import { randomUUID } from 'crypto';
import { DEFAULT_NAMESERVERS } from '../models/index.js';

export const createRecordId = () => randomUUID().slice(0, 8);

export const defaultDnsRecords = (domainName, ip = '76.76.21.21') => [
  { id: createRecordId(), recordType: 'A', name: '@', value: ip, ttl: 3600 },
  { id: createRecordId(), recordType: 'A', name: 'www', value: ip, ttl: 3600 },
  { id: createRecordId(), recordType: 'MX', name: '@', value: `mail.${domainName}`, ttl: 3600, priority: 10 },
  { id: createRecordId(), recordType: 'TXT', name: '@', value: 'v=spf1 include:syntaxverse.host ~all', ttl: 3600 },
];

export const defaultNameserverRecords = (domainName) =>
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
