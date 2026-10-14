// -----------------------------------------------------------------------------
// From the answers of the Blink cloud to a plain model: systems (Blink
// "networks", armed or not, with their Sync Module) and cameras (outdoor and
// indoor cameras, Minis, doorbells), plus the classification of the clips of
// `media/changed`. Field names as in the real answers kept in
// test/fixtures/blink/ (and blinkpy's camera.py, sync_module.py).
// -----------------------------------------------------------------------------

import { BLINK_DOMAIN, KINDS } from './client.js';

// `status` of a camera or a sync module (blinkpy ONLINE).
const ONLINE = { online: true, done: true, offline: false };

const toId = (value) => (value === null || value === undefined ? null : String(value));
const text = (value, fallback) =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback;
const finite = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** Blink reports temperatures in °F (blinkpy temperature_c). */
export function fahrenheitToCelsius(value) {
  const f = finite(value);
  return f === null ? null : Math.round(((f - 32) * 50) / 9) / 10;
}

/** `ok` / `low`, the battery state Blink gives (not a percentage). */
function batteryState(device) {
  const raw = device.battery_state ?? device.battery;
  if (typeof raw !== 'string') {
    return null;
  }
  const value = raw.toLowerCase();
  return value === 'ok' || value === 'low' ? value : null;
}

/** Wi-Fi signal in bars, 0 to 5. */
function wifiBars(device) {
  const value = finite(device.signals?.wifi) ?? finite(device.wifi_strength);
  return value !== null && value >= 0 && value <= 5 ? Math.round(value) : null;
}

/**
 * The path of a thumbnail, relative to the regional REST server. The
 * homescreen gives a path (old API: without extension), a full v3 path
 * (`…thumbnail.jpg?ts=…&ext=`), or only a timestamp (blinkpy update_images).
 * Anything that would lead outside the Blink cloud is refused (null).
 */
export function thumbnailPath(raw, { accountId, networkId, productType, id }) {
  if (typeof raw === 'number' || (typeof raw === 'string' && /^\d+$/.test(raw))) {
    if (!accountId || !networkId || !productType || !id || !/^[a-z0-9_-]+$/i.test(productType)) {
      return null;
    }
    return (
      `/api/v3/media/accounts/${accountId}/networks/${networkId}/${productType}/${id}` +
      `/thumbnail/thumbnail.jpg?ts=${raw}&ext=`
    );
  }
  if (typeof raw !== 'string' || raw.trim() === '') {
    return null;
  }
  let path = raw.trim();
  if (/^https:\/\//i.test(path)) {
    let url;
    try {
      url = new URL(path);
    } catch {
      return null;
    }
    if (!url.hostname.endsWith(`.${BLINK_DOMAIN}`)) {
      return null;
    }
    path = `${url.pathname}${url.search}`;
  }
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('..')) {
    return null;
  }
  if (path.endsWith('&ext=') || /\.jpe?g(\?|$)/i.test(path)) {
    return path;
  }
  return `${path}.jpg`;
}

function camera(raw, kind, accountId) {
  const id = toId(raw.id);
  const networkId = toId(raw.network_id);
  if (!id || !networkId) {
    return null;
  }
  const signals = raw.signals && typeof raw.signals === 'object' ? raw.signals : {};
  const temperatureF = finite(signals.temp) ?? finite(raw.temperature);
  return {
    key: `${kind}:${id}`,
    kind,
    id,
    networkId,
    name: text(raw.name, `Blink ${id}`),
    serial: text(raw.serial, null),
    productType: text(raw.type, null),
    firmware: raw.fw_version === undefined ? null : String(raw.fw_version),
    motionEnabled: typeof raw.enabled === 'boolean' ? raw.enabled : null,
    online: raw.status in ONLINE ? ONLINE[raw.status] : null,
    battery: kind === KINDS.MINI ? null : batteryState(raw),
    wifi: wifiBars(raw),
    // Only the battery cameras report a temperature (the Mini has no sensor).
    temperature: kind === KINDS.CAMERA ? fahrenheitToCelsius(temperatureF) : null,
    thumbnail: thumbnailPath(raw.thumbnail, {
      accountId,
      networkId,
      productType: text(raw.type, null),
      id,
    }),
  };
}

