'use strict';

/* Explorer: Steven's private view of everything the engine finds and does.

   One function, so it costs one of Vercel's function slots rather than ten.
   /explorer is rewritten here by vercel.json.

     GET  /explorer                      the page itself: an empty shell, no data
     GET  /explorer?action=...           JSON, behind the Signal password
     POST /explorer?action=note|dnc      JSON, behind the Signal password

   The password is Signal's own (LOOKUP_PASSWORD), sent in the same
   x-lookup-password header and compared the same constant-time way.

   Google: the business screen shows the listing live, exactly as the
   prospect page does (listingHtml from api/places.js — logo, author credits,
   the ordering notice). The place id comes from the store, never from the
   request, and what Google returns is turned into HTML and sent. It is not
   written to the store, not logged, and never goes near a model. */

const { getStore } = require('../lib/explorer/store.js');
const { CHIPS, STATUSES, STATUS_LABEL, WEBSITE_STATES, WEBSITE_LABEL, LICENCE_AGES } = require('../lib/explorer/filters.js');
const { liveTwilioFeed } = require('../lib/explorer/twilio-feed.js');
const { pageHtml } = require('../lib/explorer/page.js');
const { listingHtml } = require('./places.js');

/* The same fields the prospect page asks for, and no more. */
const GOOGLE_FIELDS = [
  'id', 'displayName', 'rating', 'userRatingCount', 'googleMapsUri',
  'regularOpeningHours', 'reviews'
].join(',');

const ID = /^[A-Za-z0-9-]{2,40}$/;
const NOTE_MAX = 500;

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
  let size = 0;
  for await (const c of req) { size += c.length; if (size > 16 * 1024) throw new Error('too large'); chunks.push(c); }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(obj));
}

/* ---------- the letter ---------- */

/* The letter as stored when it was rendered or sent. For a record with no
   stored copy (every demo record), it is drafted with the pilot's own
   renderer so the wording is the real wording, marked as a draft. */
const PIPELINE_STATE = { fine: 'fine', poor: 'poor', broken: 'dead', not_found: 'not found', unknown: 'unknown', blocked: 'unknown' };
const QR_PLACEHOLDER = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#fff" stroke="#1C1917" stroke-width="3"/>' +
  '<text x="50" y="56" font-size="16" text-anchor="middle" font-family="sans-serif" fill="#1C1917">QR</text></svg>');

function draftLetter(p, demo) {
  let render;
  try { render = require('../finder/pilot/10-render-letters.js'); } catch (e) { return null; }
  const a = p.audit || {};
  const state = PIPELINE_STATE[a.state] || 'unknown';
  const rec = {
    qualifyingParties: [p.ownerName || ''],
    foundVia: p.areaId === 'bossier-caddo' ? ['Bossier / demo'] : [],
    websiteAudit: { url: a.url, source: a.foundBy, whatsWrong: a.whatsWrong, parked: false,
                    signals: a.viewport === false ? ['viewport'] : [] }
  };
  const row = { company: p.company, websiteState: state, emailUsable: !!p.email };
  const code = { ref: p.id, url: 'https://coldenjames.com/p/' + p.id, printed: 'coldenjames.com/p/' + p.id, image: QR_PLACEHOLDER };
  const { html } = render.letterHtml(row, rec, code);
  const mark = demo
    ? '<div style="position:fixed;top:40%;left:0;right:0;text-align:center;transform:rotate(-24deg);font:600 52pt \'IBM Plex Sans\',sans-serif;color:rgba(196,80,27,.18);pointer-events:none">DEMO</div>'
    : '';
  return '<!doctype html><html><head><meta charset="utf-8"><style>' + render.pageCss('') +
    '\nbody{zoom:1}</style></head><body>' + html + mark + '</body></html>';
}

/* ---------- the actions ---------- */

