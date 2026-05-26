import { User, Invoice, HostingAccount } from '../models/index.js';
import { ensureHostingAccount } from './hostingPanelService.js';
import { createLog } from './logService.js';
import { getHostingCapabilities } from '../config/hostingCapabilities.js';
import { createCheckoutForInvoice } from './stripeService.js';

export const PLANS = {
  starter: {
    id: 'starter',
    label: 'Starter',
    price: 9.99,
    diskLimit: 10240,
    bandwidthGb: 100,
    databases: 5,
    domains: 3,
    emailAccounts: 5,
    ssl: true,
    backups: true,
  },
  pro: {
    id: 'pro',
    label: 'Pro',
    price: 29.99,
    diskLimit: 81920,
    bandwidthGb: 500,
    databases: 15,
    domains: 25,
    emailAccounts: 25,
    ssl: true,
    backups: true,
  },
  enterprise: {
    id: 'enterprise',
    label: 'Enterprise',
    price: 99.99,
    diskLimit: 512000,
    bandwidthGb: 5000,
    databases: 50,
    domains: 100,
    emailAccounts: 100,
    ssl: true,
    backups: true,
  },
};

function formatInvoice(inv) {
  const j = inv.toJSON ? inv.toJSON() : inv;
  return {
    ...j,
    id: j.id,
    _id: j.id,
    amount: Number(j.amount),
    invoiceNumber: j.invoiceNumber || `INV-${String(j.id).padStart(6, '0')}`,
  };
}

export async function getBillingSummary(userId) {
  const user = await User.findByPk(userId);
  if (!user) throw new Error('User not found');

  const planId = user.plan || 'starter';
  const plan = PLANS[planId] || PLANS.starter;
  const account = await ensureHostingAccount(userId, planId);
  const caps = getHostingCapabilities();

  const invoices = await Invoice.findAll({
    where: { userId },
    order: [['createdAt', 'DESC']],
    limit: 50,
  });

  const paymentMethods = user.paymentMethods || [];
  const pending = invoices.filter((i) => i.status === 'pending');
  const paid = invoices.filter((i) => i.status === 'paid');

  const lastPaid = paid[0];
  const cycleStart = lastPaid?.updatedAt || user.createdAt || new Date();
  const nextBilling = new Date(cycleStart);
  nextBilling.setMonth(nextBilling.getMonth() + 1);

  return {
    plan: {
      id: planId,
      ...plan,
      status: account.status,
      diskUsedMb: account.diskUsed || 0,
      diskLimitMb: account.diskLimit || plan.diskLimit,
    },
    billing: {
      nextBillingDate: nextBilling.toISOString(),
      amountDue: pending.reduce((s, i) => s + Number(i.amount), 0),
      pendingCount: pending.length,
      currency: (process.env.STRIPE_CURRENCY || 'usd').toUpperCase(),
    },
    paymentMethods: caps.paymentsReady ? [] : paymentMethods,
    defaultPaymentMethodId: null,
    invoices: invoices.map(formatInvoice),
    plans: Object.values(PLANS),
    capabilities: caps,
    paymentsReady: caps.paymentsReady,
  };
}

export async function upgradePlan(userId, newPlanId) {
  const plan = PLANS[newPlanId];
  if (!plan) throw new Error('Invalid plan');

  const user = await User.findByPk(userId);
  if (!user) throw new Error('User not found');

  const current = user.plan || 'starter';
  if (current === newPlanId) {
    return { message: 'You are already on this plan', plan: newPlanId };
  }

  await user.update({ plan: newPlanId });
  const account = await ensureHostingAccount(userId, newPlanId);
  await account.update({
    package: newPlanId,
    diskLimit: plan.diskLimit,
    status: 'active',
  });

  const isUpgrade = (PLANS[current]?.price || 0) < plan.price;
  const invoice = await Invoice.create({
    userId,
    amount: plan.price,
    description: `${plan.label} Plan — ${isUpgrade ? 'Upgrade' : 'Downgrade'} (${new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' })})`,
    status: 'pending',
    dueDate: new Date(Date.now() + 7 * 86400000),
  });

  await createLog({
    userId,
    level: 'info',
    source: 'billing',
    message: `Plan changed to ${plan.label}`,
  });

  return {
    message: `Plan updated to ${plan.label}. Pay the invoice to activate.`,
    plan: newPlanId,
    invoice: formatInvoice(invoice),
  };
}

export async function payInvoice(userId, invoiceId) {
  const invoice = await Invoice.findOne({ where: { id: invoiceId, userId } });
  if (!invoice) throw new Error('Invoice not found');
  if (invoice.status === 'paid') throw new Error('Invoice already paid');

  const caps = getHostingCapabilities();
  if (!caps.paymentsReady) {
    throw new Error(
      'Secure payments are not configured on this server. Add STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET.'
    );
  }

  const user = await User.findByPk(userId);
  const { url, sessionId } = await createCheckoutForInvoice(invoice, user);

  return {
    checkoutUrl: url,
    sessionId,
    message: 'Opening secure Stripe checkout…',
    invoice: formatInvoice(invoice),
  };
}

export async function addPaymentMethod() {
  throw new Error('Add a card during Stripe checkout. Saved cards use Stripe Customer (coming soon).');
}

export async function removePaymentMethod(userId, methodId) {
  const user = await User.findByPk(userId);
  let methods = (user.paymentMethods || []).filter((m) => m.id !== methodId);
  if (methods.length === (user.paymentMethods || []).length) {
    throw new Error('Payment method not found');
  }
  await user.update({ paymentMethods: methods });
  return { message: 'Payment method removed' };
}

export async function setDefaultPaymentMethod(userId, methodId) {
  const user = await User.findByPk(userId);
  const methods = (user.paymentMethods || []).map((m) => ({
    ...m,
    isDefault: m.id === methodId,
  }));
  if (!methods.some((m) => m.id === methodId)) throw new Error('Payment method not found');
  await user.update({ paymentMethods: methods });
  return methods.find((m) => m.id === methodId);
}
