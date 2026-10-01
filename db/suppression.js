'use strict';

/* The do-not-contact list from the command line (lib/suppression.js).

     node db/suppression.js --status [--https] --confirm
         how many entries, by reason, and how many prospects are marked.
         Counts only; no number or address is printed.

     node db/suppression.js --backfill [--https] --confirm
         writes the phone and address keys onto every prospect, puts any
         prospect already flagged do not contact onto the list, and marks
         every prospect the list matches. Safe to run again.

     node db/suppression.js --sync-twilio [--https] --confirm
         reads the texts Twilio has logged to the business number and puts
         every opt-out (STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT, REVOKE,
         OPTOUT) on the list. The webhook does this as each one arrives; this
         is the catch-up for any it missed. A text already recorded adds
         nothing.

     node db/suppression.js --add --reason by_hand|deletion_request
         (--prospect ID | --phone NUMBER | --street "..." --zip 71111)
         [--https] --confirm
         one entry by hand. A deletion request goes on before the data is
         deleted, so the business is never written to again.

   The database URL is never printed. */

const { args, cliPool } = require('./importers/common.js');
const { createPgStore } = require('../lib/explorer/pg-store.js');
const { phoneKey, addressKey, optOutWord, REASONS, maskPhone } = require('../lib/suppression.js');

/* Every prospect's keys, as the arrays one UPDATE ... FROM unnest() needs. */
function keysFor(rows) {
  const ids = [], phones = [], addresses = [];
  for (const r of rows) {
    ids.push(r.id); phones.push(phoneKey(r.phone)); addresses.push(addressKey(r.mailing_street, r.mailing_zip));
  }
  return { ids, phones, addresses };
}

async function backfill(pool) {
  const q = (sql, p = []) => pool.query(sql, p).then(r => r.rows);
  const rows = await q(`SELECT id, phone, mailing_street, mailing_zip FROM prospects`);
  const k = keysFor(rows);
  await q(`UPDATE prospects p SET phone_key = v.pk, address_key = v.ak
    FROM unnest($1::text[], $2::text[], $3::text[]) AS v(id, pk, ak) WHERE p.id = v.id`, [k.ids, k.phones, k.addresses]);
  const store = createPgStore(pool);
  let listed = 0;
  for (const p of await q(`SELECT id, phone_key, address_key FROM prospects WHERE do_not_contact
      AND (phone_key IS NOT NULL OR address_key IS NOT NULL)`)) {
    const r = await store.suppress({ phoneKey: p.phone_key, addressKey: p.address_key, reason: 'by_hand', prospectId: p.id, detail: { source: 'backfill' } });
    if (r.added) listed++;
  }
  const marked = await q(`UPDATE prospects p SET do_not_contact = true, updated_at = now() WHERE NOT p.do_not_contact AND EXISTS (
      SELECT 1 FROM suppressions s WHERE s.revoked_at IS NULL AND ((s.phone_key IS NOT NULL AND s.phone_key = p.phone_key)
        OR (s.address_key IS NOT NULL AND s.address_key = p.address_key))) RETURNING id`);
  return { prospects: rows.length, withPhoneKey: k.phones.filter(Boolean).length,
    withAddressKey: k.addresses.filter(Boolean).length, flaggedPutOnList: listed, newlyMarked: marked.length };
}

/* The opt-outs in a list of Twilio message records, oldest first. */
function optOutsIn(messages, businessNumber, ownerCell) {
  const digits = n => String(n || '').replace(/\D/g, '').slice(-10);
  return messages
    .filter(m => digits(m.to) === digits(businessNumber) && digits(m.from) !== digits(ownerCell))
    .map(m => ({ m, word: optOutWord(m.body) }))
    .filter(x => x.word)
    .map(({ m, word }) => ({ from: m.from, word, messageSid: m.sid, at: new Date(m.date_sent || m.date_created).toISOString() }))
    .sort((a, b) => a.at.localeCompare(b.at));
}

/* Every inbound text Twilio has, page by page. */
async function inboundTexts({ sid, token, businessNumber, fetchImpl = fetch }) {
  const auth = { Authorization: 'Basic ' + Buffer.from(sid + ':' + token).toString('base64') };
  let next = '/2010-04-01/Accounts/' + encodeURIComponent(sid) + '/Messages.json?To=' + encodeURIComponent(businessNumber) + '&PageSize=1000';
  const out = [];
  while (next) {
    const r = await fetchImpl('https://api.twilio.com' + next, { headers: auth });
    if (!r.ok) throw new Error('Twilio answered ' + r.status);
    const j = await r.json();
    out.push(...(j.messages || []));
    next = j.next_page_uri || null;
  }
  return out;
}

