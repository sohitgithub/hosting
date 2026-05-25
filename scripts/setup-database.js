#!/usr/bin/env node
/**
 * Creates database + application user. Run once (or anytime to reset grants).
 * Usage: cd backend && npm run db:setup
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';
import { provisionDatabase } from '../src/config/db.js';

const cfg = {
  host: process.env.MYSQL_HOST || 'localhost',
  port: Number(process.env.MYSQL_PORT) || 3306,
  database: process.env.MYSQL_DATABASE || 'syntaxverse',
  user: process.env.MYSQL_USER || 'syntaxverse',
  password: process.env.MYSQL_PASSWORD ?? 'syntaxverse_dev',
  rootUser: process.env.MYSQL_ROOT_USER || 'root',
  rootPassword: process.env.MYSQL_ROOT_PASSWORD ?? '',
};

async function verifyAppUser() {
  const conn = await mysql.createConnection({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
  });
  const [rows] = await conn.query('SELECT DATABASE() AS db, USER() AS user');
  await conn.end();
  return rows[0];
}

async function main() {
  console.log('\nSyntax Verse — MySQL setup\n');
  console.log('  Host:     ', `${cfg.host}:${cfg.port}`);
  console.log('  Database: ', cfg.database);
  console.log('  App user: ', cfg.user);
  console.log('  Admin:    ', cfg.rootUser);
  console.log('');

  await provisionDatabase();

  const info = await verifyAppUser();
  console.log('\n✓ Setup complete');
  console.log(`  Connected as: ${info.user}`);
  console.log(`  Database:     ${info.db}`);
  console.log('\nStart API: npm run dev\n');
}

main().catch((err) => {
  console.error('\n✗ Setup failed\n');
  console.error(err.message || err);
  console.error('\nTips:');
  console.error('  1. Start MySQL (Docker: docker compose up -d mysql)');
  console.error('  2. Set MYSQL_ROOT_PASSWORD in backend/.env if root has a password');
  console.error('  3. Docker defaults: root pass = MYSQL_ROOT_PASSWORD from compose (default rootpass)');
  console.error('     App user in Docker: svh / svhpass — copy from docker-compose.yml\n');
  process.exit(1);
});
