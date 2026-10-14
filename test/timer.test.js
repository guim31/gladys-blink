// -----------------------------------------------------------------------------
// The container reads the Blink cloud on its own timer, at the configured
// interval, without any onPoll from the core (GladysAssistant/Gladys#3198);
// the core's onPoll is only a fallback and never doubles a reading. A 429
// slows the timer down.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, FakeBlink, cameraId, createAll, createWorld, featureOf } from './helpers/world.js';

/** Let the reading started by a fired timer run to its end. */
async function settle() {
  for (let i = 0; i < 50; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

async function setup(t, { refresh = '60' } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.UTC(2026, 9, 14, 8, 0, 0) });
  const clock = { now: () => Date.now() };
  const blink = new FakeBlink({ now: clock.now, requireCode: false });
  const w = await createWorld({
    clock,
    blink,
    timers: true,
    config: { ...CONFIG, refresh_interval: refresh },
  });
  t.after(() => w.app.stop());
  const reads = () => blink.restCalls().filter((c) => c.path.endsWith('/homescreen')).length;
  return { ...w, reads };
}

test('the states refresh by themselves, every interval, without any onPoll', async (t) => {
  const w = await setup(t);
  await createAll(w);
  assert.equal(w.reads(), 1);
  const alpha = cameraId(w.gladys, 'camera', 4000001);

  w.blink.homescreen.cameras[0].signals.temp = 77;
  t.mock.timers.tick(60_000);
  await settle();
  assert.equal(w.reads(), 2, 'read again after one interval, no onPoll involved');
  assert.equal(w.fake.lastState(featureOf(alpha, 'temperature')), 25);

  t.mock.timers.tick(60_000);
  await settle();
  assert.equal(w.reads(), 3);
});

test('the interval of the configuration is followed (5 minutes)', async (t) => {
  const w = await setup(t, { refresh: '300' });
  t.mock.timers.tick(299_000);
  await settle();
  assert.equal(w.reads(), 1);
  t.mock.timers.tick(1_000);
  await settle();
  assert.equal(w.reads(), 2);
});

test("the core's onPoll is a fallback: it never reads twice an interval", async (t) => {
  const w = await setup(t);
  await createAll(w);
  const [device] = w.fake.discoveredDevices;
  t.mock.timers.tick(10_000);
  assert.deepEqual(await w.fake.poll(device), { success: true });
  assert.equal(w.reads(), 1, 'the timer read 10 s ago');

  // The timer stalls: the core takes over, once an interval.
  w.hub.stop();
  t.mock.timers.tick(50_000);
  await w.fake.poll(device);
  assert.equal(w.reads(), 2);
  await w.fake.poll(device);
  assert.equal(w.reads(), 2);
});

test('Blink asking to slow down doubles the interval, and it comes back after', async (t) => {
  const w = await setup(t);
  w.blink.rateLimited = true;
  t.mock.timers.tick(60_000);
  await settle();
  const after429 = w.blink.restCalls().length;
  t.mock.timers.tick(60_000);
  await settle();
  assert.equal(w.blink.restCalls().length, after429, 'no reading one interval later');
  w.blink.rateLimited = false;
  t.mock.timers.tick(60_000);
  await settle();
  assert.ok(w.blink.restCalls().length > after429, 'read again at twice the interval');
  const back = w.reads();
  t.mock.timers.tick(60_000);
  await settle();
  assert.equal(w.reads(), back + 1, 'the normal interval again');
});

test('nothing is read while Gladys is unreachable', async (t) => {
  const w = await setup(t);
  await w.gladys.disconnect();
  t.mock.timers.tick(120_000);
  await settle();
  assert.equal(w.reads(), 1);
});
