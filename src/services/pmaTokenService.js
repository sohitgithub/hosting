import { randomBytes } from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKEN_DIR = path.join(__dirname, '../../data/pma-tokens');
const TTL_MS = Number(process.env.PMA_TOKEN_TTL_MS) || 300_000; // 5 minutes
const MAX_USES = Number(process.env.PMA_TOKEN_MAX_USES) || 5;

const memory = new Map();

function tokenFile(token) {
  return path.join(TOKEN_DIR, `${token}.json`);
}

function readToken(token) {
  if (memory.has(token)) return memory.get(token);
  const file = tokenFile(token);
  if (!fs.existsSync(file)) return null;
  try {
    const entry = JSON.parse(fs.readFileSync(file, 'utf8'));
    memory.set(token, entry);
    return entry;
  } catch {
    return null;
  }
}

function writeToken(token, entry) {
  fs.mkdirSync(TOKEN_DIR, { recursive: true });
  fs.writeFileSync(tokenFile(token), JSON.stringify(entry));
  memory.set(token, entry);
}

function deleteToken(token) {
  memory.delete(token);
  const file = tokenFile(token);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

export function createPmaToken(payload) {
  const token = randomBytes(24).toString('hex');
  const entry = {
    ...payload,
    expires: Date.now() + TTL_MS,
    uses: 0,
    maxUses: MAX_USES,
  };
  writeToken(token, entry);
  return token;
}

/** Validate token and return credentials (supports multiple reads for phpMyAdmin redirects). */
export function consumePmaToken(token) {
  const entry = readToken(token);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    deleteToken(token);
    return null;
  }

  entry.uses = (entry.uses || 0) + 1;
  const maxUses = entry.maxUses ?? MAX_USES;

  if (entry.uses > maxUses) {
    deleteToken(token);
    return null;
  }

  if (entry.uses >= maxUses) {
    deleteToken(token);
  } else {
    writeToken(token, entry);
  }

  const { expires, uses, maxUses: _m, ...payload } = entry;
  return payload;
}

export function getPhpMyAdminPublicUrl() {
  return (process.env.PHPMYADMIN_URL || 'http://localhost:8080').replace(/\/$/, '');
}

export function getPmaBridgeBaseUrl() {
  return (process.env.PMA_BRIDGE_URL || `http://127.0.0.1:${process.env.PORT || 5000}`).replace(
    /\/$/,
    ''
  );
}
