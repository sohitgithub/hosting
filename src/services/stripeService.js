import Stripe from 'stripe';
import { Invoice, User, Domain } from '../models/index.js';
import { createLog } from './logService.js';
import { initSite } from './siteStorage.js';
import { domainToSlug, getSiteUrls } from '../utils/siteUrls.js';
import { getServerPublicIp } from './sslService.js';
import { defaultDnsRecords } from '../utils/dnsHelpers.js';
import { DEFAULT_NAMESERVERS } from '../models/index.js';
import { registerDomainAtNamecheap, isNamecheapConfigured } from './namecheapService.js';
import { formatDoc } from '../utils/formatDoc.js';

let stripeClient;

export function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) return null;
  if (!stripeClient) stripeClient = new Stripe(key);
  return stripeClient;
}

export function requireStripe() {
  const s = getStripe();
  if (!s) {
    throw new Error(
      'Payments are not configured. Add STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET to the server environment.'
    );
  }
  return s;
}

function panelBaseUrl() {
  const url =
    process.env.CLIENT_URL ||
    process.env.PUBLIC_APP_URL ||
    process.env.FRONTEND_URL ||
    'http://localhost:5173';
  return url.replace(/\/$/, '');
}

export async function createCheckoutForInvoice(invoice, user) {
  const stripe = requireStripe();
  const base = panelBaseUrl();
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer_email: user.email,
    line_items: [
      {
        price_data: {
          currency: (process.env.STRIPE_CURRENCY || 'usd').toLowerCase(),
          product_data: {
            name: invoice.description || 'Hosting invoice',
          },
          unit_amount: Math.round(Number(invoice.amount) * 100),
        },
        quantity: 1,
      },
    ],
    metadata: {
      type: 'invoice',
      invoiceId: String(invoice.id),
      userId: String(user.id),
    },
    success_url: `${base}/dashboard/billing?paid=1&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/dashboard/billing?cancelled=1`,
  });

  await invoice.update({
    stripeCheckoutSessionId: session.id,
    paymentMeta: { ...(invoice.paymentMeta || {}), checkoutCreatedAt: new Date().toISOString() },
  });

  return { url: session.url, sessionId: session.id };
}

export async function createCheckoutForDomainRegistration(user, domainName, price) {
  const stripe = requireStripe();
  const base = panelBaseUrl();

  const invoice = await Invoice.create({
    userId: user.id,
    amount: price,
    description: `Domain registration — ${domainName}`,
    status: 'pending',
    dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
    paymentMeta: { type: 'domain_registration', domainName },
  });

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer_email: user.email,
    line_items: [
      {
        price_data: {
          currency: (process.env.STRIPE_CURRENCY || 'usd').toLowerCase(),
          product_data: {
            name: `Domain registration — ${domainName}`,
            description: 'Includes hosting setup on Syntax Verse',
          },
          unit_amount: Math.round(Number(price) * 100),
        },
        quantity: 1,
      },
    ],
    metadata: {
      type: 'domain_registration',
      invoiceId: String(invoice.id),
      userId: String(user.id),
      domainName,
    },
    success_url: `${base}/dashboard/domains?registered=${encodeURIComponent(domainName)}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/domains?cancelled=1`,
  });

  await invoice.update({ stripeCheckoutSessionId: session.id });

  return { url: session.url, sessionId: session.id, invoiceId: invoice.id };
}

async function fulfillDomainRegistration(userId, domainName, invoice) {
  const existing = await Domain.findOne({ where: { name: domainName } });
  if (existing) {
    if (String(existing.userId) === String(userId)) return existing;
    throw new Error('Domain already registered on the platform');
  }

  const ip = getServerPublicIp();
  let registrar = 'Syntax Verse';
  let namecheapResult = null;

  if (isNamecheapConfigured()) {
    namecheapResult = await registerDomainAtNamecheap(domainName);
    registrar = 'Namecheap';
  }

  const domain = await Domain.create({
    userId,
    name: domainName,
    siteSlug: domainToSlug(domainName),
    status: 'active',
    ssl: false,
    sslStatus: 'none',
    primaryIp: ip,
    nameservers: isNamecheapConfigured() ? DEFAULT_NAMESERVERS : [],
    nameserverMode: isNamecheapConfigured() ? 'syntaxverse' : 'registrar',
    dnsRecords: defaultDnsRecords(domainName, ip),
    registrar,
    expiresAt: new Date(Date.now() + 365 * 86400000),
  });

  await initSite(domain.id, domainName);

  await createLog({
    userId,
    level: 'success',
    source: 'domain',
    message: `Domain registered (paid): ${domainName}`,
    meta: { domainId: domain.id, namecheap: !!namecheapResult },
  });

  await invoice.update({
    paymentMeta: {
      ...(invoice.paymentMeta || {}),
      domainId: domain.id,
      namecheapOrderId: namecheapResult?.orderId || null,
    },
  });

  return domain;
}

async function fulfillInvoicePayment(invoice) {
  if (invoice.status === 'paid') return invoice;
  await invoice.update({
    status: 'paid',
    paidAt: new Date(),
    paymentMethodId: 'stripe',
  });
  await createLog({
    userId: invoice.userId,
    level: 'success',
    source: 'billing',
    message: `Stripe payment: $${Number(invoice.amount).toFixed(2)} — ${invoice.description}`,
  });
  return invoice;
}

export async function handleStripeWebhook(rawBody, signature) {
  const stripe = requireStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET is not configured');

  const event = stripe.webhooks.constructEvent(rawBody, signature, secret);

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const meta = session.metadata || {};
    const invoiceId = meta.invoiceId;
    if (!invoiceId) return { received: true };

    const invoice = await Invoice.findByPk(invoiceId);
    if (!invoice) return { received: true };

    if (meta.type === 'domain_registration' && meta.domainName) {
      await fulfillInvoicePayment(invoice);
      await fulfillDomainRegistration(invoice.userId, meta.domainName.toLowerCase(), invoice);
    } else {
      await fulfillInvoicePayment(invoice);
    }
  }

  return { received: true };
}

export async function verifyCheckoutSession(userId, sessionId) {
  const stripe = requireStripe();
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  if (session.payment_status !== 'paid') {
    return { paid: false, status: session.payment_status };
  }

  const invoiceId = session.metadata?.invoiceId;
  if (!invoiceId) return { paid: true };

  const invoice = await Invoice.findOne({ where: { id: invoiceId, userId } });
  if (!invoice) return { paid: true };

  if (invoice.status !== 'paid') {
    if (session.metadata?.type === 'domain_registration' && session.metadata?.domainName) {
      await fulfillInvoicePayment(invoice);
      const domain = await fulfillDomainRegistration(
        userId,
        session.metadata.domainName.toLowerCase(),
        invoice
      );
      return { paid: true, domain: formatDoc(domain), siteUrls: getSiteUrls(domain) };
    }
    await fulfillInvoicePayment(invoice);
  }

  const domainId = invoice.paymentMeta?.domainId;
  if (domainId) {
    const domain = await Domain.findByPk(domainId);
    if (domain) return { paid: true, domain: formatDoc(domain), siteUrls: getSiteUrls(domain) };
  }

  return { paid: true, invoice: formatDoc(invoice) };
}
