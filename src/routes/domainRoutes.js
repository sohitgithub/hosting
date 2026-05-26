import express from 'express';
import {
  getDomains,
  getDomain,
  addDomain,
  updateDomain,
  deleteDomain,
  addDnsRecord,
  updateDnsRecord,
  deleteDnsRecord,
  updateNameservers,
  pointToServer,
  setForwarding,
  setReverseProxy,
  setReverseDns,
  initiateTransfer,
  addSubdomain,
} from '../controllers/domainController.js';
import { protect } from '../middleware/auth.js';
import siteRoutes from './siteRoutes.js';
import {
  getSslStatus,
  installDomainSsl,
  renewDomainSsl,
  removeDomainSsl,
} from '../controllers/sslController.js';

const router = express.Router();

router.use(protect);
router.use('/:id/site', siteRoutes);
// search & info are mounted on server.js (public)
// register is mounted on server.js as POST /api/domains/register
router.post('/transfer', initiateTransfer);
router.route('/').get(getDomains).post(addDomain);
router.route('/:id').get(getDomain).patch(updateDomain).delete(deleteDomain);
router.post('/:id/dns', addDnsRecord);
router.patch('/:id/dns/:recordId', updateDnsRecord);
router.delete('/:id/dns/:recordId', deleteDnsRecord);
router.patch('/:id/nameservers', updateNameservers);
router.get('/:id/ssl', getSslStatus);
router.post('/:id/ssl/install', installDomainSsl);
router.post('/:id/ssl/renew', renewDomainSsl);
router.delete('/:id/ssl', removeDomainSsl);
router.post('/:id/subdomain', addSubdomain);
router.post('/:id/point', pointToServer);
router.patch('/:id/forwarding', setForwarding);
router.patch('/:id/reverse-proxy', setReverseProxy);
router.patch('/:id/reverse-dns', setReverseDns);

export default router;