/**
 * @param {object} homescreen answer of GET /api/v3/accounts/{id}/homescreen
 * @param {string} accountId
 * @returns {{ systems: object[], cameras: object[] }}
 */
export function parseHomescreen(homescreen, accountId) {
  const list = (key) => (Array.isArray(homescreen?.[key]) ? homescreen[key] : []);
  const syncModules = new Map();
  for (const sync of list('sync_modules')) {
    const networkId = toId(sync.network_id);
    if (networkId && !syncModules.has(networkId)) {
      syncModules.set(networkId, {
        id: toId(sync.id),
        serial: text(sync.serial, null),
        online: sync.status in ONLINE ? ONLINE[sync.status] : null,
        firmware: sync.fw_version === undefined ? null : String(sync.fw_version),
      });
    }
  }
  const cameras = [
    ...list('cameras').map((raw) => camera(raw, KINDS.CAMERA, accountId)),
    ...list('owls').map((raw) => camera(raw, KINDS.MINI, accountId)),
    ...list('doorbells').map((raw) => camera(raw, KINDS.DOORBELL, accountId)),
  ].filter(Boolean);
  const systems = list('networks')
    .map((raw) => {
      const id = toId(raw.id);
      if (!id) {
        return null;
      }
      return {
        id,
        name: text(raw.name, `Blink ${id}`),
        armed: typeof raw.armed === 'boolean' ? raw.armed : null,
        syncModule: syncModules.get(id) ?? null,
      };
    })
    .filter(Boolean);
  return { systems, cameras };
}

// What a clip says happened: `source` of a media/changed entry. "pir" is the
// motion sensor (documented); the doorbell button is matched by its words,
// since no public reference shows its exact value (see CLAUDE.md).
const IGNORED_SOURCES = /snapshot|thumbnail|liveview|live_view|manual/i;
const RING_SOURCES = /button|press|ring|ding|bell/i;

export const MEDIA_EVENTS = Object.freeze({ MOTION: 'motion', RING: 'ring' });

/** `motion`, `ring`, or null for a clip the user asked for (snapshot, live view). */
export function classifyMedia(item) {
  const source = typeof item?.source === 'string' ? item.source : '';
  if (IGNORED_SOURCES.test(source)) {
    return null;
  }
  return RING_SOURCES.test(source) ? MEDIA_EVENTS.RING : MEDIA_EVENTS.MOTION;
}

/** The device kind of a clip (`device` of media/changed). */
function mediaKind(device) {
  const value = typeof device === 'string' ? device.toLowerCase() : '';
  if (value === 'owl' || value === 'hawk') {
    return KINDS.MINI;
  }
  if (value === 'lotus' || value === 'doorbell') {
    return KINDS.DOORBELL;
  }
  return KINDS.CAMERA;
}

/**
 * The entries of a media/changed answer, oldest first.
 * @returns {{ id: string, createdAt: number, kind: string, deviceId: string, networkId: string, source: string|null, event: string|null }[]}
 */
export function parseMedia(answer) {
  const media = Array.isArray(answer?.media) ? answer.media : [];
  return media
    .map((item) => {
      const id = toId(item?.id);
      const createdAt = Date.parse(item?.created_at);
      const deviceId = toId(item?.device_id);
      if (!id || !Number.isFinite(createdAt) || !deviceId || item.deleted === true) {
        return null;
      }
      return {
        id,
        createdAt,
        kind: mediaKind(item.device),
        deviceId,
        networkId: toId(item.network_id),
        source: typeof item.source === 'string' ? item.source : null,
        event: classifyMedia(item),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.createdAt - b.createdAt);
}

/** The camera of a clip: same kind and id, else same id on the same system. */
export function cameraOfMedia(cameras, item) {
  return (
    cameras.find((cam) => cam.kind === item.kind && cam.id === item.deviceId) ??
    cameras.find(
      (cam) => cam.id === item.deviceId && (!item.networkId || cam.networkId === item.networkId),
    ) ??
    null
  );
}
