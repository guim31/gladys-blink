# Blink cloud answers

Real answers of the Blink cloud, as published by
[homebridge-blink-for-home](https://github.com/colinbendell/homebridge-blink-for-home)
(`src/blink-api.sample.js`, MIT, © 2020 Colin Bendell). Their ids, serials and
names were already replaced by placeholders upstream; here, the last real-looking
values were replaced too (a network id, an account id in a thumbnail path, a
public IP address now in `192.0.2.0/24`).

| File                    | Endpoint                                                       | Source                    |
| ----------------------- | -------------------------------------------------------------- | ------------------------- |
| `homescreen.json`       | `GET /api/v3/accounts/{account}/homescreen`                    | `HOMESCREEN`              |
| `media-changed.json`    | `GET /api/v1/accounts/{account}/media/changed`                 | `MEDIA_CHANGE` (snapshot) |
| `arm-network.json`      | `POST /api/v1/accounts/{account}/networks/{network}/state/arm` | `ARM_NETWORK`             |
| `command-running.json`  | `GET /network/{network}/command/{command}`                     | `COMMAND_RUNNING`         |
| `command-complete.json` | `GET /network/{network}/command/{command}`                     | `COMMAND_COMPLETE`        |
| `enable-camera.json`    | `POST /network/{network}/camera/{camera}/enable`               | `ENABLE_CAMERA`           |
| `update-thumbnail.json` | `POST /network/{network}/camera/{camera}/thumbnail`            | `UPDATE_THUMBNAIL`        |

Built for the tests (no public answer shows them), from the shapes above:

- `homescreen-doorbell.json`: `homescreen.json` plus one Video Doorbell in
  `doorbells` (fields of the cameras and the Minis, `type: "lotus"` as blinkpy
  names the doorbells).
- `media-events.json`: three clips in the shape of `media-changed.json`: a motion
  clip (`source: "pir"`, the motion sensor value documented by the
  BlinkMonitorProtocol notes), a doorbell press (`source: "button_press"`, an
  **assumption**: the real value is to be confirmed with `scripts/probe.mjs`),
  and a motion clip of the doorbell.

The OAuth sign-in answers (CSRF page, 412 / 202 with `tsv_*`, 201
`auth-completed`, the `Location` with the code, the tokens) follow the tests of
[blinkpy](https://github.com/fronzbot/blinkpy) (`tests/test_oauth.py`, MIT).