function makeHandler(deps = {}) {
  const env = deps.env || process.env;
  const storeOf = () => deps.store || getStore(env);
  const placeDetails = deps.placeDetails || ((id, key, opts) => require('../finder/lib/places.js').placeDetails(id, key, opts));
  const twilioFeed = deps.twilioFeed || liveTwilioFeed;

  const actions = {
    async bootstrap(store) {
      const [areas, funnel, feed] = await Promise.all([store.areas(), store.funnel(), store.feed(40)]);
      let live = [];
      try {
        live = await twilioFeed({ sid: env.TWILIO_ACCOUNT_SID, token: env.TWILIO_AUTH_TOKEN,
          known: await store.knownPhones(), ownerCell: env.OWNER_CELL, limit: 15 });
      } catch (e) { console.error('explorer: twilio feed unavailable'); }
      const merged = feed.concat(live).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 60);
      return {
        mode: store.mode, areas, funnel, feed: merged,
        chips: Object.entries(CHIPS).map(([id, c]) => ({ id, label: c.label })),
        labels: { status: STATUS_LABEL, website: WEBSITE_LABEL, licenceAge: LICENCE_AGES },
        statuses: STATUSES, websiteStates: WEBSITE_STATES
      };
    },
    async funnel(store, q) { return { funnel: await store.funnel(ID.test(q.area || '') ? q.area : null) }; },
    async list(store, q) { return { rows: await store.list(q) }; },
    async pins(store, q) { return { pins: await store.pins(ID.test(q.area || '') ? q.area : null) }; },
    async business(store, q) {
      const b = ID.test(q.id || '') ? await store.business(q.id) : null;
      if (!b) return [404, { error: 'No such business.' }];
      const { placeId, letter, ...rest } = b;
      return { business: { ...rest, hasPlaceId: !!placeId, letter: letter ? { state: letter.state, sentAt: letter.sentAt } : null } };
    },
    async letter(store, q) {
      const p = ID.test(q.id || '') ? await store.letterSource(q.id) : null;
      if (!p) return [404, { error: 'No such business.' }];
      if (p.letter && p.letter.html) return { state: p.letter.state, sentAt: p.letter.sentAt, html: p.letter.html };
      const html = draftLetter(p, store.mode === 'demo');
      return html ? { state: p.letter ? p.letter.state : 'draft', sentAt: p.letter ? p.letter.sentAt : null, drafted: true, html }
                  : { state: 'none', html: null };
    },
    async google(store, q) {
      const placeId = ID.test(q.id || '') ? await store.placeIdOf(q.id) : null;
      if (!placeId) return { ok: false, reason: 'no place_id' };
      const key = env.GOOGLE_PLACES_API_KEY;
      if (!key) return { ok: false, reason: 'not configured' };
      try {
        const place = await placeDetails(placeId, key, { fieldMask: GOOGLE_FIELDS, maxRetries: 1 });
        if (!place) return { ok: false, reason: 'no listing' };
        return { ok: true, html: listingHtml(place) };
      } catch (e) {
        console.error('explorer: places lookup failed');
        return { ok: false, reason: 'lookup failed' };
      }
    },
    async runs(store) { return { runs: await store.runs() }; },
    async run(store, q) {
      const r = ID.test(q.id || '') ? await store.run(q.id) : null;
      return r ? { run: r } : [404, { error: 'No such run.' }];
    }
  };

  const posts = {
    async note(store, q, body) {
      const text = String(body.body || '').trim();
      if (!text || text.length > NOTE_MAX) return [400, { error: 'A note is 1 to ' + NOTE_MAX + ' characters.' }];
      const note = ID.test(q.id || '') ? await store.addNote(q.id, text) : null;
      return note ? { note } : [404, { error: 'No such business.' }];
    },
    async dnc(store, q, body) {
      const r = ID.test(q.id || '') ? await store.setDoNotContact(q.id, body.value === true) : null;
      return r ? r : [404, { error: 'No such business.' }];
    }
  };

  return async function handler(req, res) {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Cache-Control', 'no-store');

    const url = new URL(req.url, 'https://placeholder.invalid');
    const q = Object.fromEntries(url.searchParams);
    const action = q.action || '';

    /* The shell. It carries no data: every number on it arrives through an
       action below, after the password. */
    if (!action && req.method === 'GET') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(pageHtml());
      return;
    }

    /* A place id is never taken from a request — the same rule as /api/places. */
    for (const forbidden of ['place_id', 'placeId', 'placeid']) {
      if (url.searchParams.has(forbidden)) return send(res, 400, { error: 'This route takes a business id, not a place id.' });
    }

    const expected = env.LOOKUP_PASSWORD;
    if (!expected) return send(res, 500, { error: 'Server is missing LOOKUP_PASSWORD.' });
    if (!sameSecret(req.headers['x-lookup-password'], expected)) return send(res, 401, { error: 'Wrong password.' });

    const table = req.method === 'POST' ? posts : req.method === 'GET' ? actions : null;
    const fn = table && Object.prototype.hasOwnProperty.call(table, action) ? table[action] : null;
    if (!fn) return send(res, 404, { error: 'Unknown action.' });

    try {
      const body = req.method === 'POST' ? await readBody(req) : {};
      const out = await fn(storeOf(), q, body || {});
      if (Array.isArray(out)) return send(res, out[0], out[1]);
      return send(res, 200, out);
    } catch (e) {
      console.error('explorer: ' + action + ' failed');
      return send(res, 500, { error: 'Something went wrong.' });
    }
  };
}

module.exports = makeHandler();
module.exports.makeHandler = makeHandler;
