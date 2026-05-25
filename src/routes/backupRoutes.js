import express from 'express';
import { protect } from '../middleware/auth.js';
import {
  listBackups,
  createBackup,
  restoreBackup,
  downloadBackup,
  removeBackup,
} from '../controllers/backupController.js';

const router = express.Router();

router.use(protect);

router.get('/', listBackups);
router.post('/', createBackup);
router.get('/:id/download', downloadBackup);
router.post('/:id/restore', restoreBackup);
router.delete('/:id', removeBackup);

export default router;
