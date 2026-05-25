import { getSitesBaseHost } from './siteUrls.js';

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
