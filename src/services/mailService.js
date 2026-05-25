import nodemailer from 'nodemailer';
import { getPublicAppBaseUrl } from '../utils/appUrl.js';

let transporter = null;
let verified = false;

function smtpConfig() {
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.replace(/\s+/g, '') || '';
  if (!user || !pass) return null;

  const port = Number(process.env.SMTP_PORT) || 587;
  const secure = process.env.SMTP_SECURE === 'true' || port === 465;

  return {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port,
    secure,
    auth: { user, pass },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
    ...(port === 587 && !secure ? { requireTLS: true } : {}),
  };
}

function parseFromAddress() {
  const raw = process.env.MAIL_FROM?.trim();
  const user = process.env.SMTP_USER?.trim();
  const appName = process.env.APP_NAME || 'Syntax Verse Hosting';

  if (!raw) {
    return { name: appName, address: user };
  }

  const match = raw.match(/^(.+?)\s*<([^>]+)>$/);
  if (match) {
    return { name: match[1].replace(/^["']|["']$/g, '').trim(), address: match[2].trim() };
  }

  if (raw.includes('@')) {
    return { name: appName, address: raw };
  }

  return { name: appName, address: user };
}

async function buildTransporter() {
  const cfg = smtpConfig();
  if (!cfg) return null;

  const transport = nodemailer.createTransport(cfg);
  await transport.verify();
  verified = true;
  return transport;
}

function getTransporter() {
  if (!smtpConfig()) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport(smtpConfig());
  }
  return transporter;
}

/** Call on API startup — logs SMTP status. */
export async function initMailService() {
  if (!smtpConfig()) {
    console.warn('[mail] SMTP not configured — set SMTP_USER and SMTP_PASS in backend/.env');
    return { ok: false, reason: 'not_configured' };
  }

  try {
    transporter = await buildTransporter();
    const from = parseFromAddress();
    console.log(`[mail] SMTP ready → ${process.env.SMTP_HOST}:${process.env.SMTP_PORT} as ${from.address}`);
    return { ok: true };
  } catch (err) {
    transporter = null;
    verified = false;
    console.error('[mail] SMTP connection failed:', err.message);
    if (err.message?.includes('Invalid login')) {
      console.error('[mail] Use a Gmail App Password: https://myaccount.google.com/apppasswords');
    }
    return { ok: false, reason: err.message };
  }
}

export function isMailConfigured() {
  return !!smtpConfig();
}

export function getMailStatus() {
  return {
    configured: isMailConfigured(),
    verified,
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    user: process.env.SMTP_USER?.trim() || null,
  };
}

function brandLogoUrl() {
  const base = (
    process.env.APP_LOGO_URL ||
    getPublicAppBaseUrl() ||
    process.env.CLIENT_URL ||
    'http://localhost:5173'
  ).replace(/\/$/, '');
  return process.env.APP_LOGO_PATH
    ? `${base}${process.env.APP_LOGO_PATH.startsWith('/') ? '' : '/'}${process.env.APP_LOGO_PATH}`
    : `${base}/logo.png`;
}

/**
 * Send password reset email via SMTP (Gmail, etc.).
 * @returns {{ sent: boolean, messageId?: string, reason?: string }}
 */
export async function sendPasswordResetEmail({ to, name, resetUrl }) {
  if (!to?.trim()) {
    return { sent: false, reason: 'Recipient email is required' };
  }

  let transport = getTransporter();
  if (!transport) {
    return {
      sent: false,
      reason: 'SMTP is not configured (set SMTP_USER and SMTP_PASS in .env)',
    };
  }

  if (!verified) {
    try {
      transport = await buildTransporter();
    } catch (err) {
      transporter = null;
      verified = false;
      return { sent: false, reason: err.message || 'SMTP connection failed' };
    }
  }

  const appName = process.env.APP_NAME || 'Syntax Verse Hosting';
  const displayName = name?.trim() || 'there';
  const logoUrl = brandLogoUrl();
  const from = parseFromAddress();

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f0f3f8;font-family:system-ui,-apple-system,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:24px auto;background:#fff;border:1px solid #c8d0e0;border-radius:8px;">
    <tr>
      <td style="padding:20px 28px;background:#0a0a0a;border-radius:8px 8px 0 0;">
        <table cellpadding="0" cellspacing="0"><tr>
          <td style="padding-right:12px;vertical-align:middle;">
            <img src="${logoUrl}" alt="${escapeHtml(appName)}" width="40" height="40" style="display:block;border-radius:8px;background:#000;" />
          </td>
          <td style="vertical-align:middle;">
            <h1 style="margin:0;font-size:18px;color:#fff;">${escapeHtml(appName)}</h1>
          </td>
        </tr></table>
      </td>
    </tr>
    <tr>
      <td style="padding:28px;color:#333;font-size:15px;line-height:1.6;">
        <p>Hi ${escapeHtml(displayName)},</p>
        <p>We received a request to reset your password. Click the button below to choose a new password. This link expires in <strong>1 hour</strong>.</p>
        <p style="text-align:center;margin:28px 0;">
          <a href="${resetUrl}" style="display:inline-block;background:#2d6cdf;color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:600;">Reset password</a>
        </p>
        <p style="font-size:13px;color:#666;">If you did not request this, you can ignore this email. Your password will not change.</p>
        <p style="font-size:12px;color:#888;word-break:break-all;">Or copy this link:<br>${escapeHtml(resetUrl)}</p>
      </td>
    </tr>
    <tr>
      <td style="padding:16px 28px;border-top:1px solid #e8ecf2;font-size:12px;color:#888;">
        &copy; ${new Date().getFullYear()} ${escapeHtml(appName)}
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = [
    `Hi ${displayName},`,
    '',
    `Reset your ${appName} password (expires in 1 hour):`,
    resetUrl,
    '',
    'If you did not request this, ignore this email.',
  ].join('\n');

  try {
    const info = await transport.sendMail({
      from,
      to: to.trim(),
      replyTo: from.address,
      subject: `Reset your ${appName} password`,
      html,
      text,
    });
    console.log(`[mail] Sent password reset → ${to.trim()} (${info.messageId})`);
    return { sent: true, messageId: info.messageId };
  } catch (err) {
    console.error('[mail] SMTP send failed:', err.message);
    transporter = null;
    verified = false;
    return { sent: false, reason: err.message || 'SMTP error' };
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
