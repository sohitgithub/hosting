import dns from 'dns/promises';
import { Op } from 'sequelize';
import { Domain } from '../models/index.js';

const DNS_TIMEOUT_MS = 4500;

export const TLD_PRICING = {
  '.com': { price: 12.99, premium: false },
  '.net': { price: 14.99, premium: false },
  '.org': { price: 13.99, premium: false },
  '.io': { price: 49.99, premium: true },
  '.dev': { price: 16.99, premium: false },
  '.app': { price: 18.99, premium: false },
  '.cloud': { price: 24.99, premium: true },
  '.co': { price: 29.99, premium: false },
  '.tech': { price: 19.99, premium: false },
};

const DEFAULT_TLDS = ['.com', '.net', '.org', '.io', '.dev', '.app', '.cloud'];

const RESERVED_LABELS = new Set([
  'google',
  'facebook',
  'amazon',
  'apple',
  'microsoft',
  'twitter',
  'instagram',
  'youtube',
  'github',
  'cloudflare',
  'syntaxverse',
  'admin',
  'root',
  'localhost',
  'www',
  'mail',
  'ftp',
]);

const hashLabel = (str) => {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h << 5) - h + str.charCodeAt(i);
  return Math.abs(h);
};

/** Deterministic fallback when DNS is inconclusive (same name → same result). */
const simulatedTaken = (fqdn) => {
  const label = fqdn.split('.')[0].toLowerCase();
  if (label.length < 3) return true;
  if (RESERVED_LABELS.has(label)) return true;
  return hashLabel(fqdn) % 100 < 42;
};

const withTimeout = (promise, ms) =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'ETIMEOUT' })), ms)),
  ]);

const hasPublicDns = async (fqdn) => {
  const checks = [
    () => dns.resolveNs(fqdn),
    () => dns.resolve4(fqdn),
    () => dns.resolve6(fqdn),
    () => dns.resolveMx(fqdn),
    () => dns.resolveCname(fqdn),
    () => dns.resolveTxt(fqdn),
  ];

  for (const run of checks) {
    try {
      const records = await withTimeout(run(), DNS_TIMEOUT_MS);
      if (records && (Array.isArray(records) ? records.length > 0 : true)) return true;
    } catch (err) {
      const code = err?.code;
      if (code === 'ENOTFOUND' || code === 'ENODATA' || code === 'ETIMEOUT') continue;
      if (code === 'SERVFAIL' || code === 'REFUSED') return null;
    }
  }
  return false;
};

export const normalizeSearchQuery = (raw) => {
  let q = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .replace(/[^a-z0-9.-]/g, '');

  if (!q) return { label: '', domains: [] };

  const parts = q.split('.').filter(Boolean);
  if (parts.length >= 2) {
    const tld = `.${parts.slice(1).join('.')}`;
    const label = parts[0];
    const fqdn = `${label}${tld}`;
    const domains = [fqdn];
    for (const ext of DEFAULT_TLDS) {
      const candidate = `${label}${ext}`;
      if (candidate !== fqdn) domains.push(candidate);
    }
    return { label, domains: [...new Set(domains)].slice(0, 8) };
  }

  const label = parts[0];
  if (label.length < 2) return { label, domains: [] };
  return {
    label,
    domains: DEFAULT_TLDS.map((tld) => `${label}${tld}`),
  };
};

export const lookupDomainAvailability = async (fqdn, registeredHere = false) => {
  const pricing = TLD_PRICING[`.${fqdn.split('.').slice(1).join('.')}`] || { price: 14.99, premium: false };
  const label = fqdn.split('.')[0].toLowerCase();

  if (registeredHere) {
    return {
      domain: fqdn,
      available: false,
      price: pricing.price,
      premium: pricing.premium,
      status: 'registered_here',
      connectExisting: false,
      suggestedAction: 'manage',
      reason: 'Already in your hosting account — open Dashboard → Domains.',
    };
  }

  if (RESERVED_LABELS.has(label) || label.length < 2) {
    return {
      domain: fqdn,
      available: false,
      price: pricing.price,
      premium: true,
      status: 'reserved',
      reason: 'This name is reserved or not available for registration.',
    };
  }

  const dnsResult = await hasPublicDns(fqdn);
  const taken = dnsResult === true || (dnsResult === null && simulatedTaken(fqdn));

  if (taken) {
    const dnsSnapshot = dnsResult === true ? await fetchDomainDnsSnapshot(fqdn) : null;
    return {
      domain: fqdn,
      available: false,
      price: pricing.price,
      premium: pricing.premium,
      status: dnsResult === true ? 'taken' : 'unavailable',
      connectExisting: true,
      suggestedAction: 'connect',
      dnsSnapshot,
      reason:
        dnsResult === true
          ? 'Already registered — add it to your hosting panel and point A records to your server.'
          : 'This domain is not available for registration.',
    };
  }

  return {
    domain: fqdn,
    available: true,
    price: pricing.price,
    premium: pricing.premium,
    status: 'available',
    connectExisting: false,
    suggestedAction: 'register',
    reason: 'Available — register now before someone else does.',
  };
};

/** Public DNS snapshot for domains already on the internet (connect-existing flow). */
export const fetchDomainDnsSnapshot = async (fqdn) => {
  const snapshot = { a: [], aaaa: [], ns: [], mx: [], cname: [] };
  const safe = async (fn, key) => {
    try {
      const records = await withTimeout(fn(), DNS_TIMEOUT_MS);
      snapshot[key] = Array.isArray(records) ? records : [records];
    } catch {
      /* ignore */
    }
  };
  await Promise.all([
    safe(() => dns.resolve4(fqdn), 'a'),
    safe(() => dns.resolve6(fqdn), 'aaaa'),
    safe(() => dns.resolveNs(fqdn), 'ns'),
    safe(() => dns.resolveMx(fqdn).then((rows) => rows.map((r) => r.exchange)), 'mx'),
    safe(() => dns.resolveCname(fqdn), 'cname'),
  ]);
  return snapshot;
};

export const searchDomains = async (query) => {
  const { label, domains } = normalizeSearchQuery(query);
  if (!label || !domains.length) {
    return { query: label, results: [], error: 'Enter at least 2 characters for your domain name.' };
  }

  const registered = await Domain.findAll({
    where: { name: { [Op.in]: domains } },
    attributes: ['name'],
  });
  const registeredSet = new Set(registered.map((d) => d.name.toLowerCase()));

  const results = await Promise.all(
    domains.map((fqdn) => lookupDomainAvailability(fqdn, registeredSet.has(fqdn.toLowerCase())))
  );

  results.sort((a, b) => {
    if (a.available !== b.available) return a.available ? -1 : 1;
    return a.domain.localeCompare(b.domain);
  });

  return { query: label, results };
};
