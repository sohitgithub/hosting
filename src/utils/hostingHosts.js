import { getSitesBaseHost } from './siteUrls.js';

function parseHostname(url) {
  if (!url?.trim()) return null;
  try {
    return new URL(url.trim()).hostname.toLowerCase();
  } catch {
    const h = url.trim().toLowerCase().split(':')[0];
    return h || null;
  }
}

/** Dashboard / API panel hostnames (from env). */
export function getPanelHostnames() {
  const set = new Set();
  for (const key of ['PANEL_HOST', 'CLIENT_URL', 'PUBLIC_APP_URL', 'APP_URL', 'FRONTEND_URL']) {
    const h = parseHostname(process.env[key]);
    if (h) set.add(h);
  }
  for (const entry of (process.env.PANEL_HOSTS || '').split(',')) {
    const h = entry.trim().toLowerCase().split(':')[0];
    if (h) set.add(h);
  }
  return set;
}

export function isPanelHost(host) {
  const h = (host || '').toLowerCase().split(':')[0];
  if (!h) return false;
  if (getPanelHostnames().has(h)) return true;
  if (
    process.env.TREAT_HOSTINGERSITE_AS_PANEL !== 'false' &&
    h.endsWith('.hostingersite.com')
  ) {
    return true;
  }
  return false;
}

/** True for localhost, loopback, and raw IPv4 — never treat as a customer website host. */
export function isPlatformHost(host) {
  const h = (host || '').toLowerCase().split(':')[0];
  if (!h || h === 'localhost' || h === '127.0.0.1' || h === '::1') return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return true;
  return false;
}

/** Host should be served as a published customer site (subdomain or custom domain). */
export function isCustomerSiteHost(host) {
  const h = (host || '').toLowerCase().split(':')[0];
  if (isPlatformHost(h)) return false;
  if (isPanelHost(h)) return false;

  const baseHost = getSitesBaseHost().toLowerCase();
  if (h === baseHost) return false;

  if (h.endsWith(`.${baseHost}`)) return true;

  // Dev: softwarehouse.com.localhost, app.softwarehouse.com.localhost
  if (h.endsWith('.localhost')) {
    const bare = h.slice(0, -'.localhost'.length);
    return bare.includes('.') || bare.length > 0;
  }

  // Production custom domain (example.com, www.example.com)
  if (!h.endsWith('.localhost')) return true;

  return false;
}

export function shouldSkipSiteMiddleware(req) {
  if (req.path.startsWith('/api')) return true;
  if (req.path.startsWith('/sites/')) return false;
  return !isCustomerSiteHost(req.hostname);
}
