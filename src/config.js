// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Refresh intervals offered in the configuration, in seconds. 30 s is the
// floor blinkpy recommends; Blink bans clients that poll faster.
export const REFRESH_INTERVALS = ['30', '60', '120', '300'];

export const DEFAULT_CONFIG = {
  email: '',
  password: '',
  refresh_interval: '60',
  language: 'fr',
};

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const email = typeof source.email === 'string' ? source.email.trim() : '';
  const password = typeof source.password === 'string' ? source.password : '';
  const interval = REFRESH_INTERVALS.includes(String(source.refresh_interval))
    ? String(source.refresh_interval)
    : DEFAULT_CONFIG.refresh_interval;
  return {
    email,
    password,
    refreshIntervalMs: Number(interval) * 1000,
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}

/** Both credentials are filled in. */
export const hasCredentials = (config) => config.email !== '' && config.password !== '';

/**
 * Who the stored session belongs to: a hash of the e-mail address, so a new
 * account in the configuration never reuses the session of the previous one,
 * and the address itself is not written under /data.
 */
export const accountFingerprint = (email) =>
  createHash('sha256').update(email.toLowerCase()).digest('hex').slice(0, 16);
