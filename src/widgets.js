// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `blink`.
//
// The use case: the tablet by the front door. Leaving: arm the system with
// one tap; coming back: disarm it (with a confirmation); in between, the last
// image of every camera, with a badge when one saw motion, and a "New image…"
// button that asks one camera for a fresh picture.
//
// Budget (8 components, 1 focal, 1 status, 4 buttons, 2 texts): one poster
// grid (the cameras, ≤ 12), one status list (the systems, armed or not), and
// three buttons (Arm, Disarm, New image…). The current arming state is shown
// by the check-circle icon on its button, never by the `primary` style
// (invisible in dark mode, GladysAssistant/Gladys#3153).
//
// Which system the buttons drive: the one chosen in the widget settings (a
// system or one of its cameras), else the only one of the account. With
// several systems and none chosen, the widget shows them all, without
// buttons, and says so.
//
// The "New image…" form (widget action fields, GladysAssistant/Gladys#3168)
// needs Gladys 5.2.0; an older Gladys sends the tap without the camera,
// answered by a message asking to update Gladys.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { cameraIds, systemIds } from './devices.js';
import { WIDGET_KEY } from './hub.js';
import { CONNECTION_TEXT, pick } from './texts.js';

// Action keys of the buttons: permanent once published (unique, the core
// drops a button whose key is taken).
export const ACTIONS = Object.freeze({
  ARM: 'arm',
  DISARM: 'disarm',
  SNAPSHOT: 'snapshot',
});

const ACTIVE_ICON = 'check-circle';
const MAX_CAMERAS = 12;
const MAX_SYSTEMS = 10;

export const TEXT = {
  notConnected: {
    en: 'Not signed in to Blink: see the Configuration screen of the integration.',
    fr: 'Non connecté à Blink : voir l’écran Configuration de l’intégration.',
    de: 'Nicht bei Blink angemeldet: Sieh dir die Konfiguration der Integration an.',
    es: 'Sin sesión en Blink: consulte la pantalla de configuración de la integración.',
  },
  noDevice: {
    en: 'No Blink system on this account.',
    fr: 'Aucun système Blink sur ce compte.',
    de: 'Kein Blink-System in diesem Konto.',
    es: 'No hay ningún sistema Blink en esta cuenta.',
  },
  // A caption: 80 characters at most.
  chooseSystem: {
    en: 'Several systems: choose one in the widget settings to arm it here.',
    fr: 'Plusieurs systèmes : choisissez-en un dans les réglages pour l’armer ici.',
    de: 'Mehrere Systeme: Wähle eines in den Einstellungen, um es scharf zu schalten.',
    es: 'Varios sistemas: elija uno en los ajustes del widget para armarlo aquí.',
  },

  unknown: {
    en: 'This Blink device is unknown: choose another one in the widget settings.',
    fr: 'Cet appareil Blink est inconnu : choisissez-en un autre dans les réglages du widget.',
    de: 'Dieses Blink-Gerät ist unbekannt: Wähle ein anderes in den Widget-Einstellungen.',
    es: 'Este dispositivo Blink es desconocido: elija otro en los ajustes del widget.',
  },
  updateGladys: {
    en: 'Update Gladys to 5.2.0 or later to choose the camera.',
    fr: 'Mettez Gladys à jour (5.2.0 ou plus) pour choisir la caméra.',
    de: 'Aktualisiere Gladys auf 5.2.0 oder neuer, um die Kamera zu wählen.',
    es: 'Actualice Gladys a la versión 5.2.0 o posterior para elegir la cámara.',
  },
  armed: { en: 'Armed', fr: 'Armé', de: 'Scharf', es: 'Armado' },
  disarmed: { en: 'Disarmed', fr: 'Désarmé', de: 'Unscharf', es: 'Desarmado' },
  waiting: { en: 'Waiting…', fr: 'En attente…', de: 'Warte…', es: 'Esperando…' },
  syncOffline: {
    en: 'Sync Module offline',
    fr: 'Sync Module hors ligne',
    de: 'Sync Module offline',
    es: 'Sync Module sin conexión',
  },
  arm: { en: 'Arm', fr: 'Armer', de: 'Scharf schalten', es: 'Armar' },
  disarm: { en: 'Disarm', fr: 'Désarmer', de: 'Unscharf', es: 'Desarmar' },
  snapshot: { en: 'New image…', fr: 'Nouvelle image…', de: 'Neues Bild…', es: 'Nueva imagen…' },
  camera: { en: 'Camera', fr: 'Caméra', de: 'Kamera', es: 'Cámara' },
  motion: { en: 'Motion', fr: 'Mouvement', de: 'Bewegung', es: 'Movimiento' },
  offline: { en: 'Offline', fr: 'Hors ligne', de: 'Offline', es: 'Sin conexión' },
  detectionOff: {
    en: 'Detection off',
    fr: 'Détection off',
    de: 'Erkennung aus',
    es: 'Detección off',
  },
  batteryLow: {
    en: 'Low battery',
    fr: 'Batterie faible',
    de: 'Batterie schwach',
    es: 'Batería baja',
  },
};

