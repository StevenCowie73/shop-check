'use strict';

/* A speed bump on /api/prospect and /api/track. Read the limits honestly:

   It is in-memory and per instance. Vercel runs however many instances it
   feels like and recycles them, so the real ceiling is (instances alive) x
   (the number below), and a cold start empties the counters. Anyone patient
   enough to spread requests across instances and wait out a restart is not
   slowed down by this at all.

   It is keyed on the address in x-forwarded-for, which the client does not
   control here — Vercel appends the real peer — but which is shared by
   everyone behind one office NAT or one carrier's mobile gateway. So the
   limits are set where a whole street of people reading their letters stays
   under them.

   What actually stops someone walking the codes is the code space:
   31^8 ~= 852 billion eight-character refs for a few hundred live pages, so
   even a million guesses a second finds nothing. This file exists so that a
   script pointed at /p/ is answered with 429s instead of being quietly let
   run, and so the Places quota behind a page cannot be drained by repeats.
   It is not the thing keeping the codes private.

   Nothing here is persisted. No address is logged, written or kept past the
   window. */

/* The address Vercel saw, not one the caller can assert: x-forwarded-for is
   overwritten upstream, and its first entry is the client. */
function clientKey(req) {
  const headers = (req && req.headers) || {};
  const fwd = String(headers['x-forwarded-for'] || '');
  const first = fwd.split(',')[0].trim();
  if (first) return first;
  const real = String(headers['x-real-ip'] || '').trim();
  if (real) return real;
  return (req && req.socket && req.socket.remoteAddress) || 'unknown';
}

/* Keys are dropped wholesale rather than swept, so memory has a hard ceiling
   even under a flood from thousands of addresses. Dropping them is generous
   to callers, which is the right way round for a speed bump. */
const MAX_KEYS = 2000;

/* How many requests one address may make in a window. */
function counter({ windowMs, max }) {
  const hits = new Map();
  return {
    windowMs, max,
    /* true when this request is over the limit. */
    exceeded(key) {
      const now = Date.now();
      const seen = (hits.get(key) || []).filter(t => now - t < windowMs);
      seen.push(now);
      hits.set(key, seen);
      if (hits.size > MAX_KEYS) hits.clear();
      return seen.length > max;
    },
    reset() { hits.clear(); }
  };
}

/* How many *different* reference codes one address may ask for in a window.
   This is the one that matters: a person reading their own letter looks at
   one code, and someone sharing it with a neighbour looks at two. A script
   trying codes is the only thing that asks for a twentieth. */
function distinctCounter({ windowMs, max }) {
  const seen = new Map();
  return {
    windowMs, max,
    /* true when this value would be one distinct value too many. A value
       already counted within the window never trips it, so refreshing your
       own page is free. */
    exceeded(key, value) {
      const now = Date.now();
      let mine = seen.get(key);
      if (!mine) { mine = new Map(); seen.set(key, mine); }
      for (const [v, t] of mine) if (now - t >= windowMs) mine.delete(v);
      if (mine.has(value)) { mine.set(value, now); return false; }
      if (mine.size >= max) return true;
      mine.set(value, now);
      if (seen.size > MAX_KEYS) seen.clear();
      return false;
    },
    reset() { seen.clear(); }
  };
}

/* Retry-After has to be whole seconds, and rounding down would invite a
   retry that is refused again. */
function retryAfter(windowMs) {
  return String(Math.ceil(windowMs / 1000));
}

module.exports = { clientKey, counter, distinctCounter, retryAfter, MAX_KEYS };
