#!/usr/bin/env node
/**
 * Test SMTP — sends a message to SMTP_USER (or MAIL_TEST_TO).
 * Usage: cd backend && npm run mail:test
 *        MAIL_TEST_TO=other@gmail.com npm run mail:test
 */
import 'dotenv/config';
import { initMailService, sendPasswordResetEmail } from '../src/services/mailService.js';

const to = process.env.MAIL_TEST_TO?.trim() || process.env.SMTP_USER?.trim();

async function main() {
  console.log('\nSyntax Verse — SMTP test\n');
  const init = await initMailService();
  if (!init.ok) {
    process.exit(1);
  }

  const resetUrl = `${(process.env.CLIENT_URL || 'http://localhost:5173').replace(/\/$/, '')}/reset-password?token=test`;
  const result = await sendPasswordResetEmail({
    to,
    name: 'Test User',
    resetUrl,
  });

  if (result.sent) {
    console.log(`\n✓ Email sent to ${to}`);
    console.log(`  Message-ID: ${result.messageId}\n`);
  } else {
    console.error(`\n✗ Send failed: ${result.reason}\n`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
