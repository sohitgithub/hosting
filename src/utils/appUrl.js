const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function isLocalhostUrl(url) {
  if (!url) return true;
  try {
    const u = new URL(url);
    return LOCAL_HOSTS.has(u.hostname.toLowerCase());
  } catch {
    return true;
  }
}

function firstNonEmpty(...values) {
  for (const v of values) {
    const s = v?.trim();
    if (s) return s.replace(/\/$/, '');
  }
  return null;
}

/**
 * Base URL for links in emails (reset password, etc.).
 * Never uses localhost unless ALLOW_LOCALHOST_RESET_LINKS=true.
 */
export function getPublicAppBaseUrl() {
  const allowLocal = process.env.ALLOW_LOCALHOST_RESET_LINKS === 'true';
  const candidates = [
    process.env.PUBLIC_APP_URL,
    process.env.APP_PUBLIC_URL,
    process.env.FRONTEND_URL,
    process.env.CLIENT_URL,
    process.env.APP_URL,
  ];

  for (const raw of candidates) {
    const base = raw?.trim()?.replace(/\/$/, '');
    if (!base) continue;
    if (!isLocalhostUrl(base) || allowLocal) return base;
  }

  if (allowLocal) {
    return firstNonEmpty(process.env.CLIENT_URL, 'http://localhost:5173');
  }

  return null;
}

/** Base URL for in-browser dev fallback (same machine). */
export function getDevAppBaseUrl(req) {
  const origin = req?.headers?.origin?.trim();
  if (origin) return origin.replace(/\/$/, '');

  const referer = req?.headers?.referer;
  if (referer) {
    try {
      const u = new URL(referer);
      return `${u.protocol}//${u.host}`;
    } catch {
      /* ignore */
    }
  }

  return (
    getPublicAppBaseUrl() ||
    firstNonEmpty(process.env.CLIENT_URL, process.env.FRONTEND_URL, 'http://localhost:5173')
  );
}

export function buildResetPasswordUrl(baseUrl, { token, email }) {
  const base = baseUrl.replace(/\/$/, '');
  return `${base}/reset-password?token=${token}&email=${encodeURIComponent(email)}`;
}

export function getPublicAppUrlStatus() {
  const base = getPublicAppBaseUrl();
  return {
    configured: !!base,
    baseUrl: base,
    localhostAllowed: process.env.ALLOW_LOCALHOST_RESET_LINKS === 'true',
    hint: base
      ? null
      : 'Set PUBLIC_APP_URL in backend/.env to your live site or LAN URL (e.g. http://192.168.1.10:5174)',
  };
}
