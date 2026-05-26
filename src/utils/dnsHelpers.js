import { randomUUID } from 'crypto';
import { DEFAULT_NAMESERVERS } from '../models/index.js';

export const createRecordId = () => randomUUID().slice(0, 8);

/** Website hosting — A records only (professional default for Hostinger/registrar DNS). */
export const websiteDnsRecords = (domainName, ip) => [
  { id: createRecordId(), recordType: 'A', name: '@', value: ip, ttl: 3600 },
  { id: createRecordId(), recordType: 'A', name: 'www', value: ip, ttl: 3600 },
];

export const defaultDnsRecords = (domainName, ip) => websiteDnsRecords(domainName, ip);

export const defaultNameserverRecords = () =>
  DEFAULT_NAMESERVERS.map((ns, i) => ({
    id: createRecordId(),
    recordType: 'NS',
    name: '@',
    value: ns,
    ttl: 86400,
    priority: i + 1,
  }));

export const upsertARecord = (records, name, ip) => {
  const list = [...records];
  const idx = list.findIndex((r) => r.recordType === 'A' && r.name === name);
  const record = { id: createRecordId(), recordType: 'A', name, value: ip, ttl: 3600 };
  if (idx >= 0) list[idx] = { ...list[idx], value: ip };
  else list.push(record);
  return list;
};

export const upsertSubdomainRecord = (records, label, ip, domainName) => {
  const name = String(label || '')
    .toLowerCase()
    .trim();
  if (!name || name === '@' || name === 'www') {
    throw new Error('Subdomain label must be letters, numbers, or hyphens (not @ or www)');
  }
  if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(name)) {
    throw new Error('Invalid subdomain label');
  }
  const list = [...records];
  const idx = list.findIndex(
    (r) =>
      (r.recordType === 'A' || r.recordType === 'CNAME') &&
      String(r.name).toLowerCase() === name
  );
  const record = {
    id: createRecordId(),
    recordType: 'A',
    name,
    value: ip,
    ttl: 3600,
    host: `${name}.${domainName}`,
  };
  if (idx >= 0) list[idx] = { ...list[idx], ...record };
  else list.push(record);
  return list;
};

export const applyPtrRecord = (records, hostname, ip) => {
  const list = records.filter((r) => r.recordType !== 'PTR');
  if (hostname && ip) {
    list.push({
      id: createRecordId(),
      recordType: 'PTR',
      name: ip,
      value: hostname,
      ttl: 3600,
    });
  }
  return list;
};
