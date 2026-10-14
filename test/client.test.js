// -----------------------------------------------------------------------------
// The Blink client against the fake cloud: the OAuth v2 sign-in with and
// without a verification code, the token refresh, the errors by kind, and
// the safety of the paths it requests.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { BlinkAuth, extractCsrfToken, pkcePair, validHardwareId } from '../src/blink/auth.js';
import { BlinkClient, baseUrl } from '../src/blink/client.js';
import { ERROR_KINDS } from '../src/blink/errors.js';
import { CookieJar } from '../src/blink/http.js';
import { thumbnailPath } from '../src/blink/model.js';
import { ACCOUNT_ID, CODE, EMAIL, FakeBlink, PASSWORD, TIER } from './helpers/fakeBlink.js';
import { NO_DELAYS, createClock } from './helpers/world.js';

const HARDWARE_ID = '1B2C3D4E-0000-4000-8000-00000000ABCD';

function setup(options = {}) {
  const clock = createClock();
  const blink = new FakeBlink({ now: clock.now, ...options });
  const auth = new BlinkAuth({ request: blink.request, now: clock.now });
  return { clock, blink, auth };
}

async function signedInClient(options = {}) {
  const { clock, blink, auth } = setup({ requireCode: false, ...options });
  const { tokens } = await auth.login({
    email: EMAIL,
    password: PASSWORD,
    hardwareId: HARDWARE_ID,
  });
  const tier = await auth.tierInfo(tokens.accessToken);
  const sessions = [];
  const client = new BlinkClient({
    session: { ...tokens, ...tier, hardwareId: HARDWARE_ID },
    onSession: (session) => sessions.push(session),
    request: blink.request,
    auth,
    now: clock.now,
    timings: NO_DELAYS,
  });
  return { clock, blink, auth, client, sessions };
}

const rejectsWith = (promise, kind) =>
  assert.rejects(promise, (err) => {
    assert.equal(err.kind, kind, err.message);
    return true;
  });

test('the CSRF token is read from the oauth-args script of the sign-in page', () => {
  assert.equal(
    extractCsrfToken(
      '<html><script id="oauth-args" type="application/json">{"csrf-token": "test_csrf_token_123"}</script>',
    ),
    'test_csrf_token_123',
  );
  assert.equal(
    extractCsrfToken('<script type="application/json" id="oauth-args">{"csrf-token":"x"}</script>'),
    'x',
  );
  assert.equal(extractCsrfToken('<script id="other">{"csrf-token":"x"}</script>'), null);
  assert.equal(extractCsrfToken('<script id="oauth-args" type="application/json">{oops'), null);
});

test('the PKCE pair is S256 and the hardware id a UUID kept once valid', () => {
  const { verifier, challenge } = pkcePair();
  assert.ok(verifier.length >= 43);
  assert.equal(challenge, createHash('sha256').update(verifier).digest('base64url'));
  assert.equal(validHardwareId(HARDWARE_ID), HARDWARE_ID);
  for (const invalid of [undefined, '', 'Gladys', 'not-a-uuid']) {
    assert.match(
      validHardwareId(invalid),
      /^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/,
    );
  }
});

test('a client Blink already knows signs in without a code', async () => {
  const { blink, auth } = setup({ requireCode: false });
  const result = await auth.login({ email: EMAIL, password: PASSWORD, hardwareId: HARDWARE_ID });
  assert.ok(result.tokens.accessToken.startsWith('access-'));
  assert.ok(result.tokens.refreshToken.startsWith('refresh-'));
  assert.deepEqual(await auth.tierInfo(result.tokens.accessToken), {
    tier: TIER,
    accountId: ACCOUNT_ID,
  });
  assert.equal(blink.codesSent, 0);
  // The sign-in steps, in the order of blinkpy.
  assert.deepEqual(
    blink.calls.filter((c) => c.host === 'api.oauth.blink.com').map((c) => `${c.method} ${c.path}`),
    [
      'GET /oauth/v2/authorize',
      'GET /oauth/v2/signin',
      'POST /oauth/v2/signin',
      'GET /oauth/v2/authorize',
      'POST /oauth/token',
    ],
  );
});

test('a new client gets a code, and the code completes the same sign-in', async () => {
  const { blink, auth } = setup();
  const result = await auth.login({ email: EMAIL, password: PASSWORD, hardwareId: HARDWARE_ID });
  assert.deepEqual(result, { codeRequired: true });
  assert.equal(blink.codesSent, 1);
  assert.ok(auth.hasPendingLogin());

  await rejectsWith(auth.verifyCode('000000'), ERROR_KINDS.CODE_INVALID);
  assert.ok(auth.hasPendingLogin(), 'a wrong code can be typed again');
  const tokens = await auth.verifyCode(CODE);
  assert.ok(tokens.accessToken);
  assert.equal(auth.hasPendingLogin(), false);

  // The same hardware id is trusted from now on: no new code.
  const again = await auth.login({ email: EMAIL, password: PASSWORD, hardwareId: HARDWARE_ID });
  assert.ok(again.tokens);
  assert.equal(blink.codesSent, 1);
});

