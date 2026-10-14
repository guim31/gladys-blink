# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration handles:

- **Secrets**: the e-mail address and the password of the Blink account are
  fields of the Gladys configuration (the password a `secret` field). The
  integration reads them from Gladys, keeps them in memory and sends them only
  to the Blink sign-in (`api.oauth.blink.com`). The verification code typed in
  the "Enter the code" action is sent only there too. None of them is ever
  written to `/data` nor to the logs.
- **Stored in `/data`**: `blink-session.json` (mode 0600), the identifier of
  this client for Blink (a random UUID), the access and refresh tokens of the
  session, the Blink region and account id, a hash of the e-mail address (to
  tell another account), and the time of the last automatic sign-in. Deleting
  it signs the integration out; the next sign-in asks for a new code.
- **Network**: HTTPS requests only, to `api.oauth.blink.com` (sign-in) and
  `rest-*.immedia-semi.com` (the Blink REST API; thumbnails are only fetched
  from there, any other address in an answer is refused). The integration opens
  no port and talks to no device on the local network.
- **Commands**: arming, motion detection and snapshots are sent only on a user
  action (widget button, scene action), never by a device feature, so a voice
  assistant cannot disarm the cameras through Gladys.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
the Blink cloud, apps and devices (report to Amazon / Blink), and the other
devices and services of your network.
