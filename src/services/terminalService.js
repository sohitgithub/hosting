import { spawn } from 'child_process';
import path from 'path';
import os from 'os';
import fs from 'fs';
import crypto from 'crypto';
import { Domain, HostingAccount } from '../models/index.js';
import { getSiteRoot, getPublicRoot, ensureSiteStructure } from './siteStorage.js';
import { domainToSlug } from '../utils/siteUrls.js';
import { createLog } from './logService.js';

const sessions = new Map();
/** Idle timeout — extended on each command (survives short backend restarts if client recovers). */
const SESSION_TTL_MS = Number(process.env.TERMINAL_SESSION_TTL_MS) || 2 * 60 * 60 * 1000;
const MAX_OUTPUT = 512 * 1024;
const COMMAND_TIMEOUT_MS = Number(process.env.TERMINAL_TIMEOUT_MS) || 600000;

const DEFAULT_PATH_DIRS = [
  '/opt/homebrew/bin',
  '/opt/homebrew/sbin',
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin',
];

const BLOCKED_PATTERNS = [
  /\brm\s+-rf\s+\//i,
  /\bsudo\b/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bkillall\b/i,
  />\s*\/dev\//i,
  /\|\s*sh\b/i,
  /\bcurl\b[^\n]*\|\s*(ba)?sh/i,
  /\bwget\b[^\n]*\|\s*(ba)?sh/i,
  /:\(\)\s*\{\s*:\|:\s*&\s*\}\s*;/,
];

function randomSecret(len = 16) {
  return crypto.randomBytes(len).toString('base64url').slice(0, len);
}

