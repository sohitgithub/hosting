import { createHash, randomBytes } from 'crypto';
import { ApiKey, User } from '../models/index.js';
import { formatDoc } from '../utils/formatDoc.js';
import { createLog } from './logService.js';

const MAX_KEYS_PER_USER = Number(process.env.API_KEY_MAX_PER_USER) || 10;
const KEY_PREFIX = process.env.API_KEY_PREFIX || 'svh_live_';

export function hashApiKey(plainKey) {
  return createHash('sha256').update(plainKey).digest('hex');
}

export function generatePlainApiKey() {
  const secret = randomBytes(24).toString('base64url');
  return `${KEY_PREFIX}${secret}`;
}

export function maskApiKey(prefix) {
  return `${prefix}${'•'.repeat(20)}`;
}

export async function listApiKeys(userId) {
  const rows = await ApiKey.findAll({
    where: { userId },
    order: [['createdAt', 'DESC']],
  });
  return rows.map((row) => formatApiKeyForClient(row));
}

function formatApiKeyForClient(row) {
  const data = typeof row.toJSON === 'function' ? row.toJSON() : row;
  return {
    _id: data.id,
    id: data.id,
    name: data.name,
    prefix: data.keyPrefix,
    maskedKey: maskApiKey(data.keyPrefix),
    scopes: data.scopes || ['full'],
    lastUsedAt: data.lastUsedAt,
    createdAt: data.createdAt,
    expiresAt: data.expiresAt,
  };
}

export async function createApiKey(userId, { name, scopes } = {}) {
  const count = await ApiKey.count({ where: { userId } });
  if (count >= MAX_KEYS_PER_USER) {
    throw new Error(`Maximum ${MAX_KEYS_PER_USER} API keys allowed. Revoke an old key first.`);
  }

  const plainKey = generatePlainApiKey();
  const keyHash = hashApiKey(plainKey);
  const keyPrefix = plainKey.slice(0, KEY_PREFIX.length + 8);

  const record = await ApiKey.create({
    userId,
    name: (name || 'API Key').trim().slice(0, 80),
    keyPrefix,
    keyHash,
    scopes: scopes?.length ? scopes : ['full'],
  });

  await createLog({
    userId,
    level: 'info',
    source: 'api',
    message: `API key created: ${record.name}`,
    meta: { keyPrefix },
  });

  return {
    apiKey: formatApiKeyForClient(record),
    plainKey,
    message: 'Copy this key now — it will not be shown again.',
  };
}

export async function revokeApiKey(userId, keyId) {
  const record = await ApiKey.findOne({ where: { id: keyId, userId } });
  if (!record) return null;
  await record.destroy();
  await createLog({
    userId,
    level: 'info',
    source: 'api',
    message: `API key revoked: ${record.name}`,
  });
  return record;
}

export async function renameApiKey(userId, keyId, name) {
  const record = await ApiKey.findOne({ where: { id: keyId, userId } });
  if (!record) return null;
  await record.update({ name: name.trim().slice(0, 80) });
  return formatApiKeyForClient(record);
}

/** Resolve API key → user for programmatic requests. */
export async function authenticateApiKey(plainKey) {
  if (!plainKey?.startsWith(KEY_PREFIX.slice(0, 4))) {
    return null;
  }
  const keyHash = hashApiKey(plainKey);
  const record = await ApiKey.findOne({ where: { keyHash } });
  if (!record) return null;

  if (record.expiresAt && new Date(record.expiresAt) < new Date()) {
    return null;
  }

  const user = await User.findByPk(record.userId, {
    attributes: { exclude: ['password'] },
  });
  if (!user) return null;

  record.update({ lastUsedAt: new Date() }).catch(() => {});

  return {
    user: formatDoc(user),
    apiKey: record,
  };
}
