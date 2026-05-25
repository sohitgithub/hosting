import express from 'express';
import {
  getSummary,
  getTickets,
  getTicket,
  createTicketHandler,
  postReply,
  patchTicket,
} from '../controllers/ticketController.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();
router.use(protect);

router.get('/summary', getSummary);
router.get('/', getTickets);
router.post('/', createTicketHandler);
router.get('/:id', getTicket);
router.post('/:id/replies', postReply);
router.patch('/:id', patchTicket);

export default router;