function shellEscape(str) {
  return `'${String(str).replace(/'/g, `'\\''`)}'`;
}

function resolveShell() {
  const candidates = [
    process.env.TERMINAL_SHELL,
    process.env.SHELL,
    '/bin/zsh',
    '/bin/bash',
  ].filter(Boolean);
  for (const sh of candidates) {
    if (fs.existsSync(sh)) return sh;
  }
  return '/bin/sh';
}

function pathExtrasForSite(siteRoot, absCwd) {
  const extras = [];
  const dirs = [
    path.join(absCwd, 'node_modules/.bin'),
    path.join(siteRoot, 'node_modules/.bin'),
    path.join(siteRoot, 'vendor/bin'),
    path.join(absCwd, 'vendor/bin'),
  ];
  for (const d of dirs) {
    if (fs.existsSync(d)) extras.push(d);
  }
  return extras;
}

function buildTerminalEnv(domainId, absCwd) {
  const { siteRoot } = jailPaths(domainId);
  const home = process.env.HOME || os.homedir();
  const basePath = process.env.TERMINAL_PATH || process.env.PATH || DEFAULT_PATH_DIRS.join(':');
  const extras = pathExtrasForSite(siteRoot, absCwd);
  const pathSet = new Set([...extras, ...basePath.split(path.delimiter).filter(Boolean)]);

  return {
    ...process.env,
    HOME: home,
    USER: process.env.USER || os.userInfo().username || 'www-data',
    LOGNAME: process.env.LOGNAME || process.env.USER || 'www-data',
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    LANG: process.env.LANG || 'en_US.UTF-8',
    PATH: [...pathSet].join(path.delimiter),
    TMPDIR: process.env.TMPDIR || os.tmpdir(),
    npm_config_cache: path.join(siteRoot, '.npm-cache'),
    COMPOSER_HOME: path.join(siteRoot, '.composer'),
    COMPOSER_CACHE_DIR: path.join(siteRoot, '.composer-cache'),
  };
}

/** Host shown in SSH credentials (must resolve in DNS or be an IP). */
export function getSshHost() {
  const fromEnv = process.env.SSH_HOST?.trim();
  if (fromEnv) return fromEnv;
  if (process.env.NODE_ENV === 'development') return '127.0.0.1';
  return 'ssh.syntaxverse.host';
}

export function isExternalSshEnabled() {
  return process.env.SSH_ENABLED === 'true';
}

export async function ensureSshCredentials(userId) {
  let account = await HostingAccount.findOne({ where: { userId } });
  if (!account) {
    const { ensureHostingAccount } = await import('./hostingPanelService.js');
    account = await ensureHostingAccount(userId);
  }

  const meta = account.meta && typeof account.meta === 'object' ? { ...account.meta } : {};
  if (!meta.sshUsername) {
    meta.sshUsername = `u${userId}`;
    meta.sshPassword = randomSecret(20);
    meta.sshCreatedAt = new Date().toISOString();
    await account.update({ meta });
  }

  return {
    username: meta.sshUsername,
    password: meta.sshPassword,
    host: getSshHost(),
    port: Number(process.env.SSH_PORT) || 22,
    webTerminal: true,
    externalEnabled: isExternalSshEnabled(),
  };
}

export async function getUserDomain(userId, domainId) {
  const domain = await Domain.findOne({ where: { id: domainId, userId } });
  if (!domain) throw new Error('Domain not found');
  if (!domain.siteSlug) {
    domain.siteSlug = domainToSlug(domain.name);
    await domain.save();
  }
  await ensureSiteStructure(domain.id);
  return domain;
}

function jailPaths(domainId) {
  const siteRoot = path.resolve(getSiteRoot(domainId));
  const publicRoot = path.resolve(getPublicRoot(domainId));
  return { siteRoot, publicRoot, defaultCwd: publicRoot };
}

function resolveCwd(domainId, cwdRel = '/public_html') {
  const { siteRoot, publicRoot } = jailPaths(domainId);
  let rel = String(cwdRel || '/public_html').replace(/\\/g, '/');
  if (!rel.startsWith('/')) rel = `/${rel}`;
  const base = rel.startsWith('/public_html') ? publicRoot : siteRoot;
  const sub = rel.replace(/^\/public_html\/?/, '');
  const abs = path.resolve(base, sub || '.');
  if (!abs.startsWith(siteRoot + path.sep) && abs !== siteRoot) {
    throw new Error('Access denied: path outside your hosting account');
  }
  let relOut = rel.startsWith('/public_html') ? rel : `/public_html${rel}`;
  if (abs === siteRoot) relOut = '/';
  else if (abs === publicRoot) relOut = '/public_html';
  else if (abs.startsWith(publicRoot + path.sep)) {
    relOut = `/public_html${abs.slice(publicRoot.length)}` || '/public_html';
  }
  return { abs, rel: relOut };
}

function validateCommand(command) {
  const cmd = String(command || '').trim();
  if (!cmd) throw new Error('Empty command');
  if (cmd.length > 8000) throw new Error('Command too long');
  for (const re of BLOCKED_PATTERNS) {
    if (re.test(cmd)) throw new Error('Command blocked for security');
  }
  return cmd;
}

/** Map common mistakes; real shell uses rm/mv not delete/remove. */
function normalizeCommand(cmd) {
  const deleteMatch = cmd.match(/^(?:delete|remove)\s+(.+)$/i);
  if (deleteMatch) return `rm ${deleteMatch[1]}`;
  return cmd;
}

function wrapCommand(domainId, absCwd, command) {
  const env = buildTerminalEnv(domainId, absCwd);
  const envExports = [
    `export PATH=${shellEscape(env.PATH)}`,
    `export HOME=${shellEscape(env.HOME)}`,
    `export npm_config_cache=${shellEscape(env.npm_config_cache)}`,
    `export COMPOSER_HOME=${shellEscape(env.COMPOSER_HOME)}`,
  ].join('; ');
  return `${envExports}; cd ${shellEscape(absCwd)} && ${normalizeCommand(command)}`;
}

function spawnShell(command, domainId, absCwd) {
  const shell = resolveShell();
  const name = path.basename(shell);
  const env = buildTerminalEnv(domainId, absCwd);
  const shellArgs = name === 'zsh' ? ['-f', '-c', command] : ['-c', command];

  return spawn(shell, shellArgs, {
    cwd: absCwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function runShell(command, domainId, absCwd) {
  return new Promise((resolve, reject) => {
    const child = spawnShell(command, domainId, absCwd);

    let stdout = '';
    let stderr = '';
    const append = (chunk, target) => {
      const s = chunk.toString();
      if (target.length + s.length > MAX_OUTPUT) {
        return target + '\n...[output truncated]';
      }
      return target + s;
    };

    child.stdout.on('data', (d) => {
      stdout = append(d, stdout);
    });
    child.stderr.on('data', (d) => {
      stderr = append(d, stderr);
    });

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 2000);
      reject(
        new Error(
          `Command timed out (max ${Math.round(COMMAND_TIMEOUT_MS / 60000)} minutes). Try shorter steps or increase TERMINAL_TIMEOUT_MS.`
        )
      );
    }, COMMAND_TIMEOUT_MS);

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      if (err.code === 'ENOENT') {
        reject(new Error(`Shell not found (${resolveShell()}). Install zsh/bash or set TERMINAL_SHELL in .env`));
      } else {
        reject(err);
      }
    });
  });
}

export function createSession(userId, domainId) {
  const sessionId = randomSecret(24);
  const { defaultCwd } = jailPaths(domainId);
  const now = Date.now();
  sessions.set(sessionId, {
    userId,
    domainId,
    cwd: '/public_html',
    absCwd: defaultCwd,
    createdAt: now,
    lastActivityAt: now,
  });
  return sessionId;
}

export function getSession(sessionId, userId, { touch = true } = {}) {
  const s = sessions.get(sessionId);
  if (!s || s.userId !== userId) return null;
  const last = s.lastActivityAt ?? s.createdAt;
  if (Date.now() - last > SESSION_TTL_MS) {
    sessions.delete(sessionId);
    return null;
  }
  if (touch) s.lastActivityAt = Date.now();
  return s;
}

function isToolOnPath(bin) {
  const dirs = new Set([
    ...DEFAULT_PATH_DIRS,
    ...(process.env.TERMINAL_PATH || process.env.PATH || '').split(path.delimiter).filter(Boolean),
  ]);
  for (const d of dirs) {
    try {
      if (fs.existsSync(path.join(d, bin))) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

export async function executeInSession(userId, sessionId, command, domainIdForRecovery) {
  let currentSessionId = sessionId;
  let session = getSession(currentSessionId, userId);
  let renewed = false;

  if (!session) {
    if (!domainIdForRecovery) {
      throw new Error('Terminal session expired. A new session will start automatically.');
    }
    await getUserDomain(userId, domainIdForRecovery);
    currentSessionId = createSession(userId, Number(domainIdForRecovery));
    session = getSession(currentSessionId, userId);
    renewed = true;
    if (!session) throw new Error('Could not start terminal session');
  }

  await getUserDomain(userId, session.domainId);

  const cmd = validateCommand(command);

  const baseMeta = { sessionId: currentSessionId, renewed };

  if (cmd === 'clear') {
    return { stdout: '', stderr: '', exitCode: 0, cwd: session.cwd, ...baseMeta };
  }

  if (cmd === 'pwd') {
    return { stdout: `${session.cwd}\n`, stderr: '', exitCode: 0, cwd: session.cwd, ...baseMeta };
  }

  if (cmd === 'help') {
    return {
      stdout: [
        'Web terminal — PHP, Laravel, MERN, Node',
        '  ls -la              list files',
        '  cd folder           change directory',
        '  php -v              PHP version',
        '  composer install    Laravel / PHP deps',
        '  php artisan ...     Laravel (run in project root)',
        '  npm install         Node / React',
        '  npx create-react-app myapp',
        '  node server.js      run Node app (one-shot)',
        '',
        'Use && for multiple steps: mkdir api && cd api && npm init -y',
      ].join('\n'),
      stderr: '',
      exitCode: 0,
      cwd: session.cwd,
      ...baseMeta,
    };
  }

  if (cmd.startsWith('cd ') || cmd === 'cd') {
    let target = cmd === 'cd' ? '/public_html' : cmd.slice(3).trim();
    if (target === '~' || target === '~/') target = '/public_html';
    if (!target.startsWith('/')) {
      target = `${session.cwd}/${target}`.replace(/\/+/g, '/');
    }
    const { abs, rel } = resolveCwd(session.domainId, target);
    session.absCwd = abs;
    session.cwd = rel;
    return { stdout: '', stderr: '', exitCode: 0, cwd: session.cwd, ...baseMeta };
  }

  const wrapped = wrapCommand(session.domainId, session.absCwd, cmd);
  const result = await runShell(wrapped, session.domainId, session.absCwd);
  const out = { ...result, cwd: session.cwd, ...baseMeta };
  if (/\bnpm\s+init\b/i.test(cmd) || /\bcreate-react-app\b/i.test(cmd)) {
    const hint =
      '[note] npm init / create-react-app create package.json in your site folder. Delete it in File Manager if you do not need it.';
    out.stderr = out.stderr ? `${out.stderr}\n${hint}` : `${hint}\n`;
  }
  return out;
}

export async function executeOneShot(userId, domainId, command, cwdRel) {
  await getUserDomain(userId, domainId);
  const cmd = validateCommand(command);
  const { abs, rel } = resolveCwd(domainId, cwdRel || '/public_html');
  const wrapped = wrapCommand(domainId, abs, cmd);
  const result = await runShell(wrapped, domainId, abs);
  return { ...result, cwd: rel };
}

export async function getTerminalInfo(userId, domainId) {
  const domain = await getUserDomain(userId, domainId);
  const ssh = await ensureSshCredentials(userId);

  const tools = {
    node: isToolOnPath('node'),
    npm: isToolOnPath('npm'),
    npx: isToolOnPath('npx'),
    php: isToolOnPath('php'),
    composer: isToolOnPath('composer'),
    python3: isToolOnPath('python3'),
    pip3: isToolOnPath('pip3'),
    mysql: isToolOnPath('mysql'),
  };

  return {
    domain: domain.name,
    domainId: domain.id,
    cwd: '/public_html',
    siteRoot: `storage/sites/${domain.id}`,
    shell: path.basename(resolveShell()),
    tools,
    ssh: {
      host: ssh.host,
      port: ssh.port,
      username: ssh.username,
      password: ssh.password,
      command: `ssh ${ssh.username}@${ssh.host} -p ${ssh.port}`,
      externalEnabled: isExternalSshEnabled(),
      note: isExternalSshEnabled()
        ? 'Connect with any SSH client using the credentials below.'
        : process.env.NODE_ENV === 'development'
          ? 'Local dev: use the Web Terminal below. External SSH needs a VPS, DNS for SSH_HOST, and SSH_ENABLED=true.'
          : 'Web Terminal is active. Set SSH_HOST to your server hostname, point DNS, and SSH_ENABLED=true for external SSH.',
    },
    help: [
      'PHP/Laravel: composer install && php artisan key:generate',
      'MERN/React: npm install && npm run build',
      'cd .. — site root (Laravel app folder)',
      'Long installs may take several minutes',
    ],
  };
}

export async function logTerminalCommand(userId, command) {
  await createLog({
    userId,
    level: 'info',
    source: 'terminal',
    message: `Terminal: ${command.slice(0, 120)}`,
  });
}
