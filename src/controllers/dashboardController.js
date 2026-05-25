import { Deployment, Domain, HostingAccount, Ticket } from '../models/index.js';
import { formatDoc, formatDocs } from '../utils/formatDoc.js';

export const getDashboardStats = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const [deployments, domains, hosting, openTickets] = await Promise.all([
      Deployment.count({ where: { userId } }),
      Domain.count({ where: { userId } }),
      HostingAccount.findOne({ where: { userId } }),
      Ticket.count({ where: { userId, status: 'open' } }),
    ]);

    const liveDeployments = await Deployment.count({
      where: { userId, status: 'live' },
    });

    res.json({
      deployments,
      liveDeployments,
      domains,
      servers: liveDeployments || (hosting ? 1 : 0),
      openTickets,
      uptime: '99.99%',
      diskUsed: hosting?.diskUsed || 0,
      diskLimit: hosting?.diskLimit || 10240,
      bandwidth: hosting?.bandwidth || 0,
      plan: req.user.plan || 'starter',
    });
  } catch (err) {
    next(err);
  }
};

export const getRecentDeployments = async (req, res, next) => {
  try {
    const deployments = await Deployment.findAll({
      where: { userId: req.user._id },
      order: [['createdAt', 'DESC']],
      limit: 5,
    });
    res.json(formatDocs(deployments));
  } catch (err) {
    next(err);
  }
};
