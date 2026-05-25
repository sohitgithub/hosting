import express from 'express';
import {
  listSiteFiles,
  listSiteTree,
  getSiteFile,
  saveSiteFile,
  createSiteFolder,
  createSiteFile,
  deleteSiteFile,
  renameSiteFile,
  downloadSiteFile,
  chmodSiteFile,
  copySiteFile,
  compressSiteFiles,
  uploadSiteFiles,
  publishSite,
  getSiteStatus,
} from '../controllers/siteController.js';
import { siteUploadMiddleware, handleMulterError } from '../middleware/siteUpload.js';

const router = express.Router({ mergeParams: true });

router.post(
  '/upload',
  siteUploadMiddleware.array('files', 100),
  handleMulterError,
  uploadSiteFiles
);

router.get('/status', getSiteStatus);
router.get('/files', listSiteFiles);
router.get('/tree', listSiteTree);
router.get('/file', getSiteFile);
router.get('/download', downloadSiteFile);
router.put('/file', saveSiteFile);
router.post('/folder', createSiteFolder);
router.post('/file', createSiteFile);
router.delete('/file', deleteSiteFile);
router.patch('/file', renameSiteFile);
router.patch('/permissions', chmodSiteFile);
router.post('/copy', copySiteFile);
router.post('/compress', compressSiteFiles);
router.post('/publish', publishSite);

export default router;
