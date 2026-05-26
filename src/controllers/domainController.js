import { Domain, Invoice, DEFAULT_NAMESERVERS } from '../models/index.js';
import { formatDoc, formatDocs } from '../utils/formatDoc.js';
import { searchDomains } from '../utils/domainLookup.js';
import { initSite } from '../services/siteStorage.js';
import { domainToSlug, getSiteUrls, buildSiteUrl } from '../utils/siteUrls.js';
import { getServerPublicIp } from '../services/sslService.js';
import { createLog } from '../services/logService.js';
import {
  createRecordId,
  defaultDnsRecords,
  upsertARecord,
  upsertSubdomainRecord,
  applyPtrRecord,
} from '../utils/dnsHelpers.js';
import {
  assertCanRegisterInPanel,
  getHostingCapabilities,
} from '../config/hostingCapabilities.js';

const attachSiteUrls = (domain) => {
  const doc = formatDoc(domain);
  doc.siteUrls = getSiteUrls(domain);
  doc.productionUrl = doc.siteUrls.liveUrl;
  return doc;
};

const findUserDomain = async (id, userId) => {
  const domain = await Domain.findOne({ where: { id, userId } });
  return domain;
};

export const searchDomain = async (req, res, next) => {
  try {
    const { q } = req.query;
    if (!q || !String(q).trim()) {
      return res.status(400).json({ message: 'Enter a domain name to search' });
    }
    const { query, results, error } = await searchDomains(q);
    if (error && !results.length) {
      return res.status(400).json({ message: error });
    }
    res.json({ query, results });
  } catch (err) {
    next(err);
  }
};

export const getDomains = async (req, res, next) => {
  try {
    const domains = await Domain.findAll({
      where: { userId: req.user._id },
      order: [['createdAt', 'DESC']],
    });
    res.json(domains.map(attachSiteUrls));
  } catch (err) {
    next(err);
  }
};

export const getDomain = async (req, res, next) => {
  try {
    const domain = await findUserDomain(req.params.id, req.user._id);
    if (!domain) return res.status(404).json({ message: 'Domain not found' });
    res.json(attachSiteUrls(domain));
  } catch (err) {
    next(err);
  }
};

export const registerDomain = async (req, res, next) => {
  try {
    const blocked = assertCanRegisterInPanel();
    if (blocked) return res.status(blocked.status).json(blocked.body);

    const name = (req.body.domain || req.body.name)?.trim().toLowerCase();
    if (!name) return res.status(400).json({ message: 'Domain name required' });

    const existing = await Domain.findOne({ where: { name } });
    if (existing) {
      return res.status(400).json({ message: 'Domain is already registered' });
    }

    const tld = name.includes('.') ? name.substring(name.indexOf('.')) : '.com';
    const price = tld === '.com' ? 12.99 : 14.99;

    const ip = getServerPublicIp();
    const domain = await Domain.create({
      userId: req.user._id,
      name,
      siteSlug: domainToSlug(name),
      status: 'active',
      ssl: false,
      sslStatus: 'none',
      primaryIp: ip,
      nameservers: DEFAULT_NAMESERVERS,
      nameserverMode: 'syntaxverse',
      dnsRecords: defaultDnsRecords(name, ip),
      registrar: 'Syntax Verse',
      expiresAt: new Date(Date.now() + 365 * 86400000),
    });

    await Invoice.create({
      userId: req.user._id,
      amount: price,
      description: `Domain registration — ${name}`,
      status: 'paid',
    });

    await initSite(domain.id, name);

    await createLog({
      userId: req.user._id,
      level: 'success',
      source: 'domain',
      message: `Domain registered: ${name}`,
      meta: { domainId: domain.id, price },
    });

    res.status(201).json({
      ...attachSiteUrls(domain),
      registered: true,
      demoRegistration: true,
      price,
      message: `Domain ${name} added to panel (demo registration — purchase at a real registrar for public ownership).`,
    });
  } catch (err) {
    next(err);
  }
};

