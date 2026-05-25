import { HostingAccount } from '../models/index.js';
import { formatDoc, formatDocs } from '../utils/formatDoc.js';
import {
  getHostingPanel,
  ensureHostingAccount,
  addEmailAccount,
  removeEmailAccount,
  addCronJob,
  removeCronJob,
  toggleCronJob,
  restartHostingServer,
} from '../services/hostingPanelService.js';

export const getHostingAccounts = async (req, res, next) => {
  try {
    const accounts = await HostingAccount.findAll({ where: { userId: req.user._id } });
    res.json(formatDocs(accounts));
  } catch (err) {
    next(err);
  }
};

export const getPanel = async (req, res, next) => {
  try {
    const panel = await getHostingPanel(req.user._id);
    res.json(panel);
  } catch (err) {
    next(err);
  }
};

export const createHostingAccount = async (req, res, next) => {
  try {
    const account = await ensureHostingAccount(req.user._id, req.body.package || 'starter');
    res.status(201).json(formatDoc(account));
  } catch (err) {
    next(err);
  }
};

export const updateHostingAccount = async (req, res, next) => {
  try {
    const account = await HostingAccount.findOne({
      where: { id: req.params.id, userId: req.user._id },
    });
    if (!account) return res.status(404).json({ message: 'Not found' });
    const allowed = ['package', 'status'];
    const updates = {};
    allowed.forEach((k) => {
      if (req.body[k] !== undefined) updates[k] = req.body[k];
    });
    await account.update(updates);
    res.json(formatDoc(account));
  } catch (err) {
    next(err);
  }
};

export const postEmail = async (req, res, next) => {
  try {
    const entry = await addEmailAccount(req.user._id, req.body);
    res.status(201).json({ email: entry, message: 'Email account created' });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

export const deleteEmail = async (req, res, next) => {
  try {
    const result = await removeEmailAccount(req.user._id, req.params.id);
    res.json(result);
  } catch (err) {
    res.status(404).json({ message: err.message });
  }
};

export const postCron = async (req, res, next) => {
  try {
    const entry = await addCronJob(req.user._id, req.body);
    res.status(201).json({ cron: entry, message: 'Cron job created' });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

export const deleteCron = async (req, res, next) => {
  try {
    const result = await removeCronJob(req.user._id, req.params.id);
    res.json(result);
  } catch (err) {
    res.status(404).json({ message: err.message });
  }
};

export const patchCron = async (req, res, next) => {
  try {
    const job = await toggleCronJob(req.user._id, req.params.id, req.body.enabled);
    if (!job) return res.status(404).json({ message: 'Cron job not found' });
    res.json({ cron: job });
  } catch (err) {
    next(err);
  }
};

export const postRestart = async (req, res, next) => {
  try {
    const result = await restartHostingServer(req.user._id);
    res.json(result);
  } catch (err) {
    next(err);
  }
};
