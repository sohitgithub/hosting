import './loadEnv.js';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { connectDB } from './config/db.js';
import { syncModels } from './models/index.js';
import { errorHandler } from './middleware/errorHandler.js';
import authRoutes from './routes/authRoutes.js';
import deploymentRoutes from './routes/deploymentRoutes.js';
import domainRoutes from './routes/domainRoutes.js';
import { protect } from './middleware/auth.js';
import {
  registerDomain,
  registerDomainCheckout,
  verifyDomainCheckout,
  searchDomain,
  getDomainInfo,
} from './controllers/domainController.js';
import { stripeWebhook } from './controllers/stripeWebhookController.js';
import { getHostingCapabilities } from './config/hostingCapabilities.js';
import ticketRoutes from './routes/ticketRoutes.js';
import hostingRoutes from './routes/hostingRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import billingRoutes from './routes/billingRoutes.js';
import dashboardRoutes from './routes/dashboardRoutes.js';
import logRoutes from './routes/logRoutes.js';
import databaseRoutes from './routes/databaseRoutes.js';
import backupRoutes from './routes/backupRoutes.js';
import apiKeyRoutes from './routes/apiKeyRoutes.js';
import terminalRoutes from './routes/terminalRoutes.js';
import { runScheduledBackups } from './services/backupService.js';
import { runSeed } from './seed.js';
import { requestLogger } from './middleware/requestLogger.js';
import { servePublicSite } from './middleware/servePublicSite.js';
import { subdomainSiteMiddleware } from './middleware/serveSiteByHost.js';
import { servePanelSpaMiddleware } from './middleware/servePanelSpa.js';
import { sslRedirectMiddleware } from './middleware/sslRedirect.js';
import { startHttpsIfEnabled } from './httpsServer.js';
import { renewExpiringCertificates } from './services/sslService.js';
import { isPacketTooLargeError } from './config/mysqlPacket.js';
import { getMailStatus, initMailService } from './services/mailService.js';
import { getPublicAppUrlStatus } from './utils/appUrl.js';

const app = express();
const PORT = process.env.PORT || 5000;

const isProduction = process.env.NODE_ENV === 'production';

function normalizeOrigin(url) {
  if (!url?.trim()) return null;
  try {
    return new URL(url.trim()).origin;
  } catch {
    return url.trim().replace(/\/$/, '');
  }
}

function buildAllowedOrigins() {
  const raw = [
    'http://localhost:5173',
    'http://localhost:5174',
    process.env.CLIENT_URL,
    process.env.PUBLIC_APP_URL,
    process.env.FRONTEND_URL,
    ...(process.env.CORS_EXTRA_ORIGINS || '').split(','),
  ];
  const set = new Set();
  for (const item of raw) {
    const o = normalizeOrigin(item);
    if (o) set.add(o);
  }
  return set;
}

const allowedOrigins = buildAllowedOrigins();

function isAllowedCorsOrigin(origin) {
  if (!origin) return true;
  const norm = normalizeOrigin(origin);
  if (allowedOrigins.has(norm)) return true;
  try {
    const host = new URL(norm).hostname;
    if (process.env.ALLOW_HOSTINGERSITE_CORS !== 'false' && host.endsWith('.hostingersite.com')) {
      return true;
    }
    for (const allowed of allowedOrigins) {
      const ah = new URL(allowed).hostname;
      if (host === ah || host === `www.${ah}` || `www.${host}` === ah) return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

app.set('trust proxy', 1);
app.use(helmet());
app.use(
  cors({
    origin: (origin, callback) => {
      if (isAllowedCorsOrigin(origin)) {
        callback(null, true);
        return;
      }
      if (!isProduction) {
        callback(null, true);
        return;
      }
      console.warn(
        `CORS blocked origin: ${origin} — allowed: ${[...allowedOrigins].join(', ') || '(none)'}`
      );
      callback(null, false);
    },
    credentials: true,
  })
);
app.use(morgan(isProduction ? 'combined' : 'dev'));

app.post(
  '/api/webhooks/stripe',
  express.raw({ type: 'application/json' }),
  stripeWebhook
);

app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '2mb' }));
app.use(express.urlencoded({ extended: true, limit: process.env.JSON_BODY_LIMIT || '2mb' }));
app.use(requestLogger);

