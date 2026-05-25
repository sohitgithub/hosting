import mysql from 'mysql2/promise';
import { randomBytes } from 'crypto';
import { UserDatabase, HostingAccount } from '../models/index.js';
import { executeSqlInChunks, setSessionMaxAllowedPacket } from '../config/mysqlPacket.js';

const DB_LIMITS = { starter: 5, pro: 15, enterprise: 50, admin: 100 };

const adminConfig = () => ({
  host: process.env.MYSQL_HOST || 'localhost',
  port: Number(process.env.MYSQL_PORT) || 3306,
  user: process.env.MYSQL_ROOT_USER || 'root',
  password: process.env.MYSQL_ROOT_PASSWORD ?? '',
});

export async function getAdminConnection(database = null) {
  const cfg = adminConfig();
  const conn = await mysql.createConnection({
    ...cfg,
    database: database || undefined,
    multipleStatements: true,
  });
  await setSessionMaxAllowedPacket(conn);
  return conn;
}

export function sanitizeLabel(name) {
  return String(name || 'db')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_')
    .slice(0, 28) || 'db';
}

export function validateMysqlIdentifier(value, label, { min = 3, max = 28 } = {}) {
  const s = sanitizeLabel(value);
  if (s.length < min) throw new Error(`${label} must be at least ${min} characters (letters, numbers, underscore)`);
  if (s.length > max) throw new Error(`${label} must be at most ${max} characters`);
  if (/^\d/.test(s)) throw new Error(`${label} cannot start with a number`);
  return s;
}

export function validatePassword(password) {
  if (!password || String(password).length < 8) {
    throw new Error('Password must be at least 8 characters');
  }
  if (String(password).length > 64) throw new Error('Password must be at most 64 characters');
}

export function buildIdentifiers(userId, dbNameInput, dbUserInput) {
  const slug = validateMysqlIdentifier(dbNameInput, 'Database name');
  const userSlug = validateMysqlIdentifier(dbUserInput, 'Username', { max: 16 });
  const dbName = `svh_u${userId}_${slug}`.slice(0, 64);
  const dbUser = `svh_u${userId}_${userSlug}`.slice(0, 32);
  return { dbName, dbUser, slug, userSlug };
}

export function generateDbPassword() {
  return randomBytes(12).toString('base64url').slice(0, 16);
}

export async function getDatabaseLimit(userId, userPlan = 'starter') {
  const account = await HostingAccount.findOne({ where: { userId } });
  const plan = account?.package || userPlan || 'starter';
  return DB_LIMITS[plan] || DB_LIMITS.starter;
}

export async function syncHostingDatabaseList(userId) {
  const account = await HostingAccount.findOne({ where: { userId } });
  if (!account) return;
  const rows = await UserDatabase.findAll({
    where: { userId },
    order: [['createdAt', 'DESC']],
  });
  await account.update({
    databases: rows.map((d) => ({
      id: d.id,
      name: d.name,
      dbName: d.dbName,
      engine: d.engine,
      status: d.status,
      sizeBytes: d.sizeBytes,
    })),
  });
}

export async function estimateDatabaseSize(dbName) {
  const conn = await getAdminConnection();
  try {
    const [rows] = await conn.query(
      `
      SELECT COALESCE(SUM(data_length + index_length), 0) AS size
      FROM information_schema.tables
      WHERE table_schema = ?
    `,
      [dbName]
    );
    return Number(rows[0]?.size || 0);
  } finally {
    await conn.end();
  }
}

export async function createMysqlDatabase({ userId, name, dbName: dbNameInput, dbUser: dbUserInput, dbPassword }) {
  const count = await UserDatabase.count({ where: { userId } });
  const limit = await getDatabaseLimit(userId);
  if (count >= limit) {
    throw new Error(`Database limit reached (${limit}). Upgrade your plan for more.`);
  }

  validatePassword(dbPassword);
  const label = String(name || dbNameInput || '').trim() || dbNameInput;
  const { dbName, dbUser } = buildIdentifiers(userId, dbNameInput, dbUserInput);

  const existing = await UserDatabase.findOne({
    where: { dbName },
  });
  if (existing) throw new Error('This database name is already in use');

  const existingUser = await UserDatabase.findOne({ where: { dbUser } });
  if (existingUser) throw new Error('This database username is already in use');

  const password = String(dbPassword);
  const conn = await getAdminConnection();

  try {
    await conn.query(
      `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );

    const hosts = ['localhost', '127.0.0.1', '%'];
    for (const host of hosts) {
      await conn.query(`CREATE USER IF NOT EXISTS '${dbUser}'@'${host}' IDENTIFIED BY ?`, [password]);
      await conn.query(`GRANT ALL PRIVILEGES ON \`${dbName}\`.* TO '${dbUser}'@'${host}'`);
    }
    await conn.query('FLUSH PRIVILEGES');
  } finally {
    await conn.end();
  }

  const sizeBytes = await estimateDatabaseSize(dbName);
  const host = process.env.MYSQL_HOST || 'localhost';
  const port = Number(process.env.MYSQL_PORT) || 3306;

  const record = await UserDatabase.create({
    userId,
    name: label,
    dbName,
    dbUser,
    dbPassword: password,
    host,
    port,
    engine: 'mysql',
    status: 'running',
    sizeBytes,
  });

  await syncHostingDatabaseList(userId);
  return record;
}

