import crypto from 'crypto';
import { User, comparePassword } from '../models/index.js';
import { generateToken } from '../utils/generateToken.js';
import { formatDoc } from '../utils/formatDoc.js';
import { bootstrapUser } from '../services/bootstrapUser.js';
import { createLog } from '../services/logService.js';
import { sendPasswordResetEmail } from '../services/mailService.js';
import { mergeUserPreferences, parseUserPreferences } from '../utils/userPreferences.js';
import {
  buildResetPasswordUrl,
  getDevAppBaseUrl,
  getPublicAppBaseUrl,
  getPublicAppUrlStatus,
} from '../utils/appUrl.js';

const GENERIC_RESET_MSG =
  'If that email is registered, you will receive password reset instructions shortly.';

function hashResetToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export const register = async (req, res, next) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ message: 'All fields required' });
    }
    const exists = await User.findOne({ where: { email } });
    if (exists) return res.status(400).json({ message: 'Email already registered' });
    const user = await User.create({ name, email, password });
    await bootstrapUser(user.id, 'starter');
    await createLog({
      userId: user.id,
      level: 'success',
      source: 'auth',
      message: `New account registered: ${email}`,
    });
    const formatted = formatDoc(user);
    res.status(201).json({
      ...formatted,
      token: generateToken(user.id, user.role),
    });
  } catch (err) {
    next(err);
  }
};

export const login = async (req, res, next) => {
  try {
    const email = String(req.body?.email || '')
      .trim()
      .toLowerCase();
    const { password } = req.body;
    const user = await User.findOne({ where: { email } });
    if (!user || !(await comparePassword(password, user.password))) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    const formatted = formatDoc(user);
    delete formatted.password;
    await createLog({
      userId: user.id,
      level: 'success',
      source: 'auth',
      message: `User signed in: ${email}`,
    });
    res.json({
      ...formatted,
      token: generateToken(user.id, user.role),
    });
  } catch (err) {
    next(err);
  }
};

export const getMe = async (req, res) => {
  res.json(req.user);
};

export const updateProfile = async (req, res, next) => {
  try {
    const user = await User.findByPk(req.user._id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const updates = {};
    if (req.body.name !== undefined) updates.name = String(req.body.name).trim().slice(0, 80) || user.name;
    if (req.body.company !== undefined) updates.company = String(req.body.company).trim().slice(0, 120);
    if (req.body.avatar !== undefined) updates.avatar = req.body.avatar;

    if (req.body.preferences && typeof req.body.preferences === 'object') {
      updates.preferences = mergeUserPreferences(user.preferences, req.body.preferences);
    }

    await user.update(updates);

    if (updates.name || updates.company) {
      await createLog({
        userId: user.id,
        level: 'info',
        source: 'profile',
        message: 'Profile information updated',
      });
    }

    res.json(formatDoc(user));
  } catch (err) {
    next(err);
  }
};

export const forgotPassword = async (req, res, next) => {
  try {
    const email = String(req.body?.email || '')
      .trim()
      .toLowerCase();
    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    const user = await User.findOne({ where: { email } });
    const payload = { message: GENERIC_RESET_MSG };

    if (user) {
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = hashResetToken(rawToken);
      const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      const prefs = mergeUserPreferences(user.preferences, {
        passwordReset: { tokenHash, expires },
      });
      await user.update({ preferences: prefs });

      const publicBase = getPublicAppBaseUrl();
      const emailResetUrl = publicBase
        ? buildResetPasswordUrl(publicBase, { token: rawToken, email })
        : null;
      const devResetUrl = buildResetPasswordUrl(getDevAppBaseUrl(req), {
        token: rawToken,
        email,
      });

      if (!emailResetUrl) {
        console.warn(
          '[auth] PUBLIC_APP_URL not set — reset email skipped (localhost links do not work on phone).'
        );
        payload.emailSent = false;
        payload.mailError =
          'Set PUBLIC_APP_URL in backend/.env to your public or LAN URL, then try again.';
        if (process.env.NODE_ENV !== 'production') {
          payload.resetUrl = devResetUrl;
          payload.devOnly = true;
          console.log('[auth] Dev-only reset link (this machine):', devResetUrl);
        }
      } else {
        const mail = await sendPasswordResetEmail({
          to: user.email,
          name: user.name,
          resetUrl: emailResetUrl,
        });

        if (mail.sent) {
          payload.emailSent = true;
          payload.sentTo = user.email;
        } else {
          console.warn('[auth] Password reset email failed:', mail.reason);
          payload.emailSent = false;
          payload.mailError = process.env.NODE_ENV === 'production' ? undefined : mail.reason;
          if (process.env.NODE_ENV !== 'production') {
            payload.resetUrl = devResetUrl;
            payload.devOnly = true;
            console.log('[auth] Dev fallback link:', devResetUrl);
          }
        }
      }

      await createLog({
        userId: user.id,
        level: mail.sent ? 'success' : 'warn',
        source: 'auth',
        message: mail.sent
          ? `Password reset email sent to ${user.email}`
          : `Password reset requested for ${user.email} (email not sent: ${mail.reason})`,
      });
    }

    res.json(payload);
  } catch (err) {
    next(err);
  }
};

export const resetPassword = async (req, res, next) => {
  try {
    const email = String(req.body?.email || '')
      .trim()
      .toLowerCase();
    const token = String(req.body?.token || '').trim();
    const password = req.body?.password;

    if (!email || !token || !password) {
      return res.status(400).json({ message: 'Email, token, and new password are required' });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters' });
    }

    const user = await User.findOne({ where: { email } });
    if (!user) {
      return res.status(400).json({ message: 'Invalid or expired reset link' });
    }

    const reset = parseUserPreferences(user.preferences).passwordReset;
    if (!reset?.tokenHash || !reset?.expires) {
      return res.status(400).json({ message: 'Invalid or expired reset link' });
    }
    if (new Date(reset.expires) < new Date()) {
      return res.status(400).json({ message: 'Reset link has expired' });
    }
    if (hashResetToken(token) !== reset.tokenHash) {
      return res.status(400).json({ message: 'Invalid or expired reset link' });
    }

    const prefs = mergeUserPreferences(user.preferences, {});
    delete prefs.passwordReset;
    user.password = password;
    user.preferences = prefs;
    await user.save();

    await createLog({
      userId: user.id,
      level: 'success',
      source: 'auth',
      message: `Password reset completed for ${email}`,
    });

    res.json({ message: 'Password updated. You can sign in now.' });
  } catch (err) {
    next(err);
  }
};

export const changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Current and new password are required' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ message: 'New password must be at least 8 characters' });
    }
    const user = await User.findByPk(req.user._id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (!(await comparePassword(currentPassword, user.password))) {
      return res.status(401).json({ message: 'Current password is incorrect' });
    }
    user.password = newPassword;
    await user.save();
    res.json({ message: 'Password updated successfully' });
  } catch (err) {
    next(err);
  }
};
