import { createLog } from '../services/logService.js';
import { isPacketTooLargeError } from '../config/mysqlPacket.js';

export const errorHandler = (err, req, res, next) => {
  let status = err.statusCode || 500;
  let message = err.message || 'Server Error';

  if (err.type === 'entity.too.large') {
    status = 413;
    message =
      'Upload too large for JSON body. Use File Manager → Upload for .zip and large files (up to 500MB).';
  }
  if (err.code === 'LIMIT_FILE_SIZE') {
    status = 413;
    message = err.message || 'File too large';
  }

  if (err.name === 'SequelizeValidationError') {
    status = 400;
    message = err.errors?.map((e) => e.message).join(', ') || message;
  }
  if (err.name === 'SequelizeUniqueConstraintError') {
    status = 400;
    message = 'Record already exists';
  }
  if (isPacketTooLargeError(err)) {
    status = 413;
    message =
      'Database request too large for MySQL. For SQL imports use smaller dumps or run: npm run db:fix-packet';
  }
  if (err.message?.includes('CORS') || err.message?.includes('Not allowed by')) {
    status = 403;
    message = 'Origin not allowed. Set CLIENT_URL in .env to your site URL (https, no trailing slash).';
  }

  if (status >= 500) {
    createLog({
      userId: req.user?._id,
      level: 'error',
      source: 'system',
      message: `${req.method} ${req.path}: ${message}`,
      meta: { status },
    });
  }

  res.status(status).json({
    success: false,
    message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};