async function syncTwilio({ store, messages, businessNumber, ownerCell }) {
  const found = optOutsIn(messages, businessNumber, ownerCell);
  const result = { optOuts: found.length, newlyRecorded: 0, alreadyRecorded: 0, matchedProspects: 0, notUS: 0, numbers: [] };
  for (const o of found) {
    const r = await store.recordOptOut(o);
    if (!r.recorded) { result.notUS++; continue; }
    if (r.already) result.alreadyRecorded++; else result.newlyRecorded++;
    result.matchedProspects += r.matched.length;
    result.numbers.push(maskPhone(o.from) + ' ' + o.word + (r.matched.length ? ' (prospect)' : '') + (r.already ? ' already on the list' : ' added'));
  }
  return result;
}

async function status(pool) {
  const q = sql => pool.query(sql).then(r => r.rows);
  return {
    entries: await q(`SELECT reason, (revoked_at IS NOT NULL) AS revoked, count(*)::int AS n FROM suppressions GROUP BY 1, 2 ORDER BY 1, 2`),
    prospects: (await q(`SELECT count(*)::int AS total, sum(do_not_contact::int)::int AS do_not_contact,
      count(phone_key)::int AS with_phone_key, count(address_key)::int AS with_address_key FROM prospects`))[0]
  };
}

if (require.main === module) {
  (async () => {
    const o = args(process.argv.slice(2));
    const pool = cliPool(o);
    const store = createPgStore(pool);
    if (o.status) console.log(JSON.stringify(await status(pool), null, 1));
    else if (o.backfill) console.log(JSON.stringify(await backfill(pool), null, 1));
    else if (o['sync-twilio']) {
      const sid = process.env.TWILIO_ACCOUNT_SID, token = process.env.TWILIO_AUTH_TOKEN;
      if (!sid || !token) throw new Error('Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.');
      const { BUSINESS_NUMBER } = require('../lib/explorer/twilio-feed.js');
      const messages = await inboundTexts({ sid, token, businessNumber: BUSINESS_NUMBER });
      const r = await syncTwilio({ store, messages, businessNumber: BUSINESS_NUMBER, ownerCell: process.env.OWNER_CELL || '' });
      console.log('inbound texts read: ' + messages.length);
      console.log(JSON.stringify(r, null, 1));
    } else if (o.add) {
      if (!REASONS.includes(o.reason) || o.reason === 'stop_text') throw new Error('--reason must be by_hand or deletion_request (a STOP text is recorded from Twilio).');
      let keys, prospectId = null;
      if (o.prospect) {
        const p = (await pool.query(`SELECT id, phone, mailing_street, mailing_zip FROM prospects WHERE id = $1`, [o.prospect])).rows[0];
        if (!p) throw new Error('No prospect ' + o.prospect + '.');
        keys = { phoneKey: phoneKey(p.phone), addressKey: addressKey(p.mailing_street, p.mailing_zip) };
        prospectId = p.id;
      } else keys = { phoneKey: o.phone ? phoneKey(o.phone) : null, addressKey: o.street ? addressKey(o.street, o.zip) : null };
      if (!keys.phoneKey && !keys.addressKey) throw new Error('Nothing to list: give --prospect, a US --phone, or --street with a 5-digit --zip.');
      const r = await store.suppress({ ...keys, reason: o.reason, prospectId, detail: { source: 'command line' } });
      if (prospectId) await pool.query(`UPDATE prospects SET do_not_contact = true, updated_at = now() WHERE id = $1`, [prospectId]);
      console.log(r.added ? 'added; ' + r.marked.length + ' prospect(s) newly marked do not contact' : 'already on the list');
    } else throw new Error('Say what to do: --status, --backfill, --sync-twilio or --add.');
    process.exit(0);
  })().catch(e => { console.error(String(e.message).replace(/postgres(ql)?:\/\/\S+/g, '[url]')); process.exit(1); });
}

module.exports = { keysFor, backfill, optOutsIn, inboundTexts, syncTwilio, status };
