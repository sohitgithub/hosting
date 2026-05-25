#!/usr/bin/env node
/**
 * Raises MySQL max_allowed_packet (global + shows current value).
 * Usage: cd backend && npm run db:fix-packet
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';
import { ensureGlobalMaxAllowedPacket, getMaxAllowedPacketBytes } from '../src/config/mysqlPacket.js';

const cfg = {
  host: process.env.MYSQL_HOST || 'localhost',
  port: Number(process.env.MYSQL_PORT) || 3306,
  user: process.env.MYSQL_ROOT_USER || 'root',
  password: process.env.MYSQL_ROOT_PASSWORD ?? '',
};

async function show(label, user, password) {
  const conn = await mysql.createConnection({ ...cfg, user, password });
  const [rows] = await conn.query(
    "SHOW VARIABLES WHERE Variable_name IN ('max_allowed_packet','net_buffer_length')"
  );
  await conn.end();
  console.log(`\n${label} (${user}@${cfg.host}):`);
  for (const row of rows) {
    const mb = Number(row.Value) / (1024 * 1024);
    console.log(`  ${row.Variable_name} = ${row.Value} (${mb.toFixed(1)} MB)`);
  }
}

async function main() {
  const target = getMaxAllowedPacketBytes();
  console.log(`Target max_allowed_packet: ${target} bytes (${Math.round(target / (1024 * 1024))} MB)`);

  await show('Before (root)', cfg.user, cfg.password);
  await ensureGlobalMaxAllowedPacket();
  await show('After (root)', cfg.user, cfg.password);

  const appUser = process.env.MYSQL_USER;
  const appPass = process.env.MYSQL_PASSWORD;
  if (appUser) {
    try {
      await show('App user', appUser, appPass ?? '');
    } catch (err) {
      console.warn(`\nApp user check skipped: ${err.message}`);
    }
  }

  console.log('\nRestart the API: npm run dev\n');
}

main().catch((err) => {
  console.error('\n✗ Failed:', err.message);
  console.error('Ensure MySQL is running and MYSQL_ROOT_* in backend/.env is correct.\n');
  process.exit(1);
});
