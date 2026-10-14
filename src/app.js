// -----------------------------------------------------------------------------
// Registers every SDK handler on a GladysIntegration (or the SDK's fake Gladys)
// and returns the hub, so index.js stays a few lines and the tests drive the
// very same wiring.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import { BlinkHub } from './hub.js';
import { SCENE_ACTIONS } from './scenes.js';
import { Store } from './store.js';
import { INIT_FAILED } from './texts.js';
import { WIDGETS } from './widgets.js';

const logger = createLogger({ name: 'blink-app' });

// Keys of the Configuration actions (manifest `actions`): permanent.
export const ACTION_KEYS = Object.freeze({ CONNECT: 'connect', CODE: 'verify_code' });

/**
 * @param {object} gladys GladysIntegration instance
 * @param {object} [options] test seams: store, request, timers, timings, clientTimings, now
 */
export function registerHandlers(gladys, options = {}) {
  const hub = new BlinkHub({
    gladys,
    store: options.store ?? new Store(),
    request: options.request,
    timers: options.timers ?? true,
    timings: options.timings,
    clientTimings: options.clientTimings,
    now: options.now,
  });

  // Resolved once the hub has started; every handler waits for it, so a
  // command arriving during the first reading is not lost.
  let resolveReady;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });
  let started = false;
  const whenReady =
    (fn) =>
    async (...args) => {
      await ready;
      return fn(...args);
    };

  gladys.on('connected', async () => {
    try {
      const config = normalizeConfig(await gladys.getConfig());
      if (started) {
        // A reconnection (Gladys restarted): send again what Gladys may have lost.
        await hub.resync(config);
        return;
      }
      started = true;
      await hub.start(config);
    } catch (err) {
      logger.error('Initialization failed', err);
      await gladys.setConnectionStatus(false, INIT_FAILED).catch(() => {});
    } finally {
      resolveReady();
    }
  });

  gladys.onScanRequest(whenReady(() => hub.rediscover()));

  // The hub reads the account on its own timer (GladysAssistant/Gladys#3198);
  // this only serves a Gladys that polls, and never reads twice a period.
  gladys.onPoll(whenReady(() => hub.pollFromCore()));

  gladys.onGetImage(whenReady((device) => hub.getImage(device)));

  gladys.onDeviceCreated(whenReady((device) => hub.onDeviceCreated(device)));
  gladys.onDeviceUpdated(whenReady((device) => hub.onDeviceCreated(device)));

  gladys.onConfigUpdated(
    whenReady(async (newConfig) => {
      await hub.reconfigure(normalizeConfig(newConfig));
    }),
  );

  gladys.onAction(
    ACTION_KEYS.CONNECT,
    whenReady(() => hub.connectAction()),
  );
  gladys.onAction(
    ACTION_KEYS.CODE,
    whenReady((fields = {}) => hub.codeAction(fields.code)),
  );

  for (const [key, handler] of Object.entries(SCENE_ACTIONS)) {
    gladys.onSceneAction(
      key,
      whenReady((fields) => handler(hub, { fields })),
    );
  }

  for (const [key, widget] of Object.entries(WIDGETS)) {
    gladys.onWidgetGet(
      key,
      whenReady((request) => widget.get(hub, request)),
    );
    gladys.onWidgetAction(
      key,
      whenReady((actionKey, params, context = {}) =>
        widget.action(hub, { actionKey, params, ...context }),
      ),
    );
  }
  gladys.onWidgetGetImage(whenReady((imageKey) => hub.widgetImage(imageKey)));

  return {
    hub,
    ready,
    stop: () => hub.stop(),
  };
}
