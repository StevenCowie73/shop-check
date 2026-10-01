'use strict';

/* The do-not-contact list: who we never write to, text or email again.

   The letter says "Text STOP to the number above and you won't hear from me
   again", and the privacy page says a business we wrote to is never written
   to again. A flag on one prospect row cannot keep either promise: the next
   run, or another area, finds the same business as a new row. So the list
   is kept apart from the prospects, keyed by what identifies a business
   from one licence record to the next — its phone number and its mailing
   address — and any prospect matching an entry is do-not-contact, whenever
   and wherever it is imported.

   This file is the one definition of those keys and of an opt-out text.
   The store (lib/explorer/pg-store.js) holds the list, db/suppression.js is
   the command-line door, and every step that contacts a prospect asks
   suppressedSql() or whyNotContactable() first. A future email step must
   too. */

/* 10 digits, US. A leading country code 1 is dropped; anything that is not
   then a plausible NANP number gives no key rather than a wrong one. */
function phoneKey(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.length === 11 && d[0] === '1') d = d.slice(1);
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(d) ? d : null;
}

const WORDS = {
  street: 'st', str: 'st', road: 'rd', avenue: 'ave', av: 'ave', drive: 'dr', drv: 'dr', boulevard: 'blvd',
  lane: 'ln', highway: 'hwy', hiway: 'hwy', court: 'ct', circle: 'cir', place: 'pl', parkway: 'pkwy',
  trail: 'trl', terrace: 'ter', square: 'sq', expressway: 'expy', freeway: 'fwy', loop: 'loop', way: 'way',
  suite: 'ste', apartment: 'apt', unit: 'unit', building: 'bldg', floor: 'fl',
  north: 'n', south: 's', east: 'e', west: 'w', northeast: 'ne', northwest: 'nw', southeast: 'se', southwest: 'sw'
};

/* Street and 5-digit ZIP, lower case, punctuation gone, the usual words
   abbreviated the way the Postal Service does, so "1325 Barksdale Blvd.,
   Suite 105" and "1325 BARKSDALE BLVD STE 105" are the same key. No street
   or no ZIP gives no key. */
function addressKey(street, zip) {
  const z = String(zip || '').trim().slice(0, 5);
  if (!/^\d{5}$/.test(z)) return null;
  let s = String(street || '').toLowerCase()
    .replace(/\bp\.\s*o\.\s*/g, 'po ').replace(/\bpost\s+office\s+box\b/g, 'po box').replace(/\bp\s+o\s+box\b/g, 'po box')
    .replace(/\./g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  if (!s) return null;
  s = s.split(' ').map(w => WORDS[w] || w).join(' ');
  return s + '|' + z;
}

/* Twilio's opt-out words (help.twilio.com, "Twilio's default opt-out
   keywords"), plus the two it added later. A message is an opt-out when it
   is one of these and nothing else, ignoring case, spaces and punctuation,
   which is how Twilio itself decides — or when Twilio says so in the
   OptOutType it sends with the message. */
const OPT_OUT = ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'REVOKE', 'OPTOUT'];

function optOutWord(body, optOutType) {
  const w = String(body || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (OPT_OUT.includes(w)) return w;
  if (String(optOutType || '').toUpperCase() === 'STOP') return 'STOP';
  return null;
}

/* Why a list entry exists. A STOP text and a deletion request are the
   person's own words; only an entry made by hand can be taken back by
   hand. */
const REASONS = ['stop_text', 'by_hand', 'deletion_request'];

/* SQL true when the prospect row `a` is do-not-contact: its own flag, or
   any live entry on the list matching its phone or address. Used where a
   letter is approved or handed to Lob, so a list entry stops it even if
   the flag was never set. */
const suppressedSql = a => `(${a}.do_not_contact OR EXISTS (SELECT 1 FROM suppressions s WHERE s.revoked_at IS NULL AND (` +
  `(s.phone_key IS NOT NULL AND s.phone_key = ${a}.phone_key) OR (s.address_key IS NOT NULL AND s.address_key = ${a}.address_key))))`;

/* The one refusal every contact step gives, letters and email alike. */
function whyNotContactable(p, what = 'contacted') {
  if (!p) return 'No such business.';
  if (p.doNotContact) return (p.company || 'This business') + ' is marked do not contact; it is never ' + what + '.';
  return null;
}

/* Does an entry match a prospect? The in-memory twin of suppressedSql. */
const entryMatches = (e, p) => !e.revokedAt &&
  ((e.phoneKey && e.phoneKey === p.phoneKey) || (e.addressKey && e.addressKey === p.addressKey));

/* A number shown anywhere outside the database: last four digits only. */
const maskPhone = n => { const d = String(n || '').replace(/\D/g, ''); return d.length >= 4 ? '…' + d.slice(-4) : 'unknown number'; };

module.exports = { phoneKey, addressKey, OPT_OUT, optOutWord, REASONS, suppressedSql, whyNotContactable, entryMatches, maskPhone };