test('the 412 answer also means "a code was sent"', async () => {
  const { blink, auth } = setup();
  const original = blink.oauth.bind(blink);
  blink.oauth = (url, method, options) => {
    const answer = original(url, method, options);
    return answer.status === 202 ? blink.reply(412, '') : answer;
  };
  assert.deepEqual(
    await auth.login({ email: EMAIL, password: PASSWORD, hardwareId: HARDWARE_ID }),
    { codeRequired: true },
  );
});

test('a wrong password, a lost sign-in and an expired wait are told apart', async (t) => {
  const { clock, auth } = setup();
  await rejectsWith(
    auth.login({ email: EMAIL, password: 'wrong', hardwareId: HARDWARE_ID }),
    ERROR_KINDS.CREDENTIALS,
  );
  await rejectsWith(auth.verifyCode(CODE), ERROR_KINDS.NO_PENDING_LOGIN);

  await auth.login({ email: EMAIL, password: PASSWORD, hardwareId: HARDWARE_ID });
  clock.advance(16 * 60_000);
  assert.equal(auth.hasPendingLogin(), false);
  await rejectsWith(auth.verifyCode(CODE), ERROR_KINDS.NO_PENDING_LOGIN);
  t.diagnostic('a code typed too late asks for a new sign-in');
});

test('a sign-in page without CSRF token is a changed flow, not a wrong password', async () => {
  const { blink, auth } = setup();
  const original = blink.oauth.bind(blink);
  blink.oauth = (url, method, options) =>
    url.pathname === '/oauth/v2/signin' && method === 'GET'
      ? blink.reply(200, '<html>new design</html>')
      : original(url, method, options);
  await rejectsWith(
    auth.login({ email: EMAIL, password: PASSWORD, hardwareId: HARDWARE_ID }),
    ERROR_KINDS.LOGIN_FLOW,
  );
});

test('an unreachable or overloaded cloud is reported as such', async () => {
  const { blink, auth } = setup();
  blink.online = false;
  await rejectsWith(
    auth.login({ email: EMAIL, password: PASSWORD, hardwareId: HARDWARE_ID }),
    ERROR_KINDS.UNREACHABLE,
  );
  blink.online = true;
  blink.rateLimited = true;
  await rejectsWith(
    auth.login({ email: EMAIL, password: PASSWORD, hardwareId: HARDWARE_ID }),
    ERROR_KINDS.RATE_LIMIT,
  );
});

test('the cookie jar keeps, replaces and expires cookies', () => {
  const jar = new CookieJar();
  jar.store(['a=1; Path=/; HttpOnly', 'b=2']);
  jar.store(['a=3', 'b=; Max-Age=0']);
  assert.equal(jar.header(), 'a=3');
});

test('the client reads the homescreen and the clips of the region', async () => {
  const { client, blink } = await signedInClient();
  const homescreen = await client.homescreen();
  assert.equal(homescreen.networks.length, 3);
  await client.mediaChanged('2026-10-14T07:00:00.000Z');
  const paths = blink.restCalls().map((c) => `${c.method} ${c.host}${c.path}`);
  assert.deepEqual(paths, [
    `GET rest-${TIER}.immedia-semi.com/api/v3/accounts/${ACCOUNT_ID}/homescreen`,
    `GET rest-${TIER}.immedia-semi.com/api/v1/accounts/${ACCOUNT_ID}/media/changed`,
  ]);
  const headers = blink.restCalls()[0].options.headers;
  assert.match(headers.Authorization, /^Bearer access-/);
});

test('an access token about to expire is refreshed first, and the new session stored', async () => {
  const { client, clock, sessions } = await signedInClient();
  clock.advance(3600_000 - 30_000);
  await client.homescreen();
  assert.equal(sessions.length, 1);
  assert.ok(sessions[0].expiresAt > clock.now());
});

test('a revoked access token is refreshed once and the request replayed', async () => {
  const { client, blink, sessions } = await signedInClient();
  blink.revokeAccessTokens();
  const homescreen = await client.homescreen();
  assert.ok(homescreen.networks);
  assert.equal(sessions.length, 1);
});

test('a refused refresh token means a new sign-in', async () => {
  const { client, blink } = await signedInClient();
  blink.revokeAccessTokens();
  blink.refreshTokens.clear();
  await rejectsWith(client.homescreen(), ERROR_KINDS.SESSION_EXPIRED);
});

