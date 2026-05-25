#!/usr/bin/env node
/**
 * Set a user's password from the terminal (when email reset is unavailable).
 * Usage: cd backend && npm run user:reset-password -- vishnurajput847@gmail.com NewPassword123
 */
import 'dotenv/config';
import { User, comparePassword, setPasswordWithoutHooks } from '../src/models/index.js';
import sequelize from '../src/config/db.js';

const [emailArg, ...passwordParts] = process.argv.slice(2);
const email = emailArg?.trim().toLowerCase();
const password = passwordParts.join(' ');

if (!email || !password) {
  console.error('\nUsage: npm run user:reset-password -- <email> <new-password>\n');
  console.error('Example: npm run user:reset-password -- vishnurajput847@gmail.com MyNewPass123!\n');
  process.exit(1);
}

if (password.length < 8) {
  console.error('Password must be at least 8 characters.\n');
  process.exit(1);
}

const user = await User.findOne({ where: { email } });
if (!user) {
  console.error(`No user found with email: ${email}\n`);
  process.exit(1);
}

await setPasswordWithoutHooks(user.id, password);

const fresh = await User.findByPk(user.id);
const ok = await comparePassword(password, fresh.password);
await sequelize.close();

if (!ok) {
  console.error('\n✗ Password was saved but verification failed. Contact support.\n');
  process.exit(1);
}

console.log(`\n✓ Password updated for ${email} (${user.name})\n`);
console.log('Sign in with that email and the new password you just set.\n');
