import express from 'express';
import {
  getUsers,
  updateUser,
  getStats,
  getInvoices,
  updateInvoice,
  getAdminDeployments,
  getAdminDomains,
  getAdminTickets,
  updateAdminTicket,
} from '../controllers/adminController.js';
import { protect, admin } from '../middleware/auth.js';

const router = express.Router();
router.use(protect, admin);

router.get('/stats', getStats);
router.get('/users', getUsers);
router.patch('/users/:id', updateUser);
router.get('/invoices', getInvoices);
router.patch('/invoices/:id', updateInvoice);
router.get('/deployments', getAdminDeployments);
router.get('/domains', getAdminDomains);
router.get('/tickets', getAdminTickets);
router.patch('/tickets/:id', updateAdminTicket);

export default router;
