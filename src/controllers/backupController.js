import fs from 'fs';
import { formatDoc, formatDocs } from '../utils/formatDoc.js';
import {
  startUserBackup,
  runUserBackupJob,
  listUserBackups,
  getUserBackup,
  deleteUserBackup,
  restoreUserBackup,
  getBackupArchivePath,
} from '../services/backupService.js';

export const listBackups = async (req, res, next) => {
  try {
    const backups = await listUserBackups(req.user._id);
    const completed = backups.filter((b) => b.status === 'completed');
    const totalBytes = completed.reduce((s, b) => s + Number(b.sizeBytes || 0), 0);

    const formatted = formatDocs(backups).map((b) => ({
      ...b,
      sizeBytes: Number(b.sizeBytes || 0),
    }));

    res.json({
      backups: formatted,
      stats: {
        count: completed.length,
        totalBytes,
        autoDaily: process.env.BACKUP_AUTO_DAILY === 'true',
        pending: backups.filter((b) => b.status === 'pending').length,
      },
    });
  } catch (err) {
    console.error('[backup] listBackups:', err);
    res.status(500).json({ message: err.message || 'Failed to load backups' });
  }
};

export const createBackup = async (req, res, next) => {
  try {
    const type = req.body.type === 'incremental' ? 'incremental' : 'full';
    const label = req.body.label?.trim();
    const userId = req.user._id;

    const backup = await startUserBackup(userId, { type, label });
    const backupId = backup.id;

    setImmediate(() => {
      runUserBackupJob(userId, backupId, { type, label }).catch((err) => {
        console.error(`[backup] Job ${backupId} failed:`, err.message);
      });
    });

    res.status(202).json({
      message: 'Backup started. It will appear as completed when finished.',
      backup: formatDoc(backup),
    });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

export const restoreBackup = async (req, res, next) => {
  try {
    const result = await restoreUserBackup(req.user._id, req.params.id, {
      restoreSites: req.body.restoreSites !== false,
      restoreDatabases: req.body.restoreDatabases !== false,
    });
    res.json(result);
  } catch (err) {
    if (err.message.includes('not found')) {
      return res.status(404).json({ message: err.message });
    }
    next(err);
  }
};

export const downloadBackup = async (req, res, next) => {
  try {
    const backup = await getUserBackup(req.user._id, req.params.id);
    if (!backup || backup.status !== 'completed') {
      return res.status(404).json({ message: 'Backup not found' });
    }

    const filePath = getBackupArchivePath(req.user._id, backup.id);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ message: 'Backup file missing' });
    }

    const filename = `syntaxverse-backup-${backup.id}-${backup.type}.tar.gz`;
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    next(err);
  }
};

export const removeBackup = async (req, res, next) => {
  try {
    const backup = await deleteUserBackup(req.user._id, req.params.id);
    if (!backup) return res.status(404).json({ message: 'Backup not found' });
    res.json({ message: 'Backup deleted' });
  } catch (err) {
    next(err);
  }
};
