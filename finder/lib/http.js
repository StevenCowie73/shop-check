'use strict';

/* Fetching, with a timeout and readable errors. check-sites.js and
   judge-prospects.js each had their own copy of this; the audit scores
   depend on the exact error wording, so the behaviour here is unchanged
   and only the user agent moved to an argument. */

const { sleep } = require('./env.js');

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
    const cause = err && err.cause;
    const code = aborted ? 'ETIMEDOUT_FETCH' : ((cause && cause.code) || (err && err.code) || '');
    return { error: aborted ? 'timed out after ' + (timeoutMs / 1000) + 's' : shortError(err), code };
  } finally {
    clearTimeout(timer);
  }
}

function shortError(err) {
  const cause = err && err.cause;
  const code = (cause && cause.code) || (err && err.code);
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

module.exports = { get, getJson, getText, readCapped, shortError, withRetries, RETRYABLE_STATUS, BROWSER_HEADERS };
