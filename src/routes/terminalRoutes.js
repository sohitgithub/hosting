import express from 'express';
import { protect } from '../middleware/auth.js';
import { getInfo, startSession, runCommand, resetSshPassword } from '../controllers/terminalController.js';

const router = express.Router();
router.use(protect);

router.get('/info', getInfo);
router.post('/session', startSession);
router.post('/exec', runCommand);
router.post('/ssh/reset-password', resetSshPassword);

export default router;
