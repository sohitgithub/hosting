/**
 * Namecheap API — real domain availability & registration.
 * https://www.namecheap.com/support/api/methods/
 *
 * Required .env:
 *   NAMECHEAP_API_USER, NAMECHEAP_API_KEY, NAMECHEAP_USERNAME, NAMECHEAP_CLIENT_IP
 *   NAMECHEAP_SANDBOX=true (sandbox API) or false (production)
 */

const sandbox = () => process.env.NAMECHEAP_SANDBOX === 'true';

function apiBase() {
  return sandbox()
    ? 'https://api.sandbox.namecheap.com/xml.response'
    : 'https://api.namecheap.com/xml.response';
}

function baseParams() {
  return new URLSearchParams({
    ApiUser: process.env.NAMECHEAP_API_USER,
    ApiKey: process.env.NAMECHEAP_API_KEY,
    UserName: process.env.NAMECHEAP_USERNAME || process.env.NAMECHEAP_API_USER,
    ClientIp: process.env.NAMECHEAP_CLIENT_IP,
  });
}

export function isNamecheapConfigured() {
  return Boolean(
    process.env.NAMECHEAP_API_KEY?.trim() &&
      process.env.NAMECHEAP_API_USER?.trim() &&
      process.env.NAMECHEAP_CLIENT_IP?.trim()
  );
}

function parseApiStatus(xml) {
  const status = xml.match(/<ApiResponse[^>]*Status="([^"]+)"/i)?.[1];
  if (status?.toLowerCase() === 'error') {
    const err = xml.match(/<Error[^>]*>([^<]+)</i)?.[1] || 'Namecheap API error';
    throw new Error(err.trim());
  }
}

export async function checkDomainsAtNamecheap(domainList) {
  if (!isNamecheapConfigured()) return null;

  const params = baseParams();
  params.set('Command', 'namecheap.domains.check');
  params.set('DomainList', domainList.join(','));

  const url = `${apiBase()}?${params.toString()}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  const xml = await res.text();
  parseApiStatus(xml);

  const results = [];
  const re = /DomainCheckResult Domain="([^"]+)" Available="(true|false)"/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    results.push({
      domain: m[1].toLowerCase(),
      available: m[2].toLowerCase() === 'true',
    });
  }
  return results;
}

export async function registerDomainAtNamecheap(domainName) {
  if (!isNamecheapConfigured()) {
    throw new Error('Namecheap API is not configured on the server');
  }

  const years = Number(process.env.NAMECHEAP_REGISTER_YEARS) || 1;
  const parts = domainName.split('.');
  const sld = parts[0];
  const tld = parts.slice(1).join('.');

  const params = baseParams();
  params.set('Command', 'namecheap.domains.create');
  params.set('DomainName', domainName);
  params.set('Years', String(years));

  const contact = {
    FirstName: process.env.NAMECHEAP_CONTACT_FIRST || 'Domain',
    LastName: process.env.NAMECHEAP_CONTACT_LAST || 'Owner',
    Address1: process.env.NAMECHEAP_CONTACT_ADDRESS || '123 Main St',
    City: process.env.NAMECHEAP_CONTACT_CITY || 'City',
    StateProvince: process.env.NAMECHEAP_CONTACT_STATE || 'CA',
    PostalCode: process.env.NAMECHEAP_CONTACT_ZIP || '90001',
    Country: process.env.NAMECHEAP_CONTACT_COUNTRY || 'US',
    Phone: process.env.NAMECHEAP_CONTACT_PHONE || '+1.5555555555',
    EmailAddress: process.env.NAMECHEAP_CONTACT_EMAIL || process.env.ADMIN_EMAIL || 'admin@example.com',
  };

  for (const [key, val] of Object.entries(contact)) {
    params.set(key, val);
    params.set(`Admin${key}`, val);
    params.set(`Tech${key}`, val);
    params.set(`AuxBilling${key}`, val);
    params.set(`Registrant${key}`, val);
  }

  const url = `${apiBase()}?${params.toString()}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  const xml = await res.text();
  parseApiStatus(xml);

  const orderId = xml.match(/OrderID="(\d+)"/i)?.[1] || xml.match(/<OrderID>(\d+)</i)?.[1];

  return { orderId, domain: domainName, sandbox: sandbox() };
}
