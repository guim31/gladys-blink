// -----------------------------------------------------------------------------
// The integration end to end, against the SDK's fake Gladys and the fake
// Blink cloud: sign-in and verification code, the session kept under /data,
// the states, the scene events, the images and the commands.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { TRIGGERS } from '../src/hub.js';
import { fixture, makeJpeg } from './helpers/fakeBlink.js';
import {
  CODE,
  CONFIG,
  FakeBlink,
  PASSWORD,
  cameraId,
  createAll,
  createClock,
  createWorld,
  featureOf,
  systemId,
} from './helpers/world.js';

async function world(t, options = {}) {
  const clock = options.clock ?? createClock();
  const blink =
    options.blink ??
    new FakeBlink({
      now: clock.now,
      homescreen: fixture('homescreen-doorbell.json'),
      ...options.cloud,
    });
  const w = await createWorld({ clock, blink, ...options });
  t.after(() => w.app.stop());
  return w;
}

/** A clip the cloud starts listing now. */
function addClip(
  w,
  { id, deviceId, networkId, device = 'camera', source = 'pir', ageMs = 20_000 },
) {
  const at = new Date(w.clock.now() - ageMs).toISOString();
  w.blink.media.push({
    id,
    created_at: at,
    updated_at: at,
    deleted: false,
    device,
    device_id: deviceId,
    network_id: networkId,
    type: 'video',
    source,
  });
}

test('the first sign-in asks for the code Blink sent, then finds the devices', async (t) => {
  const w = await world(t, { signIn: false });
  assert.equal(w.hub.status, 'code_required');
  assert.equal(w.blink.codesSent, 1);
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.fr, /Saisir le code/);
  assert.deepEqual(w.fake.discoveredDevices, []);

  const wrong = await w.fake.action('verify_code', { code: '000000' });
  assert.match(wrong.data.message.en, /Sign-in failed: verification code refused/);

  const done = await w.fake.action('verify_code', {
    code: ` ${CODE.slice(0, 3)} ${CODE.slice(3)} `,
  });
  assert.match(done.data.message.fr, /Connecté à Blink : 3 système\(s\), 4 caméra\(s\)/);
  assert.equal(w.fake.connectionStatus.connected, true);
  assert.equal(w.fake.discoveredDevices.length, 7);
});

test('the session is kept under /data, without the password, readable by its owner only', async (t) => {
  const w = await world(t);
  await w.hub.store.flush();
  const path = join(w.dataDir, 'blink-session.json');
  const text = readFileSync(path, 'utf8');
  const saved = JSON.parse(text);
  assert.match(saved.hardwareId, /^[0-9A-F-]{36}$/);
  assert.ok(saved.session.refreshToken);
  assert.equal(saved.session.tier, 'u011');
  assert.ok(!text.includes(PASSWORD), 'never the password');
  assert.ok(!text.includes(CONFIG.email), 'not even the e-mail address');
  assert.equal(statSync(path).mode & 0o777, 0o600);
});

test('a restart reuses the session: no new code, no new sign-in', async (t) => {
  const clock = createClock();
  const blink = new FakeBlink({ now: clock.now });
  const first = await createWorld({ clock, blink });
  await first.app.stop();
  const signIns = blink.calls.filter((c) => c.path === '/oauth/v2/signin').length;

  const second = await world(t, { clock, blink, dataDir: first.dataDir, signIn: false });
  assert.equal(second.hub.status, 'connected');
  assert.equal(blink.codesSent, 1);
  assert.equal(blink.calls.filter((c) => c.path === '/oauth/v2/signin').length, signIns);
  assert.equal(second.fake.discoveredDevices.length, 6);
});

test('another account in the configuration never reuses the session', async (t) => {
  const w = await world(t);
  const codes = w.blink.codesSent;
  await w.fake.configUpdated({ ...CONFIG, email: 'other@example.com' });
  assert.notEqual(w.hub.status, 'connected');
  assert.equal(w.hub.client, null);
  assert.equal(w.blink.codesSent, codes, 'the other account is refused by the fake cloud');
});

test('without credentials, nothing is sent to Blink and the user is told what to do', async (t) => {
  const w = await world(t, { config: { language: 'fr' } });
  assert.equal(w.blink.calls.length, 0);
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.de, /Gib die E-Mail-Adresse/);
});

