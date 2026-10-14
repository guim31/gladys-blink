// -----------------------------------------------------------------------------
// The Blink hub: the session (sign-in, verification code, refresh), the
// periodic reading of the account, the states published to Gladys when they
// change, the scene events fired on new clips, the images, and the commands
// of the widget and the scene actions.
//
// One reading = two GET requests to the Blink cloud, whatever the number of
// cameras: the homescreen (systems, arming, cameras, battery, Wi-Fi,
// temperature, thumbnail paths) and media/changed (the new clips: motion,
// doorbell). No camera is woken up by a reading: only a snapshot asked by the
// user does that. A thumbnail is downloaded when its path changes.
//
// Blink has no push for third parties: motion and the doorbell are seen with
// the delay of the reading interval (30 s to 5 min, chosen by the user) plus
// the time Blink takes to upload the clip.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { createLogger } from '@gladysassistant/integration-sdk';
import { BlinkAuth, validHardwareId } from './blink/auth.js';
import { BlinkClient, KINDS } from './blink/client.js';
import { BlinkError, ERROR_KINDS } from './blink/errors.js';
import { MEDIA_EVENTS, cameraOfMedia, parseHomescreen, parseMedia } from './blink/model.js';
import { accountFingerprint, hasCredentials } from './config.js';
import {
  FEATURES,
  buildDevices,
  cameraIds,
  cameraStates,
  systemIds,
  systemStates,
} from './devices.js';
import { CAMERA_IMAGE_MAX_BYTES, WIDGET_IMAGE_MAX_BYTES, cameraImage, fitJpeg } from './images.js';
import { IssueLog } from './issues.js';
import {
  COMMAND_TEXT,
  CONNECTION_TEXT,
  ERROR_TEXT,
  REPORT_TEXT,
  UserError,
  allLanguages,
  reasonOf,
} from './texts.js';

const logger = createLogger({ name: 'blink' });

export const WIDGET_KEY = 'blink';

// Scene trigger keys (manifest `scene_triggers`): permanent once published.
export const TRIGGERS = Object.freeze({
  MOTION: 'motion_detected',
  DOORBELL: 'doorbell_pressed',
});

export const HUB_TIMINGS = {
  // "Motion detected" stays on this long after a clip (at least two readings).
  motionWindowMs: 2 * 60_000,
  // Clips older than this when first seen fire no event (a late upload, a restart).
  maxEventAgeMs: 15 * 60_000,
  // media/changed is asked since the last reading minus this overlap.
  mediaOverlapMs: 5 * 60_000,
  // A camera takes at most one snapshot per… (each one wakes it: battery).
  snapshotGapMs: 60_000,
  // An automatic sign-in (no session, a session refused) at most once per…:
  // each one may make Blink send a verification code.
  autoLoginGapMs: 60 * 60_000,
  // Unchanged values are sent again this often ("no recent value" otherwise).
  heartbeatMs: 12 * 60 * 60_000,
  // After a 429, the interval is multiplied, up to this.
  maxBackoffMs: 15 * 60_000,
};

const MAX_SEEN_MEDIA = 500;

const imageKeyOf = (camera, path) =>
  `cam-${createHash('sha1').update(`${camera.key}|${path}`).digest('hex').slice(0, 16)}`;

