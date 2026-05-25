import { Deployment } from '../models/index.js';
import { formatDoc, formatDocs } from '../utils/formatDoc.js';
import { createLog } from '../services/logService.js';

export const getDeployments = async (req, res, next) => {
  try {
    const deployments = await Deployment.findAll({
      where: { userId: req.user._id },
      order: [['createdAt', 'DESC']],
    });
    res.json(formatDocs(deployments));
  } catch (err) {
    next(err);
  }
};

export const createDeployment = async (req, res, next) => {
  try {
    const deployment = await Deployment.create({
      userId: req.user._id,
      name: req.body.name,
      framework: req.body.framework || 'node',
      region: req.body.region || 'us-east-1',
      status: 'deploying',
      url: `https://${req.body.name.toLowerCase().replace(/\s+/g, '-')}.syntaxverse.app`,
      logs: ['Initializing build...', 'Installing dependencies...'],
    });

    await createLog({
      userId: req.user._id,
      level: 'info',
      source: 'deployment',
      message: `Deployment started: ${deployment.name} (${deployment.framework})`,
      meta: { deploymentId: deployment.id, region: deployment.region },
    });

    setTimeout(async () => {
      const prev = Array.isArray(deployment.logs) ? deployment.logs : [];
      const logs = [...prev.slice(-98), 'Build complete', 'Deployment live'];
      await deployment.update({
        status: 'live',
        logs,
        cpu: Math.floor(Math.random() * 40) + 10,
        memory: Math.floor(Math.random() * 60) + 20,
      });
      await createLog({
        userId: req.user._id,
        level: 'success',
        source: 'deployment',
        message: `Deployment live: ${deployment.name} → ${deployment.url}`,
        meta: { deploymentId: deployment.id },
      });
    }, 3000);

    res.status(201).json(formatDoc(deployment));
  } catch (err) {
    next(err);
  }
};

export const getDeployment = async (req, res, next) => {
  try {
    const deployment = await Deployment.findOne({
      where: { id: req.params.id, userId: req.user._id },
    });
    if (!deployment) return res.status(404).json({ message: 'Not found' });
    res.json(formatDoc(deployment));
  } catch (err) {
    next(err);
  }
};

export const deleteDeployment = async (req, res, next) => {
  try {
    const deleted = await Deployment.destroy({
      where: { id: req.params.id, userId: req.user._id },
    });
    if (!deleted) return res.status(404).json({ message: 'Not found' });
    await createLog({
      userId: req.user._id,
      level: 'warn',
      source: 'deployment',
      message: `Deployment removed (id ${req.params.id})`,
    });
    res.json({ message: 'Deleted' });
  } catch (err) {
    next(err);
  }
};
