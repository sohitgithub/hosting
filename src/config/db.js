import { Sequelize } from 'sequelize';
import mysql from 'mysql2/promise';
import {
  ensureGlobalMaxAllowedPacket,
  isPacketTooLargeError,
  setSessionMaxAllowedPacket,
} from './mysqlPacket.js';

const config = () => ({
  host: process.env.MYSQL_HOST || 'localhost',
  port: Number(process.env.MYSQL_PORT) || 3306,
  database: process.env.MYSQL_DATABASE || 'syntaxverse',
  user: process.env.MYSQL_USER || 'syntaxverse',
  password: process.env.MYSQL_PASSWORD ?? 'syntaxverse_dev',
  rootUser: process.env.MYSQL_ROOT_USER || 'root',
  rootPassword: process.env.MYSQL_ROOT_PASSWORD ?? '',
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Create database + app user with grants (uses root/admin credentials). */
export async function provisionDatabase() {
  const { host, port, database, user, password, rootUser, rootPassword } = config();

  let connection;
  try {
    connection = await mysql.createConnection({
      host,
      port,
      user: rootUser,
      password: rootPassword,
      multipleStatements: true,
    });
  } catch (err) {
    throw new Error(
      `Cannot connect as MySQL admin (${rootUser}@${host}:${port}). ` +
        `Set MYSQL_ROOT_USER and MYSQL_ROOT_PASSWORD in backend/.env, then run: npm run db:setup\n` +
        `Original: ${err.message}`
    );
  }

  try {
    await connection.query(
      `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );

    const safeUser = user.replace(/'/g, "''");
    const hosts = ['localhost', '127.0.0.1', '%'];

    for (const h of hosts) {
      await connection.query(
        `CREATE USER IF NOT EXISTS '${safeUser}'@'${h}' IDENTIFIED BY ?`,
        [password]
      );
      await connection.query(`GRANT ALL PRIVILEGES ON \`${database}\`.* TO '${safeUser}'@'${h}'`);
    }

    await connection.query('FLUSH PRIVILEGES');
    console.log(`Database ready: ${database} (user: ${user})`);
  } finally {
    await connection.end();
  }
}

function formatDbError(err) {
  const { host, port, database, user } = config();
  const msg = err?.message || String(err);

  if (msg.includes('ECONNREFUSED')) {
    return new Error(
      `MySQL is not running on ${host}:${port}.\n` +
        `  • Docker: docker compose up -d mysql\n` +
        `  • Mac: brew services start mysql\n` +
        `  • Then: cd backend && npm run db:setup`
    );
  }
  if (msg.includes('Access denied')) {
    return new Error(
      `MySQL access denied for user "${user}".\n` +
        `  Run: cd backend && npm run db:setup\n` +
        `  Or fix MYSQL_USER / MYSQL_PASSWORD in backend/.env`
    );
  }
  if (msg.includes('Unknown database')) {
    return new Error(`Database "${database}" does not exist. Run: cd backend && npm run db:setup`);
  }
  if (isPacketTooLargeError(err)) {
    return new Error(
      `MySQL packet too large (max_allowed_packet). Run: cd backend && npm run db:fix-packet\n` +
        `Or set MYSQL_MAX_ALLOWED_PACKET in .env and restart MySQL.\n` +
        `Original: ${msg}`
    );
  }
  return err;
}

const { host, port, database, user, password } = config();

const sequelize = new Sequelize(database, user, password, {
  host,
  port,
  dialect: 'mysql',
  logging: false,
  define: {
    underscored: true,
    timestamps: true,
  },
  pool: {
    max: 10,
    min: 0,
    acquire: 30000,
    idle: 10000,
    afterConnect: async (connection) => {
      await setSessionMaxAllowedPacket(connection);
    },
  },
});

export const connectDB = async () => {
  const autoProvision = process.env.MYSQL_AUTO_PROVISION !== 'false';
  const maxRetries = Number(process.env.MYSQL_CONNECT_RETRIES) || 12;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (autoProvision) {
        await provisionDatabase();
      } else {
        const bootstrap = new Sequelize('', user, password, {
          host,
          port,
          dialect: 'mysql',
          logging: false,
        });
        await bootstrap.query(
          `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
        );
        await bootstrap.close();
      }

      await sequelize.authenticate();
      await ensureGlobalMaxAllowedPacket();
      console.log(`MySQL connected → ${user}@${host}:${port}/${database}`);
      return;
    } catch (err) {
      const isLast = attempt === maxRetries;
      const refused = err?.message?.includes('ECONNREFUSED') || err?.original?.code === 'ECONNREFUSED';

      if (!isLast && refused) {
        console.log(`Waiting for MySQL (${attempt}/${maxRetries})…`);
        await sleep(2000);
        continue;
      }

      if (!isLast && autoProvision && err?.message?.includes('Cannot connect as MySQL admin')) {
        try {
          await sequelize.authenticate();
          console.log(`MySQL connected → ${user}@${host}:${port}/${database}`);
          return;
        } catch {
          /* try again */
        }
      }

      if (!isLast) {
        console.log(`Database connection attempt ${attempt}/${maxRetries} failed, retrying…`);
        await sleep(1500);
        continue;
      }

      throw formatDbError(err);
    }
  }
};

export default sequelize;
