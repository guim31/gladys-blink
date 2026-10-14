# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- Blink cameras and doorbells in Gladys, through the Blink cloud: sign-in with
  the e-mail and password of the Blink app, and the verification code Blink
  sends (the "Enter the code" action), asked once; the session is renewed by
  itself.
- One device per Blink system: arming state, Sync Module online.
- One device per camera, Mini and Video Doorbell: last image, motion detected,
  motion detection on, temperature, low battery, Wi-Fi signal, doorbell.
- Scene triggers "Blink: motion detected" and "Blink: doorbell pressed".
- Scene actions "Blink: arm or disarm", "Blink: camera motion detection" and
  "Blink: take a new image" (never automatic: each capture costs battery).
- The "Blink" dashboard widget: last image of each camera, arming state, Arm,
  Disarm and New image… buttons.
- Refresh every 30 seconds to 5 minutes, two requests per reading, slowed down
  when Blink asks to; readings never wake the cameras.
- Feature names and messages in English, French, German and Spanish;
  documentation in the four languages.

[Unreleased]: https://github.com/guim31/gladys-blink/commits/main
