import { isNamecheapConfigured } from '../services/namecheapService.js';

/**
 * Production hosting panel capabilities.
 * Real payments: STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET
 * Real domain sales: above + Namecheap API credentials
 */

export function getHostingCapabilities() {
  const stripeKey = process.env.STRIPE_SECRET_KEY?.trim();
  const webhook = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  const namecheap = isNamecheapConfigured();
  const isProd = process.env.NODE_ENV === 'production';

  const billingMode = stripeKey && webhook ? 'stripe' : isProd ? 'unconfigured' : 'development';

  const canPurchaseDomainInPanel = Boolean(stripeKey && webhook && namecheap);
  const domainMode = canPurchaseDomainInPanel
    ? 'reseller'
    : process.env.DOMAIN_REGISTRATION_MODE === 'demo'
      ? 'demo'
      : 'connect';

  const canRegisterInPanel = domainMode === 'demo' || canPurchaseDomainInPanel;

  return {
    product: 'Syntax Verse Hosting',
    production: isProd,
    domainRegistration: domainMode,
    domainRegistrationDemo: domainMode === 'demo',
    canRegisterInPanel,
    canPurchaseDomainInPanel,
    canConnectExisting: true,
    canTransferInPanel: true,
    billing: billingMode,
    billingDemo: billingMode !== 'stripe',
    stripeConfigured: Boolean(stripeKey),
    stripeWebhookConfigured: Boolean(webhook),
    namecheapConfigured: namecheap,
    paymentsReady: billingMode === 'stripe',
    externalDomainPurchaseUrl:
      process.env.EXTERNAL_DOMAIN_PURCHASE_URL?.trim() ||
      'https://www.hostinger.com/domain-name-search',
    externalDomainHelpUrl:
      process.env.EXTERNAL_DOMAIN_HELP_URL?.trim() ||
      'https://support.hostinger.com/en/articles/1583214-how-to-point-a-domain-to-hostinger',
    hosting: {
      fileManager: true,
      publish: true,
      dnsRecords: true,
      nameservers: true,
      ssl: true,
      backups: true,
      databases: true,
      customDomains: true,
    },
    setupRequired: [
      ...(!stripeKey ? ['STRIPE_SECRET_KEY'] : []),
      ...(!webhook ? ['STRIPE_WEBHOOK_SECRET'] : []),
      ...(!namecheap && canPurchaseDomainInPanel === false && isProd
        ? ['NAMECHEAP_API_* (for in-panel domain purchase)']
        : []),
    ],
    notes: {
      en: canPurchaseDomainInPanel
        ? 'Domains are checked via Namecheap, paid via Stripe, registered at the registrar, then hosted on your server.'
        : 'Connect domains you already own. Enable Namecheap + Stripe on the server to sell domains inside the panel.',
    },
  };
}

export function assertCanRegisterInPanel() {
  const caps = getHostingCapabilities();
  if (caps.canRegisterInPanel) return null;

  return {
    status: 403,
    body: {
      message: caps.paymentsReady
        ? 'Domain checkout requires Namecheap API keys on the server. You can still add a domain you already purchased.'
        : 'Payments are not configured on this server. Add a domain you purchased at Hostinger, or configure Stripe + Namecheap.',
      code: 'DOMAIN_PURCHASE_UNAVAILABLE',
      capabilities: caps,
      externalPurchaseUrl: caps.externalDomainPurchaseUrl,
    },
  };
}
