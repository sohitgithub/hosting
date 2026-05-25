import https from 'https';
import tls from 'tls';
import fs from 'fs';
import { certPaths, findDomainByHost } from './services/sslService.js';

/**
 * Optional HTTPS listener for local SSL testing.
 * Set SSL_HTTPS_PORT=5443 in backend/.env
 */
export function startHttpsIfEnabled(app) {
  const port = Number(process.env.SSL_HTTPS_PORT);
  if (!port) return null;

  const server = https.createServer(
    {
      SNICallback: (servername, cb) => {
        findDomainByHost(servername)
          .then((domain) => {
            if (!domain) return cb(new Error('no cert'));
            const paths = certPaths(domain.id);
            if (!fs.existsSync(paths.cert) || !fs.existsSync(paths.key)) {
              return cb(new Error('no cert'));
            }
            const ctx = tls.createSecureContext({
              cert: fs.readFileSync(paths.cert),
              key: fs.readFileSync(paths.key),
            });
            cb(null, ctx);
          })
          .catch((err) => cb(err));
      },
    },
    app
  );

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(
        `HTTPS port ${port} is already in use — API still runs on HTTP only. ` +
          `Stop the other process or change SSL_HTTPS_PORT in .env`
      );
      return;
    }
    console.error('HTTPS server error:', err.message);
  });

  try {
    server.listen(port, () => {
      console.log(`HTTPS (SSL) listening on port ${port}`);
    });
  } catch (err) {
    console.warn(`HTTPS could not start on port ${port}:`, err.message);
  }

  return server;
}
