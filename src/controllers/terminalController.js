import {
  getTerminalInfo,
  getUserDomain,
  createSession,
  executeInSession,
  executeOneShot,
  logTerminalCommand,
} from '../services/terminalService.js';

export const getInfo = async (req, res, next) => {
  try {
    const domainId = req.query.domainId || req.params.domainId;
    if (!domainId) return res.status(400).json({ message: 'domainId required' });
    const info = await getTerminalInfo(req.user._id, domainId);
    res.json(info);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

export const startSession = async (req, res, next) => {
  try {
    const { domainId } = req.body;
    if (!domainId) return res.status(400).json({ message: 'domainId required' });
    const domain = await getUserDomain(req.user._id, domainId);
    const sessionId = createSession(req.user._id, domain.id);
    res.json({
      sessionId,
      cwd: '/public_html',
      domain: domain.name,
      message: 'Terminal session started',
    });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

export const runCommand = async (req, res, next) => {
  try {
    const { sessionId, command, domainId } = req.body;
    if (!command) return res.status(400).json({ message: 'command required' });

    let result;
    if (sessionId) {
      result = await executeInSession(req.user._id, sessionId, command, domainId);
    } else if (domainId) {
      result = await executeOneShot(req.user._id, domainId, command, req.body.cwd);
    } else {
      return res.status(400).json({ message: 'sessionId or domainId required' });
    }

    if (!['clear', 'pwd'].includes(command.trim()) && !command.trim().startsWith('cd')) {
      await logTerminalCommand(req.user._id, command);
    }

    res.json(result);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

export const resetSshPassword = async (req, res, next) => {
  try {
    const { HostingAccount } = await import('../models/index.js');
    const crypto = await import('crypto');
    const account = await HostingAccount.findOne({ where: { userId: req.user._id } });
    if (!account) return res.status(404).json({ message: 'Hosting account not found' });
    const meta = { ...(account.meta || {}) };
    meta.sshPassword = crypto.randomBytes(16).toString('base64url').slice(0, 20);
    await account.update({ meta });
    res.json({
      message: 'SSH password reset',
      password: meta.sshPassword,
    });
  } catch (err) {
    next(err);
  }
};
