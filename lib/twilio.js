'use strict';

/* The plumbing shared by the three Twilio webhooks.

   Twilio is reached with fetch and node's crypto rather than the official
   `twilio` package. Two reasons: the package is a large dependency for the
   two things we actually need — validating a signature (an HMAC-SHA1) and
   sending one message (a form POST) — and everything here has to be
   testable offline, which is easier when the only seam is global fetch.

   Every route is a webhook. That means anyone who learns the URL can POST
   to it, so nothing is trusted until the signature checks out. */

const crypto = require('crypto');

const TWILIO_API = 'https://api.twilio.com/2010-04-01';

/* ---------- the request ---------- */

/* Twilio signs the exact URL configured in its console, so we have to
   rebuild the outside-facing URL rather than whatever the proxy handed us.
   PUBLIC_BASE_URL is the escape hatch for when a proxy rewrites the host. */
function requestUrl(req) {
  const base = process.env.PUBLIC_BASE_URL;
  if (base) return base.replace(/\/+$/, '') + req.url;
  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = (req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  return proto + '://' + host + req.url;
}

/* Twilio posts application/x-www-form-urlencoded. Vercel may have parsed it
   already; if not, read the stream. */
async function readForm(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  let raw = typeof req.body === 'string' ? req.body : null;
  if (raw === null) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    raw = Buffer.concat(chunks).toString('utf8');
  }
  const out = {};
  for (const [k, v] of new URLSearchParams(raw)) out[k] = v;
  return out;
}

/* ---------- the signature ---------- */

/* Twilio's scheme: the full URL, then every POST parameter appended as
   name+value in order of name, HMAC-SHA1 with the auth token, base64. */
function expectedSignature(authToken, url, params) {
  let data = String(url);
  for (const key of Object.keys(params || {}).sort()) data += key + params[key];
  return crypto.createHmac('sha1', String(authToken)).update(Buffer.from(data, 'utf8')).digest('base64');
}

function sameSignature(a, b) {
  const x = Buffer.from(String(a || ''), 'utf8');
  const y = Buffer.from(String(b || ''), 'utf8');
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

function signatureValid(authToken, url, params, provided) {
  if (!provided) return false;
  return sameSignature(expectedSignature(authToken, url, params), provided);
}

/* ---------- replies ---------- */

const escapeXml = s => String(s === undefined || s === null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

function twiml(res, body) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end('<?xml version="1.0" encoding="UTF-8"?>\n<Response>' + body + '</Response>');
}

function plain(res, code, message) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(message);
}

/* ---------- the gate every route goes through ---------- */

/* Returns the posted parameters, or null once it has answered the request
   itself. A missing configuration is a 503 and never an exception: a crash
   here would show up as Twilio retrying a dead endpoint. */
async function authorize(req, res, { needOwnerCell = false } = {}) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const ownerCell = process.env.OWNER_CELL;

  if (!sid || !token) {
    plain(res, 503, 'Not configured: TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are not set.');
    return null;
  }
  if (needOwnerCell && !isE164(ownerCell)) {
    plain(res, 503, 'Not configured: OWNER_CELL is not set to an E.164 number.');
    return null;
  }
  if (req.method !== 'POST') {
    plain(res, 405, 'POST only.');
    return null;
  }

  let params;
  try {
    params = await readForm(req);
  } catch (err) {
    plain(res, 400, 'Could not read the request.');
    return null;
  }

  if (!signatureValid(token, requestUrl(req), params, req.headers['x-twilio-signature'])) {
    plain(res, 403, 'Bad signature.');
    return null;
  }
  return { params, sid, token, ownerCell };
}

/* ---------- the texting switch ---------- */

/* Until the carriers approve the texting campaign they drop our texts after
   Twilio has accepted them. Texting — the disclosure a caller hears and the
   text itself — stays off unless TEXTING_LIVE is "true" (surrounding spaces
   ignored; "TRUE", "1" or "yes" do not count). One check, so the voice
   route never promises a text the missed-call route will not send. */
const textingLive = () => String(process.env.TEXTING_LIVE || '').trim() === 'true';

/* ---------- numbers ---------- */

const isE164 = n => /^\+[1-9]\d{6,14}$/.test(String(n || '').trim());

/* ---------- sending ---------- */

/* The only two destinations this system ever writes to are the caller of the
   call in hand and OWNER_CELL. No route takes a destination from a request
   parameter, and this refuses anything that is not a plain E.164 number, so
   a malformed webhook cannot redirect a message. */
async function sendSms({ sid, token, from, to, body }) {
  if (!isE164(to)) throw new Error('refusing to send: destination is not an E.164 number');
  if (!isE164(from)) throw new Error('refusing to send: sender is not an E.164 number');
  const form = new URLSearchParams({ To: to, From: from, Body: String(body || '') });
  const res = await fetch(`${TWILIO_API}/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(sid + ':' + token).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: form.toString()
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error('Twilio refused the message (HTTP ' + res.status + ') ' + text.slice(0, 200));
  }
  return res.json().catch(() => ({}));
}

/* Has this number already had a text from us today?

   Twilio keeps the sent log, so it is the one source of truth that survives
   a cold start, a redeploy and a second function instance. We ask it rather
   than keeping our own memory, which would be wrong within minutes.

   Throws if the question cannot be answered. That is deliberate: the caller
   decides what to do about not knowing, and for a missed call the right
   answer is to send anyway. */
async function textedWithin({ sid, token, from, to, hours = 24 }) {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const query = new URLSearchParams({ To: to, From: from, PageSize: '1' });
  /* Twilio spells the inequality into the parameter name itself. */
  const url = `${TWILIO_API}/Accounts/${encodeURIComponent(sid)}/Messages.json?` +
              query.toString() + '&DateSent%3E=' + encodeURIComponent(since);
  const res = await fetch(url, {
    headers: { Authorization: 'Basic ' + Buffer.from(sid + ':' + token).toString('base64') }
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error('Twilio would not answer (HTTP ' + res.status + ') ' + text.slice(0, 200));
  }
  const body = await res.json();
  return Array.isArray(body.messages) && body.messages.length > 0;
}

module.exports = {
  TWILIO_API, requestUrl, readForm, expectedSignature, signatureValid,
  escapeXml, twiml, plain, authorize, isE164, sendSms, textedWithin, textingLive
};
