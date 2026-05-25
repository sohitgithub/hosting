import { getUserLogs, formatLogLine } from '../services/logService.js';

export const getLogs = async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 200, 500);
    const source = req.query.source || 'all';
    const level = req.query.level || 'all';

    const entries = await getUserLogs(req.user._id, { limit, source, level });

    res.json({
      entries,
      lines: entries.map(formatLogLine),
      total: entries.length,
    });
  } catch (err) {
    next(err);
  }
};
