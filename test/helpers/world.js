// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, a fake Blink cloud, a
// temporary /data and a manual clock, with the integration wired on top
// through registerHandlers. No timer runs unless `timers: true` (with
// node:test mock timers): the tests read the account with `world.hub.refresh()`.
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { Store } from '../../src/store.js';
import { CODE, EMAIL, FakeBlink, PASSWORD } from './fakeBlink.js';

// The integration logs every sign-in; keep the test output readable.
process.env.LOG_LEVEL ??= 'silent';

export const CONFIG = { email: EMAIL, password: PASSWORD, language: 'en', refresh_interval: '60' };

/** A manual clock, shared by the hub and the fake cloud. */
export function createClock(start = Date.UTC(2026, 9, 14, 8, 0, 0)) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

export const NO_DELAYS = { requestGapMs: 0, commandPollMs: 0 };

/**
 * @param {object} [options]
 * @param {FakeBlink} [options.blink]
 * @param {object} [options.config] raw integration config
 * @param {Array} [options.devices] devices already created in Gladys
 * @param {boolean} [options.connect]
 * @param {boolean} [options.signIn] type the code when Blink asks for it
 */
export async function createWorld({
  clock = createClock(),
  blink,
  config = CONFIG,
  devices = [],
  connect = true,
  signIn = true,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-blink-')),
  timings = {},
  timers = false,
} = {}) {
  const cloud = blink ?? new FakeBlink({ now: clock.now });
  const gladys = createFakeGladys({ config, devices });
  const app = registerHandlers(gladys, {
    store: new Store(dataDir),
    request: cloud.request,
    timers,
    timings,
    clientTimings: NO_DELAYS,
    now: clock.now,
  });
  const world = { gladys, fake: gladys.fake, blink: cloud, app, hub: app.hub, clock, dataDir };
  if (connect) {
    await gladys.connect();
    await app.ready;
    if (signIn && app.hub.status === 'code_required') {
      await gladys.fake.action('verify_code', { code: CODE });
    }
  }
  return world;
}

/** Add every discovered device in Gladys, as the user would. */
export async function createAll(world) {
  for (const device of world.fake.discoveredDevices) {
    await world.fake.deviceCreated(device);
  }
}

export const systemId = (gladys, id) => gladys.externalIds('system', String(id)).device;
export const cameraId = (gladys, kind, id) => gladys.externalIds(kind, String(id)).device;
export const featureOf = (deviceId, key) => `${deviceId}:${key}`;

export { CODE, EMAIL, FakeBlink, PASSWORD };
