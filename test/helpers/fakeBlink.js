// -----------------------------------------------------------------------------
// A fake Blink cloud behind the HTTP seam of the client (src/blink/http.js):
// the OAuth v2 sign-in (cookies, CSRF, PKCE, verification code, tokens), the
// tier info, and the REST endpoints the integration uses, answering with the
// real answers of test/fixtures/blink/. No network.
// -----------------------------------------------------------------------------

import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import jpeg from 'jpeg-js';
import { NetworkError } from '../../src/blink/http.js';

export const EMAIL = 'someone@example.com';
export const PASSWORD = 'correct horse battery staple';
export const CODE = '123456';
export const TIER = 'u011';
export const ACCOUNT_ID = '1000001';

export const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/blink/${name}`, import.meta.url), 'utf8'));

/** A small valid JPEG (a gradient), `width` × `height`, at `quality`. */
export function makeJpeg(width = 64, height = 36, quality = 80, seed = 1) {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      // Noise makes a large image large: it compresses badly.
      const noise = (x * 7919 + y * 104729 + seed * 31) % 255;
      data[i] = (x * 255) / width;
      data[i + 1] = noise;
      data[i + 2] = (y * 255) / height;
      data[i + 3] = 255;
    }
  }
  return Buffer.from(jpeg.encode({ width, height, data }, quality).data);
}

const token = () => randomBytes(12).toString('hex');

export class FakeBlink {
  constructor({
    now = () => Date.now(),
    homescreen = fixture('homescreen.json'),
    media = [],
    requireCode = true,
  } = {}) {
    this.now = now;
    this.homescreen = structuredClone(homescreen);
    this.media = structuredClone(media);
    this.requireCode = requireCode;
    this.password = PASSWORD;
    this.online = true;
    this.rateLimited = false;
    this.calls = [];
    this.sessions = new Map(); // cookie → { challenge, hardwareId, csrf, signedIn }
    this.codes = new Map(); // authorization code → { challenge, hardwareId }
    this.trusted = new Set(); // hardware ids that passed the verification code
    this.accessTokens = new Map(); // token → expiresAt
    this.refreshTokens = new Set();
    this.codesSent = 0;
    this.commands = 0;
    this.snapshots = 0;
    this.thumbnail = makeJpeg();
    this.thumbnailRequests = 0;
    this.tokenLifetimeS = 3600;
  }

  /** The `request` seam of the integration. */
  request = async (url, options = {}) => {
    const method = options.method ?? 'GET';
    const parsed = new URL(url);
    this.calls.push({ method, host: parsed.host, path: parsed.pathname, url, options });
    if (!this.online) {
      throw new NetworkError('network error (ECONNREFUSED)');
    }
    if (this.rateLimited) {
      return this.reply(429, { message: 'Too many requests' });
    }
    if (parsed.host === 'api.oauth.blink.com') {
      return this.oauth(parsed, method, options);
    }
    const bearer = (options.headers?.Authorization ?? '').replace(/^Bearer /, '');
    const expiresAt = this.accessTokens.get(bearer);
    if (expiresAt === undefined || expiresAt <= this.now()) {
      return this.reply(401, { message: 'Unauthorized Access', code: 101 });
    }
    if (
      parsed.host === 'rest-prod.immedia-semi.com' &&
      parsed.pathname === '/api/v1/users/tier_info'
    ) {
      return this.reply(200, { tier: TIER, account_id: Number(ACCOUNT_ID) });
    }
    if (parsed.host !== `rest-${TIER}.immedia-semi.com`) {
      return this.reply(404, {});
    }
    return this.rest(parsed, method, options);
  };

  reply(status, body, { headers = {}, cookies = [] } = {}) {
    const buffer = Buffer.isBuffer(body)
      ? body
      : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    return { status, headers, cookies, body: buffer };
  }

  session(options) {
    const cookie = options.headers?.Cookie ?? '';
    const sid = cookie.match(/(?:^|; )sid=([^;]+)/)?.[1];
    return sid ? this.sessions.get(sid) : undefined;
  }

  oauth(url, method, options) {
    const form = Object.fromEntries(new URLSearchParams(options.body ?? ''));
    const path = url.pathname;
    if (path === '/oauth/v2/authorize' && method === 'GET') {
      const challenge = url.searchParams.get('code_challenge');
      if (challenge) {
        const sid = token();
        this.sessions.set(sid, {
          challenge,
          hardwareId: url.searchParams.get('hardware_id'),
          csrf: token(),
          signedIn: false,
        });
        return this.reply(200, '<html>authorize</html>', {
          cookies: [`sid=${sid}; Path=/; HttpOnly`],
        });
      }
      const session = this.session(options);
      if (!session?.signedIn) {
        return this.reply(400, 'not signed in');
      }
      const code = token();
      this.codes.set(code, { challenge: session.challenge, hardwareId: session.hardwareId });
      return this.reply(302, '', {
        headers: {
          location: `immedia-blink://applinks.blink.com/signin/callback?code=${code}&state=x`,
        },
      });
    }
    if (path === '/oauth/v2/signin' && method === 'GET') {
      const session = this.session(options);
      if (!session) {
        return this.reply(400, 'no session');
      }
      return this.reply(
        200,
        `<html><head><script id="oauth-args" type="application/json">{"csrf-token":"${session.csrf}"}</script></head></html>`,
      );
    }
    if (path === '/oauth/v2/signin' && method === 'POST') {
      const session = this.session(options);
      if (!session || form['csrf-token'] !== session.csrf) {
        return this.reply(403, 'csrf');
      }
      if (form.username !== EMAIL || form.password !== this.password) {
        return this.reply(401, { message: 'Invalid credentials' });
      }
      if (this.requireCode && !this.trusted.has(session.hardwareId)) {
        this.codesSent += 1;
        return this.reply(202, {
          tsv_state: 'required',
          tsv_methods: ['email'],
          next_time_in_secs: 30,
        });
      }
      session.signedIn = true;
      return this.reply(302, '', { headers: { location: '/oauth/v2/authorize' } });
    }
    if (path === '/oauth/v2/2fa/verify' && method === 'POST') {
      const session = this.session(options);
      if (!session || form['csrf-token'] !== session.csrf || form['2fa_code'] !== CODE) {
        return this.reply(400, { status: 'invalid-code' });
      }
      session.signedIn = true;
      this.trusted.add(session.hardwareId);
      return this.reply(201, { status: 'auth-completed' });
    }
    if (path === '/oauth/token' && method === 'POST') {
      if (form.grant_type === 'authorization_code') {
        const grant = this.codes.get(form.code);
        const challenge = createHash('sha256')
          .update(form.code_verifier ?? '')
          .digest('base64url');
        if (!grant || grant.challenge !== challenge || grant.hardwareId !== form.hardware_id) {
          return this.reply(400, { error: 'invalid_grant' });
        }
        this.codes.delete(form.code);
        return this.reply(200, this.issueTokens());
      }
      if (form.grant_type === 'refresh_token') {
        if (!this.refreshTokens.has(form.refresh_token)) {
          return this.reply(401, { error: 'invalid_grant' });
        }
        this.refreshTokens.delete(form.refresh_token);
        return this.reply(200, this.issueTokens());
      }
    }
    return this.reply(404, {});
  }

  issueTokens() {
    const access = `access-${token()}`;
    const refresh = `refresh-${token()}`;
    this.accessTokens.set(access, this.now() + this.tokenLifetimeS * 1000);
    this.refreshTokens.add(refresh);
    return {
      access_token: access,
      refresh_token: refresh,
      token_type: 'Bearer',
      expires_in: this.tokenLifetimeS,
    };
  }

  /** Every valid access token expires now (Blink revoked them). */
  revokeAccessTokens() {
    this.accessTokens.clear();
  }

  findDevice(kind, id) {
    const list = { camera: 'cameras', owls: 'owls', doorbells: 'doorbells' }[kind];
    return this.homescreen[list]?.find((device) => String(device.id) === String(id));
  }

  command(networkId, command) {
    this.commands += 1;
    return this.reply(200, {
      id: 900000000 + this.commands,
      network_id: Number(networkId),
      command,
      state: 'new',
    });
  }

  snap(device) {
    this.snapshots += 1;
    device.thumbnail = `/api/v3/media/accounts/${ACCOUNT_ID}/networks/${device.network_id}/${device.type}/${device.id}/thumbnail/thumbnail.jpg?ts=${Math.round(this.now() / 1000) + this.snapshots}&ext=`;
  }

  rest(url, method, options) {
    const path = url.pathname;
    let match;
    if (method === 'GET' && path === `/api/v3/accounts/${ACCOUNT_ID}/homescreen`) {
      return this.reply(200, this.homescreen);
    }
    if (method === 'GET' && path === `/api/v1/accounts/${ACCOUNT_ID}/media/changed`) {
      const since = Date.parse(url.searchParams.get('since'));
      return this.reply(200, {
        limit: 500,
        purge_id: 1,
        refresh_count: 0,
        media: this.media.filter(
          (item) => !(since > Date.parse(item.updated_at ?? item.created_at)),
        ),
      });
    }
    if ((match = path.match(/^\/api\/v1\/accounts\/\d+\/networks\/(\d+)\/state\/(arm|disarm)$/))) {
      const network = this.homescreen.networks.find((n) => String(n.id) === match[1]);
      if (!network) {
        return this.reply(404, {});
      }
      network.armed = match[2] === 'arm';
      return this.command(match[1], match[2]);
    }
    if ((match = path.match(/^\/network\/(\d+)\/command\/(\d+)$/))) {
      return this.reply(200, { ...fixture('command-complete.json'), commands: [] });
    }
    if ((match = path.match(/^\/network\/(\d+)\/camera\/(\d+)\/(enable|disable|thumbnail)$/))) {
      const camera = this.findDevice('camera', match[2]);
      if (!camera) {
        return this.reply(404, {});
      }
      if (match[3] === 'thumbnail') {
        this.snap(camera);
      } else {
        camera.enabled = match[3] === 'enable';
      }
      return this.command(match[1], match[3]);
    }
    if (
      (match = path.match(
        /^\/api\/v1\/accounts\/\d+\/networks\/(\d+)\/(owls|doorbells)\/(\d+)\/(config|enable|disable|thumbnail)$/,
      ))
    ) {
      const device = this.findDevice(match[2], match[3]);
      if (!device) {
        return this.reply(404, {});
      }
      if (match[4] === 'thumbnail') {
        this.snap(device);
        return this.command(match[1], 'thumbnail');
      }
      if (match[4] === 'config') {
        device.enabled = JSON.parse(options.body).enabled;
        return this.reply(200, { message: 'OK' });
      }
      device.enabled = match[4] === 'enable';
      return this.command(match[1], match[4]);
    }
    if (method === 'GET' && (path.includes('/thumbnail') || path.startsWith('/media/'))) {
      this.thumbnailRequests += 1;
      return this.reply(200, this.thumbnail, { headers: { 'content-type': 'image/jpeg' } });
    }
    return this.reply(404, {});
  }

  /** Requests made to the REST API (not the sign-in). */
  restCalls() {
    return this.calls.filter((call) => call.host === `rest-${TIER}.immedia-semi.com`);
  }
}
