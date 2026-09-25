'use strict';

/* Fetching, with a timeout and readable errors. check-sites.js and
   judge-prospects.js each had their own copy of this; the audit scores
   depend on the exact error wording, so the behaviour here is unchanged
   and only the user agent moved to an argument. */

const dns = require('dns').promises;

const { sleep } = require('./env.js');

/* Node's own fetch ignores HTTPS_PROXY unless the process was started with
   --use-env-proxy or NODE_USE_ENV_PROXY, and neither can be switched on once
   the process is running. Where a proxy is named in the environment we use
   undici's own fetch with undici's env-reading proxy dispatcher instead.

   It has to be undici's own fetch, not Node's global fetch pointed at the
   npm undici dispatcher. Node 22 bundles undici 6; the npm package is 8.
   Mixed like that, a response over HTTP/2 through the proxy comes back with
   no headers at all — a 301 with no Location, so the redirect is never
   followed and a live website is recorded as "the server answered 301".
   That happened on a real audit. Fetch and dispatcher now come from the same
   undici, so they cannot disagree.

   When no proxy variable is set this does nothing at all, which is the case on
   Vercel and on a plain laptop: Node's own fetch is used, exactly as before.

   If a proxy is named and undici is missing, we stop. Carrying on unproxied is
   the worst outcome available: the run finishes, looks fine, and quietly marks
   live websites dead. A refusal to start is cheap; a bad audit is not. */
let fetchImpl = (...args) => globalThis.fetch(...args);
(function useProxyFromEnvironment() {
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  if (!proxy) return;
  if (process.env.NODE_USE_ENV_PROXY) return;   /* Node already did it at startup */
  let undici;
  try {
    undici = require('undici');
  } catch (err) {
    console.error('Proxy detected but undici is not installed — run npm install at the repo root');
    process.exit(1);
  }
  const agent = new undici.EnvHttpProxyAgent();
  undici.setGlobalDispatcher(agent);
  fetchImpl = (url, init) => undici.fetch(url, Object.assign({ dispatcher: agent }, init || {}));
})();

/* Every outbound request in finder/ goes through this, so the proxy rule
   above holds everywhere: the audit, Places, the licence walk and Astra. */
const fetch = (url, init) => fetchImpl(url, init);

const BROWSER_HEADERS = {
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9'
};

/* Returns { res } or { error: "a short readable reason" } — it does not
   throw, because a prospect's broken website is data, not a failure. */
async function get(url, timeoutMs, userAgent) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: Object.assign({ 'User-Agent': userAgent }, BROWSER_HEADERS)
    });
    return { res };
  } catch (err) {
    const aborted = err && (err.name === 'AbortError' || err.name === 'TimeoutError');
    /* The caller sometimes needs to tell a missing domain from a slow one,
       so pass the underlying code up alongside the readable message. */
    let code = aborted ? 'ETIMEDOUT_FETCH' : (rootCode(err) || '');
    if (!aborted && INCONCLUSIVE.has(code) && await looksLikeMissingDomain(url)) {
      return { error: 'domain not found', code: 'ENOTFOUND' };
    }
    return { error: aborted ? 'timed out after ' + (timeoutMs / 1000) + 's' : shortError(err), code };
  } finally {
    clearTimeout(timer);
  }
}

/* A proxy dispatcher wraps the real failure one or more levels down, so the
   DNS error that should read "domain not found" arrives as a bare
   "fetch failed". Walk the cause chain to the code underneath. */
function rootCode(err) {
  let node = err;
  for (let depth = 0; node && depth < 8; depth++) {
    if (node.code) return node.code;
    if (Array.isArray(node.errors) && node.errors.length) {
      const nested = node.errors.map(rootCode).find(Boolean);
      if (nested) return nested;
    }
    node = node.cause;
  }
  return '';
}

/* Through a proxy the client never resolves the host itself, so a domain that
   does not exist comes back as an aborted tunnel with nothing underneath it.
   These are the codes that tell us nothing, and are worth one DNS question. */
const INCONCLUSIVE = new Set(['', 'UND_ERR_ABORTED', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT']);

async function looksLikeMissingDomain(url) {
  let host;
  try { host = new URL(url).hostname; } catch (e) { return false; }
  try {
    await dns.lookup(host);
    return false;                       /* it resolves, so the trouble is elsewhere */
  } catch (err) {
    return err && (err.code === 'ENOTFOUND' || err.code === 'EAI_NODATA');
  }
}

function shortError(err) {
  const code = rootCode(err);
  const map = {
    ENOTFOUND: 'domain not found',
    ECONNREFUSED: 'connection refused',
    ECONNRESET: 'connection reset',
    EHOSTUNREACH: 'host unreachable',
    ETIMEDOUT: 'connection timed out',
    CERT_HAS_EXPIRED: 'security certificate expired',
    ERR_TLS_CERT_ALTNAME_INVALID: 'security certificate does not match the domain',
    DEPTH_ZERO_SELF_SIGNED_CERT: 'untrusted security certificate',
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'untrusted security certificate'
  };
  if (code && map[code]) return map[code];
  if (code) return String(code);
  return (err && err.message ? String(err.message) : 'request failed').slice(0, 120);
}

/* Read the body but stop at a cap, so one enormous page cannot stall a run. */
async function readCapped(res, maxBytes) {
  if (!res.body) return { text: '', bytes: 0, truncated: false };
  const reader = res.body.getReader();
  const chunks = [];
  let bytes = 0, truncated = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes <= maxBytes) chunks.push(Buffer.from(value));
      else { truncated = true; reader.cancel().catch(() => {}); break; }
    }
  } catch (e) { /* take whatever arrived */ }
  return { text: Buffer.concat(chunks).toString('utf8'), bytes, truncated };
}

/* ---------- reading the page ---------- */

/* JSON over HTTP, for the Places calls. Returns the parsed body and the
   status; the caller decides what a non-200 means. */
async function getJson(url, headers, timeoutMs, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, Object.assign({ headers, signal: controller.signal }, init || {}));
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch (e) { /* not json */ }
    return { status: res.status, body, text };
  } finally { clearTimeout(timer); }
}

/* Plain text, following redirects. Used for robots.txt and homepages. */
async function getText(url, timeoutMs, userAgent) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': userAgent, 'Accept': 'text/html,*/*' },
      redirect: 'follow', signal: controller.signal
    });
    return { status: res.status, body: await res.text() };
  } finally { clearTimeout(timer); }
}

/* Rate limits and server errors are worth another go; a bad key or a
   malformed request never improves by asking again. */
const RETRYABLE_STATUS = s => s === 429 || s >= 500;

async function withRetries(attempt, { tries = 4, waitMs = 1000, onRetry } = {}) {
  let wait = waitMs;
  for (let n = 1; ; n++) {
    const result = await attempt(n);
    if (!result || !result.retry || n >= tries) return result;
    if (onRetry) onRetry(n, wait, result);
    await sleep(wait);
    wait *= 2;
  }
}

module.exports = { fetch, get, getJson, getText, readCapped, shortError, withRetries, RETRYABLE_STATUS, BROWSER_HEADERS };
