'use strict';

/* Sends one approved letter through Lob as a US letter.

   What it checks before anything leaves this machine, in order:

   1. The letter is approved (state 'approved', approved_at set). Drafts,
      mock letters and letters already mailed are refused.
   2. The key's mode. A key whose prefix we can see decides it: test_ is
      test, live_ is live, anything else is refused. A key injected by a
      proxy is invisible to this process, so its mode has to be declared
      in LOB_KEY_MODE ('test' or 'live'); with neither, nothing is sent.
   3. Live needs the LIVE flag. A live key without `live: true` is
      refused, and so is `live: true` with a test key: a request for real
      mail that would silently go nowhere is as wrong as the reverse.
   4. Nothing is mailed twice. A letter with a live Lob id is refused, and
      every request carries an Idempotency-Key made from the letter's id
      and mode, so a retry after a timeout cannot print a second copy.
   5. The return address is complete (site/content.js BUSINESS.mailbox)
      and so is the recipient's, within Lob's lengths: name and company
      40 characters, each address line 64.
   6. The letter carries no [PLACEHOLDER] left over from the template.
   7. The PDF is one US Letter page, under 5 MB, with its fonts embedded
      as real fonts (no Type 3 glyphs, which print preflight flags).

   Then it POSTs the PDF to Lob and records Lob's letter id and expected
   delivery date against the letter. A test send leaves the letter
   approved (nothing was printed); a live send marks it sent.

   The layout rules the PDF must meet (Lob's address block and windows,
   the barcode corner, the folds) live with the template in
   finder/pilot/10-render-letters.js and are measured by tests/lob.test.js.

   Lob docs, read 25 September 2026: docs.lob.com (Letters: create),
   help.lob.com letters and letter-envelopes pages, and the letter
   template PDF (letter_template_updated 4_25). */

const crypto = require('crypto');

const LOB_LETTERS = 'https://api.lob.com/v1/letters';
const MAX_PDF_BYTES = 5 * 1024 * 1024;

/* What we send Lob for every letter. Page one carries the addresses
   (top_first_page), the letter is one page, so single-sided; colour
   because the letterhead and rule are in the brand's colours. */
const LETTER_OPTIONS = {
  color: true,
  double_sided: false,
  address_placement: 'top_first_page',
  mail_type: 'usps_first_class',
  use_type: 'marketing'
};

class LobRefusal extends Error {}
const refuse = msg => { throw new LobRefusal(msg); };

/* test or live, from the key itself when we can see it. */
function modeOf({ key, declaredMode }) {
  if (key) {
    if (/^test_/.test(key)) return 'test';
    if (/^live_/.test(key)) return 'live';
    refuse('That is not a Lob key: it starts with neither test_ nor live_.');
  }
  if (declaredMode === 'test' || declaredMode === 'live') return declaredMode;
  refuse('No Lob key in LOB_API_KEY and no LOB_KEY_MODE to say what the proxy-injected key is. Nothing sent.');
}

function assertMode(mode, live) {
  if (mode === 'live' && live !== true) refuse('This is a live Lob key and the LIVE flag is not set. Nothing sent.');
  if (mode === 'test' && live === true) refuse('The LIVE flag is set but this is a test key: it would print nothing. Nothing sent.');
}

function assertApproved(letter) {
  if (!letter) refuse('No such letter.');
  if (letter.state === 'mock') refuse('Letter ' + letter.id + ' is a mock and is never sent.');
  if (letter.state === 'sent' || letter.lobMode === 'live') refuse('Letter ' + letter.id + ' has already been mailed' + (letter.lobLetterId ? ' (' + letter.lobLetterId + ')' : '') + '.');
  if (letter.doNotContact) refuse('The business behind letter ' + letter.id + ' is marked do not contact. Nothing sent.');
  if (letter.state !== 'approved' || !letter.approvedAt) refuse('Letter ' + letter.id + ' is not approved (state: ' + letter.state + '). Nothing sent.');
}

/* An address as Lob wants it, or a refusal naming what is missing. */
function lobAddress(a, who) {
  const clean = v => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  const out = {
    name: clean(a.name), company: clean(a.company),
    address_line1: clean(a.line1), address_line2: clean(a.line2),
    address_city: clean(a.city), address_state: clean(a.state).toUpperCase(),
    address_zip: clean(a.zip), address_country: 'US'
  };
  const missing = [];
  if (!out.name && !out.company) missing.push('a name or company');
  if (!out.address_line1) missing.push('street');
  if (!out.address_city) missing.push('city');
  if (!/^[A-Z]{2}$/.test(out.address_state)) missing.push('two-letter state');
  if (!/^\d{5}(-?\d{4})?$/.test(out.address_zip)) missing.push('ZIP');
  if (missing.length) refuse('The ' + who + ' address is incomplete: ' + missing.join(', ') + '. Nothing sent.');
  for (const [k, max] of [['name', 40], ['company', 40], ['address_line1', 64], ['address_line2', 64]]) {
    if (out[k].length > max) refuse('The ' + who + ' ' + k + ' is ' + out[k].length + ' characters; Lob allows ' + max + '. Nothing sent.');
  }
  for (const k of Object.keys(out)) if (!out[k]) delete out[k];
  return out;
}

function assertNoPlaceholder(html) {
  const text = String(html || '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ');
  const m = /\[[A-Z][A-Z ]{2,}\]/.exec(text);
  if (m) refuse('The letter still says ' + m[0] + '. Nothing sent.');
}

