import mysql from 'mysql2/promise';

/** Default 64MB — avoids ER_NET_PACKET_TOO_LARGE on large JSON rows and SQL imports. */
export const DEFAULT_MAX_ALLOWED_PACKET = 64 * 1024 * 1024;

export function getMaxAllowedPacketBytes() {
  const n = Number(process.env.MYSQL_MAX_ALLOWED_PACKET);
  return Number.isFinite(n) && n >= 1024 * 1024 ? Math.floor(n) : DEFAULT_MAX_ALLOWED_PACKET;
}

function adminConfig() {
  return {
    host: process.env.MYSQL_HOST || 'localhost',
    port: Number(process.env.MYSQL_PORT) || 3306,
    user: process.env.MYSQL_ROOT_USER || 'root',
    password: process.env.MYSQL_ROOT_PASSWORD ?? '',
  };
}

/** Per-connection limit (app user pool + ad-hoc connections). */
export async function setSessionMaxAllowedPacket(connection) {
  const size = getMaxAllowedPacketBytes();
  const query = connection?.promise?.query
    ? connection.promise().query.bind(connection.promise())
    : connection.query.bind(connection);
  await query(`SET SESSION max_allowed_packet = ${size}`);
}

/**
 * Raise server-wide limit (needs SUPER). Safe to call on every API boot.
 * Falls back to session-only if root cannot SET GLOBAL.
 */
export async function ensureGlobalMaxAllowedPacket() {
  const size = getMaxAllowedPacketBytes();
  let conn;
  try {
    conn = await mysql.createConnection(adminConfig());
    await conn.query(`SET GLOBAL max_allowed_packet = ${size}`);
    console.log(`MySQL max_allowed_packet → ${Math.round(size / (1024 * 1024))}MB (global)`);
    return true;
  } catch (err) {
    console.warn(
      `MySQL: could not SET GLOBAL max_allowed_packet (${err.message}). Using SESSION on each connection.`
    );
    return false;
  } finally {
    if (conn) await conn.end();
  }
}

export function isPacketTooLargeError(err) {
  const msg = err?.message || err?.parent?.message || '';
  const code = err?.code || err?.parent?.code;
  return (
    code === 'ER_NET_PACKET_TOO_LARGE' ||
    /max_allowed_packet/i.test(msg) ||
    /packet bigger/i.test(msg)
  );
}

/** Split SQL dump into executable statements (handles quoted strings). */
export function* iterateSqlStatements(sql) {
  let buf = '';
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  let escaped = false;

  const flush = () => {
    const stmt = buf.trim();
    buf = '';
    if (!stmt || /^--/.test(stmt)) return null;
    return stmt;
  };

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];

    if (inSingle || inDouble || inBacktick) {
      buf += ch;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (inSingle && ch === "'") inSingle = false;
      else if (inDouble && ch === '"') inDouble = false;
      else if (inBacktick && ch === '`') inBacktick = false;
      continue;
    }

    if (ch === "'") {
      inSingle = true;
      buf += ch;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      buf += ch;
      continue;
    }
    if (ch === '`') {
      inBacktick = true;
      buf += ch;
      continue;
    }

    if (ch === ';') {
      const stmt = flush();
      if (stmt) yield stmt;
      continue;
    }

    buf += ch;
  }

  const last = flush();
  if (last) yield last;
}

/** Run a dump in batches so no single protocol packet exceeds max_allowed_packet. */
export async function executeSqlInChunks(conn, sqlContent, { chunkBytes = 2 * 1024 * 1024 } = {}) {
  const cleaned = sqlContent.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  let batch = '';
  let batchBytes = 0;

  const flush = async () => {
    const sql = batch.trim();
    batch = '';
    batchBytes = 0;
    if (!sql) return;
    await conn.query({ sql, multipleStatements: true });
  };

  for (const stmt of iterateSqlStatements(cleaned)) {
    const piece = `${stmt};\n`;
    const pieceBytes = Buffer.byteLength(piece, 'utf8');
    if (pieceBytes > chunkBytes) {
      await flush();
      await conn.query(stmt);
      continue;
    }
    if (batchBytes + pieceBytes > chunkBytes && batchBytes > 0) {
      await flush();
    }
    batch += piece;
    batchBytes += pieceBytes;
  }

  await flush();
}
