// -----------------------------------------------------------------------------
// The Gladys devices of a Blink account:
//   - one per system (Blink "network", usually a Sync Module): its arming
//     state, and whether the Sync Module is online;
//   - one per camera, Mini or doorbell: its last image, motion detected
//     (recently), motion detection on/off, and what the device reports
//     (battery state, Wi-Fi signal, temperature of the battery cameras, the
//     doorbell button).
//
// External ids are the Blink cloud ids (a network id, a camera id), which
// never change for a device: `system:<network id>`, `camera:<id>`,
// `mini:<id>`, `doorbell:<id>`. They are forever: never rename a key below.
//
// Every feature is read-only. Arming, motion detection and snapshots are
// commanded from the widget and the scene actions, on purpose: a `switch`
// feature would be exposed to Google Home and Alexa through Gladys Plus, and
// "turn everything off" would disarm the cameras (see CLAUDE.md).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CATEGORIES,
  DEVICE_FEATURE_TYPES as TYPES,
  DEVICE_FEATURE_UNITS as UNITS,
  DEVICE_POLL_FREQUENCIES,
} from '@gladysassistant/integration-sdk';
import { KINDS } from './blink/client.js';

export const SYSTEM_TYPE = 'system';

// Feature keys: part of the external ids, never renamed.
export const FEATURES = Object.freeze({
  ARMED: 'armed',
  SYNC_ONLINE: 'sync-online',
  IMAGE: 'image',
  MOTION: 'motion',
  MOTION_ENABLED: 'motion-enabled',
  TEMPERATURE: 'temperature',
  BATTERY_LOW: 'battery-low',
  WIFI: 'wifi',
  RING: 'ring',
});

// Feature names, in the language chosen in the configuration. Gladys keeps
// the name given at creation: these only name new devices.
export const NAMES = {
  en: {
    armed: 'Armed',
    syncOnline: 'Sync Module online',
    image: 'Image',
    motion: 'Motion detected',
    motionEnabled: 'Motion detection on',
    temperature: 'Temperature',
    batteryLow: 'Low battery',
    wifi: 'Wi-Fi signal',
    ring: 'Doorbell',
  },
  fr: {
    armed: 'Armement',
    syncOnline: 'Sync Module en ligne',
    image: 'Image',
    motion: 'Mouvement détecté',
    motionEnabled: 'Détection de mouvement activée',
    temperature: 'Température',
    batteryLow: 'Batterie faible',
    wifi: 'Signal Wi-Fi',
    ring: 'Sonnette',
  },
  de: {
    armed: 'Scharf geschaltet',
    syncOnline: 'Sync Module online',
    image: 'Bild',
    motion: 'Bewegung erkannt',
    motionEnabled: 'Bewegungserkennung an',
    temperature: 'Temperatur',
    batteryLow: 'Batterie schwach',
    wifi: 'WLAN-Signal',
    ring: 'Türklingel',
  },
  es: {
    armed: 'Armado',
    syncOnline: 'Sync Module en línea',
    image: 'Imagen',
    motion: 'Movimiento detectado',
    motionEnabled: 'Detección de movimiento activa',
    temperature: 'Temperatura',
    batteryLow: 'Batería baja',
    wifi: 'Señal wifi',
    ring: 'Timbre',
  },
};

// Every device is published with a poll frequency of the core's list, so a
// Gladys that does poll gets an answer (src/poller.js); the container does
// not count on it (GladysAssistant/Gladys#3198).
const POLLING = { should_poll: true, poll_frequency: DEVICE_POLL_FREQUENCIES.EVERY_MINUTES };

const binary = (name, externalId, category, type = TYPES.SENSOR.BINARY) => ({
  name,
  external_id: externalId,
  category,
  type,
  read_only: true,
  has_feedback: false,
  keep_history: true,
  min: 0,
  max: 1,
});

export const systemIds = (gladys, systemId) => gladys.externalIds(SYSTEM_TYPE, systemId);
export const cameraIds = (gladys, camera) => gladys.externalIds(camera.kind, camera.id);

