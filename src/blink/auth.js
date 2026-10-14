// -----------------------------------------------------------------------------
// Sign-in to the Blink cloud: the OAuth 2.0 authorization code flow with PKCE
// Blink moved to in 2025, as blinkpy 0.25 does it (blinkpy/auth.py, api.py —
// MIT, Kevin Fronczak and contributors):
//
//   1. GET  /oauth/v2/authorize?…code_challenge…   (opens the session cookies)
//   2. GET  /oauth/v2/signin                        (HTML page, CSRF token)
//   3. POST /oauth/v2/signin  username/password     (3xx: signed in;
//                                                   412 or 202 + tsv_*: a code
//                                                   was sent by Blink)
//   4. POST /oauth/v2/2fa/verify  2fa_code           (201 { status: auth-completed })
//   5. GET  /oauth/v2/authorize                      (3xx, Location …?code=)
//   6. POST /oauth/token  grant_type=authorization_code + code_verifier
//   then  POST /oauth/token grant_type=refresh_token  for the next hours.
//
// The `hardware_id` (a UUID, Blink refuses anything else with a 406) names
// this client for Blink: it is kept under /data, so the code is asked once,
// not at every restart. Between steps 3 and 4 (the user types the code in
// Gladys), the cookies, the CSRF token and the PKCE verifier stay in memory.
// -----------------------------------------------------------------------------

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { BlinkError, ERROR_KINDS, kindOfStatus } from './errors.js';
import { CookieJar, NetworkError, fetchRequest, json } from './http.js';

export const OAUTH_BASE_URL = 'https://api.oauth.blink.com';
export const TIER_URL = 'https://rest-prod.immedia-semi.com/api/v1/users/tier_info';
const AUTHORIZE_URL = `${OAUTH_BASE_URL}/oauth/v2/authorize`;
const SIGNIN_URL = `${OAUTH_BASE_URL}/oauth/v2/signin`;
const VERIFY_URL = `${OAUTH_BASE_URL}/oauth/v2/2fa/verify`;
const TOKEN_URL = `${OAUTH_BASE_URL}/oauth/token`;

const CLIENT_ID = 'ios';
const SCOPE = 'client';
const REDIRECT_URI = 'immedia-blink://applinks.blink.com/signin/callback';
// The user agents of the Blink iOS app, as blinkpy sends them.
const BROWSER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1';
export const APP_AGENT = 'Blink/2511191620 CFNetwork/3860.200.71 Darwin/25.1.0';

// How long a sign-in waits for its code. Blink's own limit is not published:
// the documentation asks to type the code within a few minutes.
export const PENDING_LOGIN_MS = 15 * 60_000;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A hardware id Blink accepts: the stored one when valid, a new UUID otherwise. */
export function validHardwareId(stored) {
  return typeof stored === 'string' && UUID_PATTERN.test(stored)
    ? stored
    : randomUUID().toUpperCase();
}

