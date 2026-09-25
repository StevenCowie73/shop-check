'use strict';

/* Tracking events → events.

   api/track.js logs one JSON line per event: {at, ref, event, channel,
   device}. Export the lines from the Vercel logs into a file and point this
   at it. Lines that are not tracking events, or carry no ref, are skipped.

     node db/importers/tracking.js events.jsonl --confirm */

const fs = require('fs');
const { args, cliStore } = require('./common.js');

const KINDS = new Set(['page_open', 'listing_shown', 'animation_played', 'text_tapped', 'call_tapped', 'intake_opened']);
const RENAME = { page_open: 'page_opened' };

function parseLines(text) {
  const out = [];
  for (const line of String(text).split('\n')) {
    const s = line.indexOf('{');
    if (s < 0) continue;
    let e;
    try { e = JSON.parse(line.slice(s)); } catch (x) { continue; }
    if (!e || !KINDS.has(e.event) || !/^[A-Za-z0-9]{4,24}$/.test(String(e.ref || '')) || !e.at) continue;
    out.push({ prospectId: e.ref, kind: RENAME[e.event] || e.event, at: new Date(e.at).toISOString(),
               detail: { channel: e.channel || null, device: e.device || null }, source: 'tracking' });
  }
  return out;
}

async function importTracking({ text, store }) {
  const events = parseLines(text);
  for (const e of events) await store.addEvent(e);
  return { events: events.length };
}

module.exports = { importTracking, parseLines };

if (require.main === module) {
  (async () => {
    const o = args(process.argv.slice(2));
    if (!o._[0]) throw new Error('usage: node db/importers/tracking.js FILE --confirm');
    const store = await cliStore(o);
    const r = await importTracking({ text: fs.readFileSync(o._[0], 'utf8'), store });
    console.log('imported ' + r.events + ' events');
    process.exit(0);
  })().catch(e => { console.error(e.message); process.exit(1); });
}
