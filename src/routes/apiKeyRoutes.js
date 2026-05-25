import express from 'express';
import { protect } from '../middleware/auth.js';
import { getApiKeys, postApiKey, patchApiKey, deleteApiKey } from '../controllers/apiKeyController.js';

const router = express.Router();

router.use(protect);

router.get('/', getApiKeys);
router.post('/', postApiKey);
router.patch('/:id', patchApiKey);
router.delete('/:id', deleteApiKey);

export default router;