/* One page, US Letter, small enough, real fonts. Chromium's PDFs keep
   their objects uncompressed enough for these to be read directly. */
function checkPdf(pdf) {
  const buf = Buffer.isBuffer(pdf) ? pdf : Buffer.from(pdf);
  if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') refuse('The rendered file is not a PDF.');
  if (buf.length > MAX_PDF_BYTES) refuse('The PDF is ' + buf.length + ' bytes; Lob wants under 5 MB.');
  const s = buf.toString('latin1');
  const pages = (s.match(/\/Type\s*\/Page(?![a-z])/g) || []).length;
  if (pages !== 1) refuse('The letter is ' + pages + ' pages; it must be exactly one.');
  const box = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(s);
  if (!box || Math.abs(Number(box[1]) - 612) > 1 || Math.abs(Number(box[2]) - 792) > 1) refuse('The page is not 8.5 x 11 in.');
  if (/\/Subtype\s*\/Type3/.test(s)) refuse('The PDF draws its text as Type 3 glyphs (a variable web font); render with the static Plex files.');
  return { pages, bytes: buf.length };
}

/* multipart/form-data by hand: one body, no dependency on whichever
   FormData the fetch in use happens to understand. */
function multipart(fields, file) {
  const boundary = '----coldenjames' + crypto.randomBytes(12).toString('hex');
  const parts = [];
  for (const [name, value] of fields) {
    parts.push(Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="' + name + '"\r\n\r\n' + value + '\r\n'));
  }
  parts.push(Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="' + file.name +
    '"\r\nContent-Type: application/pdf\r\n\r\n'), file.data, Buffer.from('\r\n--' + boundary + '--\r\n'));
  return { body: Buffer.concat(parts), contentType: 'multipart/form-data; boundary=' + boundary };
}

function fieldsFor({ to, from, letter, mode }) {
  const f = [];
  for (const [k, v] of Object.entries(to)) f.push(['to[' + k + ']', v]);
  for (const [k, v] of Object.entries(from)) f.push(['from[' + k + ']', v]);
  for (const [k, v] of Object.entries(LETTER_OPTIONS)) f.push([k, String(v)]);
  /* Our own ids only: no business name, nothing from Google. */
  f.push(['description', 'ColdenJames letter ' + letter.prospectId]);
  f.push(['metadata[letter_id]', String(letter.id)]);
  f.push(['metadata[ref]', String(letter.prospectId)]);
  f.push(['metadata[mode]', mode]);
  return f;
}

/* The whole send. `store` needs recordLobLetter(letterId, result);
   `renderPdf(html)` returns the PDF bytes. */
async function sendLetter({ letter, from, key = '', declaredMode = '', live = false, renderPdf, fetchImpl, store, now = () => new Date() }) {
  assertApproved(letter);
  const mode = modeOf({ key, declaredMode });
  assertMode(mode, live);
  const fromAddr = lobAddress(from || {}, 'return');
  const toAddr = lobAddress(letter.to || {}, 'recipient');
  assertNoPlaceholder(letter.html);
  if (typeof renderPdf !== 'function') refuse('No PDF renderer.');
  const pdf = await renderPdf(letter.html);
  checkPdf(pdf);

  const { body, contentType } = multipart(fieldsFor({ to: toAddr, from: fromAddr, letter, mode }),
    { name: 'letter-' + letter.id + '.pdf', data: Buffer.from(pdf) });
  const headers = {
    'Content-Type': contentType,
    'Idempotency-Key': 'coldenjames-letter-' + letter.id + '-' + mode
  };
  /* With the key in hand we send it; a proxy that injects it adds its own. */
  if (key) headers.Authorization = 'Basic ' + Buffer.from(key + ':').toString('base64');

  const f = fetchImpl || require('../finder/lib/http.js').fetch;
  const res = await f(LOB_LETTERS, { method: 'POST', headers, body });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* reported below */ }
  const scrub = s => key ? String(s).split(key).join('[key]') : String(s);
  if (!res.ok || !json) {
    const why = json && json.error ? (json.error.message || json.error.code) : text.slice(0, 200);
    throw new Error('Lob refused the letter (HTTP ' + res.status + '): ' + scrub(why));
  }
  if (!/^ltr_/.test(json.id || '')) throw new Error('Lob answered without a letter id.');

  const result = {
    lobLetterId: json.id,
    expectedDeliveryDate: json.expected_delivery_date || null,
    mode,
    sentAt: now().toISOString()
  };
  await store.recordLobLetter(letter.id, result);
  return result;
}

/* The envelope: the qualifying party and the business name, as the letter
   itself writes them (title case, no LLC), from the licence mailing
   address. */
function recipientOf(prospect) {
  const { businessName, titleCase } = require('../finder/pilot/lib/names.js');
  return {
    name: prospect.ownerName ? titleCase(prospect.ownerName) : '',
    company: businessName(prospect.company),
    line1: prospect.mailingStreet, line2: '',
    city: titleCase(prospect.mailingCity || ''), state: prospect.mailingState || 'LA', zip: prospect.mailingZip
  };
}

module.exports = { sendLetter, recipientOf, checkPdf, lobAddress, modeOf, assertMode, assertApproved, assertNoPlaceholder,
  multipart, LETTER_OPTIONS, LOB_LETTERS, LobRefusal };
