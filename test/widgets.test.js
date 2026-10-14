// -----------------------------------------------------------------------------
// The `blink` dashboard widget: rendered exactly as sent (the SDK's
// validateWidgetContent: vocabulary and budget), its references exist (the
// devices of the discovery, the image keys it serves), and the current
// arming state is told by the icon, never by the invisible `primary` style.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent, validateWidgetImage } from '@gladysassistant/integration-sdk';
import { fixture } from './helpers/fakeBlink.js';
import { FakeBlink, createClock, createWorld, systemId } from './helpers/world.js';

async function world(t, { homescreen = 'homescreen-doorbell.json', ...options } = {}) {
  const clock = createClock();
  const blink = new FakeBlink({ now: clock.now, homescreen: fixture(homescreen) });
  const w = await createWorld({ clock, blink, ...options });
  t.after(() => w.app.stop());
  return w;
}

async function content(w, settings = {}, language = 'en') {
  const answer = await w.fake.widgetGet('blink', { settings, language, units: 'metric' });
  assert.equal(answer.success, true, answer.error);
  return answer.data.content;
}

const ofType = (c, type) => c.components.filter((component) => component.type === type);

test('every content is rendered exactly as sent, in every language', async (t) => {
  const w = await world(t);
  const system = systemId(w.gladys, 2000001);
  for (const language of ['en', 'fr', 'de', 'es']) {
    for (const settings of [{}, { system }]) {
      assert.deepEqual(validateWidgetContent(await content(w, settings, language)), [], language);
    }
  }
});

test('with one system chosen: its cameras, its state, Arm, Disarm and New image…', async (t) => {
  const w = await world(t);
  const system = systemId(w.gladys, 2000001);
  const c = await content(w, { system });
  const [grid] = ofType(c, 'card-list');
  assert.deepEqual(
    grid.items.map((item) => item.title),
    ['Alpha', 'Front door'],
  );
  assert.equal(grid.items[0].subtitle, 'Low battery');
  assert.deepEqual(ofType(c, 'status')[0].items, [
    { label: '82 Downing', icon: 'shield', value: 'Armed', color: 'success' },
  ]);
  const buttons = ofType(c, 'button');
  assert.deepEqual(
    buttons.map((b) => [b.label, b.icon, b.action.key]),
    [
      ['Arm', 'check-circle', 'arm'],
      ['Disarm', 'shield-off', 'disarm'],
      ['New image…', 'camera', 'snapshot'],
    ],
  );
  assert.equal(buttons[1].action.confirm, true, 'disarming asks first');
  assert.ok(
    buttons.every((b) => b.style !== 'primary'),
    'primary is invisible in dark mode (#3153)',
  );
  assert.deepEqual(buttons[0].action.params, { system });
});

test('a camera chosen in the settings drives its own system', async (t) => {
  const w = await world(t);
  const gamma = w.gladys.externalIds('mini', '5000001').device;
  const c = await content(w, { system: gamma });
  assert.equal(ofType(c, 'status')[0].items[0].value, 'Disarmed');
  assert.equal(ofType(c, 'button')[1].icon, 'check-circle');
});

test('several systems and none chosen: every system shown, no arming button', async (t) => {
  const w = await world(t);
  const c = await content(w);
  assert.match(ofType(c, 'text')[0].text, /Several systems/);
  assert.equal(ofType(c, 'status')[0].items.length, 3);
  assert.deepEqual(
    ofType(c, 'button').map((b) => b.action.key),
    ['snapshot'],
  );
});

test('the references of the content exist: devices of the discovery, images it serves', async (t) => {
  const w = await world(t);
  const discovered = new Set(w.fake.discoveredDevices.map((device) => device.external_id));
  const system = systemId(w.gladys, 2000001);
  const c = await content(w, { system });
  assert.ok(discovered.has(ofType(c, 'button')[0].action.params.system));
  const form = ofType(c, 'button')[2].action.fields[0];
  for (const option of form.options) {
    assert.ok(discovered.has(option.value), option.value);
  }
  assert.ok(discovered.has(form.default));
  for (const item of ofType(c, 'card-list')[0].items) {
    assert.match(item.image, /^[a-z0-9][a-z0-9-]{0,63}$/);
    const image = await w.fake.widgetGetImage(item.image);
    assert.equal(image.success, true);
    assert.deepEqual(validateWidgetImage(image.data.image), []);
  }
  const unknown = await w.fake.widgetGetImage('cam-0000000000000000');
  assert.equal(unknown.success, false);
});

test('an image key changes when the image changes (the core caches by key)', async (t) => {
  const w = await world(t);
  const system = systemId(w.gladys, 2000001);
  const before = ofType(await content(w, { system }), 'card-list')[0].items[0].image;
  w.clock.advance(60_000);
  await w.fake.sceneAction('take_snapshot', {
    camera: w.gladys.externalIds('camera', '4000001').device,
  });
  const after = ofType(await content(w, { system }), 'card-list')[0].items[0].image;
  assert.notEqual(after, before);
});

test('a motion, an offline camera and a disabled detection show as badges', async (t) => {
  const w = await world(t);
  w.blink.homescreen.cameras[1].status = 'offline';
  w.blink.homescreen.owls[0].enabled = false;
  w.blink.media.push({
    id: 1,
    created_at: new Date(w.clock.now()).toISOString(),
    device_id: 6000001,
    device: 'lotus',
    network_id: 2000001,
    source: 'pir',
  });
  w.clock.advance(60_000);
  await w.hub.refresh();
  const items = ofType(await content(w), 'card-list')[0].items;
  assert.deepEqual(
    items.map((item) => [item.title, item.badge?.text ?? null]),
    [
      ['Alpha', null],
      ['Beta', 'Offline'],
      ['Gamma', 'Detection off'],
      ['Front door', 'Motion'],
    ],
  );
});

test('signed out, waiting for the code, or an unknown device: a plain message', async (t) => {
  const w = await world(t, { signIn: false });
  const waiting = await content(w, {}, 'fr');
  assert.match(waiting.components[0].text, /Saisir le code/);
  assert.deepEqual(validateWidgetContent(waiting), []);

  const signed = await world(t);
  const unknown = await content(signed, { system: 'ext:test-integration:system:9' });
  assert.match(unknown.components[0].text, /unknown/);
});

test('a refused command answers with a toast in every language', async (t) => {
  const w = await world(t);
  w.blink.online = false;
  const system = systemId(w.gladys, 2000001);
  const answer = await w.fake.widgetAction('blink', 'disarm', { system }, { settings: {} });
  assert.equal(answer.success, false);
  assert.match(answer.error, /Blink did not apply the command: the Blink cloud does not answer/);
});
