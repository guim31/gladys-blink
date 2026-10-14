// -----------------------------------------------------------------------------
// The REST client of the Blink cloud (rest-<tier>.immedia-semi.com), with the
// session obtained by src/blink/auth.js. Endpoints as blinkpy 0.25 uses them
// (MIT), response shapes checked against the real answers kept in
// test/fixtures/blink/.
//
// Gentle by construction: one request at a time, a short gap between two, a
// refresh of the access token a minute before it expires, one retry after a
// 401 (refresh then replay), never more. Blink bans clients that hammer it.
// -----------------------------------------------------------------------------

import { setTimeout as delay } from 'node:timers/promises';
import { APP_AGENT, BlinkAuth } from './auth.js';
import { BlinkError, ERROR_KINDS, kindOfStatus } from './errors.js';
import { NetworkError, fetchRequest, json } from './http.js';

export const BLINK_DOMAIN = 'immedia-semi.com';

export const CLIENT_TIMINGS = {
  // Gap between two requests to the Blink cloud.
  requestGapMs: 500,
  // Refresh the access token this long before it expires.
  refreshMarginMs: 60_000,
  // Command status (arm, snapshot…): asked every…, at most…
  commandPollMs: 2_000,
  commandTimeoutMs: 40_000,
};

// The device kinds, with their path in the camera actions of the API.
export const KINDS = Object.freeze({ CAMERA: 'camera', MINI: 'mini', DOORBELL: 'doorbell' });

/** Base URL of a region (`tier`), checked: it ends up in every request. */
export function baseUrl(tier) {
  if (typeof tier !== 'string' || !/^[a-z0-9-]+$/i.test(tier)) {
    throw new BlinkError(ERROR_KINDS.LOGIN_FLOW, 'invalid region');
  }
  return `https://rest-${tier}.${BLINK_DOMAIN}`;
}

/** Wait `ms` (no timer at all for 0: the tests run without delays). */
const sleep = (ms) => (ms > 0 ? delay(ms) : Promise.resolve());

export class BlinkClient {
  /**
   * @param {object} options
   * @param {object} options.session { accessToken, refreshToken, expiresAt, tier, accountId, hardwareId }
   * @param {(session: object) => void} [options.onSession] called with every renewed session (to store it)
   * @param {Function} [options.request] HTTP seam
   * @param {BlinkAuth} [options.auth]
   * @param {() => number} [options.now]
   * @param {object} [options.timings] CLIENT_TIMINGS overrides
   */
  constructor({
    session,
    onSession,
    request = fetchRequest,
    auth,
    now = () => Date.now(),
    timings,
  }) {
    this.session = { ...session };
    this.onSession = onSession ?? (() => {});
    this.request = request;
    this.now = now;
    this.auth = auth ?? new BlinkAuth({ request, now });
    this.timings = { ...CLIENT_TIMINGS, ...timings };
    this.base = baseUrl(this.session.tier);
    this.queue = Promise.resolve();
    this.lastRequestAt = 0;
    this.refreshing = null;
  }

  get accountId() {
    return this.session.accountId;
  }

  // --- Session -----------------------------------------------------------------

