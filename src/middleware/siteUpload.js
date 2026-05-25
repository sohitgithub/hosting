import multer from 'multer';
import path from 'path';
import fs from 'fs';
import os from 'os';

export const SITE_UPLOAD_MAX_MB = Number(process.env.SITE_UPLOAD_MAX_MB) || 500;
const MAX_BYTES = SITE_UPLOAD_MAX_MB * 1024 * 1024;

const uploadDir = path.join(os.tmpdir(), 'svh-site-uploads');
fs.mkdirSync(uploadDir, { recursive: true });

export const siteUploadMiddleware = multer({
  dest: uploadDir,
  limits: {
    fileSize: MAX_BYTES,
    files: 100,
  },
});

export function handleMulterError(err, req, res, next) {
  if (!err) return next();
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      message: `File too large. Maximum upload size is ${SITE_UPLOAD_MAX_MB} MB per file.`,
    });
  }
  if (err.code === 'LIMIT_FILE_COUNT') {
    return res.status(413).json({ message: 'Too many files in one upload (max 100).' });
  }
  if (err.message?.includes('Unexpected field')) {
    return res.status(400).json({ message: 'Invalid upload form. Use field name "files".' });
  }
  next(err);
}