test('the states of the added devices are published, then only their changes', async (t) => {
  const w = await world(t);
  await createAll(w);
  const system = systemId(w.gladys, 2000001);
  const alpha = cameraId(w.gladys, 'camera', 4000001);
  const gamma = cameraId(w.gladys, 'mini', 5000001);
  assert.equal(w.fake.lastState(featureOf(system, 'armed')), 1);
  assert.equal(w.fake.lastState(featureOf(system, 'sync-online')), 1);
  assert.equal(w.fake.lastState(featureOf(alpha, 'battery-low')), 1);
  assert.equal(w.fake.lastState(featureOf(alpha, 'wifi')), 1);
  assert.equal(w.fake.lastState(featureOf(alpha, 'temperature')), 16.7);
  assert.equal(w.fake.lastState(featureOf(alpha, 'motion')), 0);
  assert.equal(w.fake.lastState(featureOf(alpha, 'motion-enabled')), 1);
  assert.equal(w.fake.lastState(featureOf(gamma, 'motion-enabled')), 1);
  assert.equal(w.fake.lastState(featureOf(systemId(w.gladys, 2000003), 'armed')), 0);

  const count = w.fake.states.length;
  w.clock.advance(60_000);
  await w.hub.refresh();
  assert.equal(w.fake.states.length, count, 'nothing changed, nothing sent');

  w.blink.homescreen.cameras[0].battery = 'ok';
  w.blink.homescreen.cameras[0].signals.temp = 68;
  w.clock.advance(60_000);
  await w.hub.refresh();
  assert.deepEqual(
    w.fake.states.slice(count).map((s) => [s.device_feature_external_id, s.state]),
    [
      [featureOf(alpha, 'temperature'), 20],
      [featureOf(alpha, 'battery-low'), 0],
    ],
  );
});

test('unchanged values are sent again every 12 hours ("no recent value" otherwise)', async (t) => {
  // The SDK dates its heartbeat with Date.now(): the clock of the world follows it.
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 9, 14, 8, 0, 0) });
  const clock = { now: () => Date.now(), advance: (ms) => t.mock.timers.tick(ms) };
  const w = await world(t, { clock });
  await createAll(w);
  const count = w.fake.states.length;
  w.clock.advance(12 * 60 * 60_000);
  await w.hub.refresh();
  assert.ok(w.fake.states.length >= count * 2 - 1, `${w.fake.states.length} after ${count}`);
});

test('a device of a camera not added in Gladys gets no state', async (t) => {
  const w = await world(t);
  const [first] = w.fake.discoveredDevices;
  await w.fake.deviceCreated(first);
  const devices = new Set(
    w.fake.states.map((s) => s.device_feature_external_id.split(':').slice(0, 4).join(':')),
  );
  assert.deepEqual([...devices], [first.external_id]);
});

test('adding a device sends its states and its image again, and refreshes the widget', async (t) => {
  const w = await world(t);
  await createAll(w);
  const beta = w.fake.discoveredDevices.find((d) => d.name === 'Beta');
  const images = w.fake.cameraImages.length;
  const refreshes = w.fake.widgetRefreshes.length;
  const states = w.fake.states.length;
  await w.fake.deviceCreated(beta);
  assert.ok(w.fake.states.length > states);
  assert.equal(w.fake.cameraImages.length, images + 1);
  assert.ok(w.fake.widgetRefreshes.length > refreshes);
});

test('a motion clip fires "motion detected" once and turns the motion on, then off', async (t) => {
  const w = await world(t);
  await createAll(w);
  const beta = cameraId(w.gladys, 'camera', 4000002);
  addClip(w, { id: 8000001, deviceId: 4000002, networkId: 2000002 });
  w.clock.advance(60_000);
  await w.hub.refresh();
  assert.deepEqual(
    w.fake.sceneEvents.map((e) => [e.key, e.data]),
    [[TRIGGERS.MOTION, { device: beta, camera: 'Beta', system: '82b Downing' }]],
  );
  assert.equal(w.fake.lastState(featureOf(beta, 'motion')), 1);

  // Listed again by the next reading (media/changed overlaps): not a new event.
  w.clock.advance(60_000);
  await w.hub.refresh();
  assert.equal(w.fake.sceneEvents.length, 1);
  w.clock.advance(60_000);
  await w.hub.refresh();
  assert.equal(w.fake.lastState(featureOf(beta, 'motion')), 0);
});

