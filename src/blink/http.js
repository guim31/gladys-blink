// -----------------------------------------------------------------------------
// The HTTP seam of the Blink client: one function, `request(url, options)`,
// resolving `{ status, headers, cookies, body }` (body as a Buffer). The real
// one wraps Node's fetch without following redirects (the OAuth sign-in reads
// the `Location` of a redirect); the tests pass a fake Blink cloud instead.
//
// Also a minimal cookie jar: the OAuth v2 sign-in of Blink is a browser-like
// flow, its steps are tied together by session cookies (blinkpy relies on the
// aiohttp session for that).
// -----------------------------------------------------------------------------

export const REQUEST_TIMEOUT_MS = 20_000;

/** An error of the transport itself (DNS, refused connection, timeout). */
export class NetworkError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'NetworkError';
    this.cause = cause;
  }
}

/**
 * @param {string} url
 * @param {{ method?: string, headers?: object, body?: string|Buffer, timeoutMs?: number }} [options]
 */
export async function fetchRequest(url, options = {}) {
  let response;
  try {
    response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: options.headers,
      body: options.body,
      redirect: 'manual',
      signal: AbortSignal.timeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    // Never the URL: it may carry an authorization code.
    const reason = err.cause?.code ?? err.name ?? 'error';
    throw new NetworkError(`network error (${reason})`, err);
  }
  const headers = {};
  for (const [name, value] of response.headers) {
    headers[name.toLowerCase()] = value;
  }
  const body = Buffer.from(await response.arrayBuffer());
  return { status: response.status, headers, cookies: response.headers.getSetCookie(), body };
}

/** Name/value pairs of the `Set-Cookie` headers, kept for the next requests. */
export class CookieJar {
  constructor() {
    this.cookies = new Map();
  }

  store(setCookies = []) {
    for (const line of setCookies) {
      const [pair, ...attributes] = String(line).split(';');
      const index = pair.indexOf('=');
      if (index <= 0) {
        continue;
      }
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      const expired = attributes.some((attribute) => {
        const [key, raw] = attribute.split('=');
        const attr = key.trim().toLowerCase();
        return (
          (attr === 'max-age' && Number(raw) <= 0) ||
          (attr === 'expires' && Date.parse(raw) < Date.now())
        );
      });
      if (expired || value === '') {
        this.cookies.delete(name);
      } else {
        this.cookies.set(name, value);
      }
    }
  }

  header() {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  clear() {
    this.cookies.clear();
  }
}

/** Parse a JSON body; `null` when it is not JSON. */
export function json(response) {
  try {
    return JSON.parse(response.body.toString('utf8'));
  } catch {
    return null;
  }
}
