const DEFAULT_PREFERENCES = {
  emailAlerts: true,
  deployAlerts: true,
  billingAlerts: true,
  sslAlerts: true,
};

/** Parse preferences from DB (JSON object or legacy string). */
export function parseUserPreferences(raw) {
  if (raw == null) return { ...DEFAULT_PREFERENCES };
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return { ...DEFAULT_PREFERENCES, ...pickPreferenceFields(raw) };
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return { ...DEFAULT_PREFERENCES };
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { ...DEFAULT_PREFERENCES, ...pickPreferenceFields(parsed) };
      }
    } catch {
      /* corrupted / huge string — reset to defaults */
    }
    return { ...DEFAULT_PREFERENCES };
  }
  return { ...DEFAULT_PREFERENCES };
}

function pickPreferenceFields(obj) {
  const out = {};
  for (const key of Object.keys(DEFAULT_PREFERENCES)) {
    if (key in obj) out[key] = obj[key];
  }
  if (obj.passwordReset && typeof obj.passwordReset === 'object') {
    out.passwordReset = {
      tokenHash: obj.passwordReset.tokenHash,
      expires: obj.passwordReset.expires,
    };
  }
  return out;
}

export function mergeUserPreferences(raw, patch) {
  const base = parseUserPreferences(raw);
  const next = { ...base, ...patch };
  if (patch?.passwordReset) {
    next.passwordReset = patch.passwordReset;
  }
  return next;
}

export { DEFAULT_PREFERENCES };
