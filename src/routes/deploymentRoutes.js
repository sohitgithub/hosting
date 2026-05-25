import express from 'express';
import {
  getDeployments,
  createDeployment,
  getDeployment,
  deleteDeployment,
} from '../controllers/deploymentController.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();
router.use(protect);
router.route('/').get(getDeployments).post(createDeployment);
router.route('/:id').get(getDeployment).delete(deleteDeployment);

export default router;
