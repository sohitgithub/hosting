import {
  listApiKeys,
  createApiKey,
  revokeApiKey,
  renameApiKey,
} from '../services/apiKeyService.js';

export const getApiKeys = async (req, res, next) => {
  try {
    const keys = await listApiKeys(req.user._id);
    res.json({
      keys,
      docs: {
        authHeader: 'Authorization: Bearer YOUR_API_KEY',
        altHeader: 'X-API-Key: YOUR_API_KEY',
        example: 'curl -H "Authorization: Bearer svh_live_..." https://your-api/api/dashboard',
      },
    });
  } catch (err) {
    next(err);
  }
};

export const postApiKey = async (req, res, next) => {
  try {
    const result = await createApiKey(req.user._id, {
      name: req.body.name,
      scopes: req.body.scopes,
    });
    res.status(201).json(result);
  } catch (err) {
    if (err.message.includes('Maximum')) {
      return res.status(400).json({ message: err.message });
    }
    next(err);
  }
};

export const patchApiKey = async (req, res, next) => {
  try {
    const updated = await renameApiKey(req.user._id, req.params.id, req.body.name);
    if (!updated) return res.status(404).json({ message: 'API key not found' });
    res.json({ apiKey: updated });
  } catch (err) {
    next(err);
  }
};

export const deleteApiKey = async (req, res, next) => {
  try {
    const removed = await revokeApiKey(req.user._id, req.params.id);
    if (!removed) return res.status(404).json({ message: 'API key not found' });
    res.json({ message: 'API key revoked' });
  } catch (err) {
    next(err);
  }
};
