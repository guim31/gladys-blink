// -----------------------------------------------------------------------------
// Deduplicated problem logging. A failure that repeats (the Blink cloud down,
// a refused session, a read-only /data) writes one line when it starts and
// one when it is over, not one per attempt: the attempts in between go to the
// debug level (LOG_LEVEL=debug shows them). (From guim31/gladys-wled.)
// -----------------------------------------------------------------------------

export class IssueLog {
  /** @param {object} logger an SDK logger (debug/info/warn/error) */
  constructor(logger) {
    this.logger = logger;
    /** @type {Map<string, string>} keys of the problems going on, with their message */
    this.open = new Map();
  }

  /**
   * A failure: logged at `level` the first time (or when its message
   * changes), at debug while it lasts.
   * @returns {boolean} true when it is a new problem
   */
  fail(key, message, level = 'warn') {
    if (this.open.get(key) === message) {
      this.logger.debug(`${message} (again)`);
      return false;
    }
    this.open.set(key, message);
    this.logger[level](message);
    return true;
  }

  /**
   * A success: one info line if the problem was going on, nothing otherwise.
   * @returns {boolean} true when a problem is over
   */
  recover(key, message) {
    if (!this.open.delete(key)) {
      return false;
    }
    if (message) {
      this.logger.info(message);
    }
    return true;
  }

  has(key) {
    return this.open.has(key);
  }
}
