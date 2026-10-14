import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accountFingerprint, hasCredentials, normalizeConfig } from '../src/config.js';

test('the defaults apply to an empty configuration', () => {
  assert.deepEqual(normalizeConfig(), {
    email: '',
    password: '',
    refreshIntervalMs: 60_000,
    language: 'fr',
  });
  assert.equal(hasCredentials(normalizeConfig()), false);
});

test('values are trimmed and checked against their lists', () => {
  const config = normalizeConfig({
    email: '  me@example.com ',
    password: ' spaces kept ',
    refresh_interval: '5',
    language: 'it',
  });
  assert.equal(config.email, 'me@example.com');
  assert.equal(config.password, ' spaces kept ');
  assert.equal(config.refreshIntervalMs, 60_000, 'never below 30 s');
  assert.equal(config.language, 'fr');
  assert.equal(normalizeConfig({ refresh_interval: 300 }).refreshIntervalMs, 300_000);
  assert.equal(hasCredentials(config), true);
});

test('the account fingerprint ignores the case and hides the address', () => {
  assert.equal(accountFingerprint('Me@Example.com'), accountFingerprint('me@example.com'));
  assert.notEqual(accountFingerprint('a@example.com'), accountFingerprint('b@example.com'));
  assert.ok(!accountFingerprint('me@example.com').includes('example'));
});
