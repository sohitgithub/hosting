import { listDirectory, isHiddenSiteEntry } from '../services/siteStorage.js';

function sslActiveForUrls(domain) {
  if (!domain?.ssl) return false;
  const status = domain.sslStatus || 'active';
  if (['none', 'pending', 'failed', 'expired'].includes(status)) return false;
  if (domain.sslExpiresAt && new Date(domain.sslExpiresAt) < new Date()) return false;
  return true;
}

/** Convert domain name to storage slug (internal only). */
export function domainToSlug(domainName) {
  return String(domainName || '')
    .toLowerCase()
    .trim()
    .replace(/\./g, '-')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function getSitesBaseHost() {
  return process.env.SITES_BASE_HOST || 'sites.localhost';
}

function isDevEnvironment() {
  return process.env.NODE_ENV !== 'production';
}

function portSuffix(protocol) {
  const isDev = isDevEnvironment();
  const httpPort = process.env.PORT || 5000;
  const httpsPort = process.env.SSL_HTTPS_PORT;
  if (protocol === 'https') {
    if (httpsPort && httpsPort !== '443' && (isDev || httpsPort !== '443')) {
      return `:${httpsPort}`;
    }
    return '';
  }
  if (!isDev && httpPort === '80') return '';
  if (httpPort === '80' || httpPort === '443') return '';
  return `:${httpPort}`;
}

/**
 * Build a professional site URL.
 * Dev: http://softwarehouse.com.localhost:5000 (works in Chrome/Safari without /etc/hosts)
 * Prod: https://softwarehouse.com
 */
export function buildSiteUrl(hostname, { ssl = false, dev = null } = {}) {
  const useDev = dev ?? isDevEnvironment();
  const protocol = useDev ? 'http' : ssl ? 'https' : 'https';
  let host = String(hostname || '').toLowerCase();
  if (!host) return '';
  if (useDev && !host.endsWith('.localhost')) {
    host = `${host}.localhost`;
  }
  return `${protocol}://${host}${portSuffix(protocol)}`;
}

export function getSiteUrls(domain) {
  const name = domain.name;
  const sslOn = sslActiveForUrls(domain);
  const isDev = isDevEnvironment();

  const apexUrl = buildSiteUrl(name, { ssl: sslOn, dev: false });
  const wwwUrl = buildSiteUrl(`www.${name}`, { ssl: sslOn, dev: false });
  const liveUrl = buildSiteUrl(name, { ssl: sslOn, dev: isDev });
  const wwwLiveUrl = buildSiteUrl(`www.${name}`, { ssl: sslOn, dev: isDev });

  return {
    slug: domain.siteSlug || domainToSlug(name),
    sslActive: sslOn,
    domain: name,
    /** Opens in browser during local dev */
    liveUrl,
    openUrl: liveUrl,
    /** Production apex — domain.extension */
    apexUrl,
    primaryUrl: apexUrl,
    wwwUrl,
    wwwLiveUrl,
    /** @deprecated use liveUrl */
    previewUrl: liveUrl,
    previewHost: isDev ? `${name}.localhost` : name,
    sitePublished: !!domain.sitePublished,
    isDev,
    directories: [],
    subdomains: [],
  };
}

export async function enrichSiteUrls(domain) {
  const urls = getSiteUrls(domain);
  const base = urls.liveUrl.replace(/\/$/, '');

  try {
    const { items } = await listDirectory(domain.id);
    urls.directories = items
      .filter(
        (i) =>
          i.type === 'folder' &&
          !isHiddenSiteEntry(i.name) &&
          !['node_modules', 'vendor', '.git'].includes(i.name)
      )
      .map((i) => ({
        name: i.name,
        path: `/${i.name}`,
        url: `${base}/${i.name}`,
      }));
  } catch {
    urls.directories = [];
  }

  const records = Array.isArray(domain.dnsRecords) ? domain.dnsRecords : [];
  const seen = new Set(['www']);
  urls.subdomains = records
    .filter((r) => {
      const n = String(r.name || r.host || '').toLowerCase();
      return n && n !== '@' && n !== 'www' && (r.type === 'A' || r.type === 'CNAME' || !r.type);
    })
    .map((r) => {
      const label = String(r.name || r.host).toLowerCase();
      seen.add(label);
      const host = `${label}.${domain.name}`;
      return {
        label,
        host,
        url: buildSiteUrl(host, { ssl: urls.sslActive, dev: urls.isDev }),
        productionUrl: buildSiteUrl(host, { ssl: urls.sslActive, dev: false }),
      };
    });

  for (const dir of urls.directories) {
    if (seen.has(dir.name) || ['public', 'public_html'].includes(dir.name)) continue;
    urls.subdomains.push({
      label: dir.name,
      host: `${dir.name}.${domain.name}`,
      url: buildSiteUrl(`${dir.name}.${domain.name}`, { ssl: urls.sslActive, dev: urls.isDev }),
      productionUrl: buildSiteUrl(`${dir.name}.${domain.name}`, { ssl: urls.sslActive, dev: false }),
      folderPath: dir.path,
      isFolder: true,
    });
  }

  return urls;
}