export class BlinkHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} options.store persistence (src/store.js)
   * @param {Function} [options.request] HTTP seam (src/blink/http.js)
   * @param {boolean} [options.timers] periodic timer (off in tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {object} [options.clientTimings] CLIENT_TIMINGS overrides
   * @param {() => number} [options.now]
   */
  constructor({ gladys, store, request, timers = true, timings, clientTimings, now }) {
    this.gladys = gladys;
    this.store = store;
    this.request = request;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.clientTimings = clientTimings;
    this.now = now ?? (() => Date.now());
    this.auth = new BlinkAuth({ request, now: this.now });
    this.config = null;
    this.saved = {};
    this.client = null;
    /** 'no_credentials' | 'signed_out' | 'code_required' | 'connected' */
    this.status = 'signed_out';
    this.model = null;
    this.devicesSignature = null;
    this.media = { since: null, seen: new Set(), lastMotion: new Map(), ringing: new Set() };
    /** Last thumbnail of each camera: { path, camera (≤ 150 KB), widget (≤ 300 KB), key }. */
    this.images = new Map();
    this.lastSnapshotAt = new Map();
    this.lastRefreshAt = null;
    this.refreshing = null;
    this.backoff = 1;
    this.timer = null;
    this.stopped = false;
    this.connectionKey = null;
    this.issues = new IssueLog(logger);
  }

  get language() {
    return this.config?.language ?? 'fr';
  }

  get periodMs() {
    return Math.min(this.config.refreshIntervalMs * this.backoff, this.timings.maxBackoffMs);
  }

  // --- Lifecycle -----------------------------------------------------------------

  async start(config) {
    this.saved = await this.store.load();
    const hardwareId = validHardwareId(this.saved.hardwareId);
    if (hardwareId !== this.saved.hardwareId) {
      this.saved = { hardwareId };
      this.save();
    }
    logger.info('Blink integration started');
    await this.reconfigure(config);
  }

  /** Gladys reconnected (it restarted): send everything again. */
  async resync(config) {
    this.gladys.forgetPublishedStates();
    this.devicesSignature = null;
    this.connectionKey = null;
    this.images.forEach((image) => {
      image.published = new Set();
    });
    await this.reconfigure(config);
  }

  async reconfigure(config) {
    const previous = this.config;
    this.config = config;
    if (!hasCredentials(config)) {
      this.dropSession();
      this.status = 'no_credentials';
      this.model = null;
      await this.publishDevices();
      await this.reportConnection(false, CONNECTION_TEXT.noCredentials, 'no_credentials');
      this.schedule();
      return;
    }
    const fingerprint = accountFingerprint(config.email);
    if (this.saved.account && this.saved.account !== fingerprint) {
      // Another account: the stored session is not its own.
      logger.info('Blink account changed in the configuration: new sign-in');
      this.dropSession();
      this.saved = { hardwareId: this.saved.hardwareId };
      this.save();
    }
    const credentialsChanged =
      previous && (previous.email !== config.email || previous.password !== config.password);
    if (!this.client && this.saved.session) {
      this.useSession(this.saved.session);
    }
    if (this.client) {
      await this.refresh();
    } else if (this.status !== 'code_required' || credentialsChanged) {
      await this.autoLogin({ force: Boolean(credentialsChanged) });
    }
    this.schedule();
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.timer = null;
    await this.store.flush();
  }

  save() {
    return this.store.save(this.saved);
  }

  schedule() {
    clearTimeout(this.timer);
    this.timer = null;
    if (!this.timersEnabled || this.stopped) {
      return;
    }
    this.timer = setTimeout(async () => {
      this.timer = null;
      try {
        await this.tick();
      } catch (err) {
        this.issues.fail('tick', `Reading cycle failed: ${err.message}`, 'error');
      } finally {
        this.schedule();
      }
    }, this.periodMs);
  }

  /** One timer cycle: read the account, or sign in again when allowed. */
  async tick() {
    if (this.gladys.connected === false) {
      logger.debug('Gladys unreachable: reading skipped');
      return;
    }
    if (this.client) {
      await this.refresh();
    } else if (this.status === 'signed_out') {
      await this.autoLogin();
    }
    this.issues.recover('tick');
  }

  // --- Session ----------------------------------------------------------------------

  useSession(session) {
    try {
      this.client = new BlinkClient({
        session: { ...session, hardwareId: this.saved.hardwareId },
        onSession: (renewed) => this.storeSession(renewed),
        request: this.request,
        auth: this.auth,
        now: this.now,
        timings: this.clientTimings,
      });
    } catch {
      this.client = null;
      this.saved.session = null;
      this.save();
    }
  }

  storeSession({ accessToken, refreshToken, expiresAt, tier, accountId }) {
    this.saved = {
      ...this.saved,
      account: accountFingerprint(this.config.email),
      session: { accessToken, refreshToken, expiresAt, tier, accountId },
    };
    this.save();
  }

  dropSession() {
    this.client = null;
    if (this.saved.session) {
      this.saved.session = null;
      this.save();
    }
  }

  /** Sign in by itself (no session yet, or refused), at most once per hour. */
  async autoLogin({ force = false } = {}) {
    const last = this.saved.lastAutoLoginAt ?? 0;
    if (!force && this.now() - last < this.timings.autoLoginGapMs) {
      logger.debug('Automatic sign-in skipped: tried less than an hour ago');
      await this.reportConnection(false, CONNECTION_TEXT.signIn, 'sign_in');
      this.status = 'signed_out';
      return;
    }
    this.saved.lastAutoLoginAt = this.now();
    this.save();
    try {
      await this.login();
    } catch {
      // Logged and reported by login().
    }
  }

  /**
   * Steps 1 to 3 of the sign-in (src/blink/auth.js).
   * @returns {Promise<'connected'|'code_required'>}
   * @throws {BlinkError}
   */
  async login() {
    const { email, password } = this.config;
    try {
      const result = await this.auth.login({
        email,
        password,
        hardwareId: this.saved.hardwareId,
      });
      if (result.codeRequired) {
        this.dropSession();
        this.status = 'code_required';
        logger.info('Blink asks for a verification code (sent by e-mail or SMS)');
        await this.reportConnection(false, CONNECTION_TEXT.codeRequired, 'code_required');
        return 'code_required';
      }
      await this.signedIn(result.tokens);
      return 'connected';
    } catch (err) {
      await this.loginFailed(err);
      throw err;
    }
  }

  /** Step 4: the code the user received. */
  async verifyCode(code) {
    try {
      const tokens = await this.auth.verifyCode(code);
      await this.signedIn(tokens);
    } catch (err) {
      if (err.kind !== ERROR_KINDS.CODE_INVALID) {
        await this.loginFailed(err);
      } else {
        logger.warn(`Blink sign-in: ${err.message}`);
      }
      throw err;
    }
  }

  async signedIn(tokens) {
    const { tier, accountId } = await this.auth.tierInfo(tokens.accessToken);
    this.storeSession({ ...tokens, tier, accountId });
    this.useSession(this.saved.session);
    this.status = 'connected';
    this.issues.recover('session');
    await this.refresh();
    if (this.model) {
      logger.info(
        `Signed in to Blink: ${this.model.systems.length} system(s), ${this.model.cameras.length} camera(s)`,
      );
    }
  }

  async loginFailed(err) {
    if (!(err instanceof BlinkError)) {
      this.issues.fail('login', `Blink sign-in failed: ${err.message}`, 'error');
      return;
    }
    this.status = 'signed_out';
    this.issues.fail('login', `Blink sign-in failed: ${err.message}`);
    await this.reportConnection(
      false,
      allLanguages((language) => REPORT_TEXT[language].failed(reasonOf(err, language))),
      `login:${err.kind}`,
    );
  }

  /** The connection status of the Configuration screen, sent when it changes. */
  async reportConnection(connected, message, key) {
    const statusKey = `${connected}:${key}`;
    if (this.connectionKey === statusKey) {
      return;
    }
    this.connectionKey = statusKey;
    try {
      await this.gladys.setConnectionStatus(connected, message);
    } catch (err) {
      this.connectionKey = null;
      logger.debug(`Connection status not sent: ${err.message}`);
    }
  }

  // --- Reading the account -------------------------------------------------------------

  /** Read the account now (shared by concurrent callers). */
  refresh() {
    if (!this.client) {
      return Promise.resolve(false);
    }
    this.refreshing ??= this.read().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  /**
   * Read the account after a command: a reading already in progress started
   * before it, so wait for it and read again.
   */
  async refreshAfterCommand() {
    await this.refreshing?.catch(() => {});
    return this.refresh();
  }

  /** The core's onPoll (fallback): read unless the timer just did. */
  async pollFromCore() {
    if (this.lastRefreshAt !== null && this.now() - this.lastRefreshAt < this.periodMs * 0.9) {
      logger.debug('onPoll: read less than a period ago, skipped');
      return;
    }
    await this.refresh();
  }

  async read() {
    const client = this.client;
    this.lastRefreshAt = this.now();
    let model;
    let clips;
    try {
      model = parseHomescreen(await client.homescreen(), client.accountId);
      clips = await this.readMedia(client);
    } catch (err) {
      await this.readFailed(err);
      return false;
    }
    if (client !== this.client) {
      return false; // signed out meanwhile
    }
    if (this.issues.recover('read', 'Blink cloud answers again')) {
      this.backoff = 1;
    }
    this.status = 'connected';
    this.model = model;
    await this.reportConnection(true, undefined, 'connected');
    await this.publishDevices();
    const events = this.applyClips(clips);
    const imagesChanged = await this.updateImages(client);
    await this.publishStates();
    await this.publishImages();
    await this.fireEvents(events);
    if (imagesChanged || events.length > 0 || this.modelChanged()) {
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }
    return true;
  }

  /** New clips since the last reading (the first reading only learns them). */
  async readMedia(client) {
    const now = this.now();
    const first = this.media.since === null;
    const since = first ? now - this.timings.maxEventAgeMs : this.media.since;
    const answer = await client.mediaChanged(new Date(since).toISOString());
    this.media.since = now - this.timings.mediaOverlapMs;
    const clips = [];
    for (const clip of parseMedia(answer)) {
      if (this.media.seen.has(clip.id)) {
        continue;
      }
      this.media.seen.add(clip.id);
      if (!first && clip.event && now - clip.createdAt <= this.timings.maxEventAgeMs) {
        clips.push(clip);
      }
    }
    // Bounded memory: the oldest ids go first (a Set keeps insertion order).
    while (this.media.seen.size > MAX_SEEN_MEDIA) {
      this.media.seen.delete(this.media.seen.values().next().value);
    }
    return clips;
  }

  /** @returns {object[]} the scene events to fire */
  applyClips(clips) {
    const events = [];
    for (const clip of clips) {
      const camera = cameraOfMedia(this.model.cameras, clip);
      if (!camera) {
        logger.debug(`Clip ${clip.id} of an unknown device ignored`);
        continue;
      }
      const isRing = clip.event === MEDIA_EVENTS.RING && camera.kind === KINDS.DOORBELL;
      logger.debug(`${camera.name}: ${isRing ? 'doorbell pressed' : 'motion'} (${clip.source})`);
      if (isRing) {
        this.media.ringing.add(camera.key);
        events.push({ key: TRIGGERS.DOORBELL, camera });
      } else {
        const last = this.media.lastMotion.get(camera.key) ?? 0;
        this.media.lastMotion.set(camera.key, Math.max(last, clip.createdAt, this.now()));
        events.push({ key: TRIGGERS.MOTION, camera });
      }
    }
    return events;
  }

  motionOf(camera) {
    const last = this.media.lastMotion.get(camera.key);
    return last !== undefined && this.now() - last < this.timings.motionWindowMs;
  }

  modelChanged() {
    const signature = JSON.stringify([
      this.model?.systems.map((s) => [s.id, s.name, s.armed, s.syncModule?.online]),
      this.model?.cameras.map((c) => [c.key, c.name, c.online, c.battery, c.motionEnabled]),
      this.model?.cameras.filter((camera) => this.motionOf(camera)).map((camera) => camera.key),
    ]);
    const changed = signature !== this.widgetSignature;
    this.widgetSignature = signature;
    return changed;
  }

  async readFailed(err) {
    if (!(err instanceof BlinkError)) {
      this.issues.fail('read', `Reading the Blink account failed: ${err.message}`, 'error');
      return;
    }
    if (err.kind === ERROR_KINDS.SESSION_EXPIRED) {
      this.issues.fail('session', 'Blink session refused: a new sign-in is needed');
      this.dropSession();
      this.status = 'signed_out';
      await this.reportConnection(false, ERROR_TEXT[ERROR_KINDS.SESSION_EXPIRED], 'session');
      await this.autoLogin();
      return;
    }
    if (err.kind === ERROR_KINDS.RATE_LIMIT) {
      this.backoff = Math.min(this.backoff * 2, 16);
    }
    this.issues.fail('read', `Reading the Blink account failed: ${err.message}`);
    await this.reportConnection(false, ERROR_TEXT[err.kind] ?? ERROR_TEXT.http, `read:${err.kind}`);
  }

  // --- Devices and states ---------------------------------------------------------------

  async publishDevices() {
    const devices = this.model ? buildDevices(this.gladys, this.model, this.language) : [];
    const signature = JSON.stringify(devices);
    if (signature === this.devicesSignature) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.devicesSignature = signature;
      this.issues.recover('discovery', 'Devices published to Gladys again');
    } catch (err) {
      this.issues.fail('discovery', `Devices refused by Gladys: ${err.message}`);
    }
  }

  /** "Search" in the Discovery tab. */
  async rediscover() {
    this.devicesSignature = null;
    if (this.client) {
      await this.refresh();
    }
    await this.publishDevices();
  }

  createdIds() {
    return new Set((this.gladys.devices ?? []).map((device) => device.external_id));
  }

  /** Every known state of the devices added to Gladys, only the changes. */
  async publishStates() {
    if (!this.model) {
      return;
    }
    const created = this.createdIds();
    const states = [];
    const rings = [];
    for (const system of this.model.systems) {
      if (created.has(systemIds(this.gladys, system.id).device)) {
        states.push(...systemStates(this.gladys, system));
      }
    }
    for (const camera of this.model.cameras) {
      const ids = cameraIds(this.gladys, camera);
      if (!created.has(ids.device)) {
        continue;
      }
      states.push(...cameraStates(this.gladys, camera, { motion: this.motionOf(camera) }));
      if (camera.kind === KINDS.DOORBELL) {
        rings.push(ids.feature(FEATURES.RING), this.media.ringing.has(camera.key));
      }
    }
    try {
      await this.gladys.publishChangedStates(states, { heartbeat: this.timings.heartbeatMs });
      await this.publishRings(rings);
      this.issues.recover('states', 'States accepted by Gladys again');
    } catch (err) {
      this.issues.fail('states', `States refused by Gladys: ${err.message}`);
    }
  }

  /**
   * The doorbell button is a pulse: 1 when pressed, 0 at the next reading.
   * Sent outside publishChangedStates and without heartbeat: Gladys shows
   * the time of the last value as "last ring", a heartbeat would fake one.
   */
  async publishRings(pairs) {
    this.ringState ??= new Map();
    const states = [];
    for (let i = 0; i < pairs.length; i += 2) {
      const [externalId, ringing] = [pairs[i], pairs[i + 1]];
      const value = ringing ? 1 : 0;
      if (
        this.ringState.get(externalId) !== value &&
        (ringing || this.ringState.get(externalId) === 1)
      ) {
        states.push({ device_feature_external_id: externalId, state: value });
      }
    }
    if (states.length > 0) {
      await this.gladys.publishStates(states);
      for (const { device_feature_external_id: id, state } of states) {
        this.ringState.set(id, state);
      }
    }
    this.media.ringing.clear();
  }

  /** The user added a device: its states sent before were dropped by Gladys. */
  async onDeviceCreated(device) {
    this.gladys.forgetPublishedStates(device.external_id);
    for (const image of this.images.values()) {
      image.published?.delete(device.external_id);
    }
    await this.publishStates();
    await this.publishImages();
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  // --- Images ---------------------------------------------------------------------------

  /** Download the thumbnails whose path changed. @returns {Promise<boolean>} */
  async updateImages(client) {
    let changed = false;
    for (const camera of this.model.cameras) {
      const current = this.images.get(camera.key);
      if (!camera.thumbnail || current?.path === camera.thumbnail) {
        continue;
      }
      try {
        const bytes = await client.thumbnail(camera.thumbnail);
        const forWidget = fitJpeg(bytes, WIDGET_IMAGE_MAX_BYTES);
        const forCamera = forWidget && fitJpeg(forWidget, CAMERA_IMAGE_MAX_BYTES);
        if (!forCamera || !forWidget) {
          throw new Error(`not a usable JPEG (${bytes.length} bytes)`);
        }
        this.images.set(camera.key, {
          path: camera.thumbnail,
          camera: forCamera,
          widget: forWidget,
          key: imageKeyOf(camera, camera.thumbnail),
          published: new Set(),
        });
        changed = true;
        this.issues.recover(`image:${camera.key}`);
      } catch (err) {
        this.issues.fail(
          `image:${camera.key}`,
          `${camera.name}: thumbnail not read (${err.message})`,
        );
        if (err.kind === ERROR_KINDS.SESSION_EXPIRED) {
          throw err;
        }
      }
    }
    return changed;
  }

  /** Send each new image once to the camera devices added to Gladys. */
  async publishImages() {
    if (!this.model) {
      return;
    }
    const created = this.createdIds();
    for (const camera of this.model.cameras) {
      const image = this.images.get(camera.key);
      const { device } = cameraIds(this.gladys, camera);
      if (!image || !created.has(device) || image.published.has(device)) {
        continue;
      }
      try {
        await this.gladys.publishCameraImage(device, cameraImage(image.camera));
        image.published.add(device);
      } catch (err) {
        this.issues.fail('camera-image', `Image refused by Gladys: ${err.message}`);
      }
    }
  }

  /** Gladys asks for an image (dashboard, chat): the last thumbnail, never a capture. */
  async getImage(device) {
    const camera = this.findCamera(device.external_id);
    let image = camera ? this.images.get(camera.key) : null;
    if (!image && camera && this.client) {
      await this.refresh();
      image = this.images.get(camera.key);
    }
    if (!image) {
      throw new Error('No image of this camera yet');
    }
    return cameraImage(image.camera);
  }

  /** The raw base64 of a widget image key. */
  widgetImage(imageKey) {
    for (const image of this.images.values()) {
      if (image.key === imageKey) {
        return image.widget.toString('base64');
      }
    }
    throw new Error('Unknown image');
  }

  // --- Events --------------------------------------------------------------------------

  async fireEvents(events) {
    for (const { key, camera } of events) {
      const system = this.model.systems.find((s) => s.id === camera.networkId);
      const data = {
        device: cameraIds(this.gladys, camera).device,
        camera: camera.name,
        system: system?.name ?? null,
      };
      try {
        await this.gladys.publishSceneEvent(key, data);
      } catch (err) {
        this.issues.fail(`event:${key}`, `Scene event ${key} refused by Gladys: ${err.message}`);
      }
    }
  }

  // --- Lookups ---------------------------------------------------------------------------

  findSystem(externalId) {
    return (
      this.model?.systems.find(
        (system) => systemIds(this.gladys, system.id).device === externalId,
      ) ?? null
    );
  }

  findCamera(externalId) {
    return (
      this.model?.cameras.find((camera) => cameraIds(this.gladys, camera).device === externalId) ??
      null
    );
  }

  /** The system of a device: the system itself, or the one of a camera. */
  systemOf(externalId) {
    const system = this.findSystem(externalId);
    if (system) {
      return system;
    }
    const camera = this.findCamera(externalId);
    return camera ? (this.model.systems.find((s) => s.id === camera.networkId) ?? null) : null;
  }

  // --- Commands (widget, scene actions) ----------------------------------------------------

  requireClient() {
    if (!this.client || !this.model) {
      throw new UserError(
        allLanguages((l) => COMMAND_TEXT[l].notConnected),
        this.language,
      );
    }
    return this.client;
  }

  async run(command) {
    try {
      await command();
    } catch (err) {
      if (err instanceof BlinkError) {
        logger.warn(`Blink command failed: ${err.message}`);
        if (err.kind === ERROR_KINDS.SESSION_EXPIRED) {
          await this.readFailed(err);
        }
        throw new UserError(
          allLanguages((l) => COMMAND_TEXT[l].failed(reasonOf(err, l))),
          this.language,
        );
      }
      throw err;
    }
  }

  /**
   * Arm or disarm a system.
   * @param {string} externalId the system device, or one of its cameras
   * @returns {Promise<{ text: object, system: object }>}
   */
  async setArmed(externalId, armed) {
    const client = this.requireClient();
    const system = this.systemOf(externalId);
    if (!system) {
      throw new UserError(
        allLanguages((l) => COMMAND_TEXT[l].unknown),
        this.language,
      );
    }
    await this.run(() => client.setArmed(system.id, armed));
    logger.info(`${system.name}: ${armed ? 'armed' : 'disarmed'} from Gladys`);
    await this.refreshAfterCommand();
    return {
      system,
      text: allLanguages((l) => COMMAND_TEXT[l][armed ? 'armed' : 'disarmed'](system.name)),
    };
  }

  /** Turn the motion detection of a camera on or off. */
  async setMotionDetection(externalId, enabled) {
    const client = this.requireClient();
    const camera = this.findCamera(externalId);
    if (!camera) {
      throw new UserError(
        allLanguages((l) => COMMAND_TEXT[l].unknown),
        this.language,
      );
    }
    await this.run(() => client.setMotionDetection(camera, enabled));
    logger.info(`${camera.name}: motion detection ${enabled ? 'on' : 'off'} from Gladys`);
    await this.refreshAfterCommand();
    return allLanguages((l) => COMMAND_TEXT[l][enabled ? 'motionOn' : 'motionOff'](camera.name));
  }

  /**
   * A new image, asked by the user (never automatic: it wakes the camera and
   * costs battery). At most one per camera per minute.
   */
  async snapshot(externalId) {
    const client = this.requireClient();
    const camera = this.findCamera(externalId);
    if (!camera) {
      throw new UserError(
        allLanguages((l) => COMMAND_TEXT[l].unknown),
        this.language,
      );
    }
    const last = this.lastSnapshotAt.get(camera.key);
    if (last !== undefined && this.now() - last < this.timings.snapshotGapMs) {
      const seconds = Math.ceil((this.timings.snapshotGapMs - (this.now() - last)) / 1000);
      throw new UserError(
        allLanguages((l) => COMMAND_TEXT[l].tooSoon(camera.name, seconds)),
        this.language,
      );
    }
    this.lastSnapshotAt.set(camera.key, this.now());
    await this.run(() => client.snapshot(camera));
    logger.info(`${camera.name}: new image asked from Gladys`);
    await this.refreshAfterCommand();
    return allLanguages((l) => COMMAND_TEXT[l].snapshot(camera.name));
  }

  // --- Configuration actions ---------------------------------------------------------------

  /** "Sign in": a new sign-in now (Blink may send a code). */
  async connectAction() {
    if (!hasCredentials(this.config)) {
      return CONNECTION_TEXT.noCredentials;
    }
    logger.info('Sign-in asked from the Configuration screen');
    try {
      const result = await this.login();
      if (result === 'code_required') {
        return allLanguages((l) => REPORT_TEXT[l].codeSent);
      }
      return this.connectedReport();
    } catch (err) {
      return allLanguages((l) => REPORT_TEXT[l].failed(reasonOf(err, l)));
    }
  }

  /** "Enter the code": finish the sign-in. */
  async codeAction(rawCode) {
    const code = String(rawCode ?? '').replace(/\s+/g, '');
    if (!code) {
      return allLanguages((l) => REPORT_TEXT[l].codeEmpty);
    }
    logger.info('Verification code typed in the Configuration screen');
    try {
      await this.verifyCode(code);
      return this.connectedReport();
    } catch (err) {
      return allLanguages((l) => REPORT_TEXT[l].failed(reasonOf(err, l)));
    }
  }

  connectedReport() {
    const systems = this.model?.systems.length ?? 0;
    const cameras = this.model?.cameras.length ?? 0;
    return allLanguages((l) => REPORT_TEXT[l].connected(systems, cameras));
  }
}
