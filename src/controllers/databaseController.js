import { UserDatabase } from '../models/index.js';
import { formatDoc, formatDocs } from '../utils/formatDoc.js';
import { createLog } from '../services/logService.js';
import {
  createMysqlDatabase,
  dropMysqlDatabase,
  exportDatabaseSql,
  importDatabaseSql,
  estimateDatabaseSize,
  getConnectionInfo,
  generateDbPassword,
  getAdminConnection,
  getDatabaseLimit,
} from '../services/userDatabaseService.js';
import {
  createPmaToken,
  consumePmaToken,
  getPhpMyAdminPublicUrl,
} from '../services/pmaTokenService.js';
import { checkPhpMyAdminReachable, getPmaMysqlHost } from '../services/pmaHealthService.js';

const findUserDb = async (id, userId) =>
  UserDatabase.findOne({ where: { id, userId } });

export const listDatabases = async (req, res, next) => {
  try {
    const rows = await UserDatabase.findAll({
      where: { userId: req.user._id },
      order: [['createdAt', 'DESC']],
    });

    const limit = await getDatabaseLimit(req.user._id, req.user.plan);

    const enriched = await Promise.all(
      rows.map(async (row) => {
        let sizeBytes = row.sizeBytes;
        try {
          sizeBytes = await estimateDatabaseSize(row.dbName);
          if (sizeBytes !== row.sizeBytes) await row.update({ sizeBytes });
        } catch {
          /* db may be missing */
        }
        const doc = formatDoc(row);
        return {
          ...doc,
          dbPassword: row.dbPassword,
          connection: getConnectionInfo(row),
        };
      })
    );

    res.json({
      databases: enriched,
      limit,
      used: rows.length,
    });
  } catch (err) {
    next(err);
  }
};

export const getPhpMyAdminInfo = async (req, res) => {
  const url = getPhpMyAdminPublicUrl();
  const health = await checkPhpMyAdminReachable();
  res.json({
    enabled: !!url,
    url,
    reachable: health.reachable,
    message: health.message,
    startHint: 'npm run pma:up',
  });
};

export const openPhpMyAdmin = async (req, res, next) => {
  try {
    const record = await findUserDb(req.params.id, req.user._id);
    if (!record) return res.status(404).json({ message: 'Database not found' });

    const health = await checkPhpMyAdminReachable();
    if (!health.reachable) {
      return res.status(503).json({
        message:
          health.message ||
          'phpMyAdmin is not running. From the project root run: npm run pma:up',
        startHint: 'npm run pma:up',
      });
    }

    const token = createPmaToken({
      dbUser: record.dbUser,
      dbPassword: record.dbPassword,
      database: record.dbName,
      host: getPmaMysqlHost(),
      port: record.port || Number(process.env.MYSQL_PORT) || 3306,
    });

    const base = getPhpMyAdminPublicUrl();
    res.json({
      url: `${base}/signon.php?token=${token}`,
      phpMyAdminUrl: base,
    });
  } catch (err) {
    next(err);
  }
};

/** One-time bridge for phpMyAdmin signon.php (no auth — token is single-use). */
export const pmaBridge = async (req, res) => {
  const payload = consumePmaToken(req.params.token);
  if (!payload) {
    return res.status(401).json({ message: 'Invalid or expired session' });
  }
  res.json({
    user: payload.dbUser,
    password: payload.dbPassword,
    database: payload.database,
    host: payload.host,
    port: payload.port,
  });
};

export const createDatabase = async (req, res, next) => {
  try {
    const dbName = req.body.dbName?.trim();
    const dbUser = req.body.dbUser?.trim();
    const dbPassword = req.body.dbPassword;
    const name = req.body.name?.trim() || dbName;

    if (!dbName) return res.status(400).json({ message: 'Database name is required' });
    if (!dbUser) return res.status(400).json({ message: 'Database username is required' });
    if (!dbPassword) return res.status(400).json({ message: 'Database password is required' });

    const record = await createMysqlDatabase({
      userId: req.user._id,
      name,
      dbName,
      dbUser,
      dbPassword,
    });

    await createLog({
      userId: req.user._id,
      level: 'success',
      source: 'database',
      message: `MySQL database created: ${record.dbName}`,
      meta: { databaseId: record.id },
    });

    const doc = formatDoc(record);
    res.status(201).json({
      ...doc,
      connection: getConnectionInfo(record),
      message: 'Database created successfully',
    });
  } catch (err) {
    if (err.message?.includes('limit reached')) {
      return res.status(400).json({ message: err.message });
    }
    next(err);
  }
};

