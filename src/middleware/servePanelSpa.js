import path from 'path';
import fs from 'fs';
import { isPanelHost } from '../utils/hostingHosts.js';

const panelStaticDir = (() => {
  const configured = process.env.PANEL_STATIC_DIR?.trim();
  if (configured) return path.resolve(configured);
  return path.resolve(process.cwd(), '../public_html');
})();

const indexHtml = path.join(panelStaticDir, 'index.html');
const hasPanelBuild = fs.existsSync(indexHtml);

/**
 * Serve React dashboard from public_html on panel host (Hostinger: nodejs + public_html).
 * Skips /api and customer-site hosts.
 */
export const servePanelSpaMiddleware = (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/sites/')) return next();
  if (!isPanelHost(req.hostname)) return next();
  if (!hasPanelBuild) return next();

  if (req.method !== 'GET' && req.method !== 'HEAD') return next();

  const rel = req.path === '/' ? 'index.html' : req.path.replace(/^\//, '');
  const safe = path.normalize(rel).replace(/^(\.\.(\/|\\|$))+/, '');
  const filePath = path.join(panelStaticDir, safe);

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    return res.sendFile(filePath);
  }

  return res.sendFile(indexHtml);
};
