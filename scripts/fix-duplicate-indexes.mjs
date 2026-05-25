/**
 * Remove duplicate indexes created by repeated Sequelize sync({ alter: true }).
 * Run: node scripts/fix-duplicate-indexes.mjs
 */
import 'dotenv/config';
import sequelize from '../src/config/db.js';

function pickIndexToKeep(names, cols) {
  if (names.includes('PRIMARY')) return 'PRIMARY';
  const preferred = names.find((n) => n === cols || n === `${cols}` || n.endsWith(`_${cols}`));
  if (preferred) return preferred;
  const withoutSuffix = names.filter((n) => !/_\d+$/.test(n) && n !== 'PRIMARY');
  if (withoutSuffix.length) return withoutSuffix.sort((a, b) => a.length - b.length)[0];
  return names.sort((a, b) => a.length - b.length)[0];
}

async function dedupeTable(tableName) {
  const [rows] = await sequelize.query(
    `
    SELECT INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols, NON_UNIQUE
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table
    GROUP BY INDEX_NAME, NON_UNIQUE
    `,
    { replacements: { table: tableName } }
  );

  const byCols = new Map();
  for (const row of rows) {
    const key = `${row.cols}:${row.NON_UNIQUE}`;
    if (!byCols.has(key)) byCols.set(key, []);
    byCols.get(key).push(row.INDEX_NAME);
  }

  let dropped = 0;
  for (const [key, names] of byCols) {
    if (names.length <= 1) continue;
    const cols = key.split(':')[0];
    const keep = pickIndexToKeep(names, cols);
    for (const name of names) {
      if (name === keep || name === 'PRIMARY') continue;
      await sequelize.query(`ALTER TABLE \`${tableName}\` DROP INDEX \`${name}\``);
      console.log(`  dropped ${tableName}.${name} (kept ${keep})`);
      dropped++;
    }
  }
  return dropped;
}

async function main() {
  await sequelize.authenticate();
  const tables = ['api_keys', 'users', 'domains', 'activity_logs', 'user_databases', 'backups'];
  let total = 0;
  for (const table of tables) {
    try {
      const n = await dedupeTable(table);
      if (n) console.log(`${table}: removed ${n} duplicate index(es)`);
      total += n;
    } catch (err) {
      if (err.message?.includes("doesn't exist")) continue;
      console.warn(`${table}:`, err.message);
    }
  }
  console.log(total ? `Done. Removed ${total} duplicate indexes.` : 'No duplicate indexes found.');
  await sequelize.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
