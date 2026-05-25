import { Domain } from '../models/index.js';
import { getSiteUrls } from '../utils/siteUrls.js';
import { sendPublishedSiteFile } from './serveSiteByHost.js';

/** Legacy path URL → redirect to professional subdomain. */
export const servePublicSite = async (req, res, next) => {
  try {
    const domainName = String(req.params.domain || '').toLowerCase();
    const filePart = req.params[0] || '';

    const domain = await Domain.findOne({
      where: { name: domainName, sitePublished: true },
    });
    if (!domain) {
      return res.status(404).send(`<!DOCTYPE html><html><body style="font-family:sans-serif;background:#0f172a;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh"><div style="text-align:center"><h1>Site not live</h1><p>Publish your site from Syntax Verse Dashboard → Files.</p></div></body></html>`);
    }

    const urls = getSiteUrls(domain);
    const subPath = filePart ? `/${filePart}` : '';
    if (!filePart && req.method === 'GET') {
      return res.redirect(301, `${urls.liveUrl}${subPath}`);
    }

    await sendPublishedSiteFile(domain, filePart, res);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return res.status(404).send('File not found');
    }
    next(err);
  }
};
