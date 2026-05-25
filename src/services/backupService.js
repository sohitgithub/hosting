import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { Domain, UserDatabase, Backup, HostingAccount } from '../models/index.js';
import { getPublicRoot } from './siteStorage.js';
import {
  exportDatabaseSql,
  importDatabaseSql,
  estimateDatabaseSize,
} from './userDatabaseService.js';
import { createLog } from './logService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const BACKUP_ROOT = path.join(__dirname, '../../data/backups');
const MAX_BACKUPS_PER_USER = Number(process.env.BACKUP_MAX_PER_USER) || 10;

export function getBackupArchivePath(userId, backupId) {
  return path.join(BACKUP_ROOT, String(userId), `${backupId}.tar.gz`);
}

async function dirSize(dir) {
  let total = 0;
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const ent of entries) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) total += await dirSize(p);
    else {
      const st = await fs.stat(p);
      total += st.size;
    }
  }
  return total;
}

async function copyDir(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const ent of entries) {
    const s = path.join(src, ent.name);
    const d = path.join(dest, ent.name);
    if (ent.isDirectory()) await copyDir(s, d);
    else await fs.copyFile(s, d);
  }
}

async function collectSiteFiles(domain, destSitesDir, sinceMs = 0) {
  const publicRoot = getPublicRoot(domain.id);
  try {
    await fs.access(publicRoot);
  } catch {
    return { files: 0, skipped: true };
  }

  const target = path.join(destSitesDir, String(domain.id), 'public_html');
  if (sinceMs > 0) {
    let copied = 0;
    await fs.mkdir(target, { recursive: true });

    async function walk(rel = '') {
      const abs = path.join(publicRoot, rel);
      const entries = await fs.readdir(abs, { withFileTypes: true });
      for (const ent of entries) {
        const relPath = rel ? `${rel}/${ent.name}` : ent.name;
        const full = path.join(publicRoot, relPath);
        if (ent.isDirectory()) {
          await walk(relPath);
        } else {
          const st = await fs.stat(full);
          if (st.mtimeMs >= sinceMs) {
            const out = path.join(target, relPath);
            await fs.mkdir(path.dirname(out), { recursive: true });
            await fs.copyFile(full, out);
            copied++;
          }
        }
      }
    }
    await walk();
    return { files: copied, skipped: false };
  }

  await copyDir(publicRoot, target);
  const files = await dirSize(target);
  return { files, skipped: false, bytes: files };
}

/** Create pending backup row (API returns immediately). */
export async function startUserBackup(userId, { type = 'full', label } = {}) {
  const pending = await Backup.count({ where: { userId, status: 'pending' } });
  if (pending > 0) {
    throw new Error('A backup is already in progress. Please wait for it to finish.');
  }

  const existing = await Backup.count({ where: { userId, status: 'completed' } });
  if (existing >= MAX_BACKUPS_PER_USER) {
    const oldest = await Backup.findOne({
      where: { userId, status: 'completed' },
      order: [['createdAt', 'ASC']],
    });
    if (oldest) await deleteUserBackup(userId, oldest.id);
  }

  const backupType = type === 'incremental' ? 'incremental' : 'full';
  return Backup.create({
    userId,
    type: backupType,
    status: 'pending',
    label: label || `${backupType === 'incremental' ? 'Incremental' : 'Full'} backup`,
  });
}

