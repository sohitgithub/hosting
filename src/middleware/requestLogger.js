import jwt from 'jsonwebtoken';
import { User } from '../models/index.js';
import { createLog, shouldLogRequest } from '../services/logService.js';

export const requestLogger = (req, res, next) => {
  if (!shouldLogRequest(req.path)) {
    return next();
  }

  const start = Date.now();

  const attachUser = async () => {
    if (req.user?._id) return req.user._id;
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) return null;
    try {
      const decoded = jwt.verify(auth.slice(7), process.env.JWT_SECRET);
      const user = await User.findByPk(decoded.id);
      return user?.id ?? null;
    } catch {
      return null;
    }
  };

  res.on('finish', () => {
    const ms = Date.now() - start;
    const status = res.statusCode;

    attachUser().then((userId) => {
      if (!userId) return;

      const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
      const message = `${req.method} ${req.originalUrl || req.path} → ${status} (${ms}ms)`;

      createLog({
        userId,
        level,
        source: 'api',
        message,
        meta: { method: req.method, path: req.path, status, durationMs: ms },
      });
    });
  });

  next();
};
