import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import AdmZip from 'adm-zip';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const STORAGE_ROOT = path.join(__dirname, '../../storage/sites');

const ROOT_FOLDER = 'public_html';

export const defaultIndexHtml = (domainName) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${domainName}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: system-ui, sans-serif;
      background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0e7490 100%);
      color: #f8fafc;
      padding: 2rem;
    }
    .card {
      text-align: center;
      max-width: 32rem;
      padding: 2.5rem;
      border-radius: 1rem;
      background: rgba(255,255,255,0.08);
      border: 1px solid rgba(255,255,255,0.15);
      backdrop-filter: blur(12px);
    }
    h1 { font-size: 1.75rem; margin-bottom: 0.5rem; }
    p { color: #94a3b8; line-height: 1.6; }
    .badge {
      display: inline-block;
      margin-top: 1.5rem;
      padding: 0.35rem 0.75rem;
      border-radius: 9999px;
      font-size: 0.75rem;
      background: rgba(124, 58, 237, 0.35);
      color: #c4b5fd;
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>Welcome to ${domainName}</h1>
    <p>Your site is live on Syntax Verse Hosting. Edit this page in Dashboard → Files.</p>
    <span class="badge">Powered by Syntax Verse</span>
  </div>
</body>
</html>
`;

export function getSiteRoot(domainId) {
  return path.join(STORAGE_ROOT, String(domainId));
}

export function getPublicRoot(domainId) {
  return path.join(getSiteRoot(domainId), ROOT_FOLDER);
}

/** Normalize to relative path under public_html (no traversal). */
export function safeRelativePath(input = '/') {
  let p = String(input || '/').replace(/\\/g, '/');
  if (!p.startsWith('/')) p = `/${p}`;
  const segments = p.split('/').filter((s) => s && s !== '.' && s !== '..');
  const rel = segments.join('/');
  return rel ? `/${rel}` : '/';
}

function resolveAbsolute(domainId, relPath) {
  const safe = safeRelativePath(relPath);
  const publicRoot = path.resolve(getPublicRoot(domainId));
  const abs = path.resolve(publicRoot, safe === '/' ? '.' : safe.slice(1));
  if (!abs.startsWith(publicRoot)) {
    throw new Error('Invalid path');
  }
  return { abs, rel: safe === '/' ? '/public_html' : `/public_html${safe}` };
}

/** Ensure site folders exist (does not recreate deleted files). */
export async function ensureSiteStructure(domainId) {
  await fs.mkdir(getPublicRoot(domainId), { recursive: true });
}

/** Create default index.html only when missing — use on new domain registration. */
export async function seedDefaultIndex(domainId, domainName) {
  await ensureSiteStructure(domainId);
  const indexPath = path.join(getPublicRoot(domainId), 'index.html');
  try {
    await fs.access(indexPath);
  } catch {
    await fs.writeFile(indexPath, defaultIndexHtml(domainName), 'utf8');
  }
}

/** @deprecated Prefer ensureSiteStructure for API calls; seedDefaultIndex for new domains. */
export async function initSite(domainId, domainName) {
  await seedDefaultIndex(domainId, domainName);
}

function formatPermissions(mode) {
  return (mode & 0o777).toString(8).padStart(4, '0');
}

function mimeTypeFor(name, isDirectory) {
  if (isDirectory) return 'httpd/unix-directory';
  const ext = path.extname(name).toLowerCase();
  const map = {
    '.html': 'text/html',
    '.htm': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.php': 'application/x-httpd-php',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.xml': 'application/xml',
    '.zip': 'application/zip',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
  };
  return map[ext] || 'application/octet-stream';
}

async function statEntry(abs, rel, name, type) {
  const st = await fs.stat(abs);
  const isDirectory = type === 'folder';
  return {
    name,
    type,
    path: rel,
    size: isDirectory ? null : st.size,
    modifiedAt: st.mtime.toISOString(),
    permissions: formatPermissions(st.mode),
    mimeType: mimeTypeFor(name, isDirectory),
  };
}

/** Large/vendor dirs: skip deep recursion in file tree (still browsable in File Manager). */
const TREE_SKIP_RECURSE = new Set([
  'node_modules',
  '.npm-cache',
  'vendor',
  '.git',
  'dist',
  '.next',
  '.nuxt',
  '.cache',
  'coverage',
]);

export function shouldSkipTreeRecurse(dirName) {
  return TREE_SKIP_RECURSE.has(dirName);
}

/** Hide dotfiles/cache dirs in File Manager (still on disk; deletable via Terminal). */
export function isHiddenSiteEntry(name) {
  if (!name || name === '.' || name === '..') return true;
  if (name === '.htaccess' || name === '.well-known') return false;
  if (name.startsWith('.')) return true;
  return false;
}

export async function listDirectory(domainId, relPath = '/public_html') {
  const normalized = relPath.replace(/^\/public_html/, '') || '/';
  const { abs, rel } = resolveAbsolute(domainId, normalized);
  const st = await fs.stat(abs);
  if (!st.isDirectory()) {
    throw new Error('Not a directory');
  }
  const entries = (await fs.readdir(abs, { withFileTypes: true })).filter(
    (e) => !isHiddenSiteEntry(e.name)
  );
  const items = await Promise.all(
    entries.map(async (e) => {
      const childAbs = path.join(abs, e.name);
      const childRel = `${rel}/${e.name}`.replace(/\/+/g, '/');
      return statEntry(childAbs, childRel, e.name, e.isDirectory() ? 'folder' : 'file');
    })
  );
  items.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return { path: rel, items };
}

export async function readFile(domainId, relPath) {
  const normalized = relPath.replace(/^\/public_html\/?/, '');
  const { abs, rel } = resolveAbsolute(domainId, `/${normalized}`);
  const st = await fs.stat(abs);
  if (!st.isFile()) throw new Error('Not a file');
  const content = await fs.readFile(abs, 'utf8');
  return { path: rel, content, size: st.size };
}

export async function writeFile(domainId, relPath, content) {
  const normalized = relPath.replace(/^\/public_html\/?/, '');
  const { abs, rel } = resolveAbsolute(domainId, `/${normalized}`);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content ?? '', 'utf8');
  const st = await fs.stat(abs);
  return { path: rel, size: st.size };
}

/** Write binary file (images, archives, etc.) under public_html. */
export async function writeBinaryFile(domainId, relPath, data) {
  const normalized = relPath.replace(/^\/public_html\/?/, '');
  const { abs, rel } = resolveAbsolute(domainId, `/${normalized}`);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  await fs.writeFile(abs, buffer);
  const st = await fs.stat(abs);
  return { path: rel, size: st.size };
}

/**
 * Extract a .zip into a folder under public_html (Hostinger-style deploy).
 * Guards against zip-slip path traversal.
 */
export async function extractZipToDirectory(domainId, targetRelPath, zipFilePath) {
  const normalized = (targetRelPath || '/public_html').replace(/^\/public_html\/?/, '');
  const { abs: destRoot } = resolveAbsolute(domainId, normalized ? `/${normalized}` : '/');
  await fs.mkdir(destRoot, { recursive: true });
  const destResolved = path.resolve(destRoot) + path.sep;

  const zip = new AdmZip(zipFilePath);
  let fileCount = 0;

  for (const entry of zip.getEntries()) {
    const entryName = entry.entryName.replace(/\\/g, '/');
    if (!entryName || entryName.includes('..')) continue;

    const outPath = path.resolve(destRoot, entryName);
    if (!outPath.startsWith(destResolved)) {
      throw new Error('Zip archive contains unsafe paths');
    }

    if (entry.isDirectory) {
      await fs.mkdir(outPath, { recursive: true });
      continue;
    }

    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, entry.getData());
    fileCount++;
  }

  return fileCount;
}

export async function createFolder(domainId, relPath) {
  const normalized = relPath.replace(/^\/public_html\/?/, '');
  const { abs, rel } = resolveAbsolute(domainId, `/${normalized}`);
  await fs.mkdir(abs, { recursive: true });
  return { path: rel, type: 'folder' };
}

export async function createFile(domainId, relPath, content = '') {
  const normalized = relPath.replace(/^\/public_html\/?/, '');
  const { abs, rel } = resolveAbsolute(domainId, `/${normalized}`);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  try {
    await fs.access(abs);
    throw new Error('File already exists');
  } catch (err) {
    if (err.code !== 'ENOENT' && err.message !== 'File already exists') throw err;
  }
  await fs.writeFile(abs, content, 'utf8');
  const st = await fs.stat(abs);
  return { path: rel, type: 'file', size: st.size };
}

export async function deletePath(domainId, relPath) {
  const normalized = relPath.replace(/^\/public_html\/?/, '');
  const { abs } = resolveAbsolute(domainId, `/${normalized}`);
  try {
    await fs.access(abs);
  } catch (err) {
    if (err.code === 'ENOENT') return { path: relPath, alreadyGone: true };
    throw err;
  }
  await fs.rm(abs, { recursive: true, force: true });
  try {
    await fs.access(abs);
    throw new Error('Delete failed — file or folder still exists');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  return { path: relPath, alreadyGone: false };
}

export async function renamePath(domainId, fromPath, toPath) {
  const fromNorm = fromPath.replace(/^\/public_html\/?/, '');
  const toNorm = toPath.replace(/^\/public_html\/?/, '');
  const { abs: fromAbs } = resolveAbsolute(domainId, `/${fromNorm}`);
  const { abs: toAbs, rel: toRel } = resolveAbsolute(domainId, `/${toNorm}`);
  await fs.mkdir(path.dirname(toAbs), { recursive: true });
  await fs.rename(fromAbs, toAbs);
  const st = await fs.stat(toAbs);
  return {
    path: toRel,
    type: st.isDirectory() ? 'folder' : 'file',
    size: st.isFile() ? st.size : null,
  };
}

export async function resolvePublishedFile(domainId, requestPath = '') {
  const publicRoot = path.resolve(getPublicRoot(domainId));
  let rel = String(requestPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!rel || rel.endsWith('/')) rel = `${rel}index.html`.replace(/\/+/g, '/');
  if (!path.extname(rel)) rel = `${rel}/index.html`.replace(/\/+/g, '/');

  const { abs } = resolveAbsolute(domainId, `/${rel}`);
  try {
    const st = await fs.stat(abs);
    if (st.isDirectory()) {
      const index = path.join(abs, 'index.html');
      await fs.access(index);
      return index;
    }
    return abs;
  } catch {
    const fallback = path.join(publicRoot, 'index.html');
    await fs.access(fallback);
    return fallback;
  }
}

/** Parse chmod: "644", "0644", or { user, group, world } each 0–7. */
export function parseModeInput(input) {
  if (typeof input === 'object' && input !== null) {
    const user = Number(input.user) || 0;
    const group = Number(input.group) || 0;
    const world = Number(input.world) || 0;
    return ((user & 7) << 6) | ((group & 7) << 3) | (world & 7);
  }
  let s = String(input ?? '').trim();
  if (/^[0-7]{3}$/.test(s)) return parseInt(s, 8);
  s = s.replace(/^0+/, '');
  if (s.length === 4) s = s.slice(1);
  if (/^[0-7]{3}$/.test(s)) return parseInt(s, 8);
  throw new Error('Invalid permission mode');
}

export function modeToTriple(mode) {
  const m = parseModeInput(mode);
  return {
    user: (m >> 6) & 7,
    group: (m >> 3) & 7,
    world: m & 7,
  };
}

export async function chmodPath(domainId, relPath, mode) {
  const modeBits = parseModeInput(mode);
  const normalized = relPath.replace(/^\/public_html\/?/, '');
  const { abs, rel } = resolveAbsolute(domainId, `/${normalized}`);
  await fs.chmod(abs, modeBits);
  const st = await fs.stat(abs);
  return { path: rel, permissions: formatPermissions(st.mode) };
}

export async function copyPath(domainId, fromPath, toPath) {
  const fromNorm = fromPath.replace(/^\/public_html\/?/, '');
  const toNorm = toPath.replace(/^\/public_html\/?/, '');
  const { abs: fromAbs } = resolveAbsolute(domainId, `/${fromNorm}`);
  const { abs: toAbs, rel: toRel } = resolveAbsolute(domainId, `/${toNorm}`);
  try {
    await fs.access(toAbs);
    throw new Error('Destination already exists');
  } catch (err) {
    if (err.message === 'Destination already exists') throw err;
    if (err.code !== 'ENOENT') throw err;
  }
  await fs.mkdir(path.dirname(toAbs), { recursive: true });
  await fs.cp(fromAbs, toAbs, { recursive: true });
  const st = await fs.stat(toAbs);
  return {
    path: toRel,
    type: st.isDirectory() ? 'folder' : 'file',
    permissions: formatPermissions(st.mode),
  };
}

export async function readFileBuffer(domainId, relPath) {
  const normalized = relPath.replace(/^\/public_html\/?/, '');
  const { abs, rel } = resolveAbsolute(domainId, `/${normalized}`);
  const st = await fs.stat(abs);
  if (!st.isFile()) throw new Error('Not a file');
  const buffer = await fs.readFile(abs);
  const name = path.basename(abs);
  return {
    path: rel,
    name,
    buffer,
    size: st.size,
    mimeType: mimeTypeFor(name, false),
  };
}

async function addPathToZip(zip, abs) {
  const st = await fs.stat(abs);
  const name = path.basename(abs);
  if (st.isDirectory()) {
    zip.addLocalFolder(abs, name);
    return;
  }
  zip.addLocalFile(abs, '', name);
}

/** Create a .zip next to the item(s) (cPanel-style compress). */
export async function compressPaths(domainId, relPaths) {
  if (!relPaths?.length) throw new Error('No paths to compress');
  const zip = new AdmZip();
  for (const relPath of relPaths) {
    const normalized = relPath.replace(/^\/public_html\/?/, '');
    const { abs } = resolveAbsolute(domainId, `/${normalized}`);
    await addPathToZip(zip, abs);
  }

  const first = relPaths[0];
  const firstNorm = first.replace(/^\/public_html\/?/, '');
  const parentNorm = path.dirname(firstNorm);
  const zipBaseName =
    relPaths.length === 1 ? `${path.basename(first)}.zip` : `archive_${Date.now()}.zip`;
  const destRel =
    parentNorm && parentNorm !== '.'
      ? `/public_html/${parentNorm}/${zipBaseName}`
      : `/public_html/${zipBaseName}`;

  const { abs: zipAbs, rel: zipRel } = resolveAbsolute(
    domainId,
    `/${destRel.replace(/^\/public_html\/?/, '')}`
  );
  await fs.mkdir(path.dirname(zipAbs), { recursive: true });
  zip.writeZip(zipAbs);
  const st = await fs.stat(zipAbs);
  return { path: zipRel, size: st.size, name: zipBaseName };
}

export async function buildFileTree(domainId, dirPath = '/public_html') {
  const { items } = await listDirectory(domainId, dirPath);
  const tree = [];
  for (const item of items) {
    const node = {
      name: item.name,
      path: item.path,
      type: item.type,
      size: item.size,
      modifiedAt: item.modifiedAt,
    };
    if (item.type === 'folder') {
      if (shouldSkipTreeRecurse(item.name)) {
        node.children = [];
        node.treeSkipped = true;
      } else {
        node.children = await buildFileTree(domainId, item.path);
      }
    }
    tree.push(node);
  }
  return tree;
}