  async refreshSession() {
    this.refreshing ??= (async () => {
      try {
        const tokens = await this.auth.refresh({
          refreshToken: this.session.refreshToken,
          hardwareId: this.session.hardwareId,
        });
        this.session = { ...this.session, ...tokens };
        this.onSession(this.session);
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  async freshToken() {
    if (this.session.expiresAt - this.now() < this.timings.refreshMarginMs) {
      await this.refreshSession();
    }
    return this.session.accessToken;
  }

  // --- Requests ------------------------------------------------------------------

  /** Run `task` after the requests already queued, a gap after the last one. */
  serialize(task) {
    const run = this.queue.then(async () => {
      const wait = this.lastRequestAt + this.timings.requestGapMs - this.now();
      if (wait > 0) {
        await sleep(wait);
      }
      try {
        return await task();
      } finally {
        this.lastRequestAt = this.now();
      }
    });
    this.queue = run.catch(() => {});
    return run;
  }

  /**
   * One request to the REST API.
   * @param {string} path absolute path (`/api/...`)
   * @param {{ method?: string, body?: object, raw?: boolean }} [options]
   * @returns {Promise<any>} the JSON answer, or the raw response with `raw`
   */
  call(path, { method = 'GET', body, raw = false } = {}) {
    return this.serialize(async () => {
      let response = await this.send(path, method, body, await this.freshToken());
      if (response.status === 401) {
        // The token may have been revoked before its expiry: one refresh, one replay.
        await this.refreshSession();
        response = await this.send(path, method, body, this.session.accessToken);
        if (response.status === 401) {
          throw new BlinkError(ERROR_KINDS.SESSION_EXPIRED, `${method} refused (HTTP 401)`, {
            status: 401,
          });
        }
      }
      if (response.status < 200 || response.status >= 300) {
        throw new BlinkError(
          kindOfStatus(response.status),
          `${method} ${describePath(path)} answered HTTP ${response.status}`,
          { status: response.status },
        );
      }
      if (raw) {
        return response;
      }
      const data = json(response);
      if (data === null) {
        throw new BlinkError(ERROR_KINDS.HTTP, `${method} ${describePath(path)}: not JSON`);
      }
      return data;
    });
  }

  async send(path, method, body, token) {
    const headers = {
      Authorization: `Bearer ${token}`,
      'User-Agent': APP_AGENT,
      Accept: '*/*',
    };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    try {
      return await this.request(`${this.base}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      if (err instanceof NetworkError) {
        throw new BlinkError(
          ERROR_KINDS.UNREACHABLE,
          `${method} ${describePath(path)}: ${err.message}`,
        );
      }
      throw err;
    }
  }

  // --- Reads ---------------------------------------------------------------------

  /** Systems, sync modules, cameras, Minis and doorbells, with their states. */
  homescreen() {
    return this.call(`/api/v3/accounts/${this.accountId}/homescreen`);
  }

  /** The clips (motion, doorbell, snapshots) created or changed since `since` (ISO date). */
  mediaChanged(since, page = 1) {
    const query = new URLSearchParams({ since, page: String(page) });
    return this.call(`/api/v1/accounts/${this.accountId}/media/changed?${query}`);
  }

  /**
   * A thumbnail, from a path of the homescreen answer. Only from the Blink
   * cloud itself: a path that would lead elsewhere is refused.
   * @returns {Promise<Buffer>}
   */
  async thumbnail(path) {
    const response = await this.call(path, { raw: true });
    return response.body;
  }

  // --- Commands ------------------------------------------------------------------

  /** Arm or disarm a system (Blink network). */
  async setArmed(networkId, armed) {
    const command = await this.call(
      `/api/v1/accounts/${this.accountId}/networks/${id(networkId)}/state/${armed ? 'arm' : 'disarm'}`,
      { method: 'POST' },
    );
    await this.waitForCommand(networkId, command);
  }

  /** Turn the motion detection of one camera on or off. */
  async setMotionDetection(camera, enabled) {
    const net = id(camera.networkId);
    const cam = id(camera.id);
    const account = this.accountId;
    let command;
    if (camera.kind === KINDS.MINI) {
      command = await this.call(`/api/v1/accounts/${account}/networks/${net}/owls/${cam}/config`, {
        method: 'POST',
        body: { enabled },
      });
    } else if (camera.kind === KINDS.DOORBELL) {
      command = await this.call(
        `/api/v1/accounts/${account}/networks/${net}/doorbells/${cam}/${enabled ? 'enable' : 'disable'}`,
        { method: 'POST' },
      );
    } else {
      command = await this.call(`/network/${net}/camera/${cam}/${enabled ? 'enable' : 'disable'}`, {
        method: 'POST',
      });
    }
    await this.waitForCommand(camera.networkId, command);
  }

  /** Ask a camera for a new thumbnail (it wakes up: this costs battery). */
  async snapshot(camera) {
    const net = id(camera.networkId);
    const cam = id(camera.id);
    const account = this.accountId;
    const path =
      camera.kind === KINDS.MINI
        ? `/api/v1/accounts/${account}/networks/${net}/owls/${cam}/thumbnail`
        : camera.kind === KINDS.DOORBELL
          ? `/api/v1/accounts/${account}/networks/${net}/doorbells/${cam}/thumbnail`
          : `/network/${net}/camera/${cam}/thumbnail`;
    const command = await this.call(path, { method: 'POST' });
    await this.waitForCommand(camera.networkId, command);
  }

  /**
   * Blink answers a command with its id, then runs it on the sync module:
   * ask its status until it completes. `status_code` 908 means "running or
   * succeeded"; anything else is a failure.
   */
  async waitForCommand(networkId, command) {
    const commandId = command?.id;
    const network = command?.network_id ?? networkId;
    if (commandId == null || network == null) {
      // Some commands (the Mini configuration) complete at once.
      return;
    }
    const deadline = this.now() + this.timings.commandTimeoutMs;
    const maxAttempts = Math.max(
      1,
      Math.ceil(this.timings.commandTimeoutMs / Math.max(this.timings.commandPollMs, 1)),
    );
    for (let attempt = 1; ; attempt += 1) {
      const status = await this.call(`/network/${id(network)}/command/${id(commandId)}`);
      if (status && status.status_code !== undefined && status.status_code !== 908) {
        throw new BlinkError(
          ERROR_KINDS.COMMAND,
          `command refused by Blink (${status.status_code}: ${status.status_msg ?? 'no message'})`,
        );
      }
      if (status?.complete) {
        return;
      }
      if (this.now() >= deadline || attempt >= maxAttempts) {
        throw new BlinkError(ERROR_KINDS.COMMAND, 'command did not complete in time');
      }
      await sleep(this.timings.commandPollMs);
    }
  }
}

/** An id of the API, checked before it goes into a path. */
function id(value) {
  const text = String(value ?? '');
  if (!/^\d+$/.test(text)) {
    throw new BlinkError(ERROR_KINDS.HTTP, 'invalid Blink id');
  }
  return text;
}

/** A path for the logs: the ids are not secret, the query strings are dropped. */
function describePath(path) {
  return path.split('?')[0];
}
