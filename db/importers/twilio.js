'use strict';

/* Twilio call and text history on the ColdenJames number → messages.

   The sid is the id, so running it twice adds nothing. A number that
   belongs to a known prospect is linked to them; every other number is
   kept (it is our own history, in a private database) but Explorer only
   ever shows its last four digits.

     node db/importers/twilio.js --confirm */

const { args, cliStore } = require('./common.js');
const { BUSINESS_NUMBER } = require('../../lib/explorer/twilio-feed.js');

const digits = n => String(n || '').replace(/\D/g, '').slice(-10);

function toMessages({ calls = [], messages = [] }, known) {
  const mine = digits(BUSINESS_NUMBER);
  const out = [];
  for (const c of calls) {
    const inbound = digits(c.to) === mine;
    const other = inbound ? c.from : c.to;
    const k = known.get(digits(other));
    out.push({ id: c.sid, kind: 'call', direction: inbound ? 'in' : 'out', otherParty: other, prospectId: k ? k.id : null,
               body: null, status: c.status || null, at: new Date(c.start_time || c.date_created).toISOString() });
  }
  for (const m of messages) {
    const inbound = digits(m.to) === mine;
    const other = inbound ? m.from : m.to;
    const k = known.get(digits(other));
    out.push({ id: m.sid, kind: 'text', direction: inbound ? 'in' : 'out', otherParty: other, prospectId: k ? k.id : null,
               body: m.body || null, status: m.status || null, at: new Date(m.date_sent || m.date_created).toISOString() });
  }
  return out;
}

async function fetchHistory({ sid, token, fetchImpl = fetch, pageSize = 200 }) {
  const auth = { Authorization: 'Basic ' + Buffer.from(sid + ':' + token).toString('base64') };
  const base = 'https://api.twilio.com/2010-04-01/Accounts/' + encodeURIComponent(sid);
  const n = encodeURIComponent(BUSINESS_NUMBER);
  const get = async p => { const r = await fetchImpl(base + p, { headers: auth }); if (!r.ok) throw new Error('Twilio ' + r.status); return r.json(); };
  const [ci, mi, mo] = await Promise.all([
    get('/Calls.json?To=' + n + '&PageSize=' + pageSize),
    get('/Messages.json?To=' + n + '&PageSize=' + pageSize),
    get('/Messages.json?From=' + n + '&PageSize=' + pageSize)
  ]);
  return { calls: ci.calls || [], messages: [...(mi.messages || []), ...(mo.messages || [])] };
}

async function importTwilio({ history, store }) {
  const rows = toMessages(history, await store.knownPhones());
  for (const m of rows) await store.addMessage(m);
  return { messages: rows.length };
}

module.exports = { importTwilio, toMessages, fetchHistory };

if (require.main === module) {
  (async () => {
    const o = args(process.argv.slice(2));
    const store = await cliStore(o);
    const sid = process.env.TWILIO_ACCOUNT_SID, token = process.env.TWILIO_AUTH_TOKEN;
    if (!sid || !token) throw new Error('Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.');
    const r = await importTwilio({ history: await fetchHistory({ sid, token, fetchImpl: require('../../finder/lib/http.js').fetch }), store });
    console.log('imported ' + r.messages + ' calls and texts');
    process.exit(0);
  })().catch(e => { console.error(e.message); process.exit(1); });
}
