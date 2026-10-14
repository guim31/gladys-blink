// -----------------------------------------------------------------------------
// Scene actions (manifest `scene_actions`, Gladys 5.1+). The real uses:
//   - follow the Gladys alarm: "when the house alarm is armed, arm Blink",
//     "when I come home, disarm Blink" (set_arming);
//   - stop recording the garden while the family is outside (set_motion_detection);
//   - "when the doorbell rings, take a new image of the entrance and send it
//     to me" (take_snapshot, then the core's "send a camera image" action:
//     the image is published on the camera device).
// Throwing fails this action only: the message reaches the scene logs.
// Never a scene event from here (a scene bound to it would loop).
// -----------------------------------------------------------------------------

export const SCENE_ACTIONS = {
  async set_arming(hub, { fields }) {
    const armed = fields.mode === 'arm';
    await hub.setArmed(fields.system, armed);
    return { armed };
  },

  async set_motion_detection(hub, { fields }) {
    const enabled = fields.state === 'on';
    await hub.setMotionDetection(fields.camera, enabled);
    return { enabled };
  },

  async take_snapshot(hub, { fields }) {
    await hub.snapshot(fields.camera);
    return { captured: true };
  },
};
