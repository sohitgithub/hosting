import jwt from 'jsonwebtoken';
import { User } from '../models/index.js';
import { formatDoc } from '../utils/formatDoc.js';
import { authenticateApiKey } from '../services/apiKeyService.js';

const API_KEY_PREFIX = process.env.API_KEY_PREFIX || 'svh_live_';

function extractToken(req) {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    return auth.slice(7).trim();
  }
  if (req.headers['x-api-key']) {
    return String(req.headers['x-api-key']).trim();
  }
  return null;
}

function looksLikeApiKey(token) {
  return token.startsWith('svh_') || token.startsWith(API_KEY_PREFIX.slice(0, 4));
}

export const protect = async (req, res, next) => {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ message: 'Not authorized. Use Bearer JWT or API key.' });
  }

  if (looksLikeApiKey(token)) {
    try {
      const result = await authenticateApiKey(token);
      if (!result) {
        return res.status(401).json({ message: 'Invalid or expired API key' });
      }
      req.user = result.user;
      req.apiKey = result.apiKey;
      return next();
    } catch {
      return res.status(401).json({ message: 'Invalid API key' });
    }
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret');
    const user = await User.findByPk(decoded.id, {
      attributes: { exclude: ['password'] },
    });
    if (!user) return res.status(401).json({ message: 'User not found' });
    req.user = formatDoc(user);
    next();
  } catch {
    return res.status(401).json({ message: 'Invalid token' });
  }
};

export const admin = (req, res, next) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ message: 'Admin access required' });
  }
  next();
};
