'use strict';

/* Did anyone open the page, and did they do anything.

   A stub on purpose: it validates, drops what is obviously a machine, logs
   one line and answers 204. When there is somewhere to put these, the write
   goes where the console.log is and nothing else changes.

   What it never does: set a cookie, read one, keep an IP address, or record
   anything that identifies a person. A reference code says which letter was
   opened, not who was holding the phone. */

const { clientKey, counter, distinctCounter, retryAfter } = require('../lib/ratelimit.js');

/* Read lib/ratelimit.js before trusting these: in memory, per instance, and
   emptied by a cold start. One page visit sends at most six events, so 120 a
   minute is twenty page visits from one address — a builders' merchant on one
   office connection stays well under it. Twelve different codes in ten
   minutes matches the page's own limit, so a script cannot map which codes
   are live by tracking against them instead. */
const RATE = counter({ windowMs: 60 * 1000, max: 120 });
const WALK = distinctCounter({ windowMs: 10 * 60 * 1000, max: 12 });

const EVENTS = new Set([
  'page_open',        /* only after the page has been visible two seconds */
  'listing_shown',
  'animation_played',
  'text_tapped',
  'call_tapped',
  'intake_opened'
]);

const CHANNELS = new Set(['letter', 'email', 'direct']);
const DEVICES = new Set(['phone', 'desktop']);

/* Link scanners in mail systems and security products fetch every URL in an
   email the moment it arrives. Counting those as opens would make the
   numbers a comfortable lie. */
const NOT_A_PERSON = /bot|crawler|spider|slurp|preview|scan|monitor|curl|wget|python-requests|headless|phantom|lighthouse|pingdom|uptime|facebookexternalhit|whatsapp|telegram|slackbot|discordbot|bingpreview|proofpoint|barracuda|mimecast|symantec|forcepoint|microsoft office|ms-office|outlook|skypeuripreview|google-read-aloud|gtmetrix|semrush|ahrefs|petalbot|yandex|duckduck/i;

async function readJson(req) {
  if (req.body) {
    if (typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
    return JSON.parse(String(req.body));
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');

  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.end();
    return;
  }

  const agent = String(req.headers['user-agent'] || '');
  if (!agent || NOT_A_PERSON.test(agent)) {
    /* Answered, not counted. Nothing is gained by telling a scanner it was
       spotted. */
    res.statusCode = 204;
    res.end();
    return;
  }

  const who = clientKey(req);
  if (RATE.exceeded(who)) {
    res.statusCode = 429;
    res.setHeader('Retry-After', retryAfter(RATE.windowMs));
    res.end();
    return;
  }

  let body = {};
  try {
    body = await readJson(req);
  } catch (err) {
    res.statusCode = 400;
    res.end();
    return;
  }

  const event = String(body.event || '');
  if (!EVENTS.has(event)) {
    res.statusCode = 400;
    res.end();
    return;
  }

  const ref = String(body.ref || '').trim().toUpperCase();
  const channel = CHANNELS.has(body.channel) ? body.channel : 'direct';
  const device = DEVICES.has(body.device) ? body.device : 'unknown';

  if (!/^[A-Z0-9]{4,24}$/.test(ref)) {
    res.statusCode = 400;
    res.end();
    return;
  }

  if (WALK.exceeded(who, ref)) {
    res.statusCode = 429;
    res.setHeader('Retry-After', retryAfter(WALK.windowMs));
    res.end();
    return;
  }

  /* One line, no address, no agent string, no cookie. */
  console.log(JSON.stringify({
    at: new Date().toISOString(), ref, event, channel, device
  }));

  res.statusCode = 204;
  res.end();
};

module.exports.EVENTS = EVENTS;
module.exports.RATE = RATE;
module.exports.WALK = WALK;
module.exports.resetLimits = function () { RATE.reset(); WALK.reset(); };
module.exports.NOT_A_PERSON = NOT_A_PERSON;
