import { resolveSiteFromHost } from '../utils/hostingRouting.js';
import { isSslActive } from '../services/sslService.js';
import { isCustomerSiteHost } from '../utils/hostingHosts.js';

/** Redirect HTTP → HTTPS when SSL is active (works behind reverse proxy). */
export const sslRedirectMiddleware = async (req, res, next) => {
  if (process.env.SSL_FORCE_HTTPS === 'false') return next();
  if (req.path.startsWith('/api')) return next();

  const host = (req.hostname || '').toLowerCase();
  if (!isCustomerSiteHost(host)) return next();

  const proto = req.get('x-forwarded-proto') || (req.secure ? 'https' : 'http');
  if (proto === 'https') return next();

  try {
    const resolved = await resolveSiteFromHost(host);
    if (!resolved?.domain || !isSslActive(resolved.domain)) return next();

    const port = process.env.SSL_HTTPS_PORT || '443';
    const defaultPort = port === '80' || port === '443' ? '' : `:${port}`;
    const target = `https://${host}${defaultPort}${req.originalUrl}`;
    return res.redirect(301, target);
  } catch {
    return next();
  }
};
