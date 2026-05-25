import express from 'express';
import {
  getSummary,
  getInvoices,
  getPlans,
  postUpgrade,
  postPayInvoice,
  postPaymentMethod,
  deletePaymentMethod,
  patchDefaultPaymentMethod,
} from '../controllers/billingController.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();
router.use(protect);

router.get('/summary', getSummary);
router.get('/plans', getPlans);
router.get('/invoices', getInvoices);
router.post('/upgrade', postUpgrade);
router.post('/invoices/:id/pay', postPayInvoice);
router.post('/payment-methods', postPaymentMethod);
router.delete('/payment-methods/:id', deletePaymentMethod);
router.patch('/payment-methods/:id/default', patchDefaultPaymentMethod);

export default router;
