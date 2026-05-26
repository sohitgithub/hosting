import { parseUserPreferences } from './userPreferences.js';

const JSON_FIELDS = [
  'nameservers',
  'dnsRecords',
  'forwarding',
  'reverseProxy',
  'replies',
  'domains',
  'databases',
  'emailAccounts',
  'cronJobs',
  'scopes',
  'meta',
  'preferences',
  'paymentMethods',
  'paymentMeta',
];

const JSON_ARRAY_FIELDS = new Set([
  'nameservers',
  'replies',
  'domains',
  'databases',
  'emailAccounts',
  'cronJobs',
  'scopes',
]);

function parseJsonField(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'object' && !Array.isArray(value) && fallback === []) {
    return Array.isArray(value) ? value : fallback;
  }
  if (typeof value === 'object') return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (fallback === [] && !Array.isArray(parsed)) return [];
      return parsed;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

export const formatDoc = (doc) => {
  if (!doc) return null;
  const data = typeof doc.toJSON === 'function' ? doc.toJSON() : { ...doc };

  JSON_FIELDS.forEach((field) => {
    if (field in data) {
      let fallback = {};
      if (field === 'nameservers') {
        fallback = ['ns1.syntaxverse.host', 'ns2.syntaxverse.host'];
      } else if (JSON_ARRAY_FIELDS.has(field)) {
        fallback = [];
      }
      if (field === 'preferences') {
        data[field] = parseUserPreferences(data[field]);
      } else {
        data[field] = parseJsonField(data[field], fallback);
        if (JSON_ARRAY_FIELDS.has(field) && !Array.isArray(data[field])) {
          data[field] = [];
        }
      }
    }
  });

  if (data.id != null) data._id = data.id;
  if (data.userId != null) data.user = data.userId;
  delete data.password;
  if (data.amount != null) data.amount = Number(data.amount);
  return data;
};

export const formatDocs = (docs) => (docs || []).map(formatDoc);
