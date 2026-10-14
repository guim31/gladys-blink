// -----------------------------------------------------------------------------
// Persistence under /data (the only writable path of the container):
//   - the session: hardware id of this client (a UUID: Blink asks the
//     verification code once per new client), access and refresh tokens,
//     region and account id, and a hash of the e-mail it belongs to;
//   - the time of the last automatic sign-in, so a restart loop does not make
//     Blink send a code at every start.
// The file holds secrets: it is written with mode 0600 and never logged.
// Losing it only costs a new sign-in (and a new code).
// (Writer adapted from guim31/gladys-wled.)
// -----------------------------------------------------------------------------

import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLogger } from '@gladysassistant/integration-sdk';
import { IssueLog } from './issues.js';

const logger = createLogger({ name: 'blink-store' });
const FILE_NAME = 'blink-session.json';

export class Store {
  constructor(directory = process.env.BLINK_DATA_DIR || '/data') {
    this.directory = directory;
    this.path = join(directory, FILE_NAME);
    this.pending = null;
    this.writing = null;
    // A read-only or full /data fails every write: logged once.
    this.issues = new IssueLog(logger);
  }

  async load() {
    try {
      const data = JSON.parse(await readFile(this.path, 'utf8'));
      return data && typeof data === 'object' ? data : {};
    } catch (err) {
      if (err.code !== 'ENOENT') {
        logger.warn(`Cannot read ${this.path}: ${err.code ?? 'invalid JSON'}`);
      }
      return {};
    }
  }

  // Writes are coalesced and atomic (temporary file + rename): a crash never
  // leaves half a JSON file behind.
  save(data) {
    this.latest = data;
    if (!this.pending) {
      // Chained after the write in progress, if any: one writer at a time.
      this.pending = (this.writing ?? Promise.resolve()).then(async () => {
        const snapshot = this.latest;
        this.pending = null;
        try {
          await mkdir(this.directory, { recursive: true });
          const temporary = `${this.path}.tmp`;
          await writeFile(temporary, JSON.stringify(snapshot), { mode: 0o600 });
          await chmod(temporary, 0o600);
          await rename(temporary, this.path);
          this.issues.recover('write', `${this.path} written again`);
        } catch (err) {
          this.issues.fail('write', `Cannot write ${this.path}: ${err.code ?? err.message}`);
        }
      });
      this.writing = this.pending;
    }
    return this.pending;
  }

  /** Resolves once every write requested so far is on disk. */
  flush() {
    return this.writing ?? Promise.resolve();
  }
}
