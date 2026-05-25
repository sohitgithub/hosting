import { Sequelize } from 'sequelize';
import { User, Deployment, Ticket, Invoice, Domain, HostingAccount } from '../models/index.js';
import { formatDoc, formatDocs } from '../utils/formatDoc.js';

export const getUsers = async (req, res, next) => {
  try {
    const users = await User.findAll({
      attributes: { exclude: ['password'] },
      order: [['createdAt', 'DESC']],
    });
    res.json(formatDocs(users));
  } catch (err) {
    next(err);
  }
};

export const updateUser = async (req, res, next) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    const { name, email, role, plan } = req.body;
    if (name) user.name = name;
    if (email) user.email = email;
    if (role) user.role = role;
    if (plan) user.plan = plan;
    await user.save();
    res.json(formatDoc(user));
  } catch (err) {
    next(err);
  }
};

export const getStats = async (req, res, next) => {
  try {
    const [users, deployments, domains, openTickets, revenueRow, hostingAccounts] = await Promise.all([
      User.count(),
      Deployment.count(),
      Domain.count(),
      Ticket.count({ where: { status: 'open' } }),
      Invoice.findOne({
        attributes: [[Sequelize.fn('SUM', Sequelize.col('amount')), 'total']],
        where: { status: 'paid' },
        raw: true,
      }),
      HostingAccount.count(),
    ]);
    res.json({
      users,
      deployments,
      domains,
      hostingAccounts,
      openTickets,
      revenue: Number(revenueRow?.total || 0),
      servers: { online: 12, total: 12 },
    });
  } catch (err) {
    next(err);
  }
};

export const getInvoices = async (req, res, next) => {
  try {
    const invoices = await Invoice.findAll({
      include: [{ model: User, attributes: ['id', 'name', 'email'] }],
      order: [['createdAt', 'DESC']],
    });
    const formatted = invoices.map((inv) => {
      const doc = formatDoc(inv);
      if (inv.User) {
        doc.user = { _id: inv.User.id, name: inv.User.name, email: inv.User.email };
      }
      return doc;
    });
    res.json(formatted);
  } catch (err) {
    next(err);
  }
};

export const updateInvoice = async (req, res, next) => {
  try {
    const invoice = await Invoice.findByPk(req.params.id);
    if (!invoice) return res.status(404).json({ message: 'Invoice not found' });
    if (req.body.status) invoice.status = req.body.status;
    if (req.body.amount != null) invoice.amount = req.body.amount;
    await invoice.save();
    res.json(formatDoc(invoice));
  } catch (err) {
    next(err);
  }
};

export const getAdminDeployments = async (req, res, next) => {
  try {
    const deployments = await Deployment.findAll({
      include: [{ model: User, attributes: ['id', 'name', 'email'] }],
      order: [['createdAt', 'DESC']],
    });
    res.json(
      deployments.map((d) => {
        const doc = formatDoc(d);
        if (d.User) doc.user = { _id: d.User.id, name: d.User.name, email: d.User.email };
        return doc;
      })
    );
  } catch (err) {
    next(err);
  }
};

export const getAdminDomains = async (req, res, next) => {
  try {
    const domains = await Domain.findAll({
      include: [{ model: User, attributes: ['id', 'name', 'email'] }],
      order: [['createdAt', 'DESC']],
    });
    res.json(
      domains.map((d) => {
        const doc = formatDoc(d);
        if (d.User) doc.user = { _id: d.User.id, name: d.User.name, email: d.User.email };
        return doc;
      })
    );
  } catch (err) {
    next(err);
  }
};

export const getAdminTickets = async (req, res, next) => {
  try {
    const { listAllTicketsAdmin } = await import('../services/ticketService.js');
    const tickets = await listAllTicketsAdmin();
    res.json(tickets);
  } catch (err) {
    next(err);
  }
};

export const updateAdminTicket = async (req, res, next) => {
  try {
    const { addTicketReply, updateTicketStatus, getTicketForUser } = await import('../services/ticketService.js');
    const ticketId = req.params.id;
    let ticket;

    if (req.body.reply) {
      ticket = await addTicketReply(null, ticketId, req.body.reply, {
        asAdmin: true,
        authorName: 'Syntax Verse Support',
      });
    }
    if (req.body.status) {
      ticket = await updateTicketStatus(null, ticketId, req.body.status, { isAdmin: true });
    }
    if (req.body.priority) {
      const row = await Ticket.findByPk(ticketId);
      if (!row) return res.status(404).json({ message: 'Ticket not found' });
      await row.update({ priority: req.body.priority });
      ticket = await getTicketForUser(row.userId, ticketId, true);
    }

    if (!ticket) {
      const row = await Ticket.findByPk(ticketId);
      if (!row) return res.status(404).json({ message: 'Ticket not found' });
      ticket = await getTicketForUser(row.userId, ticketId, true);
    }

    res.json(ticket);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};
