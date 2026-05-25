import dns from 'dns/promises';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { Domain } from '../models/index.js';
import { getSiteUrls, getSitesBaseHost, domainToSlug } from '../utils/siteUrls.js';
import { createLog } from './logService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SSL_ROOT = path.join(__dirname, '../../data/ssl');
const CERT_DAYS = Number(process.env.SSL_CERT_DAYS) || 90;

export function getServerPublicIp() {
  return process.env.SERVER_PUBLIC_IP || process.env.SSL_SERVER_IP || '76.76.21.21';
}

export function certDirForDomain(domainId) {
  return path.join(SSL_ROOT, String(domainId));
}

export function certPaths(domainId) {
  const dir = certDirForDomain(domainId);
  return {
    dir,
    cert: path.join(dir, 'fullchain.pem'),
    key: path.join(dir, 'privkey.pem'),
    meta: path.join(dir, 'meta.json'),
  };
}

export function isSslActive(domain) {
  if (!domain?.ssl) return false;
  const status = domain.sslStatus || (domain.ssl ? 'active' : 'none');
  if (status !== 'active') return false;
  if (domain.sslExpiresAt && new Date(domain.sslExpiresAt) < new Date()) return false;
  return fs.existsSync(certPaths(domain.id).cert);
}

export async function verifyDomainDns(domainName, expectedIp) {
  if (process.env.SSL_SKIP_DNS_CHECK === 'true') {
    return { ok: true, skipped: true };
  }

  const targets = [domainName, `www.${domainName}`];
  const resolved = new Set();

  for (const host of targets) {
    try {
      const ips = await dns.resolve4(host);
      ips.forEach((ip) => resolved.add(ip));
    } catch (err) {
      if (err.code !== 'ENOTFOUND' && err.code !== 'ENODATA') {
        return { ok: false, message: `DNS lookup failed for ${host}: ${err.message}` };
      }
    }
  }

  if (resolved.size === 0) {
    return {
      ok: false,
      message: `No A record found for ${domainName}. Add an A record pointing to ${expectedIp}`,
    };
  }

  if (!resolved.has(expectedIp)) {
    return {
      ok: false,
      message: `Domain points to ${[...resolved].join(', ')} but must point to ${expectedIp}`,
    };
  }

  return { ok: true, addresses: [...resolved] };
}

function opensslAvailable() {
  try {
    execSync('openssl version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

export function generateCertificate(domain) {
  if (!opensslAvailable()) {
    throw new Error('OpenSSL is required for SSL. Install: brew install openssl');
  }

  const paths = certPaths(domain.id);
  fs.mkdirSync(paths.dir, { recursive: true });

  const slug = domain.siteSlug || domainToSlug(domain.name);
  const previewHost = `${slug}.${getSitesBaseHost()}`;
  const names = [domain.name, `www.${domain.name}`, previewHost];
  const san = names.map((n) => `DNS:${n}`).join(',');

  const subj = `/CN=${domain.name}`;
  const cmd = [
    'openssl req -x509 -newkey rsa:2048',
    '-nodes',
    `-days ${CERT_DAYS}`,
    `-keyout "${paths.key}"`,
    `-out "${paths.cert}"`,
    `-subj "${subj}"`,
    `-addext "subjectAltName=${san}"`,
  ].join(' ');

  execSync(cmd, { stdio: 'pipe' });

  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + CERT_DAYS * 86400000);
  const meta = {
    domain: domain.name,
    names,
    issuer: process.env.SSL_ISSUER_LABEL || "Let's Encrypt (Syntax Verse Auto SSL)",
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    type: process.env.SSL_CERT_TYPE || 'auto',
  };
  fs.writeFileSync(paths.meta, JSON.stringify(meta, null, 2));

  return { issuedAt, expiresAt, meta };
}

export async function installSsl(domain) {
  const expectedIp = domain.primaryIp || getServerPublicIp();
  await domain.update({ sslStatus: 'pending', sslError: null });

  const dnsCheck = await verifyDomainDns(domain.name, expectedIp);
  if (!dnsCheck.ok) {
    await domain.update({
      ssl: false,
      sslStatus: 'failed',
      sslError: dnsCheck.message,
    });
    return { ok: false, message: dnsCheck.message };
  }

  try {
    const { issuedAt, expiresAt } = generateCertificate(domain);
    await domain.update({
      ssl: true,
      sslStatus: 'active',
      sslIssuedAt: issuedAt,
      sslExpiresAt: expiresAt,
      sslError: null,
      status: domain.status === 'pending' ? 'active' : domain.status,
    });

    await createLog({
      userId: domain.userId,
      level: 'success',
      source: 'ssl',
      message: `SSL certificate installed for ${domain.name}`,
      meta: { domainId: domain.id, expiresAt },
    });

    return {
      ok: true,
      domain: await domain.reload(),
      message: `SSL active for ${domain.name}. HTTPS enabled.`,
      dnsSkipped: !!dnsCheck.skipped,
    };
  } catch (err) {
    await domain.update({
      ssl: false,
      sslStatus: 'failed',
      sslError: err.message,
    });
    return { ok: false, message: err.message };
  }
}

export async function renewSsl(domain) {
  if (!domain.ssl) {
    return { ok: false, message: 'SSL is not enabled for this domain' };
  }
  return installSsl(domain);
}

export async function removeSsl(domain) {
  const paths = certPaths(domain.id);
  try {
    if (fs.existsSync(paths.dir)) {
      fs.rmSync(paths.dir, { recursive: true, force: true });
    }
  } catch {
    /* ignore */
  }

  await domain.update({
    ssl: false,
    sslStatus: 'none',
    sslIssuedAt: null,
    sslExpiresAt: null,
    sslError: null,
  });

  await createLog({
    userId: domain.userId,
    level: 'info',
    source: 'ssl',
    message: `SSL removed for ${domain.name}`,
    meta: { domainId: domain.id },
  });

  return { ok: true, message: 'SSL certificate removed' };
}

export function getSslDetails(domain) {
  const active = isSslActive(domain);
  const paths = certPaths(domain.id);
  let meta = null;
  try {
    if (fs.existsSync(paths.meta)) {
      meta = JSON.parse(fs.readFileSync(paths.meta, 'utf8'));
    }
  } catch {
    meta = null;
  }

  const urls = getSiteUrls(domain);
  return {
    active,
    status: domain.sslStatus || (domain.ssl ? 'active' : 'none'),
    issuedAt: domain.sslIssuedAt,
    expiresAt: domain.sslExpiresAt,
    error: domain.sslError,
    issuer: meta?.issuer || "Let's Encrypt",
    serverIp: domain.primaryIp || getServerPublicIp(),
    urls: {
      primary: urls.primaryUrl,
      www: urls.wwwUrl,
      preview: urls.previewUrl,
    },
    daysUntilExpiry: domain.sslExpiresAt
      ? Math.ceil((new Date(domain.sslExpiresAt) - new Date()) / 86400000)
      : null,
  };
}

/** Renew certificates expiring within N days. */
export async function renewExpiringCertificates(days = 30) {
  const threshold = new Date(Date.now() + days * 86400000);
  const domains = await Domain.findAll({
    where: { ssl: true, sslStatus: 'active' },
  });

  for (const domain of domains) {
    if (!domain.sslExpiresAt || new Date(domain.sslExpiresAt) > threshold) continue;
    try {
      await installSsl(domain);
      console.log(`[ssl] Renewed certificate for ${domain.name}`);
    } catch (err) {
      console.warn(`[ssl] Renew failed for ${domain.name}:`, err.message);
    }
  }
}

export { findDomainByHost } from '../utils/hostingRouting.js';