export const addDomain = async (req, res, next) => {
  if (req.body.register === true || req.body.purchase === true) {
    const blocked = assertCanRegisterInPanel();
    if (blocked) return res.status(blocked.status).json(blocked.body);
    req.body.domain = req.body.domain || req.body.name;
    return registerDomain(req, res, next);
  }

  try {
    const name = (req.body.name || req.body.domain)?.trim().toLowerCase();
    if (!name) return res.status(400).json({ message: 'Domain name required' });

    const existing = await Domain.findOne({ where: { name } });
    if (existing) {
      if (String(existing.userId) === String(req.user._id)) {
        return res.status(400).json({ message: 'Domain is already in your account' });
      }
      return res.status(400).json({ message: 'Domain is already registered on the platform' });
    }

    const ip = req.body.primaryIp || getServerPublicIp();
    const useRegistrarDns =
      req.body.dnsAtRegistrar !== false ||
      req.body.connectExisting === true ||
      req.body.nameserverMode === 'registrar';

    const domain = await Domain.create({
      userId: req.user._id,
      name,
      siteSlug: domainToSlug(name),
      status: 'active',
      ssl: req.body.ssl || false,
      primaryIp: ip,
      nameservers: useRegistrarDns ? [] : DEFAULT_NAMESERVERS,
      nameserverMode: useRegistrarDns ? 'registrar' : 'syntaxverse',
      dnsRecords: defaultDnsRecords(name, ip),
      registrar: req.body.registrar || (useRegistrarDns ? 'External registrar' : 'Syntax Verse'),
    });
    await initSite(domain.id, name);

    await createLog({
      userId: req.user._id,
      level: 'success',
      source: 'domain',
      message: `Domain connected: ${name}`,
      meta: { domainId: domain.id, dnsMode: useRegistrarDns ? 'registrar' : 'syntaxverse' },
    });

    res.status(201).json({
      ...attachSiteUrls(domain),
      connected: true,
      dnsSetupRecommended: 'a-records-at-registrar',
      message: useRegistrarDns
        ? `Domain ${name} added — set A records @ and www → ${ip} at Hostinger (keep nameservers unchanged).`
        : `Domain ${name} added — update nameservers or A records to point to ${ip}.`,
    });
  } catch (err) {
    next(err);
  }
};

export const addSubdomain = async (req, res, next) => {
  try {
    const domain = await findUserDomain(req.params.id, req.user._id);
    if (!domain) return res.status(404).json({ message: 'Domain not found' });

    const label = req.body.label || req.body.name;
    if (!label) return res.status(400).json({ message: 'Subdomain label required (e.g. shop)' });

    const ip = req.body.ip || domain.primaryIp || getServerPublicIp();
    let dnsRecords;
    try {
      dnsRecords = upsertSubdomainRecord(domain.dnsRecords || [], label, ip, domain.name);
    } catch (err) {
      return res.status(400).json({ message: err.message });
    }

    await domain.update({ dnsRecords });
    await domain.reload();
    const host = `${String(label).toLowerCase().trim()}.${domain.name}`;
    res.status(201).json({
      ...attachSiteUrls(domain),
      subdomain: {
        label: String(label).toLowerCase().trim(),
        host,
        ip,
        url: buildSiteUrl(host, { ssl: !!domain.ssl }),
        dnsHint: `Add A record: ${label} → ${ip} at your registrar (if DNS is not hosted here).`,
      },
      message: `Subdomain ${host} configured — point DNS A record to ${ip}`,
    });
  } catch (err) {
    next(err);
  }
};