test('commands wait for Blink to complete them; a refused command is an error', async () => {
  const { client, blink } = await signedInClient();
  await client.setArmed('2000003', true);
  assert.equal(blink.homescreen.networks.find((n) => n.id === 2000003).armed, true);
  assert.ok(blink.restCalls().some((c) => /\/network\/2000003\/command\/9\d+$/.test(c.path)));

  const original = blink.rest.bind(blink);
  blink.rest = (url, method, options) =>
    /\/command\//.test(url.pathname)
      ? blink.reply(200, { complete: false, status_code: 902, status_msg: 'Sync module offline' })
      : original(url, method, options);
  await rejectsWith(client.setArmed('2000001', false), ERROR_KINDS.COMMAND);
});

test('the motion detection and the snapshot take the path of each device kind', async () => {
  const { client, blink } = await signedInClient();
  await client.setMotionDetection({ kind: 'camera', id: '4000001', networkId: '2000001' }, false);
  await client.setMotionDetection({ kind: 'mini', id: '5000001', networkId: '2000003' }, false);
  await client.snapshot({ kind: 'mini', id: '5000001', networkId: '2000003' });
  await client.snapshot({ kind: 'camera', id: '4000002', networkId: '2000002' });
  const posts = blink
    .restCalls()
    .filter((c) => c.method === 'POST')
    .map((c) => c.path);
  assert.deepEqual(posts, [
    '/network/2000001/camera/4000001/disable',
    `/api/v1/accounts/${ACCOUNT_ID}/networks/2000003/owls/5000001/config`,
    `/api/v1/accounts/${ACCOUNT_ID}/networks/2000003/owls/5000001/thumbnail`,
    '/network/2000002/camera/4000002/thumbnail',
  ]);
  assert.equal(blink.homescreen.cameras[0].enabled, false);
  assert.equal(blink.homescreen.owls[0].enabled, false);
  assert.equal(blink.snapshots, 2);
});

test('ids and regions are checked before they go into a URL', async () => {
  const { client } = await signedInClient();
  await rejectsWith(client.setArmed('../../x', true), ERROR_KINDS.HTTP);
  assert.throws(() => baseUrl('evil.example.com/'), /invalid region/);
});

test('thumbnail paths never lead outside the Blink cloud', () => {
  const ids = { accountId: '1', networkId: '2', productType: 'catalina', id: '3' };
  assert.equal(
    thumbnailPath('/media/production/account/1/network/2/camera/3/clip_x', ids),
    '/media/production/account/1/network/2/camera/3/clip_x.jpg',
  );
  assert.equal(
    thumbnailPath(
      '/api/v3/media/accounts/1/networks/2/catalina/3/thumbnail/thumbnail.jpg?ts=1&ext=',
      ids,
    ),
    '/api/v3/media/accounts/1/networks/2/catalina/3/thumbnail/thumbnail.jpg?ts=1&ext=',
  );
  assert.equal(
    thumbnailPath('1648473188', ids),
    '/api/v3/media/accounts/1/networks/2/catalina/3/thumbnail/thumbnail.jpg?ts=1648473188&ext=',
  );
  assert.equal(
    thumbnailPath('https://rest-u011.immedia-semi.com/media/x.jpg', ids),
    '/media/x.jpg',
  );
  for (const bad of [
    'https://evil.example.com/x.jpg',
    '//evil.example.com/x',
    '/a/../b',
    'x',
    '',
    null,
  ]) {
    assert.equal(thumbnailPath(bad, ids), null, String(bad));
  }
});

test('the first step may redirect to the sign-in page (the real cloud) or answer 200', async () => {
  for (const [status, location] of [
    [302, '/oauth/v2/signin'],
    [302, 'https://api.oauth.blink.com/oauth/v2/signin'],
    [200, undefined],
  ]) {
    const { blink, auth } = setup({ requireCode: false });
    blink.authorizeStatus = status;
    blink.authorizeLocation = location;
    const result = await auth.login({ email: EMAIL, password: PASSWORD, hardwareId: HARDWARE_ID });
    assert.ok(result.tokens, `${status} ${location}`);
  }
});

test('a first step redirecting anywhere else is a changed flow', async () => {
  for (const location of ['/oauth/v2/other', 'https://evil.example.com/oauth/v2/signin']) {
    const { blink, auth } = setup();
    blink.authorizeLocation = location;
    await rejectsWith(
      auth.login({ email: EMAIL, password: PASSWORD, hardwareId: HARDWARE_ID }),
      ERROR_KINDS.LOGIN_FLOW,
    );
  }
});