app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    message: { message: 'Too many requests' },
  })
);

// ─── API (must run before site-hosting middleware) ─────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Syntax Verse Hosting API',
    database: 'mysql',
    mail: getMailStatus(),
    resetLinks: getPublicAppUrlStatus(),
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/deployments', deploymentRoutes);

app.get('/api/domains/search', searchDomain);
app.get('/api/domains/info', getDomainInfo);
app.post('/api/domains/register', protect, registerDomainCheckout);
app.post('/api/domains/register/checkout', protect, registerDomainCheckout);
app.get('/api/domains/register/verify', protect, verifyDomainCheckout);
app.use('/api/domains', domainRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/hosting', hostingRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/logs', logRoutes);
app.use('/api/databases', databaseRoutes);
app.use('/api/backups', backupRoutes);
app.use('/api/api-keys', apiKeyRoutes);
app.use('/api/terminal', terminalRoutes);

// ─── Published websites (host-based routing) ───────────────────────────────
app.use(sslRedirectMiddleware);
app.get('/sites/:domain', servePublicSite);
app.get('/sites/:domain/*', servePublicSite);
app.use(servePanelSpaMiddleware);
app.use(subdomainSiteMiddleware);

app.use(errorHandler);

process.on('unhandledRejection', (reason) => {
  if (isPacketTooLargeError(reason)) {
    console.error(
      'MySQL max_allowed_packet exceeded. Run: cd backend && npm run db:fix-packet —',
      reason?.message || reason
    );
    return;
  }
  console.error('Unhandled rejection:', reason?.message || reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});

const start = async () => {
  try {
    await connectDB();
    await syncModels();
    await runSeed();
    await initMailService();
    const resetLinks = getPublicAppUrlStatus();
    if (!resetLinks.configured) {
      console.warn(`[app] ${resetLinks.hint}`);
    } else {
      console.log(`[app] Reset password links → ${resetLinks.baseUrl}`);
    }
    const caps = getHostingCapabilities();
    console.log(
      `[app] Payments: ${caps.billing} | Domain sales: ${caps.canPurchaseDomainInPanel ? 'Namecheap+Stripe' : 'connect-only'}`
    );
    if (caps.setupRequired?.length) {
      console.warn(`[app] Production setup missing: ${caps.setupRequired.join(', ')}`);
    }

    const server = app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });

    const httpsServer = startHttpsIfEnabled(app);

    const closeListening = (srv) =>
      new Promise((resolve) => {
        if (!srv?.listening) {
          resolve();
          return;
        }
        srv.close(() => resolve());
      });

    const onShutdown = async (signal) => {
      await Promise.all([closeListening(server), closeListening(httpsServer)]);
      if (signal === 'SIGUSR2') {
        process.kill(process.pid, 'SIGUSR2');
        return;
      }
      process.exit(0);
    };
    process.once('SIGTERM', () => onShutdown('SIGTERM'));
    process.once('SIGINT', () => onShutdown('SIGINT'));
    process.once('SIGUSR2', () => onShutdown('SIGUSR2'));

    const renewHours = Number(process.env.SSL_RENEW_CHECK_HOURS) || 24;
    setInterval(() => renewExpiringCertificates(30), renewHours * 3600000);

    if (process.env.BACKUP_AUTO_DAILY === 'true') {
      setInterval(() => runScheduledBackups(), 24 * 3600000);
      setTimeout(() => runScheduledBackups(), 60_000);
    }

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} is already in use. Stop the other process:`);
        console.error(`  lsof -i :${PORT}   then   kill <PID>`);
        console.error(`  Or: kill $(lsof -t -i :${PORT})`);
      } else {
        console.error('Server error:', err.message);
      }
      process.exit(1);
    });
  } catch (err) {
    console.error('Failed to start server:', err.message);
    process.exit(1);
  }
};

start();
