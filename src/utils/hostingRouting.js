import { Domain } from '../models/index.js';
import { getSitesBaseHost } from './siteUrls.js';

/** Strip dev suffix so softwarehouse.com.localhost → softwarehouse.com */
export function normalizeIncomingHost(host) {
  let h = String(host || '')
    .toLowerCase()
    .split(':')[0];
  if (h.endsWith('.localhost')) {
    h = h.slice(0, -'.localhost'.length);
  }
  return h;
}

/**
 * Resolve published site from Host header.
 * - Apex: softwarehouse.com
 * - WWW: www.softwarehouse.com → site root
 * - Subdomain: app.softwarehouse.com → public_html/app/
 * - Dev: softwarehouse.com.localhost
 * - Legacy: slug.sites.localhost
 */
export async function resolveSiteFromHost(host) {
  const raw = String(host || '')
    .toLowerCase()
    .split(':')[0];
  const baseHost = getSitesBaseHost().toLowerCase();

  if (raw.endsWith(`.${baseHost}`) && raw !== baseHost) {
    const slug = raw.slice(0, -(baseHost.length + 1));
    const domain = await Domain.findOne({ where: { siteSlug: slug, sitePublished: true } });
    if (domain) return { domain, pathPrefix: '' };
  }

  let h = normalizeIncomingHost(raw);

  if (h.startsWith('www.')) {
    const apex = h.slice(4);
    const domain = await Domain.findOne({ where: { name: apex, sitePublished: true } });
    if (domain) return { domain, pathPrefix: '' };
  }

  let domain = await Domain.findOne({ where: { name: h, sitePublished: true } });
  if (domain) return { domain, pathPrefix: '' };

  const labels = h.split('.').filter(Boolean);
  for (let i = 1; i < labels.length; i++) {
    const apex = labels.slice(i).join('.');
    const sub = labels.slice(0, i).join('.');
    if (!apex.includes('.')) continue;
    domain = await Domain.findOne({ where: { name: apex, sitePublished: true } });
    if (!domain) continue;
    if (sub === 'www') return { domain, pathPrefix: '' };
    const safe = sub.replace(/[^a-z0-9-]/gi, '');
    return { domain, pathPrefix: safe };
  }

  return null;
}

/** @deprecated Use resolveSiteFromHost */
export async function findDomainByHost(host) {
  const resolved = await resolveSiteFromHost(host);
  return resolved?.domain ?? null;
}

export function joinSiteRequestPath(pathPrefix, urlPath) {
  const sub = String(pathPrefix || '').replace(/^\/+|\/+$/g, '');
  const rest = String(urlPath || '')
    .replace(/^\//, '')
    .replace(/\/+/g, '/');
  if (!sub) return rest;
  if (!rest) return sub;
  return `${sub}/${rest}`;
}
