import path from 'path';
import { resolvePublishedFile } from '../services/siteStorage.js';
import { isSslActive } from '../services/sslService.js';
import { resolveSiteFromHost, joinSiteRequestPath } from '../utils/hostingRouting.js';
import { isCustomerSiteHost } from '../utils/hostingHosts.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

export async function sendPublishedSiteFile(domain, requestPath, res) {
  const abs = await resolvePublishedFile(domain.id, requestPath);
  const ext = path.extname(abs).toLowerCase();
  res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
  res.setHeader('X-Served-By', 'Syntax-Verse-Hosting');
  res.setHeader('X-Site-Domain', domain.name);
  if (isSslActive(domain)) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  return res.sendFile(abs);
}

export const subdomainSiteMiddleware = async (req, res, next) => {
  if (req.path.startsWith('/api')) return next();

  const host = (req.hostname || '').toLowerCase();
  if (!isCustomerSiteHost(host)) {
    return next();
  }

  try {
    const resolved = await resolveSiteFromHost(host);

    if (!resolved) {
      return res.status(404).send(`<!DOCTYPE html><html><head><title>Site not found</title></head><body style="font-family:system-ui;background:#0f172a;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh"><div style="text-align:center"><h1>Website not found</h1><p>Publish your site from Dashboard → Files.</p></div></body></html>`);
    }

    const { domain, pathPrefix } = resolved;
    const urlPath = req.path === '/' ? '' : req.path.replace(/^\//, '');
    const requestPath = joinSiteRequestPath(pathPrefix, urlPath);
    await sendPublishedSiteFile(domain, requestPath, res);
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).send('File not found');
    next(err);
  }
};
