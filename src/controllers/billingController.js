import { Invoice } from '../models/index.js';
import { formatDocs } from '../utils/formatDoc.js';
import {
  getBillingSummary,
  upgradePlan,
  payInvoice,
  addPaymentMethod,
  removePaymentMethod,
  setDefaultPaymentMethod,
  PLANS,
} from '../services/billingService.js';

export const getSummary = async (req, res, next) => {
  try {
    const summary = await getBillingSummary(req.user._id);
    res.json(summary);
  } catch (err) {
    next(err);
  }
};

export const getInvoices = async (req, res, next) => {
  try {
    const invoices = await Invoice.findAll({
      where: { userId: req.user._id },
      order: [['createdAt', 'DESC']],
    });
    res.json(formatDocs(invoices));
  } catch (err) {
    next(err);
  }
};

export const getPlans = async (req, res, next) => {
  try {
    res.json({ plans: Object.values(PLANS), current: req.user.plan || 'starter' });
  } catch (err) {
    next(err);
  }
};

export const postUpgrade = async (req, res, next) => {
  try {
    const result = await upgradePlan(req.user._id, req.body.plan);
    res.json(result);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

export const postPayInvoice = async (req, res, next) => {
  try {
    const result = await payInvoice(req.user._id, req.params.id, req.body.paymentMethodId);
    res.json(result);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

export const postPaymentMethod = async (req, res, next) => {
  try {
    const method = await addPaymentMethod(req.user._id, req.body);
    res.status(201).json({ method, message: 'Payment method added' });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

export const deletePaymentMethod = async (req, res, next) => {
  try {
    const result = await removePaymentMethod(req.user._id, req.params.id);
    res.json(result);
  } catch (err) {
    res.status(404).json({ message: err.message });
  }
};

export const patchDefaultPaymentMethod = async (req, res, next) => {
  try {
    const method = await setDefaultPaymentMethod(req.user._id, req.params.id);
    res.json({ method });
  } catch (err) {
    res.status(404).json({ message: err.message });
  }
};