export const updateDomain = async (req, res, next) => {
  try {
    const domain = await findUserDomain(req.params.id, req.user._id);
    if (!domain) return res.status(404).json({ message: 'Domain not found' });

    const allowed = [
      'ssl',
      'status',
      'nameservers',
      'nameserverMode',
      'primaryIp',
      'ptrRecord',
      'forwarding',
      'reverseProxy',
      'registrar',
    ];
    const updates = {};
    allowed.forEach((key) => {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    });

    if (req.body.ssl === true && !domain.ssl) {
      return res.status(400).json({
        message: 'Use POST /api/domains/:id/ssl/install to enable SSL (includes DNS verification)',
      });
    }
    if (req.body.ssl === false) {
      updates.sslStatus = 'none';
      updates.sslError = null;
    }

    if (req.body.primaryIp) {
      let records = domain.dnsRecords || [];
      records = upsertARecord(records, '@', req.body.primaryIp);
      records = upsertARecord(records, 'www', req.body.primaryIp);
      updates.dnsRecords = records;
    }

    if (req.body.ptrRecord !== undefined) {
      updates.dnsRecords = applyPtrRecord(
        updates.dnsRecords || domain.dnsRecords || [],
        req.body.ptrRecord,
        updates.primaryIp || domain.primaryIp
      );
    }

    await domain.update(updates);
    res.json(formatDoc(domain));
  } catch (err) {
    next(err);
  }
};

export const deleteDomain = async (req, res, next) => {
  try {
    const deleted = await Domain.destroy({
      where: { id: req.params.id, userId: req.user._id },
    });
    if (!deleted) return res.status(404).json({ message: 'Domain not found' });
    res.json({ message: 'Domain removed' });
  } catch (err) {
    next(err);
  }
};

export const addDnsRecord = async (req, res, next) => {
  try {
    const domain = await findUserDomain(req.params.id, req.user._id);
    if (!domain) return res.status(404).json({ message: 'Domain not found' });

    const { recordType, name, value, ttl = 3600, priority } = req.body;
    if (!recordType || !name || !value) {
      return res.status(400).json({ message: 'Type, name, and value required' });
    }

    const record = {
      id: createRecordId(),
      recordType: recordType.toUpperCase(),
      name,
      value,
      ttl: Number(ttl) || 3600,
      ...(priority != null && { priority: Number(priority) }),
    };

    const dnsRecords = [...(domain.dnsRecords || []), record];
    await domain.update({ dnsRecords });
    res.status(201).json(formatDoc(domain));
  } catch (err) {
    next(err);
  }
};

export const updateDnsRecord = async (req, res, next) => {
  try {
    const domain = await findUserDomain(req.params.id, req.user._id);
    if (!domain) return res.status(404).json({ message: 'Domain not found' });

    const records = domain.dnsRecords || [];
    const idx = records.findIndex((r) => r.id === req.params.recordId);
    if (idx < 0) return res.status(404).json({ message: 'Record not found' });

    records[idx] = {
      ...records[idx],
      ...req.body,
      recordType: (req.body.recordType || records[idx].recordType).toUpperCase(),
      ttl: Number(req.body.ttl) || records[idx].ttl,
    };

    if (records[idx].recordType === 'A' && records[idx].name === '@') {
      await domain.update({ dnsRecords: records, primaryIp: records[idx].value });
    } else {
      await domain.update({ dnsRecords: records });
    }
    res.json(formatDoc(domain));
  } catch (err) {
    next(err);
  }
};

export const deleteDnsRecord = async (req, res, next) => {
  try {
    const domain = await findUserDomain(req.params.id, req.user._id);
    if (!domain) return res.status(404).json({ message: 'Domain not found' });

    const dnsRecords = (domain.dnsRecords || []).filter((r) => r.id !== req.params.recordId);
    await domain.update({ dnsRecords });
    res.json(formatDoc(domain));
  } catch (err) {
    next(err);
  }
};