/** The device of a Blink system. */
export function buildSystemDevice(gladys, system, language) {
  const names = NAMES[language] ?? NAMES.fr;
  const ids = systemIds(gladys, system.id);
  const features = [binary(names.armed, ids.feature(FEATURES.ARMED), CATEGORIES.INPUT)];
  if (system.syncModule) {
    features.push(binary(names.syncOnline, ids.feature(FEATURES.SYNC_ONLINE), CATEGORIES.INPUT));
  }
  return { name: system.name, external_id: ids.device, ...POLLING, features };
}

/** The device of a camera, a Mini or a doorbell. */
export function buildCameraDevice(gladys, camera, language) {
  const names = NAMES[language] ?? NAMES.fr;
  const ids = cameraIds(gladys, camera);
  const features = [
    {
      name: names.image,
      external_id: ids.feature(FEATURES.IMAGE),
      category: CATEGORIES.CAMERA,
      type: TYPES.CAMERA.IMAGE,
      read_only: true,
      has_feedback: false,
      // Images never go through the states history.
      keep_history: false,
      min: 0,
      max: 0,
    },
    binary(names.motion, ids.feature(FEATURES.MOTION), CATEGORIES.MOTION_SENSOR),
    binary(names.motionEnabled, ids.feature(FEATURES.MOTION_ENABLED), CATEGORIES.INPUT),
  ];
  if (camera.kind === KINDS.DOORBELL) {
    features.push(
      binary(names.ring, ids.feature(FEATURES.RING), CATEGORIES.DOORBELL, TYPES.DOORBELL.RING),
    );
  }
  if (camera.kind === KINDS.CAMERA) {
    features.push({
      name: names.temperature,
      external_id: ids.feature(FEATURES.TEMPERATURE),
      // The camera's own sensor, often outdoors: kept out of the room average.
      category: CATEGORIES.DEVICE_TEMPERATURE_SENSOR,
      type: TYPES.SENSOR.DECIMAL,
      unit: UNITS.CELSIUS,
      read_only: true,
      has_feedback: false,
      keep_history: true,
      min: -40,
      max: 70,
    });
  }
  if (camera.kind !== KINDS.MINI) {
    features.push(
      binary(names.batteryLow, ids.feature(FEATURES.BATTERY_LOW), CATEGORIES.BATTERY_LOW),
    );
    features.push({
      name: names.wifi,
      external_id: ids.feature(FEATURES.WIFI),
      category: CATEGORIES.SIGNAL,
      type: TYPES.SENSOR.INTEGER,
      read_only: true,
      has_feedback: false,
      keep_history: true,
      min: 0,
      max: 5,
    });
  }
  return { name: camera.name, external_id: ids.device, ...POLLING, features };
}

/** Every device of the model, systems first. */
export function buildDevices(gladys, model, language) {
  return [
    ...model.systems.map((system) => buildSystemDevice(gladys, system, language)),
    ...model.cameras.map((camera) => buildCameraDevice(gladys, camera, language)),
  ];
}

const bit = (value) => (value === null || value === undefined ? null : value ? 1 : 0);

/**
 * The states of a system, `{ device_feature_external_id, state }`, only the
 * known ones.
 */
export function systemStates(gladys, system) {
  const ids = systemIds(gladys, system.id);
  return [
    [FEATURES.ARMED, bit(system.armed)],
    [FEATURES.SYNC_ONLINE, system.syncModule ? bit(system.syncModule.online) : null],
  ]
    .filter(([, state]) => state !== null)
    .map(([key, state]) => ({ device_feature_external_id: ids.feature(key), state }));
}

/**
 * The states of a camera. `motion` is the hub's "recent motion" (0/1); the
 * doorbell button is a pulse sent by the hub, not a state of the model.
 */
export function cameraStates(gladys, camera, { motion }) {
  const ids = cameraIds(gladys, camera);
  const values = [
    [FEATURES.MOTION, bit(motion)],
    [FEATURES.MOTION_ENABLED, bit(camera.motionEnabled)],
  ];
  if (camera.kind === KINDS.CAMERA) {
    values.push([FEATURES.TEMPERATURE, camera.temperature]);
  }
  if (camera.kind !== KINDS.MINI) {
    values.push([
      FEATURES.BATTERY_LOW,
      camera.battery === null ? null : bit(camera.battery === 'low'),
    ]);
    values.push([FEATURES.WIFI, camera.wifi]);
  }
  return values
    .filter(([, state]) => state !== null && state !== undefined)
    .map(([key, state]) => ({ device_feature_external_id: ids.feature(key), state }));
}
