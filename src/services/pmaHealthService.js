import http from 'http';
import https from 'https';
import { getPhpMyAdminPublicUrl } from './pmaTokenService.js';

/** Host the DB manager uses to connect to MySQL. */
export function getPmaMysqlHost() {
  if (process.env.PHPMYADMIN_MYSQL_HOST) {
    return process.env.PHPMYADMIN_MYSQL_HOST;
  }
  const mode = (process.env.PHPMYADMIN_MODE || 'phpmyadmin').toLowerCase();
  const appHost = process.env.MYSQL_HOST || 'localhost';
  if (mode === 'phpmyadmin' || mode === 'php' || mode === 'adminer') {
    return appHost === 'localhost' ? '127.0.0.1' : appHost;
  }
  if (appHost === 'localhost' || appHost === '127.0.0.1') {
    return 'host.docker.internal';
  }
  return appHost;
}

export async function checkPhpMyAdminReachable() {
  const base = getPhpMyAdminPublicUrl();
  let url;
  try {
    url = new URL(base);
  } catch {
    return { reachable: false, message: 'Invalid PHPMYADMIN_URL in backend/.env' };
  }

  const port = url.port || (url.protocol === 'https:' ? 443 : 80);
  const lib = url.protocol === 'https:' ? https : http;

  return new Promise((resolve) => {
    const req = lib.request(
      {
        hostname: url.hostname,
        port,
        path: '/index.php',
        method: 'GET',
        timeout: 4000,
      },
      (res) => {
        res.resume();
        resolve({
          reachable: res.statusCode < 500,
          message: res.statusCode < 500 ? null : `phpMyAdmin returned HTTP ${res.statusCode}`,
        });
      }
    );
    req.on('error', (err) => {
      const refused = err.code === 'ECONNREFUSED';
      resolve({
        reachable: false,
        message: refused
          ? `Nothing is listening on ${base}. In the project folder run: npm run pma:up`
          : err.message,
      });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ reachable: false, message: `Timed out connecting to ${base}` });
    });
    req.end();
  });
}