/** Run backup work for an existing pending record. */
export async function runUserBackupJob(userId, backupId, { type = 'full', label } = {}) {
  const backup = await Backup.findOne({ where: { id: backupId, userId } });
  if (!backup) throw new Error('Backup not found');
  if (backup.status !== 'pending') return backup;

  const workDir = path.join(BACKUP_ROOT, String(userId), String(backup.id));
  const sitesDir = path.join(workDir, 'sites');
  const dbDir = path.join(workDir, 'databases');

  try {
    await fs.mkdir(sitesDir, { recursive: true });
    await fs.mkdir(dbDir, { recursive: true });

    const domains = await Domain.findAll({ where: { userId } });
    const databases = await UserDatabase.findAll({ where: { userId } });

    let sinceMs = 0;
    if (backup.type === 'incremental') {
      const last = await Backup.findOne({
        where: { userId, status: 'completed' },
        order: [['completedAt', 'DESC']],
      });
      if (last?.completedAt) sinceMs = new Date(last.completedAt).getTime();
      else await backup.update({ type: 'full' });
    }

    const manifest = {
      version: 1,
      userId,
      backupId: backup.id,
      type: backup.type,
      createdAt: new Date().toISOString(),
      domains: [],
      databases: [],
    };

    for (const domain of domains) {
      const result = await collectSiteFiles(domain, sitesDir, backup.type === 'incremental' ? sinceMs : 0);
      manifest.domains.push({
        id: domain.id,
        name: domain.name,
        siteSlug: domain.siteSlug,
        filesBackedUp: result.files,
        skipped: result.skipped,
      });
    }

    for (const db of databases) {
      try {
        const sql = await exportDatabaseSql(db.dbName);
        const sqlPath = path.join(dbDir, `${db.dbName}.sql`);
        await fs.writeFile(sqlPath, sql, 'utf8');
        manifest.databases.push({
          id: db.id,
          name: db.name,
          dbName: db.dbName,
        });
      } catch (dbErr) {
        console.warn(`[backup] Skip DB ${db.dbName}:`, dbErr.message);
        manifest.databases.push({
          id: db.id,
          name: db.name,
          dbName: db.dbName,
          skipped: true,
          error: dbErr.message,
        });
      }
    }

    await fs.writeFile(path.join(workDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

    const archivePath = getBackupArchivePath(userId, backup.id);
    await fs.mkdir(path.dirname(archivePath), { recursive: true });
    try {
      execSync(`tar -czf "${archivePath}" -C "${workDir}" .`, { stdio: 'pipe', timeout: 600000 });
    } catch (tarErr) {
      throw new Error(
        tarErr.message?.includes('ENOENT')
          ? 'tar command not found. Install tar (macOS/Linux) to create backups.'
          : `Archive failed: ${tarErr.message}`
      );
    }

    const st = await fs.stat(archivePath);
    await fs.rm(workDir, { recursive: true, force: true });

    await backup.update({
      status: 'completed',
      sizeBytes: st.size,
      storagePath: archivePath,
      completedAt: new Date(),
      meta: {
        domainCount: domains.length,
        databaseCount: databases.length,
      },
    });

    try {
      await syncDiskUsage(userId);
    } catch (syncErr) {
      console.warn('[backup] syncDiskUsage:', syncErr.message);
    }

    await createLog({
      userId,
      level: 'success',
      source: 'backup',
      message: `${backup.type} backup completed (${formatBytes(st.size)})`,
      meta: { backupId: backup.id },
    });

    return backup;
  } catch (err) {
    await backup.update({
      status: 'failed',
      error: err.message,
    });
    try {
      await fs.rm(workDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    throw err;
  }
}

/** Synchronous full flow (cron / internal). */
export async function createUserBackup(userId, options = {}) {
  const backup = await startUserBackup(userId, options);
  return runUserBackupJob(userId, backup.id, options);
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

async function syncDiskUsage(userId) {
  const backups = await Backup.findAll({ where: { userId, status: 'completed' } });
  const backupBytes = backups.reduce((s, b) => s + Number(b.sizeBytes || 0), 0);

  const account = await HostingAccount.findOne({ where: { userId } });
  if (!account) return;

  let siteBytes = 0;
  try {
    const domains = await Domain.findAll({ where: { userId }, attributes: ['id'] });
    for (const d of domains) {
      const root = getPublicRoot(d.id);
      if (fsSync.existsSync(root)) siteBytes += await dirSize(root);
    }
  } catch {
    /* ignore */
  }

  const totalMb = Math.ceil((backupBytes + siteBytes) / (1024 * 1024));
  await account.update({ diskUsed: totalMb });
}

export async function listUserBackups(userId) {
  return Backup.findAll({
    where: { userId },
    order: [['createdAt', 'DESC']],
    limit: MAX_BACKUPS_PER_USER + 5,
  });
}

export async function getUserBackup(userId, backupId) {
  return Backup.findOne({ where: { id: backupId, userId } });
}

export async function deleteUserBackup(userId, backupId) {
  const backup = await getUserBackup(userId, backupId);
  if (!backup) return null;

  const archivePath = getBackupArchivePath(userId, backupId);
  try {
    await fs.unlink(archivePath);
  } catch {
    /* ignore */
  }

  await backup.destroy();
  await syncDiskUsage(userId);
  return backup;
}

export async function restoreUserBackup(userId, backupId, { restoreSites = true, restoreDatabases = true } = {}) {
  const backup = await getUserBackup(userId, backupId);
  if (!backup || backup.status !== 'completed') {
    throw new Error('Backup not found or not ready');
  }

  const archivePath = getBackupArchivePath(userId, backupId);
  if (!fsSync.existsSync(archivePath)) {
    throw new Error('Backup archive missing on disk');
  }

  const extractDir = path.join(BACKUP_ROOT, String(userId), `_restore_${backupId}`);
  await fs.rm(extractDir, { recursive: true, force: true });
  await fs.mkdir(extractDir, { recursive: true });

  try {
    execSync(`tar -xzf "${archivePath}" -C "${extractDir}"`, { stdio: 'pipe' });

    const manifestRaw = await fs.readFile(path.join(extractDir, 'manifest.json'), 'utf8');
    const manifest = JSON.parse(manifestRaw);

    if (restoreSites && manifest.domains?.length) {
      for (const d of manifest.domains) {
        const src = path.join(extractDir, 'sites', String(d.id), 'public_html');
        try {
          await fs.access(src);
        } catch {
          continue;
        }
        const dest = getPublicRoot(d.id);
        await fs.rm(dest, { recursive: true, force: true });
        await copyDir(src, dest);
      }
    }

    if (restoreDatabases && manifest.databases?.length) {
      for (const db of manifest.databases) {
        const sqlPath = path.join(extractDir, 'databases', `${db.dbName}.sql`);
        try {
          const sql = await fs.readFile(sqlPath, 'utf8');
          await importDatabaseSql(db.dbName, sql);
          const record = await UserDatabase.findOne({ where: { id: db.id, userId } });
          if (record) {
            const size = await estimateDatabaseSize(db.dbName);
            await record.update({ sizeBytes: size });
          }
        } catch (err) {
          console.warn(`Restore DB ${db.dbName}:`, err.message);
        }
      }
    }

    await createLog({
      userId,
      level: 'success',
      source: 'backup',
      message: `Restored backup from ${new Date(backup.completedAt).toLocaleString()}`,
      meta: { backupId },
    });

    return { manifest, message: 'Restore completed' };
  } finally {
    await fs.rm(extractDir, { recursive: true, force: true });
  }
}

/** Daily auto-backup for users with active hosting (optional). */
export async function runScheduledBackups() {
  if (process.env.BACKUP_AUTO_DAILY !== 'true') return;

  const accounts = await HostingAccount.findAll({ where: { status: 'active' } });
  for (const acc of accounts) {
    try {
      const last = await Backup.findOne({
        where: { userId: acc.userId, status: 'completed' },
        order: [['completedAt', 'DESC']],
      });
      const dayMs = 24 * 3600000;
      if (last && Date.now() - new Date(last.completedAt).getTime() < dayMs) continue;

      await createUserBackup(acc.userId, {
        type: 'incremental',
        label: 'Automated daily backup',
      });
      console.log(`[backup] Auto backup user ${acc.userId}`);
    } catch (err) {
      console.warn(`[backup] Auto backup failed user ${acc.userId}:`, err.message);
    }
  }
}
