import express from 'express';
import {
  getHostingAccounts,
  getPanel,
  createHostingAccount,
  updateHostingAccount,
  postEmail,
  deleteEmail,
  postCron,
  deleteCron,
  patchCron,
  postRestart,
} from '../controllers/hostingController.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

router.use(protect);

router.get('/panel', getPanel);
router.post('/restart', postRestart);
router.post('/emails', postEmail);
router.delete('/emails/:id', deleteEmail);
router.post('/cron', postCron);
router.patch('/cron/:id', patchCron);
router.delete('/cron/:id', deleteCron);

router.route('/').get(getHostingAccounts).post(createHostingAccount);
router.patch('/:id', updateHostingAccount);

export default router;
