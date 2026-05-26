/**
 * RDAP — public domain registration data (real availability signal).
 * https://about.rdap.org/
 */

const RDAP_TIMEOUT_MS = 6000;

export async function checkRdapAvailability(fqdn) {
  const domain = String(fqdn || '')
    .toLowerCase()
    .trim();
  if (!domain.includes('.')) return { available: null, source: 'rdap' };

  try {
    const res = await fetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`, {
      headers: { Accept: 'application/rdap+json' },
      signal: AbortSignal.timeout(RDAP_TIMEOUT_MS),
    });

    if (res.status === 404) return { available: true, source: 'rdap' };
    if (res.ok) return { available: false, source: 'rdap' };
    return { available: null, source: 'rdap' };
  } catch {
    return { available: null, source: 'rdap' };
  }
}