const t = (text, language) => pick(text, language);
const fit = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

function message(text, language) {
  return {
    ttl_seconds: 300,
    components: [{ type: 'text', variant: 'body', text: t(text, language) }],
  };
}

function cameraCard(hub, camera, language) {
  const image = hub.images.get(camera.key);
  const item = { title: fit(camera.name, 60) };
  if (image) {
    item.image = image.key;
  }
  if (camera.online === false) {
    item.badge = { text: t(TEXT.offline, language), color: WIDGET_COLORS.DANGER };
  } else if (hub.motionOf(camera)) {
    item.badge = { text: t(TEXT.motion, language), color: WIDGET_COLORS.WARNING };
  } else if (camera.motionEnabled === false) {
    item.badge = { text: t(TEXT.detectionOff, language), color: WIDGET_COLORS.NEUTRAL };
  }
  if (camera.battery === 'low') {
    item.subtitle = t(TEXT.batteryLow, language);
  }
  return item;
}

function systemRow(system, language) {
  const label = fit(system.name, 40);
  if (system.syncModule && system.syncModule.online === false) {
    return {
      label,
      icon: 'wifi-off',
      value: t(TEXT.syncOffline, language),
      color: WIDGET_COLORS.DANGER,
    };
  }
  if (system.armed === null) {
    return { label, icon: 'clock', value: t(TEXT.waiting, language), color: WIDGET_COLORS.NEUTRAL };
  }
  return system.armed
    ? { label, icon: 'shield', value: t(TEXT.armed, language), color: WIDGET_COLORS.SUCCESS }
    : {
        label,
        icon: 'shield-off',
        value: t(TEXT.disarmed, language),
        color: WIDGET_COLORS.NEUTRAL,
      };
}

/** The content of the widget. */
export function widgetContent(hub, { settings = {}, language = 'en' } = {}) {
  if (!hub.client || !hub.model) {
    return message(
      hub.status === 'code_required' ? CONNECTION_TEXT.codeRequired : TEXT.notConnected,
      language,
    );
  }
  const { systems, cameras } = hub.model;
  if (systems.length === 0) {
    return message(TEXT.noDevice, language);
  }
  let system = null;
  if (settings.system) {
    system = hub.systemOf(settings.system);
    if (!system) {
      return message(TEXT.unknown, language);
    }
  } else if (systems.length === 1) {
    [system] = systems;
  }

  const shown = (
    system ? cameras.filter((camera) => camera.networkId === system.id) : cameras
  ).slice(0, MAX_CAMERAS);
  const components = [];
  if (!system) {
    components.push({ type: 'text', variant: 'caption', text: t(TEXT.chooseSystem, language) });
  }
  if (shown.length > 0) {
    components.push({
      type: 'card-list',
      display: 'grid',
      items: shown.map((camera) => cameraCard(hub, camera, language)),
    });
  }
  components.push({
    type: 'status',
    items: (system ? [system] : systems).slice(0, MAX_SYSTEMS).map((s) => systemRow(s, language)),
  });
  if (system) {
    const params = { system: systemIds(hub.gladys, system.id).device };
    components.push(
      {
        type: 'button',
        label: t(TEXT.arm, language),
        icon: system.armed === true ? ACTIVE_ICON : 'shield',
        style: 'secondary',
        action: { key: ACTIONS.ARM, params },
      },
      {
        type: 'button',
        label: t(TEXT.disarm, language),
        icon: system.armed === false ? ACTIVE_ICON : 'shield-off',
        style: 'secondary',
        action: { key: ACTIONS.DISARM, params, confirm: true },
      },
    );
  }
  if (shown.length > 0) {
    components.push({
      type: 'button',
      label: t(TEXT.snapshot, language),
      icon: 'camera',
      style: 'secondary',
      action: {
        key: ACTIONS.SNAPSHOT,
        fields: [
          {
            key: 'camera',
            type: 'select',
            required: true,
            // Form labels are multi-language objects (a plain string drops the button).
            label: TEXT.camera,
            default: cameraIds(hub.gladys, shown[0]).device,
            options: shown.map((camera) => ({
              value: cameraIds(hub.gladys, camera).device,
              label: { en: fit(camera.name, 60) },
            })),
          },
        ],
      },
    });
  }
  return { ttl_seconds: 120, components };
}

export const WIDGETS = {
  [WIDGET_KEY]: {
    async get(hub, request = {}) {
      return widgetContent(hub, request);
    },

    // Resolve a toast (multi-language object, ≤ 200 characters). After a
    // successful action the core drops the cached content and every open
    // dashboard refetches it.
    async action(hub, { actionKey, params = {}, values }) {
      if (actionKey === ACTIONS.ARM || actionKey === ACTIONS.DISARM) {
        const { text } = await hub.setArmed(params.system, actionKey === ACTIONS.ARM);
        return text;
      }
      if (actionKey === ACTIONS.SNAPSHOT) {
        if (!values?.camera) {
          return TEXT.updateGladys;
        }
        return hub.snapshot(values.camera);
      }
      throw new Error(`Unknown widget action: ${actionKey}`);
    },
  },
};