export const updateNameservers = async (req, res, next) => {
  try {
    const domain = await findUserDomain(req.params.id, req.user._id);
    if (!domain) return res.status(404).json({ message: 'Domain not found' });

    const { mode, nameservers } = req.body;

    if (mode === 'registrar') {
      const ip = domain.primaryIp || getServerPublicIp();
      let dnsRecords = (domain.dnsRecords || []).filter((r) => r.recordType !== 'NS');
      dnsRecords = defaultDnsRecords(domain.name, ip);
      await domain.update({
        nameserverMode: 'registrar',
        nameservers: [],
        dnsRecords,
      });
      await domain.reload();
      return res.json(attachSiteUrls(domain));
    }

    const ns =
      mode === 'custom' && nameservers?.length
        ? nameservers
        : DEFAULT_NAMESERVERS;

    let dnsRecords = (domain.dnsRecords || []).filter((r) => r.recordType !== 'NS');
    ns.forEach((nameserver) => {
      dnsRecords.push({
        id: createRecordId(),
        recordType: 'NS',
        name: '@',
        value: nameserver,
        ttl: 86400,
      });
    });

    await domain.update({
      nameserverMode: mode === 'custom' ? 'custom' : 'syntaxverse',
      nameservers: ns,
      dnsRecords,
    });
    res.json(formatDoc(domain));
  } catch (err) {
    next(err);
  }
};

export const pointToServer = async (req, res, next) => {
  try {
    const domain = await findUserDomain(req.params.id, req.user._id);
    if (!domain) return res.status(404).json({ message: 'Domain not found' });

    const { ip, disableForward, disableReverse } = req.body;
    if (!ip) return res.status(400).json({ message: 'IP address required' });

    let dnsRecords = domain.dnsRecords || [];
    dnsRecords = upsertARecord(dnsRecords, '@', ip);
    dnsRecords = upsertARecord(dnsRecords, 'www', ip);

    const updates = {
      primaryIp: ip,
      dnsRecords,
      forwarding: disableForward
        ? { ...domain.forwarding, enabled: false }
        : domain.forwarding,
      reverseProxy: disableReverse
        ? { ...domain.reverseProxy, enabled: false }
        : domain.reverseProxy,
    };

    await domain.update(updates);
    res.json(formatDoc(domain));
  } catch (err) {
    next(err);
  }
};

