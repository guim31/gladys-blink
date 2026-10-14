// -----------------------------------------------------------------------------
// From the real answers of the Blink cloud (test/fixtures/blink/) to the
// model: systems, cameras, Minis, doorbells; and the classification of clips.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MEDIA_EVENTS,
  cameraOfMedia,
  classifyMedia,
  fahrenheitToCelsius,
  parseHomescreen,
  parseMedia,
} from '../src/blink/model.js';
import { fixture } from './helpers/fakeBlink.js';

test('the homescreen gives the systems, armed or not, with their Sync Module', () => {
  const { systems } = parseHomescreen(fixture('homescreen.json'), '1000001');
  assert.deepEqual(
    systems.map((s) => [
      s.id,
      s.name,
      s.armed,
      s.syncModule?.serial ?? null,
      s.syncModule?.online ?? null,
    ]),
    [
      ['2000001', '82 Downing', true, 'A0000001', true],
      ['2000002', '82b Downing', true, 'A0000002', true],
      // The network of a Mini without Sync Module.
      ['2000003', '82b Downing', false, null, null],
    ],
  );
});

test('the homescreen gives the cameras with what they report', () => {
  const { cameras } = parseHomescreen(fixture('homescreen-doorbell.json'), '1000001');
  const byName = Object.fromEntries(cameras.map((c) => [c.name, c]));
  assert.deepEqual(Object.keys(byName), ['Alpha', 'Beta', 'Gamma', 'Front door']);

  assert.equal(byName.Alpha.kind, 'camera');
  assert.equal(byName.Alpha.battery, 'low');
  assert.equal(byName.Alpha.wifi, 1);
  assert.equal(byName.Alpha.temperature, 16.7, '62 °F');
  assert.equal(byName.Alpha.motionEnabled, true);
  assert.equal(byName.Alpha.online, true, 'status "done"');
  assert.equal(
    byName.Alpha.thumbnail,
    '/media/production/account/1000001/network/2000001/camera/4000001/clip_8mpxqvts_2020_01_01__01_01AM.jpg',
  );

  assert.equal(byName.Beta.battery, 'ok');
  assert.equal(byName.Beta.wifi, 5);
  assert.match(byName.Beta.thumbnail, /thumbnail\.jpg\?ts=1648473188&ext=$/);

  // The Mini: wired, no battery, no temperature sensor.
  assert.equal(byName.Gamma.kind, 'mini');
  assert.equal(byName.Gamma.battery, null);
  assert.equal(byName.Gamma.temperature, null);
  assert.equal(byName.Gamma.networkId, '2000003');

  assert.equal(byName['Front door'].kind, 'doorbell');
  assert.equal(byName['Front door'].battery, 'ok');
  assert.equal(byName['Front door'].wifi, 4);
  assert.equal(byName['Front door'].temperature, null);
});

test('missing or odd fields give unknown values, not wrong ones', () => {
  const { systems, cameras } = parseHomescreen(
    {
      networks: [{ id: 1, name: '' }, { name: 'no id' }],
      cameras: [
        {
          id: 2,
          network_id: 1,
          battery: 'unknown',
          signals: { wifi: 9, temp: 'hot' },
          status: 'weird',
        },
        { name: 'no id' },
      ],
      owls: 'not a list',
    },
    '1',
  );
  assert.deepEqual(systems, [{ id: '1', name: 'Blink 1', armed: null, syncModule: null }]);
  assert.equal(cameras.length, 1);
  assert.equal(cameras[0].battery, null);
  assert.equal(cameras[0].wifi, null);
  assert.equal(cameras[0].temperature, null);
  assert.equal(cameras[0].online, null);
  assert.equal(cameras[0].thumbnail, null);
  assert.deepEqual(parseHomescreen(null, '1'), { systems: [], cameras: [] });
});

test('Blink temperatures are converted from °F', () => {
  assert.equal(fahrenheitToCelsius(32), 0);
  assert.equal(fahrenheitToCelsius(68), 20);
  assert.equal(fahrenheitToCelsius(-4), -20);
  assert.equal(fahrenheitToCelsius(null), null);
});

test('clips are classified: motion, doorbell, or asked by the user', () => {
  assert.equal(classifyMedia({ source: 'pir' }), MEDIA_EVENTS.MOTION);
  assert.equal(classifyMedia({ source: 'cv_motion' }), MEDIA_EVENTS.MOTION);
  assert.equal(classifyMedia({}), MEDIA_EVENTS.MOTION);
  assert.equal(classifyMedia({ source: 'button_press' }), MEDIA_EVENTS.RING);
  assert.equal(classifyMedia({ source: 'doorbell_ring' }), MEDIA_EVENTS.RING);
  assert.equal(classifyMedia({ source: 'snapshot' }), null);
  assert.equal(classifyMedia({ source: 'liveview' }), null);
  // The real clip of the fixture is a snapshot.
  assert.deepEqual(
    parseMedia(fixture('media-changed.json')).map((clip) => clip.event),
    [null],
  );
});

test('clips are sorted and matched to their camera', () => {
  const clips = parseMedia(fixture('media-events.json'));
  assert.deepEqual(
    clips.map((clip) => [clip.id, clip.kind, clip.event]),
    [
      ['7000002', 'camera', 'motion'],
      ['7000003', 'doorbell', 'ring'],
      ['7000004', 'doorbell', 'motion'],
    ],
  );
  const { cameras } = parseHomescreen(fixture('homescreen-doorbell.json'), '1000001');
  assert.equal(cameraOfMedia(cameras, clips[0]).name, 'Beta');
  assert.equal(cameraOfMedia(cameras, clips[1]).name, 'Front door');
  // The real snapshot clip says `catalina` for a camera of the `cameras` list.
  const [snapshot] = parseMedia(fixture('media-changed.json'));
  assert.equal(cameraOfMedia(cameras, snapshot).name, 'Alpha');
  assert.equal(cameraOfMedia(cameras, { ...clips[0], deviceId: '1' }), null);
  assert.deepEqual(parseMedia({ media: [{ id: 1, deleted: true, created_at: 'x' }] }), []);
});
