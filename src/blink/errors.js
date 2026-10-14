// -----------------------------------------------------------------------------
// The errors of the Blink client, by kind: the hub reacts to the kind (retry,
// ask for the code, wait for the user), src/texts.js explains each one to the
// user in four languages. Messages never carry a token, a password or a URL
// with an authorization code.
// -----------------------------------------------------------------------------

export const ERROR_KINDS = Object.freeze({
  // No answer: DNS, refused connection, timeout, a 5xx of the Blink cloud.
  UNREACHABLE: 'unreachable',
  // E-mail or password refused by Blink.
  CREDENTIALS: 'credentials',
  // The verification code was refused (wrong or expired).
  CODE_INVALID: 'code_invalid',
  // A code was typed but no sign-in waits for one (container restarted, too late).
  NO_PENDING_LOGIN: 'no_pending_login',
  // The session (refresh token) was refused: a new sign-in is needed.
  SESSION_EXPIRED: 'session_expired',
  // Blink answered 429: too many requests.
  RATE_LIMIT: 'rate_limit',
  // The sign-in page changed (no CSRF token, no authorization code).
  LOGIN_FLOW: 'login_flow',
  // A command (arm, snapshot…) was refused or did not complete.
  COMMAND: 'command',
  // Anything else unexpected.
  HTTP: 'http',
});

export class BlinkError extends Error {
  /**
   * @param {string} kind one of ERROR_KINDS
   * @param {string} message for the logs (English, no secret)
   * @param {{ status?: number }} [details]
   */
  constructor(kind, message, { status } = {}) {
    super(message);
    this.name = 'BlinkError';
    this.kind = kind;
    this.status = status;
  }
}

/** The kind of an unexpected HTTP status. */
export function kindOfStatus(status) {
  if (status === 429) {
    return ERROR_KINDS.RATE_LIMIT;
  }
  if (status >= 500) {
    return ERROR_KINDS.UNREACHABLE;
  }
  return ERROR_KINDS.HTTP;
}