test('a doorbell press fires "doorbell pressed" and a ring pulse, never a heartbeat', async (t) => {
  const w = await world(t);
  await createAll(w);
  const door = cameraId(w.gladys, 'doorbell', 6000001);
  const ring = featureOf(door, 'ring');
  assert.equal(w.fake.lastState(ring), undefined, 'no ring yet: no fake "last ring" time');

  addClip(w, {
    id: 8000002,
    deviceId: 6000001,
    networkId: 2000001,
    device: 'lotus',
    source: 'button_press',
  });
  w.clock.advance(60_000);
  await w.hub.refresh();
  assert.deepEqual(
    w.fake.sceneEvents.map((e) => e.key),
    [TRIGGERS.DOORBELL],
  );
  assert.equal(w.fake.sceneEvents[0].data.camera, 'Front door');
  assert.equal(w.fake.lastState(ring), 1);
  assert.equal(w.fake.lastState(featureOf(door, 'motion')), 0, 'a press is not a motion');

  w.clock.advance(60_000);
  await w.hub.refresh();
  assert.equal(w.fake.lastState(ring), 0);
  const rings = () => w.fake.states.filter((s) => s.device_feature_external_id === ring).length;
  const before = rings();
  w.clock.advance(13 * 60 * 60_000);
  await w.hub.refresh();
  assert.equal(rings(), before, 'the "last ring" time stays true');
});

test('old clips, snapshots and clips seen at start fire nothing', async (t) => {
  const clock = createClock();
  const blink = new FakeBlink({ now: clock.now, homescreen: fixture('homescreen-doorbell.json') });
  const at = (ms) => new Date(clock.now() - ms).toISOString();
  blink.media.push({
    id: 1,
    created_at: at(60_000),
    updated_at: at(60_000),
    device_id: 4000002,
    network_id: 2000002,
    source: 'pir',
  });
  const w = await world(t, { clock, blink });
  addClip(w, { id: 2, deviceId: 4000002, networkId: 2000002, ageMs: 20 * 60_000 });
  w.blink.media.at(-1).updated_at = new Date(w.clock.now()).toISOString();
  addClip(w, { id: 3, deviceId: 4000002, networkId: 2000002, source: 'snapshot' });
  w.clock.advance(60_000);
  await w.hub.refresh();
  assert.deepEqual(w.fake.sceneEvents, []);
});

test('the widget arms and disarms; the state follows at once', async (t) => {
  const w = await world(t);
  await createAll(w);
  const system = systemId(w.gladys, 2000003);
  const disarm = await w.fake.widgetAction('blink', 'arm', { system }, { settings: { system } });
  assert.equal(disarm.success, true);
  assert.equal(disarm.data.message.en, '82b Downing: armed.');
  assert.equal(w.fake.lastState(featureOf(system, 'armed')), 1);

  await w.fake.widgetAction('blink', 'disarm', { system }, { settings: { system } });
  assert.equal(w.fake.lastState(featureOf(system, 'armed')), 0);
});

test('the scene actions arm a system (from one of its cameras too) and set the motion detection', async (t) => {
  const w = await world(t);
  await createAll(w);
  const gamma = cameraId(w.gladys, 'mini', 5000001);
  assert.deepEqual(await w.fake.sceneAction('set_arming', { system: gamma, mode: 'arm' }), {
    success: true,
    data: { outputs: { armed: true } },
  });
  assert.equal(w.blink.homescreen.networks[2].armed, true);

  const alpha = cameraId(w.gladys, 'camera', 4000001);
  assert.deepEqual(
    await w.fake.sceneAction('set_motion_detection', { camera: alpha, state: 'off' }),
    {
      success: true,
      data: { outputs: { enabled: false } },
    },
  );
  assert.equal(w.fake.lastState(featureOf(alpha, 'motion-enabled')), 0);

  const unknown = await w.fake.sceneAction('set_arming', { system: 'ext:x:system:9', mode: 'arm' });
  assert.equal(unknown.success, false);
  assert.match(unknown.error, /unknown|inconnu/i);
});

