/**
 * What this panel can do in production vs demo.
 *
 * DOMAIN_REGISTRATION_MODE:
 *   connect-only (default) — real hosting; domains bought at Hostinger/GoDaddy, then added here
 *   demo — panel-only fake register (development / demos only)
 *
 * BILLING_MODE:
 *   demo — invoices marked paid in DB only (no card charge)
 *   stripe — requires STRIPE_SECRET_KEY; charges via Stripe Checkout
 */

export function getHostingCapabilities() {
  const domainMode = (process.env.DOMAIN_REGISTRATION_MODE || 'connect-only').toLowerCase();
  const stripeKey = process.env.STRIPE_SECRET_KEY?.trim();
  const billingEnv = (process.env.BILLING_MODE || '').toLowerCase();
  const billingMode =
    billingEnv === 'stripe' && stripeKey
      ? 'stripe'
      : billingEnv === 'demo' || !stripeKey
        ? 'demo'
        : billingEnv || 'demo';

  const canRegisterInPanel = domainMode === 'demo';

  return {
    product: 'Syntax Verse Hosting',
    domainRegistration: domainMode,
    domainRegistrationDemo: canRegisterInPanel,
    canRegisterInPanel,
    canConnectExisting: true,
    canTransferInPanel: true,
    billing: billingMode,
    billingDemo: billingMode === 'demo',
    stripeConfigured: Boolean(stripeKey),
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
    notes: {
      en:
        'Real hosting: upload files, publish, point DNS A records to your server IP. Domain names must be purchased at a registrar (Hostinger, GoDaddy, etc.) unless demo mode is enabled.',
    },
  };
}

export function assertCanRegisterInPanel(res) {
  const caps = getHostingCapabilities();
  if (caps.canRegisterInPanel) return null;
  return {
    status: 403,
    body: {
      message:
        'This panel does not sell domain names. Buy your domain at Hostinger or another registrar, then add it under Dashboard → Domains → Add existing domain.',
      code: 'DOMAIN_REGISTRATION_DISABLED',
      capabilities: caps,
      externalPurchaseUrl: caps.externalDomainPurchaseUrl,
    },
  };
}
