'use strict';

/* The do-not-contact list, as the Twilio webhooks see it.

   Two things happen on the business line:

   - An opt-out text (STOP and the rest, lib/suppression.js) from anyone but
     the owner goes on the list as it arrives. If it cannot be recorded the
     owner is told in one line, and db/suppression.js --sync-twilio picks it
     up later from Twilio's log.
   - A call or text from a number that is do not contact gets the owner one
     extra line, "Note: <business> is marked do not contact." Nothing is
     blocked: they reached out to us, and Twilio already stops texts to
     anyone who texted STOP. The note only makes sure the owner knows before
     answering.

   The list lives in the database, whatever EXPLORER_DATA says Explorer
   reads: one pool per instance. Tests replace deps. Neither path ever
   throws into a webhook. */

const { sendSms } = require('./twilio.js');
const { formatUS } = require('./reply-through.js');
const { maskPhone } = require('./suppression.js');

const scrub = e => String(e && e.message).replace(/postgres(ql)?:\/\/\S+/g, '[url]');

let pgStore = null;
function store() {
  const { databaseUrl } = require('./explorer/store.js');
  const url = databaseUrl();
  if (!url) throw new Error('no database is configured');
  if (!pgStore) {
    const { Pool } = require('pg');
    const { createPgStore } = require('./explorer/pg-store.js');
    pgStore = createPgStore(new Pool({ connectionString: url, max: 1, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: true } }));
  }
  return pgStore;
}

const deps = {
  recordOptOut: entry => store().recordOptOut(entry),
  /* null, or { company } — company is null for a listed number that is no
     prospect's. */
  doNotContactByPhone: phone => store().doNotContactByPhone(phone)
};

async function recordOptOut({ sid, token, businessNumber, ownerCell, from, word, messageSid }) {
  try {
    await deps.recordOptOut({ from, word, messageSid: messageSid || null, at: new Date().toISOString() });
  } catch (err) {
    console.error('could not put ' + maskPhone(from) + ' on the do-not-contact list: ' + scrub(err));
    try {
      await sendSms({ sid, token, from: businessNumber, to: ownerCell,
        body: 'ColdenJames: ' + formatUS(from) + ' texted ' + word + ' but it could not be put on the do-not-contact list. Run db/suppression.js --sync-twilio.' });
    } catch (e) {
      console.error('could not tell the owner either: ' + (e && e.message));
    }
  }
}

/* The business as the letter names it: title case, no LLC. */
function noteFor(hit, from) {
  const { businessName } = require('../finder/pilot/lib/names.js');
  return 'Note: ' + (hit.company ? businessName(hit.company) : formatUS(from)) + ' is marked do not contact.';
}

/* The extra line, if this number is do not contact. A lookup that fails or
   takes longer than `timeoutMs` sends nothing: the call or text itself
   must never wait on it for long, and the note is a courtesy. */
async function noteIfDoNotContact({ sid, token, businessNumber, ownerCell, from, timeoutMs = 2500 }) {
  let hit = null, timer = null;
  try {
    hit = await Promise.race([deps.doNotContactByPhone(from),
      new Promise((_, no) => { timer = setTimeout(() => no(new Error('timed out')), timeoutMs); })]);
  } catch (err) {
    console.error('could not check ' + maskPhone(from) + ' against the do-not-contact list: ' + scrub(err));
    return false;
  } finally {
    clearTimeout(timer);
  }
  if (!hit) return false;
  try {
    await sendSms({ sid, token, from: businessNumber, to: ownerCell, body: noteFor(hit, from) });
    return true;
  } catch (err) {
    console.error('could not send the do-not-contact note: ' + (err && err.message));
    return false;
  }
}

module.exports = { deps, recordOptOut, noteIfDoNotContact, noteFor };
