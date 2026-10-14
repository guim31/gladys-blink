# Blink for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com) that brings
[Blink](https://blinkforhome.com) cameras and doorbells (Blink Outdoor 4, Blink Mini, Blink Video Doorbell, with or
without a Sync Module) into Gladys, through the Blink cloud.

> **Developed without the hardware: feedback welcome.** The integration follows the sign-in and the API calls of
> [blinkpy](https://github.com/fronzbot/blinkpy) (the library of Home Assistant's Blink integration) and is tested
> against real answers of the Blink cloud published by other projects, not against a real Blink account. Please
> report what works and what does not in the [issues](https://github.com/guim31/gladys-blink/issues).

Not affiliated with Blink or Amazon.

## Features

- **Sign-in** with the e-mail and password of the Blink app, and the **verification code** Blink sends to every new
  client (the _Enter the code_ action of the Configuration screen). The code is asked once: the session is kept
  under `/data` and renewed by itself. The _Sign in_ action signs in again on demand.
- **One device per Blink system**: _Armed_ (read-only, see below) and _Sync Module online_.
- **One device per camera, Mini and doorbell**: the **last image** (camera feature: the dashboard camera widget and
  the "send a camera image" scene action use it), _Motion detected_ (for two minutes after a clip), _Motion detection
  on_, _Temperature_ (battery cameras, °C, kept out of the room average), _Low battery_ (Blink reports "OK" or "low",
  not a percentage), _Wi-Fi signal_ (0 to 5 bars), _Doorbell_ (a pulse on each press, Video Doorbell).
- **Scene triggers**: _Blink: motion detected_ and _Blink: doorbell pressed_, with the camera and system names as
  variables.
- **Scene actions**: _Blink: arm or disarm_ (a system, or the system of a camera: follow the Gladys alarm),
  _Blink: camera motion detection_, _Blink: take a new image_.
- **Dashboard widget** "Blink": the last image of each camera with a badge (motion, offline, detection off), the
  arming state, and **Arm**, **Disarm** (with a confirmation) and **New image…** (a camera to choose in a form).
- Every text in English, French, German and Spanish.

Arming and motion detection are **read-only features** on purpose: Gladys Plus exposes every on/off switch to
Google Home and Alexa, and "turn everything off" would disarm the cameras. They are commanded from the widget and
the scene actions only.

## Requirements

- Gladys Assistant **5.2.0** or later (the _New image…_ form of the widget).
- A Blink account with at least one system, and access to its mailbox or phone for the verification code.
- Internet access: Blink has no local API.

## Installation

1. In Gladys, open **Integrations** → **Install from GitHub** and enter the address of this repository:
   `https://github.com/guim31/gladys-blink` (or install **Blink** from the catalog once it is listed).
2. In **Configuration**, enter the e-mail address and the password of the Blink account, choose the refresh
   interval, and save.
3. Blink sends a verification code by e-mail or SMS: type it in the **Enter the code** action.
4. Open the **Discover** tab and add the devices.

The user guide is in [`docs/en.md`](docs/en.md) (also in [French](docs/fr.md), [German](docs/de.md) and
[Spanish](docs/es.md)); Gladys links it from the Configuration screen.

## How it works

- **Sign-in**: the OAuth 2.0 authorization code flow with PKCE that Blink uses since 2025, step by step as blinkpy
  0.25 does it (authorize, sign-in page and its CSRF token, credentials, verification code, authorization code,
  tokens), with a random UUID as the `hardware_id` of this client, kept under `/data`. The access token is
  refreshed a minute before it expires; a refused session triggers a new sign-in by itself, at most once an hour
  (each one may make Blink send a code).
- **Readings**: on its own timer (30 s, 1 min — default —, 2 min or 5 min), the integration asks the homescreen
  (systems, arming, cameras, battery, Wi-Fi, temperature, thumbnails) and the clips changed since the last reading
  (`media/changed`). Two GET requests per reading whatever the number of cameras, one request at a time, half a
  second apart; a 429 doubles the interval for a while. **No reading wakes a camera.** A thumbnail is downloaded
  only when its path changes.
- **Events**: a new clip of a camera is a motion (`source: "pir"` and the like); a clip of a doorbell whose source
  names the button is a press. Clips already listed, older than 15 minutes, or asked by the user (snapshot, live
  view) fire nothing.
- **States**: only the changes are sent (the SDK's `publishChangedStates`), with a heartbeat every 12 hours, except
  the doorbell pulse (a heartbeat would fake the time of the last ring). Everything is sent again when a device is
  added, and the widget is refreshed.
- **Polling by Gladys**: the devices are published with `should_poll` and a one-minute `poll_frequency`, but the
  integration does not count on it (GladysAssistant/Gladys#3198): Gladys' `onPoll` only reads the cloud when the
  timer has not done it for 90 % of an interval.
- **Images**: Blink thumbnails go to Gladys as they are when they fit (150 KB for the camera channel, base64
  included; 300 KB for the widget), else they are halved and re-encoded with
  [jpeg-js](https://github.com/eugeneware/jpeg-js) (pure JavaScript). A new picture is taken only on a user action, at
  most once a minute per camera: each one wakes the camera and costs battery.

## What was checked, and what was not

The session that wrote this integration had no network access to the Blink cloud and no Blink hardware. The tests
run against the SDK's fake Gladys and an in-memory Blink cloud (`test/helpers/fakeBlink.js`) answering with real
answers of the Blink cloud (`test/fixtures/blink/`).

- Not checked against the real cloud: the whole sign-in (status codes, CSRF page, the code by e-mail and by SMS),
  the token refresh, the answers of a Video Doorbell and of a recent Mini, the `source` of a doorbell press (the
  integration matches words like `button`, `press`, `ring`), the motion detection commands of a Mini and of a
  doorbell, the size of real thumbnails, and the widget in a real Gladys.
- [`scripts/probe.mjs`](scripts/probe.mjs) checks the sign-in of the real cloud with a fake account (a clean refusal
  is expected), and, with `BLINK_EMAIL` and `BLINK_PASSWORD`, reads a real account without changing anything,
  printing only counts and field names (the `source` values of the clips, the fields of the doorbells).

## Limitations

- Cloud only; Blink does not publish its API: a change on their side can break the integration until it is updated.
- Motion and the doorbell are seen at the next reading (no push for third parties), plus the upload time of the
  clip.
- No live view and no clip download: thumbnails only.
- A doorbell press that records no clip is not seen.

## Development

```bash
npm ci
npm run format:check
npm run lint
npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
node scripts/probe.mjs   # needs the network
```

See [`CLAUDE.md`](CLAUDE.md) for the project rules.

## Credits

- [blinkpy](https://github.com/fronzbot/blinkpy) by Kevin Fronczak and contributors (MIT): the OAuth v2 sign-in, the
  endpoints and their quirks (temperatures in °F, the thumbnail paths, the camera kinds), re-implemented here in
  JavaScript; its OAuth tests shaped the fake sign-in.
- Home Assistant's [`blink`](https://github.com/home-assistant/core/tree/dev/homeassistant/components/blink)
  integration (Apache-2.0): the choice of entities and the gentle polling.
- [homebridge-blink-for-home](https://github.com/colinbendell/homebridge-blink-for-home) by Colin Bendell (MIT): the
  real answers of the Blink cloud used as test fixtures.
- [BlinkMonitorProtocol](https://github.com/MattTW/BlinkMonitorProtocol) by MattTW: read to understand the
  API; no text was copied.
- [jpeg-js](https://github.com/eugeneware/jpeg-js) (BSD-3-Clause): JPEG decoding and encoding.
- The architecture and the conformity tests follow [gladys-wled](https://github.com/guim31/gladys-wled) and
  [gladys-pihole](https://github.com/guim31/gladys-pihole).

## Disclaimer

This project is not affiliated with, endorsed or sponsored by Blink, Immedia Semiconductor or Amazon. "Blink" is a
trademark of Amazon.com, Inc. or its affiliates.

## License

Apache-2.0
