import { Domain } from '../models/index.js';
import { formatDoc } from '../utils/formatDoc.js';
import { upsertARecord } from '../utils/dnsHelpers.js';
import { enrichSiteUrls, domainToSlug } from '../utils/siteUrls.js';
import { createLog } from '../services/logService.js';
import fs from 'fs/promises';
import {
  ensureSiteStructure,
  listDirectory,
  readFile,
  writeFile,
  writeBinaryFile,
  extractZipToDirectory,
  createFolder,
  createFile,
  deletePath,
  renamePath,
  buildFileTree,
  chmodPath,
  copyPath,
  compressPaths,
  readFileBuffer,
} from '../services/siteStorage.js';
import { SITE_UPLOAD_MAX_MB } from '../middleware/siteUpload.js';

const findUserDomain = async (id, userId) => {
  const domain = await Domain.findOne({ where: { id, userId } });
  return domain;
};

const ensureSite = async (domain) => {
  if (!domain.siteSlug) {
    domain.siteSlug = domainToSlug(domain.name);
    await domain.save();
  }
  await ensureSiteStructure(domain.id);
};

const sitePayload = async (domain) => {
  const urls = await enrichSiteUrls(domain);
  return {
    domain: domain.name,
    sitePublished: !!domain.sitePublished,
    sitePublishedAt: domain.sitePublishedAt,
    urls,
    liveUrl: urls.liveUrl,
    openUrl: urls.openUrl,
  };
};

export const listSiteFiles = async (req, res, next) => {
  try {
    const domain = await findUserDomain(req.params.id, req.user._id);
    if (!domain) return res.status(404).json({ message: 'Domain not found' });
    await ensureSite(domain);
    const dirPath = req.query.path || '/public_html';
    const data = await listDirectory(domain.id, dirPath);
    const payload = await sitePayload(domain);
    res.json({
      ...data,
      ...payload,
    });
  } catch (err) {
    if (err.message === 'Invalid path' || err.message === 'Not a directory') {
      return res.status(400).json({ message: err.message });
    }
    next(err);
  }
};

export const listSiteTree = async (req, res, next) => {
  try {
    const domain = await findUserDomain(req.params.id, req.user._id);
    if (!domain) return res.status(404).json({ message: 'Domain not found' });
    await ensureSite(domain);
    const tree = await buildFileTree(domain.id);
    const payload = await sitePayload(domain);
    res.json({
      tree,
      ...payload,
    });
  } catch (err) {
    next(err);
  }
};

export const getSiteFile = async (req, res, next) => {
  try {
    const domain = await findUserDomain(req.params.id, req.user._id);
    if (!domain) return res.status(404).json({ message: 'Domain not found' });
    const filePath = req.query.path;
    if (!filePath) return res.status(400).json({ message: 'path required' });
    await ensureSite(domain);
    const data = await readFile(domain.id, filePath);
    res.json(data);
  } catch (err) {
    if (err.message === 'Not a file') return res.status(400).json({ message: err.message });
    next(err);
  }
};

export const saveSiteFile = async (req, res, next) => {
  try {
    const domain = await findUserDomain(req.params.id, req.user._id);
    if (!domain) return res.status(404).json({ message: 'Domain not found' });
    const { path: filePath, content } = req.body;
    if (!filePath) return res.status(400).json({ message: 'path required' });
    await ensureSite(domain);
    const data = await writeFile(domain.id, filePath, content ?? '');
    res.json(data);
  } catch (err) {
    next(err);
  }
};

export const createSiteFolder = async (req, res, next) => {
  try {
    const domain = await findUserDomain(req.params.id, req.user._id);
    if (!domain) return res.status(404).json({ message: 'Domain not found' });
    const { path: folderPath } = req.body;
    if (!folderPath) return res.status(400).json({ message: 'path required' });
    await ensureSite(domain);
    const data = await createFolder(domain.id, folderPath);
    res.status(201).json(data);
  } catch (err) {
    next(err);
  }
};

