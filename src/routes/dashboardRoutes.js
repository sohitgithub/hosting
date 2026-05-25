import express from 'express';
import { getDashboardStats, getRecentDeployments } from '../controllers/dashboardController.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();
router.use(protect);
router.get('/stats', getDashboardStats);
router.get('/deployments/recent', getRecentDeployments);

export default router;
