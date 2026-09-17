'use strict';

/* The single-business lookup, behind a password.

   The keys live in Vercel's environment and are read here. Nothing that
   reaches the browser contains them, and every error is scrubbed on the
   way out.

   Streams progress as server-sent events so a 30 second wait looks like
   work rather than a hang, then sends the result as the last event. */

const { scrub } = require('../finder/lib/env.js');
const { lookupOne, STEPS } = require('../finder/lib/lookup.js');
const { formatPlain } = require('../finder/lib/format.js');

const MAX_QUERY = 200;

/* Enough to stop a leaked password emptying the Places account before you
   notice. Per instance, so it resets on a cold start — a speed bump, not a
   security control. */
const RATE = { windowMs: 60 * 1000, max: 12 };
const hits = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const seen = (hits.get(ip) || []).filter(t => now - t < RATE.windowMs);
  seen.push(now);
  hits.set(ip, seen);
  if (hits.size > 500) hits.clear();          /* never grow without bound */
  return seen.length > RATE.max;
}

/* Comparing byte by byte regardless of where the first difference is. */
function sameSecret(a, b) {
  const x = Buffer.from(String(a || ''), 'utf8');
  const y = Buffer.from(String(b || ''), 'utf8');
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

async function readBody(req) {
  if (req.body) return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

module.exports = async function handler(req, res) {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }

  const expected = process.env.LOOKUP_PASSWORD;
  const placesKey = process.env.GOOGLE_PLACES_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (!expected || !placesKey) {
    res.status(500).json({ error: 'Server is missing LOOKUP_PASSWORD or GOOGLE_PLACES_API_KEY.' });
    return;
  }
  if (!sameSecret(req.headers['x-lookup-password'], expected)) {
    res.status(401).json({ error: 'Wrong password.' });
    return;
  }

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (rateLimited(ip)) {
    res.status(429).json({ error: 'Slow down — too many lookups in the last minute.' });
    return;
  }

  let query = '', placeId = null;
  try {
    const body = await readBody(req);
    query = String(body.query || '').trim().slice(0, MAX_QUERY);
    /* Place ids are opaque but bounded; anything else is not one. */
    const raw = String(body.placeId || '').trim();
    if (raw && /^[A-Za-z0-9_-]{1,255}$/.test(raw)) placeId = raw;
  } catch (e) {
    res.status(400).json({ error: 'Could not read the request.' });
    return;
  }
  if (!query && !placeId) {
    res.status(400).json({ error: 'Type a business name.' });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  send('steps', { steps: STEPS });
  try {
    const result = await lookupOne(query, {
      placesKey,
      anthropicKey,
      placeId,
      onProgress: p => send('progress', { step: p.step, label: p.label })
    });
    result.plain = formatPlain(result);
    send('result', result);
  } catch (err) {
    send('failed', { error: scrub((err && err.message) || 'The lookup failed.') });
  }
  res.end();
};