test('a snapshot wakes the camera once, publishes the new image, and is refused within a minute', async (t) => {
  const w = await world(t);
  await createAll(w);
  const beta = cameraId(w.gladys, 'camera', 4000002);
  const images = w.fake.cameraImages.length;
  w.blink.thumbnail = makeJpeg(64, 36, 80, 2);

  const result = await w.fake.sceneAction('take_snapshot', { camera: beta });
  assert.deepEqual(result, { success: true, data: { outputs: { captured: true } } });
  assert.equal(w.blink.snapshots, 1);
  assert.equal(w.fake.cameraImages.length, images + 1);
  assert.equal(w.fake.cameraImages.at(-1).device_external_id, beta);

  w.clock.advance(20_000);
  const tooSoon = await w.fake.sceneAction('take_snapshot', { camera: beta });
  assert.equal(tooSoon.success, false);
  assert.match(tooSoon.error, /wait 40 s/);
  assert.equal(w.blink.snapshots, 1);

  const form = await w.fake.widgetAction('blink', 'snapshot', {}, { settings: {} });
  assert.match(form.data.message.en, /Update Gladys to 5\.2\.0/);
  w.clock.advance(41_000);
  const widget = await w.fake.widgetAction(
    'blink',
    'snapshot',
    {},
    { settings: {}, values: { camera: beta } },
  );
  assert.equal(widget.success, true);
  assert.equal(w.blink.snapshots, 2);
});

test('Gladys asking for an image gets the last thumbnail, never a capture', async (t) => {
  const w = await world(t);
  await createAll(w);
  const alpha = w.fake.discoveredDevices.find((d) => d.name === 'Alpha');
  for (let i = 0; i < 3; i += 1) {
    const answer = await w.fake.getImage(alpha);
    assert.equal(answer.success, true);
    assert.match(answer.data.image, /^image\/jpg;base64,\/9j\//);
  }
  assert.equal(w.blink.snapshots, 0);
});

test('a thumbnail is downloaded once per new path', async (t) => {
  const w = await world(t);
  const downloads = w.blink.thumbnailRequests;
  assert.equal(downloads, 4, 'one per camera');
  w.clock.advance(60_000);
  await w.hub.refresh();
  assert.equal(w.blink.thumbnailRequests, downloads);
});

test('a thumbnail over 150 KB is made smaller for Gladys', async (t) => {
  const clock = createClock();
  const blink = new FakeBlink({ now: clock.now });
  blink.thumbnail = makeJpeg(800, 450, 100);
  assert.ok(blink.thumbnail.length > 150 * 1024, `${blink.thumbnail.length} bytes`);
  const w = await world(t, { clock, blink });
  await createAll(w);
  assert.equal(w.fake.cameraImages.length, 3);
  for (const { image } of w.fake.cameraImages) {
    // The limit bounds the whole string sent, base64 included.
    assert.ok(image.length <= 150 * 1024, `${image.length} characters`);
  }
  const content = (await w.fake.widgetGet('blink', { settings: {}, language: 'en' })).data.content;
  const key = content.components.find((c) => c.type === 'card-list').items[0].image;
  const widgetImage = await w.fake.widgetGetImage(key);
  assert.ok(Buffer.from(widgetImage.data.image, 'base64').length <= 300 * 1024);
});

test('a session refused by Blink signs in again by itself, once an hour at most', async (t) => {
  const w = await world(t);
  w.blink.revokeAccessTokens();
  w.blink.refreshTokens.clear();
  w.blink.trusted.clear(); // Blink forgot this client: it asks a code again
  w.clock.advance(61 * 60_000);
  await w.hub.tick();
  assert.equal(w.hub.status, 'code_required');
  assert.equal(w.blink.codesSent, 2);

  // The code never comes: no new sign-in at every cycle.
  for (let i = 0; i < 5; i += 1) {
    w.clock.advance(60_000);
    await w.hub.tick();
  }
  assert.equal(w.blink.codesSent, 2);
});

test('"Sign in" signs in again on demand and reports what it found', async (t) => {
  const w = await world(t);
  const answer = await w.fake.action('connect', {});
  assert.match(answer.data.message.es, /Sesión iniciada en Blink: 3 sistema\(s\), 4 cámara\(s\)/);
});

test('a command during a reading publishes the state after the command, not before', async (t) => {
  const w = await world(t);
  await createAll(w);
  const system = systemId(w.gladys, 2000001);
  w.clock.advance(60_000);
  const reading = w.hub.refresh(); // reads "armed" before the command reaches Blink
  const disarm = w.fake.sceneAction('set_arming', { system, mode: 'disarm' });
  await Promise.all([reading, disarm]);
  assert.equal(w.fake.lastState(featureOf(system, 'armed')), 0);
});
