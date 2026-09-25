'use strict';

/* Calls and texts on the ColdenJames number, read live from Twilio for the
   Home feed. Nothing is stored. A number is shown only by its last four
   digits unless it belongs to a known prospect, and numbers inside a
   message body are masked the same way. */

const BUSINESS_NUMBER = process.env.COLDENJAMES_NUMBER || '+13186666445';

const digits = n => String(n || '').replace(/\D/g, '').slice(-10);
const mask = n => { const d = String(n || '').replace(/\D/g, ''); return d.length >= 4 ? '…' + d.slice(-4) : 'unknown number'; };
const maskInText = s => String(s || '').replace(/(\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, m => mask(m));

function who(number, known, ownerCell) {
  if (ownerCell && digits(number) === digits(ownerCell)) return { label: 'your cell', prospectId: null };
  const k = known.get(digits(number));
  return k ? { label: k.company, prospectId: k.id, company: k.company } : { label: mask(number), prospectId: null };
}

async function liveTwilioFeed({ sid, token, known, ownerCell, limit = 15, fetchImpl = fetch }) {
  if (!sid || !token) return [];
  const auth = { Authorization: 'Basic ' + Buffer.from(sid + ':' + token).toString('base64') };
  const base = 'https://api.twilio.com/2010-04-01/Accounts/' + encodeURIComponent(sid);
  const get = async path => { const r = await fetchImpl(base + path, { headers: auth }); return r.ok ? r.json() : {}; };
  const n = encodeURIComponent(BUSINESS_NUMBER);
  const [calls, textsIn, textsOut] = await Promise.all([
    get(`/Calls.json?To=${n}&PageSize=${limit}`),
    get(`/Messages.json?To=${n}&PageSize=${limit}`),
    get(`/Messages.json?From=${n}&PageSize=${limit}`)
  ]);
  const items = [];
  for (const c of calls.calls || []) {
    const w = who(c.from, known, ownerCell);
    items.push({ at: new Date(c.start_time || c.date_created).toISOString(), kind: 'call_in', live: true,
      prospectId: w.prospectId, company: w.company || null,
      text: 'Call from ' + w.label + (c.duration ? ' — ' + c.duration + 's' : '') });
  }
  for (const m of textsIn.messages || []) {
    const w = who(m.from, known, ownerCell);
    items.push({ at: new Date(m.date_sent || m.date_created).toISOString(), kind: 'text_in', live: true,
      prospectId: w.prospectId, company: w.company || null,
      text: 'Text from ' + w.label + ': "' + maskInText(m.body).slice(0, 80) + '"' });
  }
  for (const m of textsOut.messages || []) {
    const w = who(m.to, known, ownerCell);
    items.push({ at: new Date(m.date_sent || m.date_created).toISOString(), kind: 'text_out', live: true,
      prospectId: w.prospectId, company: w.company || null,
      text: 'Text to ' + w.label + ': "' + maskInText(m.body).slice(0, 80) + '"' });
  }
  return items;
}

module.exports = { liveTwilioFeed, mask, maskInText, BUSINESS_NUMBER };
