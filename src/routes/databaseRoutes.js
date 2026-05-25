import express from 'express';
import multer from 'multer';
import { protect } from '../middleware/auth.js';
import {
  listDatabases,
  createDatabase,
  getDatabase,
  deleteDatabase,
  exportDatabase,
  importDatabase,
  resetDatabasePassword,
  getPhpMyAdminInfo,
  openPhpMyAdmin,
  pmaBridge,
} from '../controllers/databaseController.js';

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok =
      file.mimetype === 'application/sql' ||
      file.mimetype === 'text/plain' ||
      file.originalname.endsWith('.sql');
    cb(ok ? null : new Error('Only .sql files are allowed'), ok);
  },
});

router.get('/pma-bridge/:token', pmaBridge);

router.use(protect);

router.get('/phpmyadmin/info', getPhpMyAdminInfo);
router.get('/', listDatabases);
router.post('/', createDatabase);
router.get('/:id/phpmyadmin', openPhpMyAdmin);
router.get('/:id', getDatabase);
router.delete('/:id', deleteDatabase);
router.get('/:id/export', exportDatabase);
router.post('/:id/import', upload.single('file'), importDatabase);
router.post('/:id/reset-password', resetDatabasePassword);

export default router;
