import { User, Invoice, HostingAccount } from '../models/index.js';
import { ensureHostingAccount } from './hostingPanelService.js';
import { createLog } from './logService.js';

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

function nextId(list) {
  return String(Date.now()) + Math.random().toString(36).slice(2, 6);
}

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
      currency: 'USD',
    },
    paymentMethods,
    defaultPaymentMethodId:
      paymentMethods.find((p) => p.isDefault)?.id || paymentMethods[0]?.id || null,
    invoices: invoices.map(formatInvoice),
    plans: Object.values(PLANS),
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
    message: `Plan updated to ${plan.label}. Pay the new invoice to activate billing for this cycle.`,
    plan: newPlanId,
    invoice: formatInvoice(invoice),
  };
}

export async function payInvoice(userId, invoiceId, paymentMethodId) {
  const invoice = await Invoice.findOne({ where: { id: invoiceId, userId } });
  if (!invoice) throw new Error('Invoice not found');
  if (invoice.status === 'paid') throw new Error('Invoice already paid');

  const billingMode = (process.env.BILLING_MODE || 'demo').toLowerCase();
  const stripeKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (billingMode === 'stripe' && stripeKey) {
    throw new Error(
      'Stripe checkout is not wired yet. Set BILLING_MODE=demo or contact support to pay hosting invoices.'
    );
  }

  const user = await User.findByPk(userId);
  const methods = user.paymentMethods || [];
  if (methods.length === 0) {
    throw new Error('Add a payment method before paying');
  }

  const method = paymentMethodId
    ? methods.find((m) => m.id === paymentMethodId)
    : methods.find((m) => m.isDefault) || methods[0];
  if (!method) throw new Error('Payment method not found');

  await invoice.update({
    status: 'paid',
    paidAt: new Date(),
    paymentMethodId: method.id,
  });

  await createLog({
    userId,
    level: 'success',
    source: 'billing',
    message: `Payment received (demo billing): $${Number(invoice.amount).toFixed(2)} — ${invoice.description}`,
  });

  return {
    message: `Payment of $${Number(invoice.amount).toFixed(2)} recorded (demo — no card was charged)`,
    invoice: formatInvoice(invoice),
    billingDemo: true,
  };
}

export async function addPaymentMethod(userId, { brand, last4, expMonth, expYear, name }) {
  const user = await User.findByPk(userId);
  const digits = String(last4 || '').replace(/\D/g, '').slice(-4);
  if (digits.length !== 4) throw new Error('Enter the last 4 digits of your card');

  const methods = [...(user.paymentMethods || [])];
  if (methods.length >= 5) throw new Error('Maximum 5 payment methods');

  const entry = {
    id: nextId(methods),
    brand: (brand || 'visa').toLowerCase(),
    last4: digits,
    expMonth: Number(expMonth) || 12,
    expYear: Number(expYear) || new Date().getFullYear() + 3,
    name: (name || 'Cardholder').trim().slice(0, 80),
    isDefault: methods.length === 0,
    createdAt: new Date().toISOString(),
  };
  methods.push(entry);
  await user.update({ paymentMethods: methods });

  return entry;
}

export async function removePaymentMethod(userId, methodId) {
  const user = await User.findByPk(userId);
  let methods = (user.paymentMethods || []).filter((m) => m.id !== methodId);
  if (methods.length === (user.paymentMethods || []).length) {
    throw new Error('Payment method not found');
  }
  if (methods.length && !methods.some((m) => m.isDefault)) {
    methods = methods.map((m, i) => (i === 0 ? { ...m, isDefault: true } : m));
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