/** PKCE pair (RFC 7636, S256). */
export function pkcePair() {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

/** The CSRF token of the sign-in page: `<script id="oauth-args" type="application/json">`. */
export function extractCsrfToken(html) {
  const match = String(html).match(
    /<script\b(?=[^>]*\bid=["']oauth-args["'])(?=[^>]*\btype=["']application\/json["'])[^>]*>([\s\S]*?)<\/script>/i,
  );
  if (!match) {
    return null;
  }
  try {
    const token = JSON.parse(match[1])['csrf-token'];
    return typeof token === 'string' && token ? token : null;
  } catch {
    return null;
  }
}

const isRedirect = (status) => [301, 302, 303, 307, 308].includes(status);

/** The token answer of Blink, as stored under /data. */
export function parseTokens(body, now) {
  if (!body || typeof body.access_token !== 'string' || typeof body.refresh_token !== 'string') {
    throw new BlinkError(ERROR_KINDS.LOGIN_FLOW, 'token answer without tokens');
  }
  const expiresIn = Number(body.expires_in);
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: now + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600) * 1000,
  };
}

export class BlinkAuth {
  /**
   * @param {object} [options]
   * @param {Function} [options.request] HTTP seam (src/blink/http.js)
   * @param {() => number} [options.now]
   */
  constructor({ request = fetchRequest, now = () => Date.now() } = {}) {
    this.request = request;
    this.now = now;
    /** The sign-in waiting for its code: { jar, csrf, verifier, hardwareId, startedAt }. */
    this.pending = null;
  }

  /** One request of the sign-in, through the session cookies. */
  async send(jar, url, { method = 'GET', headers = {}, form } = {}) {
    const allHeaders = { 'User-Agent': BROWSER_AGENT, ...headers };
    const cookie = jar.header();
    if (cookie) {
      allHeaders.Cookie = cookie;
    }
    let body;
    if (form) {
      allHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(form).toString();
    }
    let response;
    try {
      response = await this.request(url, { method, headers: allHeaders, body });
    } catch (err) {
      if (err instanceof NetworkError) {
        throw new BlinkError(ERROR_KINDS.UNREACHABLE, `Blink sign-in: ${err.message}`);
      }
      throw err;
    }
    jar.store(response.cookies);
    if (response.status === 429 || response.status >= 500) {
      throw new BlinkError(
        kindOfStatus(response.status),
        `Blink sign-in answered HTTP ${response.status}`,
        { status: response.status },
      );
    }
    return response;
  }

  /**
   * Steps 1 to 3, then 5 and 6 when Blink asks no code.
   * @returns {Promise<{ tokens?: object, codeRequired?: boolean }>}
   */
  async login({ email, password, hardwareId }) {
    this.pending = null;
    const jar = new CookieJar();
    const { verifier, challenge } = pkcePair();
    const page = {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    };

    const authorize = await this.send(
      jar,
      `${AUTHORIZE_URL}?${new URLSearchParams({
        app_brand: 'blink',
        app_version: '50.1',
        client_id: CLIENT_ID,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        device_brand: 'Apple',
        device_model: 'iPhone16,1',
        device_os_version: '26.1',
        hardware_id: hardwareId,
        redirect_uri: REDIRECT_URI,
        response_type: 'code',
        scope: SCOPE,
      })}`,
      { headers: page },
    );
    if (authorize.status !== 200) {
      throw new BlinkError(
        ERROR_KINDS.LOGIN_FLOW,
        `authorization request answered HTTP ${authorize.status}`,
        { status: authorize.status },
      );
    }

    const signinPage = await this.send(jar, SIGNIN_URL, { headers: page });
    const csrf = signinPage.status === 200 ? extractCsrfToken(signinPage.body.toString()) : null;
    if (!csrf) {
      throw new BlinkError(ERROR_KINDS.LOGIN_FLOW, 'no CSRF token on the sign-in page');
    }

    const signin = await this.send(jar, SIGNIN_URL, {
      method: 'POST',
      headers: { Accept: '*/*', Origin: OAUTH_BASE_URL, Referer: SIGNIN_URL },
      form: { username: email, password, 'csrf-token': csrf },
    });
    const answer = json(signin) ?? {};
    const codeRequired =
      signin.status === 412 ||
      (signin.status === 202 &&
        Boolean(answer.tsv_state || answer.tsv_methods || answer.next_time_in_secs));
    if (codeRequired) {
      this.pending = { jar, csrf, verifier, hardwareId, startedAt: this.now() };
      return { codeRequired: true };
    }
    if (!isRedirect(signin.status)) {
      throw new BlinkError(ERROR_KINDS.CREDENTIALS, `sign-in refused (HTTP ${signin.status})`, {
        status: signin.status,
      });
    }
    return { tokens: await this.finish(jar, verifier, hardwareId) };
  }

  /** Is a sign-in waiting for its code? */
  hasPendingLogin() {
    if (this.pending && this.now() - this.pending.startedAt > PENDING_LOGIN_MS) {
      this.pending = null;
    }
    return this.pending !== null;
  }

  /** Step 4, then 5 and 6: the code the user received from Blink. */
  async verifyCode(code) {
    if (!this.hasPendingLogin()) {
      throw new BlinkError(ERROR_KINDS.NO_PENDING_LOGIN, 'no sign-in waits for a code');
    }
    const { jar, csrf, verifier, hardwareId } = this.pending;
    const verify = await this.send(jar, VERIFY_URL, {
      method: 'POST',
      headers: { Accept: '*/*', Origin: OAUTH_BASE_URL, Referer: SIGNIN_URL },
      form: { '2fa_code': String(code), 'csrf-token': csrf, remember_me: 'false' },
    });
    if (verify.status !== 201 || json(verify)?.status !== 'auth-completed') {
      throw new BlinkError(ERROR_KINDS.CODE_INVALID, `code refused (HTTP ${verify.status})`, {
        status: verify.status,
      });
    }
    const tokens = await this.finish(jar, verifier, hardwareId);
    this.pending = null;
    return tokens;
  }

  /** Steps 5 and 6: the authorization code, exchanged for the tokens. */
  async finish(jar, verifier, hardwareId) {
    const authorize = await this.send(jar, AUTHORIZE_URL, {
      headers: { Accept: '*/*', Referer: SIGNIN_URL },
    });
    const location = authorize.headers.location ?? '';
    let code = null;
    if (isRedirect(authorize.status)) {
      try {
        code = new URL(location, OAUTH_BASE_URL).searchParams.get('code');
      } catch {
        code = null;
      }
    }
    if (!code) {
      throw new BlinkError(ERROR_KINDS.LOGIN_FLOW, 'no authorization code after the sign-in');
    }
    const token = await this.send(jar, TOKEN_URL, {
      method: 'POST',
      headers: { 'User-Agent': APP_AGENT, Accept: '*/*' },
      form: {
        app_brand: 'blink',
        client_id: CLIENT_ID,
        code,
        code_verifier: verifier,
        grant_type: 'authorization_code',
        hardware_id: hardwareId,
        redirect_uri: REDIRECT_URI,
        scope: SCOPE,
      },
    });
    if (token.status !== 200) {
      throw new BlinkError(ERROR_KINDS.LOGIN_FLOW, `token exchange answered HTTP ${token.status}`, {
        status: token.status,
      });
    }
    return parseTokens(json(token), this.now());
  }

  /** A new access token from the refresh token. */
  async refresh({ refreshToken, hardwareId }) {
    const response = await this.send(new CookieJar(), TOKEN_URL, {
      method: 'POST',
      headers: { 'User-Agent': APP_AGENT, Accept: '*/*' },
      form: {
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: CLIENT_ID,
        scope: SCOPE,
        hardware_id: hardwareId,
      },
    });
    if (response.status === 400 || response.status === 401 || response.status === 403) {
      throw new BlinkError(
        ERROR_KINDS.SESSION_EXPIRED,
        `refresh refused (HTTP ${response.status})`,
        {
          status: response.status,
        },
      );
    }
    if (response.status !== 200) {
      throw new BlinkError(
        kindOfStatus(response.status),
        `refresh answered HTTP ${response.status}`,
        {
          status: response.status,
        },
      );
    }
    return parseTokens(json(response), this.now());
  }

  /** The region (`tier`) and the account of the signed-in user. */
  async tierInfo(accessToken) {
    let response;
    try {
      response = await this.request(TIER_URL, {
        headers: { 'User-Agent': APP_AGENT, Authorization: `Bearer ${accessToken}` },
      });
    } catch (err) {
      if (err instanceof NetworkError) {
        throw new BlinkError(ERROR_KINDS.UNREACHABLE, `tier info: ${err.message}`);
      }
      throw err;
    }
    const body = response.status === 200 ? json(response) : null;
    const tier = body?.tier;
    const accountId = body?.account_id;
    if (typeof tier !== 'string' || !/^[a-z0-9-]+$/i.test(tier) || accountId == null) {
      throw new BlinkError(
        response.status === 200 ? ERROR_KINDS.LOGIN_FLOW : kindOfStatus(response.status),
        `tier info answered HTTP ${response.status}`,
        { status: response.status },
      );
    }
    return { tier, accountId: String(accountId) };
  }
}
