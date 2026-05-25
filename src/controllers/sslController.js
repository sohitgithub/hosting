import { Domain } from '../models/index.js';
import { formatDoc } from '../utils/formatDoc.js';
import {
  installSsl,
  renewSsl,
  removeSsl,
  getSslDetails,
  getServerPublicIp,
} from '../services/sslService.js';

const findUserDomain = async (id, userId) => {
  return Domain.findOne({ where: { id, userId } });
};

export const getSslStatus = async (req, res, next) => {
  try {
    const domain = await findUserDomain(req.params.id, req.user._id);
    if (!domain) return res.status(404).json({ message: 'Domain not found' });
    res.json({
      domain: formatDoc(domain),
      ssl: getSslDetails(domain),
      serverIp: getServerPublicIp(),
    });
  } catch (err) {
    next(err);
  }
};

export const installDomainSsl = async (req, res, next) => {
  try {
    const domain = await findUserDomain(req.params.id, req.user._id);
    if (!domain) return res.status(404).json({ message: 'Domain not found' });

    const result = await installSsl(domain);
    await domain.reload();

    if (!result.ok) {
      return res.status(400).json({
        message: result.message,
        domain: formatDoc(domain),
        ssl: getSslDetails(domain),
      });
    }

    res.json({
      message: result.message,
      domain: formatDoc(domain),
      ssl: getSslDetails(domain),
    });
  } catch (err) {
    next(err);
  }
};

export const renewDomainSsl = async (req, res, next) => {
  try {
    const domain = await findUserDomain(req.params.id, req.user._id);
    if (!domain) return res.status(404).json({ message: 'Domain not found' });

    const result = await renewSsl(domain);
    await domain.reload();

    if (!result.ok) {
      return res.status(400).json({ message: result.message, ssl: getSslDetails(domain) });
    }

    res.json({
      message: 'SSL certificate renewed',
      domain: formatDoc(domain),
      ssl: getSslDetails(domain),
    });
  } catch (err) {
    next(err);
  }
};

export const removeDomainSsl = async (req, res, next) => {
  try {
    const domain = await findUserDomain(req.params.id, req.user._id);
    if (!domain) return res.status(404).json({ message: 'Domain not found' });

    const result = await removeSsl(domain);
    await domain.reload();

    res.json({
      message: result.message,
      domain: formatDoc(domain),
      ssl: getSslDetails(domain),
    });
  } catch (err) {
    next(err);
  }
};
