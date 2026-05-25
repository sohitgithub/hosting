#!/usr/bin/env node
import 'dotenv/config';
import { connectDB } from '../src/config/db.js';
import { syncModels } from '../src/models/index.js';

async function main() {
  await connectDB();
  await syncModels();
  console.log('✓ Database connection and tables OK');
  process.exit(0);
}

main().catch((err) => {
  console.error('✗', err.message || err);
  process.exit(1);
});
