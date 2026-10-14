// -----------------------------------------------------------------------------
// What the integration writes at the default level (info): the lifecycle
// only. A normal reading writes nothing, a failure that repeats is logged
// once, and its end once. Never a password, a token, a code or the e-mail.
// (Adapted from guim31/gladys-pihole.)
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture } from './helpers/fakeBlink.js';
import { CODE, CONFIG, FakeBlink, createAll, createClock, createWorld } from './helpers/world.js';

/** Capture the lines of the SDK logger at a level. */
function captureLogs(t, level = 'info') {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  const lines = [];
  const record =
    (stream) =>
    (...args) =>
      lines.push({
        stream,
        text: args.map((arg) => (arg instanceof Error ? arg.stack : String(arg))).join(' '),
      });
  t.mock.method(console, 'log', record('out'));
  t.mock.method(console, 'error', record('err'));
  return {
    lines,
    clear: () => lines.splice(0),
    texts: () => lines.map((line) => line.text),
  };
}

async function world(t, options = {}) {
  const clock = createClock();
  const blink = new FakeBlink({ now: clock.now, homescreen: fixture('homescreen-doorbell.json') });
  const w = await createWorld({ clock, blink, ...options });
  t.after(() => w.app.stop());
  return w;
}

test('a normal reading cycle writes nothing at info', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  assert.ok(
    logs.texts().some((text) => text.includes('Signed in to Blink')),
    'the sign-in is logged',
  );
  await createAll(w);
  logs.clear();

  for (let i = 0; i < 5; i += 1) {
    w.blink.homescreen.cameras[0].signals.temp += 1;
    w.blink.homescreen.networks[0].armed = i % 2 === 0;
    w.blink.media.push({
      id: 9000 + i,
      created_at: new Date(w.clock.now()).toISOString(),
      device_id: 4000002,
      network_id: 2000002,
      source: 'pir',
    });
    w.clock.advance(60_000);
    await w.hub.refresh();
  }
  assert.ok(w.fake.sceneEvents.length >= 4, 'motion events fired meanwhile');
  assert.deepEqual(logs.texts(), []);
});

test('a Blink cloud that stays down is logged once, and once when it is back', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  logs.clear();

  w.blink.online = false;
  for (let i = 0; i < 6; i += 1) {
    w.clock.advance(60_000);
    await w.hub.refresh();
  }
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  assert.equal(logs.lines[0].stream, 'err');
  assert.match(logs.lines[0].text, /Reading the Blink account failed: .*network error/);

  logs.clear();
  w.blink.online = true;
  await w.hub.refresh();
  await w.hub.refresh();
  assert.deepEqual(logs.texts().length, 1, logs.texts().join('\n'));
  assert.match(logs.lines[0].text, /Blink cloud answers again/);
});

test('one line per user command', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  logs.clear();
  const system = w.gladys.externalIds('system', '2000001').device;
  await w.fake.sceneAction('set_arming', { system, mode: 'disarm' });
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  assert.match(logs.lines[0].text, /82 Downing: disarmed from Gladys/);
});

test('LOG_LEVEL=debug shows the details; never a secret, at any level', async (t) => {
  const logs = captureLogs(t, 'debug');
  const w = await world(t, { signIn: false });
  await w.fake.action('verify_code', { code: '654321' });
  await w.fake.action('verify_code', { code: CODE });
  w.blink.online = false;
  await w.hub.refresh();
  await w.hub.refresh();
  w.blink.online = true;
  w.blink.revokeAccessTokens();
  await w.hub.refresh();
  const text = logs.texts().join('\n');
  assert.match(text, /\[DEBUG\].*again/);

  await w.hub.store.flush();
  const saved = JSON.parse(readFileSync(join(w.dataDir, 'blink-session.json'), 'utf8'));
  const secrets = [
    CONFIG.password,
    CONFIG.email,
    CODE,
    '654321',
    saved.session.accessToken,
    saved.session.refreshToken,
    ...w.blink.accessTokens.keys(),
    ...w.blink.refreshTokens,
  ];
  for (const secret of secrets) {
    assert.ok(!text.includes(secret), `a secret reached the logs: ${secret.slice(0, 4)}…`);
  }
});

test('a refused password is logged once, with its reason, not the password', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t, { config: { ...CONFIG, password: 'wrong-password' } });
  await w.fake.action('connect', {});
  await w.fake.action('connect', {});
  const warnings = logs.lines.filter((line) => line.stream === 'err');
  assert.equal(warnings.length, 1, logs.texts().join('\n'));
  assert.match(warnings[0].text, /sign-in refused \(HTTP 401\)/);
  assert.ok(!logs.texts().join('\n').includes('wrong-password'));
});
