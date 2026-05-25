import { Op } from 'sequelize';
import { Ticket, User } from '../models/index.js';
import { createLog } from './logService.js';

export const TICKET_CATEGORIES = [
  { id: 'hosting', label: 'Hosting & websites' },
  { id: 'domains', label: 'Domains & DNS' },
  { id: 'ssl', label: 'SSL / HTTPS' },
  { id: 'databases', label: 'Databases' },
  { id: 'billing', label: 'Billing & plans' },
  { id: 'email', label: 'Email' },
  { id: 'general', label: 'General' },
];

function nextId() {
  return String(Date.now()) + Math.random().toString(36).slice(2, 8);
}

function formatReply(r) {
  if (!r || typeof r !== 'object') return null;
  return {
    id: r.id || nextId(),
    from: r.from || 'user',
    authorName: r.authorName || (r.from === 'admin' ? 'Support Team' : 'You'),
    message: r.message,
    createdAt: r.createdAt || new Date().toISOString(),
  };
}

/** MySQL/Sequelize may return JSON columns as string, object, or array. */
export function normalizeReplies(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    return raw.map(formatReply).filter(Boolean);
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map(formatReply).filter(Boolean) : [];
    } catch {
      return [];
    }
  }
  if (typeof raw === 'object') {
    return Object.values(raw)
      .map(formatReply)
      .filter(Boolean);
  }
  return [];
}

export function formatTicket(ticket, user = null) {
  const j = ticket.toJSON ? ticket.toJSON() : ticket;
  const replies = normalizeReplies(j.replies);
  const doc = {
    ...j,
    id: j.id,
    _id: j.id,
    ticketNumber: j.ticketNumber || `TKT-${String(j.id).padStart(5, '0')}`,
    category: j.category || 'general',
    replies,
    replyCount: replies.length,
  };
  if (user) {
    doc.user = { _id: user.id, name: user.name, email: user.email };
  } else if (ticket.User) {
    doc.user = {
      _id: ticket.User.id,
      name: ticket.User.name,
      email: ticket.User.email,
    };
  }
  return doc;
}

export async function getSupportSummary(userId) {
  const tickets = await Ticket.findAll({
    where: { userId },
    order: [['updatedAt', 'DESC']],
  });
  const open = tickets.filter((t) => t.status === 'open' || t.status === 'in_progress').length;
  const resolved = tickets.filter((t) => t.status === 'resolved' || t.status === 'closed').length;

  return {
    total: tickets.length,
    open,
    resolved,
    responseTimeLabel: 'Typically under 2 hours',
    categories: TICKET_CATEGORIES,
  };
}

export async function listTicketsForUser(userId) {
  const tickets = await Ticket.findAll({
    where: { userId },
    order: [['updatedAt', 'DESC']],
  });
  return tickets.map((t) => formatTicket(t));
}

export async function getTicketForUser(userId, ticketId, isAdmin = false) {
  const where = isAdmin ? { id: ticketId } : { id: ticketId, userId };
  const ticket = await Ticket.findOne({
    where,
    include: isAdmin ? [{ model: User, attributes: ['id', 'name', 'email'] }] : [],
  });
  if (!ticket) throw new Error('Ticket not found');
  return formatTicket(ticket, ticket.User);
}

export async function createTicket(userId, { subject, message, priority, category }, userName) {
  const subj = String(subject || '').trim().slice(0, 120);
  const body = String(message || '').trim();
  if (!subj) throw new Error('Subject is required');
  if (body.length < 10) throw new Error('Please describe your issue in at least 10 characters');

  const openCount = await Ticket.count({
    where: { userId, status: { [Op.in]: ['open', 'in_progress'] } },
  });
  if (openCount >= 10) throw new Error('You have too many open tickets. Please close or wait on existing ones.');

  const ticket = await Ticket.create({
    userId,
    subject: subj,
    message: body,
    priority: ['low', 'medium', 'high'].includes(priority) ? priority : 'medium',
    category: TICKET_CATEGORIES.some((c) => c.id === category) ? category : 'general',
    status: 'open',
    replies: [],
    ticketNumber: `TKT-${Date.now().toString(36).toUpperCase().slice(-8)}`,
    lastReplyAt: new Date(),
  });

  await createLog({
    userId,
    level: 'info',
    source: 'support',
    message: `Support ticket opened: ${subj}`,
    meta: { ticketId: ticket.id },
  });

  return formatTicket(ticket);
}

export async function addTicketReply(userId, ticketId, message, { asAdmin = false, authorName } = {}) {
  const body = String(message || '').trim();
  if (!body) throw new Error('Reply message is required');
  if (body.length < 2) throw new Error('Reply is too short');

  const owned = await Ticket.findOne({
    where: asAdmin ? { id: ticketId } : { id: ticketId, userId },
  });
  if (!owned) throw new Error('Ticket not found');

  if (!asAdmin && ['closed'].includes(owned.status)) {
    throw new Error('This ticket is closed. Open a new ticket if you need more help.');
  }

  const reply = formatReply({
    id: nextId(),
    from: asAdmin ? 'admin' : 'user',
    authorName: authorName || (asAdmin ? 'Syntax Verse Support' : 'You'),
    message: body,
    createdAt: new Date().toISOString(),
  });

  const replies = [...(owned.replies || []), reply];
  const updates = {
    replies,
    lastReplyAt: new Date(),
  };

  if (asAdmin) {
    if (owned.status === 'open') updates.status = 'in_progress';
  } else if (owned.status === 'resolved') {
    updates.status = 'open';
  }

  await owned.update(updates);

  if (asAdmin) {
    await createLog({
      userId: owned.userId,
      level: 'info',
      source: 'support',
      message: `Support replied on: ${owned.subject}`,
      meta: { ticketId: owned.id },
    });
  }

  return formatTicket(owned);
}

export async function updateTicketStatus(userId, ticketId, status, { isAdmin = false } = {}) {
  const allowed = ['open', 'in_progress', 'resolved', 'closed'];
  if (!allowed.includes(status)) throw new Error('Invalid status');

  const ticket = await Ticket.findOne({
    where: isAdmin ? { id: ticketId } : { id: ticketId, userId },
  });
  if (!ticket) throw new Error('Ticket not found');

  if (!isAdmin && !['resolved', 'closed'].includes(status)) {
    throw new Error('You can only mark tickets as resolved or closed');
  }

  await ticket.update({ status });

  if (status === 'closed' || status === 'resolved') {
    await createLog({
      userId: ticket.userId,
      level: 'info',
      source: 'support',
      message: `Ticket ${status}: ${ticket.subject}`,
      meta: { ticketId: ticket.id },
    });
  }

  return formatTicket(ticket);
}

export async function listAllTicketsAdmin() {
  const tickets = await Ticket.findAll({
    include: [{ model: User, attributes: ['id', 'name', 'email'] }],
    order: [['updatedAt', 'DESC']],
  });
  return tickets.map((t) => formatTicket(t, t.User));
}
