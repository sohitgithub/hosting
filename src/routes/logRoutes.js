import express from 'express';
import { getLogs } from '../controllers/logController.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();
router.use(protect);
router.get('/', getLogs);

export default router;
