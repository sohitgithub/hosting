import { ActivityLog, Deployment } from '../models/index.js';

const SKIP_PATHS = ['/api/health', '/api/auth/me'];
const MAX_LOG_META_BYTES = 32 * 1024;

function trimMeta(meta) {
  if (meta == null) return null;
  try {
    let json = JSON.stringify(meta);
    if (json.length <= MAX_LOG_META_BYTES) return meta;
    const trimmed = { _truncated: true, preview: json.slice(0, MAX_LOG_META_BYTES - 80) };
    return trimmed;
  } catch {
    return { _error: 'meta_not_serializable' };
  }
}

export async function createLog({ userId, level = 'info', source = 'system', message, meta = null }) {
  if (!message) return null;
  try {
    return await ActivityLog.create({
      userId: userId || null,
      level,
      source,
      message: String(message).slice(0, 4000),
      meta: trimMeta(meta),
    });
  } catch (err) {
    console.error('Failed to write log:', err.message);
    return null;
  }
}

export function shouldLogRequest(path) {
  if (!path?.startsWith('/api')) return false;
  return !SKIP_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
}

/** Pull build lines from deployments into unified log entries. */
export async function getDeploymentLogEntries(userId, limit = 50) {
  const deployments = await Deployment.findAll({
    where: { userId },
    order: [['updatedAt', 'DESC']],
    limit: 20,
    attributes: ['id', 'name', 'status', 'logs', 'updatedAt', 'createdAt'],
  });

  const entries = [];
  for (const d of deployments) {
    const lines = Array.isArray(d.logs) ? d.logs : [];
    lines.forEach((line, idx) => {
      entries.push({
        id: `dep-${d.id}-${idx}`,
        userId,
        level: line.toLowerCase().includes('fail') ? 'error' : line.toLowerCase().includes('warn') ? 'warn' : 'info',
        source: 'deployment',
        message: `[${d.name}] ${line}`,
        meta: { deploymentId: d.id, status: d.status },
        createdAt: d.updatedAt || d.createdAt,
      });
    });
    if (d.status === 'live') {
      entries.push({
        id: `dep-${d.id}-live`,
        userId,
        level: 'success',
        source: 'deployment',
        message: `[${d.name}] Deployment is live`,
        meta: { deploymentId: d.id },
        createdAt: d.updatedAt,
      });
    }
  }

  return entries.slice(0, limit);
}

export async function getUserLogs(userId, { limit = 200, source, level } = {}) {
  const where = { userId };
  if (source && source !== 'all') where.source = source;
  if (level && level !== 'all') where.level = level;

  const [activityRows, deploymentEntries] = await Promise.all([
    ActivityLog.findAll({
      where,
      order: [['createdAt', 'DESC']],
      limit: Math.min(limit, 500),
    }),
    source && source !== 'all' && source !== 'deployment'
      ? Promise.resolve([])
      : getDeploymentLogEntries(userId, 80),
  ]);

  const activity = activityRows.map((row) => ({
    id: row.id,
    userId: row.userId,
    level: row.level,
    source: row.source,
    message: row.message,
    meta: row.meta,
    createdAt: row.createdAt,
  }));

  let merged = [...activity, ...deploymentEntries];
  if (level && level !== 'all') {
    merged = merged.filter((e) => e.level === level);
  }
  if (source && source !== 'all') {
    merged = merged.filter((e) => e.source === source);
  }

  merged.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return merged.slice(0, limit);
}

export function formatLogLine(entry) {
  const ts = new Date(entry.createdAt).toISOString();
  const lvl = (entry.level || 'info').toUpperCase().padEnd(5);
  const src = (entry.source || 'system').padEnd(10);
  return `[${ts}] [${lvl}] [${src}] ${entry.message}`;
}