export const setForwarding = async (req, res, next) => {
  try {
    const domain = await findUserDomain(req.params.id, req.user._id);
    if (!domain) return res.status(404).json({ message: 'Domain not found' });

    const forwarding = {
      enabled: Boolean(req.body.enabled),
      type: req.body.type === '302' ? '302' : '301',
      targetUrl: req.body.targetUrl || '',
      includePath: req.body.includePath !== false,
    };

    let dnsRecords = domain.dnsRecords || [];
    dnsRecords = dnsRecords.filter((r) => !(r.recordType === 'CNAME' && r.name === '@'));

    if (forwarding.enabled && forwarding.targetUrl) {
      dnsRecords.push({
        id: createRecordId(),
        recordType: 'CNAME',
        name: '@',
        value: forwarding.targetUrl.replace(/^https?:\/\//, '').split('/')[0],
        ttl: 3600,
      });
    }

    await domain.update({ forwarding, dnsRecords });
    res.json(formatDoc(domain));
  } catch (err) {
    next(err);
  }
};

export const setReverseProxy = async (req, res, next) => {
  try {
    const domain = await findUserDomain(req.params.id, req.user._id);
    if (!domain) return res.status(404).json({ message: 'Domain not found' });

    const reverseProxy = {
      enabled: Boolean(req.body.enabled),
      originIp: req.body.originIp || '',
      originPort: Number(req.body.originPort) || 80,
      preserveHost: req.body.preserveHost !== false,
    };

    let dnsRecords = domain.dnsRecords || [];
    if (reverseProxy.enabled && reverseProxy.originIp) {
      dnsRecords = upsertARecord(dnsRecords, '@', reverseProxy.originIp);
      dnsRecords = upsertARecord(dnsRecords, 'www', reverseProxy.originIp);
    }

    await domain.update({
      reverseProxy,
      primaryIp: reverseProxy.enabled ? reverseProxy.originIp : domain.primaryIp,
      dnsRecords,
      forwarding: req.body.disableForwarding
        ? { ...domain.forwarding, enabled: false }
        : domain.forwarding,
    });
    res.json(formatDoc(domain));
  } catch (err) {
    next(err);
  }
};

export const setReverseDns = async (req, res, next) => {
  try {
    const domain = await findUserDomain(req.params.id, req.user._id);
    if (!domain) return res.status(404).json({ message: 'Domain not found' });

    const ptrRecord = req.body.hostname || `${domain.name}.`;
    const ip = req.body.ip || domain.primaryIp;

    const dnsRecords = applyPtrRecord(domain.dnsRecords || [], ptrRecord, ip);
    await domain.update({ ptrRecord, dnsRecords });
    res.json(formatDoc(domain));
  } catch (err) {
    next(err);
  }
};

export const initiateTransfer = async (req, res, next) => {
  try {
    const { name, authCode, registrar } = req.body;
    if (!name || !authCode) {
      return res.status(400).json({ message: 'Domain name and EPP/auth code required' });
    }

    const existing = await Domain.findOne({
      where: { name: name.trim().toLowerCase(), userId: req.user._id },
    });
    if (existing) return res.status(400).json({ message: 'Domain already in your account' });

    const domain = await Domain.create({
      userId: req.user._id,
      name: name.trim().toLowerCase(),
      status: 'transferring',
      transferStatus: 'pending',
      transferAuthCode: authCode,
      registrar: registrar || 'External',
      nameservers: DEFAULT_NAMESERVERS,
      primaryIp: getServerPublicIp(),
      dnsRecords: defaultDnsRecords(
        name.trim().toLowerCase(),
        getServerPublicIp()
      ),
    });

    const transferDemo = process.env.DOMAIN_TRANSFER_MODE === 'demo';
    if (transferDemo) {
      setTimeout(async () => {
        const d = await Domain.findByPk(domain.id);
        if (d?.transferStatus === 'pending') {
          await d.update({ transferStatus: 'in_progress', status: 'transferring' });
        }
      }, 2000);

      setTimeout(async () => {
        const d = await Domain.findByPk(domain.id);
        if (d?.transferStatus === 'in_progress') {
          await d.update({
            transferStatus: 'completed',
            status: 'active',
            registrar: 'Syntax Verse',
          });
        }
      }, 8000);
    }

    res.status(201).json({
      ...formatDoc(domain),
      transferDemo,
      message: transferDemo
        ? 'Transfer request recorded (demo — completes automatically in ~8s).'
        : 'Transfer request recorded. Complete the transfer at your registrar; DNS pointing is enough to host the site.',
    });
  } catch (err) {
    next(err);
  }
};

export const getDomainInfo = async (req, res) => {
  const serverPublicIp = getServerPublicIp();
  const isDev = process.env.NODE_ENV !== 'production';
  const capabilities = getHostingCapabilities();
  res.json({
    serverPublicIp,
    syntaxVerseIp: serverPublicIp,
    defaultNameservers: DEFAULT_NAMESERVERS,
    supportedRecordTypes: ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'PTR', 'SRV'],
    dnsSetupRecommended: 'a-records-at-registrar',
    nameserverNote:
      'Keep DNS at Hostinger (or your registrar) and add A records for @ and www. Syntax Verse nameservers are only needed when our DNS hosting is enabled for your server.',
    transferNote: capabilities.domainRegistrationDemo
      ? 'Demo mode: transfers may auto-complete. In production, complete transfer at your registrar.'
      : 'Unlock domain at current registrar and submit auth code. Point A records to your server to go live — transfer can finish in parallel.',
    isDev,
    productionUrlExample: 'https://yourdomain.com',
    devPreviewExample: 'http://yourdomain.com.localhost:5000',
    capabilities,
  });
};