export const createSiteFile = async (req, res, next) => {
  try {
    const domain = await findUserDomain(req.params.id, req.user._id);
    if (!domain) return res.status(404).json({ message: 'Domain not found' });
    const { path: filePath, content } = req.body;
    if (!filePath) return res.status(400).json({ message: 'path required' });
    await ensureSite(domain);
    const data = await createFile(domain.id, filePath, content ?? '');
    res.status(201).json(data);
  } catch (err) {
    if (err.message === 'File already exists') {
      return res.status(400).json({ message: err.message });
    }
    next(err);
  }
};

export const deleteSiteFile = async (req, res, next) => {
  try {
    const domain = await findUserDomain(req.params.id, req.user._id);
    if (!domain) return res.status(404).json({ message: 'Domain not found' });
    const filePath = req.query.path || req.body?.path;
    if (!filePath) return res.status(400).json({ message: 'path required' });
    if (filePath === '/public_html' || filePath.endsWith('/public_html')) {
      return res.status(400).json({ message: 'Cannot delete site root folder' });
    }
    const result = await deletePath(domain.id, filePath);
    res.json({
      message: result.alreadyGone ? 'Already deleted' : 'Deleted',
      path: filePath,
      deleted: true,
    });
  } catch (err) {
    next(err);
  }
};

export const downloadSiteFile = async (req, res, next) => {
  try {
    const domain = await findUserDomain(req.params.id, req.user._id);
    if (!domain) return res.status(404).json({ message: 'Domain not found' });
    const filePath = req.query.path;
    if (!filePath) return res.status(400).json({ message: 'path required' });
    await ensureSite(domain);
    const { buffer, name, mimeType } = await readFileBuffer(domain.id, filePath);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(name)}"`);
    res.send(buffer);
  } catch (err) {
    if (err.message === 'Not a file') return res.status(400).json({ message: err.message });
    next(err);
  }
};

export const chmodSiteFile = async (req, res, next) => {
  try {
    const domain = await findUserDomain(req.params.id, req.user._id);
    if (!domain) return res.status(404).json({ message: 'Domain not found' });
    const { path: filePath, mode } = req.body;
    if (!filePath) return res.status(400).json({ message: 'path required' });
    if (mode === undefined || mode === null) {
      return res.status(400).json({ message: 'mode required' });
    }
    if (filePath === '/public_html' || filePath.endsWith('/public_html')) {
      return res.status(400).json({ message: 'Cannot change permissions on site root' });
    }
    await ensureSite(domain);
    const data = await chmodPath(domain.id, filePath, mode);
    res.json({ message: 'Permissions updated', ...data });
  } catch (err) {
    if (err.message === 'Invalid permission mode' || err.message === 'Invalid path') {
      return res.status(400).json({ message: err.message });
    }
    next(err);
  }
};

export const copySiteFile = async (req, res, next) => {
  try {
    const domain = await findUserDomain(req.params.id, req.user._id);
    if (!domain) return res.status(404).json({ message: 'Domain not found' });
    const { from, to } = req.body;
    if (!from || !to) return res.status(400).json({ message: 'from and to paths required' });
    await ensureSite(domain);
    const data = await copyPath(domain.id, from, to);
    res.status(201).json({ message: 'Copied', ...data });
  } catch (err) {
    if (err.message === 'Destination already exists' || err.message === 'Invalid path') {
      return res.status(400).json({ message: err.message });
    }
    next(err);
  }
};

export const compressSiteFiles = async (req, res, next) => {
  try {
    const domain = await findUserDomain(req.params.id, req.user._id);
    if (!domain) return res.status(404).json({ message: 'Domain not found' });
    const paths = req.body.paths || (req.body.path ? [req.body.path] : []);
    if (!paths.length) return res.status(400).json({ message: 'paths required' });
    await ensureSite(domain);
    const data = await compressPaths(domain.id, paths);
    res.status(201).json({ message: `Created ${data.name}`, ...data });
  } catch (err) {
    if (err.message === 'Invalid path' || err.message === 'No paths to compress') {
      return res.status(400).json({ message: err.message });
    }
    next(err);
  }
};

export const renameSiteFile = async (req, res, next) => {
  try {
    const domain = await findUserDomain(req.params.id, req.user._id);
    if (!domain) return res.status(404).json({ message: 'Domain not found' });
    const { from, to } = req.body;
    if (!from || !to) return res.status(400).json({ message: 'from and to paths required' });
    const data = await renamePath(domain.id, from, to);
    res.json(data);
  } catch (err) {
    next(err);
  }
};