export async function dropMysqlDatabase(record) {
  const conn = await getAdminConnection();
  try {
    await conn.query(`DROP DATABASE IF EXISTS \`${record.dbName}\``);
    const hosts = ['localhost', '127.0.0.1', '%'];
    for (const host of hosts) {
      await conn.query(`DROP USER IF EXISTS '${record.dbUser}'@'${host}'`);
    }
    await conn.query('FLUSH PRIVILEGES');
  } finally {
    await conn.end();
  }
  await record.destroy();
  await syncHostingDatabaseList(record.userId);
}

function escapeSqlValue(val) {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'number' && !Number.isNaN(val)) return String(val);
  if (typeof val === 'bigint') return String(val);
  if (val instanceof Date) {
    return `'${val.toISOString().slice(0, 19).replace('T', ' ')}'`;
  }
  if (Buffer.isBuffer(val)) return `X'${val.toString('hex')}'`;
  if (typeof val === 'object') return `'${JSON.stringify(val).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  return `'${String(val).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
}

export async function exportDatabaseSql(dbName) {
  const conn = await getAdminConnection();
  const lines = [
    '-- Syntax Verse Hosting — MySQL Export',
    `-- Database: ${dbName}`,
    `-- Generated: ${new Date().toISOString()}`,
    'SET NAMES utf8mb4;',
    'SET FOREIGN_KEY_CHECKS=0;',
    '',
    `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`,
    `USE \`${dbName}\`;`,
    '',
  ];

  try {
    const [tables] = await conn.query(
      `SELECT table_name AS name FROM information_schema.tables WHERE table_schema = ? AND table_type = 'BASE TABLE'`,
      [dbName]
    );

    for (const { name: tableName } of tables) {
      const [createRows] = await conn.query(`SHOW CREATE TABLE \`${dbName}\`.\`${tableName}\``);
      const createSql = createRows[0]['Create Table'];
      lines.push(`DROP TABLE IF EXISTS \`${tableName}\`;`);
      lines.push(`${createSql};`);
      lines.push('');

      const [rows] = await conn.query(`SELECT * FROM \`${dbName}\`.\`${tableName}\``);
      if (rows.length > 0) {
        const cols = Object.keys(rows[0]).map((c) => `\`${c}\``).join(', ');
        for (const row of rows) {
          const vals = Object.values(row).map(escapeSqlValue).join(', ');
          lines.push(`INSERT INTO \`${tableName}\` (${cols}) VALUES (${vals});`);
        }
        lines.push('');
      }
    }
  } finally {
    await conn.end();
  }

  lines.push('SET FOREIGN_KEY_CHECKS=1;');
  return lines.join('\n');
}

export async function importDatabaseSql(dbName, sqlContent) {
  if (!sqlContent?.trim()) throw new Error('SQL file is empty');

  const conn = await getAdminConnection();
  try {
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await conn.query(`USE \`${dbName}\``);

    await executeSqlInChunks(conn, sqlContent);
  } finally {
    await conn.end();
  }

  return estimateDatabaseSize(dbName);
}

export function getConnectionInfo(record) {
  const host = record.host || process.env.MYSQL_HOST || 'localhost';
  const port = record.port || Number(process.env.MYSQL_PORT) || 3306;
  return {
    host,
    port,
    database: record.dbName,
    username: record.dbUser,
    password: record.dbPassword,
    jdbc: `jdbc:mysql://${host}:${port}/${record.dbName}`,
    node: `mysql://${record.dbUser}:${encodeURIComponent(record.dbPassword)}@${host}:${port}/${record.dbName}`,
    php: `mysqli_connect('${host}', '${record.dbUser}', '${record.dbPassword}', '${record.dbName}', ${port});`,
  };
}
