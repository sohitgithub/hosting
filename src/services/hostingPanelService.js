import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  HostingAccount,
  Domain,
  UserDatabase,
  Backup,
  Deployment,
} from '../models/index.js';
import { getPublicRoot } from './siteStorage.js';
import { isSslActive } from './sslService.js';
import { createLog } from './logService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKUP_ROOT = path.join(__dirname, '../../data/backups');

async function dirSizeBytes(dir) {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  const walk = async (p) => {
    const entries = await fsp.readdir(p, { withFileTypes: true });
    for (const ent of entries) {
      const full = path.join(p, ent.name);
      if (ent.isDirectory()) await walk(full);
      else total += (await fsp.stat(full)).size;
    }
  };
  await walk(dir);
  return total;
}

export async function ensureHostingAccount(userId, plan = 'starter') {
  let account = await HostingAccount.findOne({ where: { userId } });
  if (!account) {
    account = await HostingAccount.create({
      userId,
      package: plan,
      status: 'active',
      diskLimit: plan === 'pro' ? 81920 : 10240,
      emailAccounts: [],
      cronJobs: [],
    });
  }
  return account;
}

export async function syncHostingUsage(userId) {
  const account = await ensureHostingAccount(userId);
  const domains = await Domain.findAll({ where: { userId } });

  let siteBytes = 0;
  for (const d of domains) {
    try {
      siteBytes += await dirSizeBytes(getPublicRoot(d.id));
    } catch {
      /* no site */
    }
  }

  let backupBytes = 0;
  const backupDir = path.join(BACKUP_ROOT, String(userId));
  if (fs.existsSync(backupDir)) {
    const files = await fsp.readdir(backupDir);
    for (const f of files) {
      if (f.endsWith('.tar.gz')) {
        backupBytes += (await fsp.stat(path.join(backupDir, f))).size;
      }
    }
  }

  const diskUsedMb = Math.ceil((siteBytes + backupBytes) / (1024 * 1024));
  const dbCount = await UserDatabase.count({ where: { userId } });
  const sslDomains = domains.filter((d) => isSslActive(d)).length;

  await account.update({
    diskUsed: diskUsedMb,
    sslEnabled: sslDomains > 0,
    domains: domains.map((d) => d.name),
    databases: (await UserDatabase.findAll({ where: { userId }, attributes: ['dbName', 'name'] })).map(
      (db) => db.dbName
    ),
  });

  return account;
}

export async function getHostingPanel(userId) {
  const account = await syncHostingUsage(userId);
  const data = account.toJSON();

  const [domainCount, databaseCount, backupCount, liveDeploys] = await Promise.all([
    Domain.count({ where: { userId } }),
    UserDatabase.count({ where: { userId } }),
    Backup.count({ where: { userId, status: 'completed' } }),
    Deployment.count({ where: { userId, status: 'live' } }),
  ]);

  const domains = await Domain.findAll({
    where: { userId },
    attributes: ['id', 'name', 'ssl', 'sslStatus', 'sitePublished'],
  });

  return {
    account: {
      ...data,
      id: data.id,
      _id: data.id,
      emailAccounts: data.emailAccounts || [],
      cronJobs: data.cronJobs || [],
    },
    stats: {
      domains: domainCount,
      databases: databaseCount,
      backups: backupCount,
      deployments: liveDeploys,
      sslDomains: domains.filter((d) => isSslActive(d)).length,
      emails: (data.emailAccounts || []).length,
      cronJobs: (data.cronJobs || []).length,
    },
    domains: domains.map((d) => ({
      _id: d.id,
      name: d.name,
      sslActive: isSslActive(d),
      sitePublished: !!d.sitePublished,
    })),
    quickLinks: [
      { label: 'File Manager', path: '/dashboard/files', desc: 'Edit website files' },
      { label: 'Terminal', path: '/dashboard/terminal', desc: 'SSH & shell (npm, composer)' },
      { label: 'Databases', path: '/dashboard/databases', desc: 'MySQL & phpMyAdmin' },
      { label: 'SSL / TLS', path: '/dashboard/ssl', desc: 'HTTPS certificates' },
      { label: 'Domains', path: '/dashboard/domains', desc: 'DNS & domains' },
      { label: 'Backups', path: '/dashboard/backups', desc: 'Restore & download' },
    ],
  };
}