export const uploadSiteFiles = async (req, res, next) => {
  try {
    const domain = await findUserDomain(req.params.id, req.user._id);
    if (!domain) return res.status(404).json({ message: 'Domain not found' });

    const files = req.files?.length ? req.files : req.file ? [req.file] : [];
    if (!files.length) {
      return res.status(400).json({ message: 'No files uploaded. Choose files or a .zip archive.' });
    }

    await ensureSite(domain);

    const targetPath = (req.body.path || '/public_html').replace(/\\/g, '/');
    const shouldExtract =
      req.body.extract === 'true' || req.body.extract === true || req.body.extract === '1';

    let uploaded = 0;
    let extracted = 0;
    let extractedFiles = 0;

    for (const file of files) {
      const name = file.originalname || 'upload.bin';
      const isZip =
        /\.zip$/i.test(name) ||
        file.mimetype === 'application/zip' ||
        file.mimetype === 'application/x-zip-compressed';

      try {
        if (isZip && shouldExtract) {
          const count = await extractZipToDirectory(domain.id, targetPath, file.path);
          extracted++;
          extractedFiles += count;
        } else {
          const destPath = `${targetPath}/${name}`.replace(/\/+/g, '/');
          const data = await fs.readFile(file.path);
          await writeBinaryFile(domain.id, destPath, data);
          uploaded++;
        }
      } finally {
        await fs.unlink(file.path).catch(() => {});
      }
    }

    await createLog({
      userId: req.user._id,
      level: 'success',
      source: 'site',
      message:
        extracted > 0
          ? `Uploaded & extracted ${extracted} zip (${extractedFiles} files) → ${domain.name}`
          : `Uploaded ${uploaded} file(s) → ${domain.name}`,
      meta: { domainId: domain.id, targetPath },
    });

    const parts = [];
    if (uploaded) parts.push(`${uploaded} file(s)`);
    if (extracted) parts.push(`${extracted} zip (${extractedFiles} files extracted)`);

    res.json({
      message: parts.length ? `Uploaded ${parts.join(', ')}` : 'Upload complete',
      uploaded,
      extracted,
      extractedFiles,
      maxMb: SITE_UPLOAD_MAX_MB,
    });
  } catch (err) {
    if (err.message?.includes('unsafe paths') || err.message?.includes('Invalid path')) {
      return res.status(400).json({ message: err.message });
    }
    next(err);
  }
};

export const publishSite = async (req, res, next) => {
  try {
    const domain = await findUserDomain(req.params.id, req.user._id);
    if (!domain) return res.status(404).json({ message: 'Domain not found' });
    await ensureSite(domain);

    const ip = domain.primaryIp || '76.76.21.21';
    let records = Array.isArray(domain.dnsRecords) ? [...domain.dnsRecords] : [];
    records = upsertARecord(records, '@', ip);
    records = upsertARecord(records, 'www', ip);
    domain.dnsRecords = records;
    domain.forwarding = {
      ...(typeof domain.forwarding === 'object' ? domain.forwarding : {}),
      enabled: false,
    };
    domain.siteSlug = domain.siteSlug || domainToSlug(domain.name);
    domain.sitePublished = true;
    domain.sitePublishedAt = new Date();
    domain.status = 'active';
    await domain.save();

    const urls = await enrichSiteUrls(domain);
    await createLog({
      userId: req.user._id,
      level: 'success',
      source: 'site',
      message: `Website published: ${domain.name} → ${urls.liveUrl}`,
      meta: { domainId: domain.id, liveUrl: urls.liveUrl },
    });
    res.json({
      ...formatDoc(domain),
      urls,
      liveUrl: urls.liveUrl,
      openUrl: urls.openUrl,
      message: `Site published — open ${urls.liveUrl}`,
    });
  } catch (err) {
    next(err);
  }
};

export const getSiteStatus = async (req, res, next) => {
  try {
    const domain = await findUserDomain(req.params.id, req.user._id);
    if (!domain) return res.status(404).json({ message: 'Domain not found' });
    await ensureSite(domain);
    const payload = await sitePayload(domain);
    res.json(payload);
  } catch (err) {
    next(err);
  }
};