export const getDatabase = async (req, res, next) => {
  try {
    const record = await findUserDb(req.params.id, req.user._id);
    if (!record) return res.status(404).json({ message: 'Database not found' });

    const sizeBytes = await estimateDatabaseSize(record.dbName).catch(() => record.sizeBytes);
    if (sizeBytes !== record.sizeBytes) await record.update({ sizeBytes });

    res.json({
      ...formatDoc(record),
      connection: getConnectionInfo(record),
    });
  } catch (err) {
    next(err);
  }
};

export const deleteDatabase = async (req, res, next) => {
  try {
    const record = await findUserDb(req.params.id, req.user._id);
    if (!record) return res.status(404).json({ message: 'Database not found' });

    const name = record.dbName;
    await dropMysqlDatabase(record);

    await createLog({
      userId: req.user._id,
      level: 'warn',
      source: 'database',
      message: `MySQL database deleted: ${name}`,
    });

    res.json({ message: 'Database deleted' });
  } catch (err) {
    next(err);
  }
};

export const exportDatabase = async (req, res, next) => {
  try {
    const record = await findUserDb(req.params.id, req.user._id);
    if (!record) return res.status(404).json({ message: 'Database not found' });

    const sql = await exportDatabaseSql(record.dbName);
    const filename = `${record.dbName}_${new Date().toISOString().slice(0, 10)}.sql`;

    await createLog({
      userId: req.user._id,
      level: 'info',
      source: 'database',
      message: `Database exported: ${record.dbName}`,
    });

    res.setHeader('Content-Type', 'application/sql; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(sql);
  } catch (err) {
    next(err);
  }
};

export const importDatabase = async (req, res, next) => {
  try {
    const record = await findUserDb(req.params.id, req.user._id);
    if (!record) return res.status(404).json({ message: 'Database not found' });

    if (!req.file?.buffer && !req.body?.sql) {
      return res.status(400).json({ message: 'Upload a .sql file or send sql in body' });
    }

    const sqlContent = req.file?.buffer
      ? req.file.buffer.toString('utf8')
      : String(req.body.sql);

    const sizeBytes = await importDatabaseSql(record.dbName, sqlContent);
    await record.update({ sizeBytes, status: 'running' });

    await createLog({
      userId: req.user._id,
      level: 'success',
      source: 'database',
      message: `Database imported into ${record.dbName}`,
      meta: { bytes: sqlContent.length },
    });

    res.json({
      message: 'Import completed successfully',
      sizeBytes,
      ...formatDoc(record),
    });
  } catch (err) {
    next(err);
  }
};

export const resetDatabasePassword = async (req, res, next) => {
  try {
    const record = await findUserDb(req.params.id, req.user._id);
    if (!record) return res.status(404).json({ message: 'Database not found' });

    const password = generateDbPassword();
    const conn = await getAdminConnection();
    try {
      const hosts = ['localhost', '127.0.0.1', '%'];
      for (const host of hosts) {
        await conn.query(`ALTER USER '${record.dbUser}'@'${host}' IDENTIFIED BY ?`, [password]);
      }
      await conn.query('FLUSH PRIVILEGES');
    } finally {
      await conn.end();
    }

    await record.update({ dbPassword: password });

    await createLog({
      userId: req.user._id,
      level: 'info',
      source: 'database',
      message: `Database password reset: ${record.dbUser}`,
    });

    res.json({
      message: 'Password updated',
      connection: getConnectionInfo(record),
      ...formatDoc(record),
    });
  } catch (err) {
    next(err);
  }
};
