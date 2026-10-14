#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Probe of the real Blink cloud, for a machine that has the network (the
// development sessions of this repository do not reach Blink). Read-only:
// it never arms, disarms, changes a camera nor takes a snapshot.
//
//   node scripts/probe.mjs
//       Signs in with a fake account: a clean refusal is expected (exit 0).
//       Checks that the OAuth v2 sign-in of Blink still has the shape the
//       integration expects (authorize page, CSRF token, refusal status).
//
//   BLINK_EMAIL=… BLINK_PASSWORD=… [BLINK_CODE=…] node scripts/probe.mjs
//       Signs in with a real account (the code Blink sends is asked on the
//       terminal unless BLINK_CODE is set), then reads the homescreen and the
//       clips of the last 7 days, and prints only counts and field names:
//       how many systems and cameras of each kind, which `source` values the
//       clips carry per device type (to confirm how a doorbell press is
//       reported), whether the thumbnails fit the limits of Gladys.
//
// Never printed: the e-mail, the password, the code, the tokens, the names,
// the ids, the URLs with a query string. Nothing is written to disk.
// -----------------------------------------------------------------------------

import { createInterface } from 'node:readline/promises';
import { BlinkAuth, validHardwareId } from '../src/blink/auth.js';
import { BlinkClient } from '../src/blink/client.js';
import { BlinkError, ERROR_KINDS } from '../src/blink/errors.js';
import { fetchRequest } from '../src/blink/http.js';
import { parseHomescreen, parseMedia } from '../src/blink/model.js';
import { CAMERA_IMAGE_MAX_BYTES, WIDGET_IMAGE_MAX_BYTES, fitJpeg } from '../src/images.js';

/** The real HTTP seam, printing each step: method, host, path, status. */
async function request(url, options = {}) {
  const { host, pathname } = new URL(url);
  const response = await fetchRequest(url, options);
  console.log(`  ${options.method ?? 'GET'} ${host}${pathname} → HTTP ${response.status}`);
  return response;
}

async function askCode() {
  if (process.env.BLINK_CODE) {
    return process.env.BLINK_CODE;
  }
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await terminal.question('Code sent by Blink: ')).trim();
  } finally {
    terminal.close();
  }
}

async function fakeAccount() {
  console.log('Sign-in with a fake account (a clean refusal is expected):');
  const auth = new BlinkAuth({ request });
  try {
    const result = await auth.login({
      email: `probe-${Date.now()}@example.invalid`,
      password: 'not-a-password',
      hardwareId: validHardwareId(),
    });
    console.log(`Unexpected: ${result.codeRequired ? 'a code was asked' : 'signed in'}.`);
    return 1;
  } catch (err) {
    if (err instanceof BlinkError && err.kind === ERROR_KINDS.CREDENTIALS) {
      console.log(`OK: refused as expected (${err.message}).`);
      return 0;
    }
    console.log(`Not the expected refusal: ${err.kind ?? err.name}: ${err.message}`);
    return 1;
  }
}

async function realAccount(email, password) {
  console.log('Sign-in with the account of BLINK_EMAIL (read-only probe):');
  const auth = new BlinkAuth({ request });
  const hardwareId = validHardwareId(process.env.BLINK_HARDWARE_ID);
  let { tokens, codeRequired } = await auth.login({ email, password, hardwareId });
  if (codeRequired) {
    console.log('Blink sent a verification code.');
    tokens = await auth.verifyCode(await askCode());
  }
  const tier = await auth.tierInfo(tokens.accessToken);
  console.log(`Signed in (region ${tier.tier}).`);
  const client = new BlinkClient({ session: { ...tokens, ...tier, hardwareId }, request, auth });

  const homescreen = await client.homescreen();
  console.log(`Homescreen keys: ${Object.keys(homescreen).sort().join(', ')}`);
  const model = parseHomescreen(homescreen, client.accountId);
  console.log(
    `Systems: ${model.systems.length} (with a Sync Module: ${model.systems.filter((s) => s.syncModule).length})`,
  );
  for (const kind of ['camera', 'mini', 'doorbell']) {
    const cameras = model.cameras.filter((camera) => camera.kind === kind);
    if (cameras.length === 0) {
      continue;
    }
    const known = (key) => cameras.filter((camera) => camera[key] !== null).length;
    console.log(
      `  ${kind}: ${cameras.length} — battery ${known('battery')}, wifi ${known('wifi')}, ` +
        `temperature ${known('temperature')}, thumbnail ${known('thumbnail')}, motion setting ${known('motionEnabled')}`,
    );
  }
  for (const key of ['doorbells', 'owls']) {
    const [first] = homescreen[key] ?? [];
    if (first) {
      console.log(`  fields of ${key}[0]: ${Object.keys(first).sort().join(', ')}`);
      if (first.signals) {
        console.log(`  signals of ${key}[0]: ${Object.keys(first.signals).sort().join(', ')}`);
      }
    }
  }

  const since = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
  const media = await client.mediaChanged(since);
  const sources = new Map();
  for (const item of media.media ?? []) {
    const key = `${item.device ?? '?'} / ${item.source ?? '(none)'}`;
    sources.set(key, (sources.get(key) ?? 0) + 1);
  }
  console.log(`Clips of the last 7 days (first page): ${(media.media ?? []).length}`);
  for (const [key, count] of [...sources].sort()) {
    console.log(`  device / source: ${key} × ${count}`);
  }
  console.log(
    `Classified: ${
      parseMedia(media)
        .map((clip) => clip.event ?? 'ignored')
        .join(', ') || 'none'
    }`,
  );

  const withThumbnail = model.cameras.find((camera) => camera.thumbnail);
  if (withThumbnail) {
    const bytes = await client.thumbnail(withThumbnail.thumbnail);
    const camera = fitJpeg(bytes, CAMERA_IMAGE_MAX_BYTES);
    const widget = fitJpeg(bytes, WIDGET_IMAGE_MAX_BYTES);
    console.log(
      `A thumbnail: ${bytes.length} bytes; camera channel ${camera ? camera.length : 'unusable'}, widget ${widget ? widget.length : 'unusable'}`,
    );
  }
  return 0;
}

const { BLINK_EMAIL: email, BLINK_PASSWORD: password } = process.env;
try {
  process.exitCode = email && password ? await realAccount(email, password) : await fakeAccount();
} catch (err) {
  console.log(`Probe failed: ${err.kind ?? err.name}: ${err.message}`);
  process.exitCode = 1;
}
