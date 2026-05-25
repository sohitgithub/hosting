import {
  getSupportSummary,
  listTicketsForUser,
  getTicketForUser,
  createTicket,
  addTicketReply,
  updateTicketStatus,
} from '../services/ticketService.js';

export const getSummary = async (req, res, next) => {
  try {
    const summary = await getSupportSummary(req.user._id);
    res.json(summary);
  } catch (err) {
    next(err);
  }
};

export const getTickets = async (req, res, next) => {
  try {
    const tickets = await listTicketsForUser(req.user._id);
    res.json(tickets);
  } catch (err) {
    next(err);
  }
};

export const getTicket = async (req, res, next) => {
  try {
    const ticket = await getTicketForUser(req.user._id, req.params.id, req.user.role === 'admin');
    res.json(ticket);
  } catch (err) {
    res.status(404).json({ message: err.message });
  }
};

export const createTicketHandler = async (req, res, next) => {
  try {
    const ticket = await createTicket(req.user._id, req.body, req.user.name);
    res.status(201).json(ticket);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

export const postReply = async (req, res, next) => {
  try {
    const ticket = await addTicketReply(req.user._id, req.params.id, req.body.message, {
      asAdmin: req.user.role === 'admin',
      authorName: req.user.name,
    });
    res.json({ ticket, message: 'Reply sent' });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

export const patchTicket = async (req, res, next) => {
  try {
    if (req.body.message) {
      const ticket = await addTicketReply(req.user._id, req.params.id, req.body.message, {
        asAdmin: false,
        authorName: req.user.name,
      });
      return res.json(ticket);
    }
    if (req.body.status) {
      const ticket = await updateTicketStatus(req.user._id, req.params.id, req.body.status, {
        isAdmin: req.user.role === 'admin',
      });
      return res.json(ticket);
    }
    res.status(400).json({ message: 'Nothing to update' });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};