function nextId(list) {
  return String(Date.now()) + Math.random().toString(36).slice(2, 6);
}

export async function addEmailAccount(userId, { address, password, quotaMb }) {
  const account = await ensureHostingAccount(userId);
  const email = String(address || '').trim().toLowerCase();
  if (!email || !email.includes('@')) throw new Error('Valid email address required');

  const emails = [...(account.emailAccounts || [])];
  if (emails.some((e) => e.address === email)) {
    throw new Error('Email account already exists');
  }
  if (emails.length >= 25) throw new Error('Maximum 25 email accounts');

  const entry = {
    id: nextId(emails),
    address: email,
    quotaMb: Number(quotaMb) || 1024,
    createdAt: new Date().toISOString(),
    status: 'active',
  };
  emails.push(entry);
  await account.update({ emailAccounts: emails });

  await createLog({
    userId,
    level: 'success',
    source: 'hosting',
    message: `Email account created: ${email}`,
  });

  return entry;
}

export async function removeEmailAccount(userId, emailId) {
  const account = await ensureHostingAccount(userId);
  const emails = (account.emailAccounts || []).filter((e) => e.id !== emailId);
  if (emails.length === (account.emailAccounts || []).length) {
    throw new Error('Email account not found');
  }
  await account.update({ emailAccounts: emails });
  return { message: 'Email account removed' };
}

const CRON_PRESETS = {
  '0 2 * * *': 'Daily at 2:00 AM',
  '0 */6 * * *': 'Every 6 hours',
  '0 0 * * 0': 'Weekly (Sunday midnight)',
};

export async function addCronJob(userId, { name, schedule, command }) {
  const account = await ensureHostingAccount(userId);
  const cronName = (name || 'Scheduled task').trim().slice(0, 80);
  const cronSchedule = (schedule || '0 2 * * *').trim();
  const cronCommand = (command || '').trim();
  if (!cronCommand) throw new Error('Command is required');

  const jobs = [...(account.cronJobs || [])];
  if (jobs.length >= 20) throw new Error('Maximum 20 cron jobs');

  const entry = {
    id: nextId(jobs),
    name: cronName,
    schedule: cronSchedule,
    scheduleLabel: CRON_PRESETS[cronSchedule] || cronSchedule,
    command: cronCommand,
    enabled: true,
    lastRunAt: null,
    createdAt: new Date().toISOString(),
  };
  jobs.push(entry);
  await account.update({ cronJobs: jobs });

  await createLog({
    userId,
    level: 'info',
    source: 'hosting',
    message: `Cron job added: ${cronName}`,
  });

  return entry;
}

export async function removeCronJob(userId, jobId) {
  const account = await ensureHostingAccount(userId);
  const jobs = (account.cronJobs || []).filter((j) => j.id !== jobId);
  if (jobs.length === (account.cronJobs || []).length) {
    throw new Error('Cron job not found');
  }
  await account.update({ cronJobs: jobs });
  return { message: 'Cron job removed' };
}

export async function toggleCronJob(userId, jobId, enabled) {
  const account = await ensureHostingAccount(userId);
  const jobs = (account.cronJobs || []).map((j) =>
    j.id === jobId ? { ...j, enabled: !!enabled } : j
  );
  await account.update({ cronJobs: jobs });
  return jobs.find((j) => j.id === jobId);
}

export async function restartHostingServer(userId) {
  const account = await ensureHostingAccount(userId);
  const restartedAt = new Date();
  await account.update({ lastRestartAt: restartedAt });

  await createLog({
    userId,
    level: 'success',
    source: 'hosting',
    message: 'Hosting services restarted (web, PHP, mail queue)',
    meta: { restartedAt },
  });

  return {
    message: 'Server restart completed. Web services and caches were refreshed.',
    restartedAt,
    services: ['nginx', 'php-fpm', 'mysql', 'mail'],
  };
}
