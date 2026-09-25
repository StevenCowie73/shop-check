'use strict';

/* Geocodes every licence mailing address in a pilot spine with the US
   Census Geocoder, once, and saves the answers for the pilot importer
   (--geocodes). Public data with no storage limits; nothing from Google.

     node db/importers/geocode.js [--spine out/spine.json] --out out/geocodes.json

   The output maps each one-line address to { lat, lng, matched, source }
   or null for no match. It names real addresses, so it belongs in the
   pilot's git-ignored out/ folder. Addresses already in --out are not
   looked up again. Prints the addresses that did not match. */

const fs = require('fs');
const { readJson, args } = require('./common.js');
const { recordsOf, prospectOf, addressLine } = require('./pilot.js');

async function geocodeAll(lines, lookup, { saved = {}, concurrency = 3, onEach = () => {} } = {}) {
  const out = { ...saved };
  const todo = [...new Set(lines)].filter(l => !(l in out));
  let next = 0;
  async function worker() {
    while (next < todo.length) {
      const line = todo[next++];
      let g = null;
      for (let attempt = 0; attempt < 3 && g === null; attempt++) {
        try { g = await lookup(line); break; } catch (e) { g = null; await new Promise(r => setTimeout(r, 1000 * (attempt + 1))); }
      }
      out[line] = g;
      onEach(line, g);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return out;
}

module.exports = { geocodeAll };

if (require.main === module) {
  (async () => {
    const o = args(process.argv.slice(2));
    const P = require('../../finder/pilot/lib/paths.js');
    if (!o.out) throw new Error('--out is required');
    const recs = recordsOf(readJson(o.spine || P.spine));
    const lines = recs.map(r => prospectOf(r, {})).filter(p => p.mailingStreet).map(addressLine);
    const noStreet = recs.length - lines.length;
    const { fetch } = require('../../finder/lib/http.js');
    const { geocode } = require('../../lib/explorer/geocode.js');
    const saved = fs.existsSync(o.out) ? readJson(o.out) : {};
    let done = 0;
    const out = await geocodeAll(lines, l => geocode(l, { fetchImpl: fetch }), { saved,
      onEach: () => { if (++done % 50 === 0) console.error('  ' + done + ' looked up'); } });
    fs.writeFileSync(o.out, JSON.stringify(out, null, 1));
    const uniq = [...new Set(lines)];
    const missed = uniq.filter(l => !out[l]);
    console.log(recs.length + ' records, ' + lines.length + ' with a street address (' + noStreet + ' without), ' +
      uniq.length + ' distinct addresses: ' + (uniq.length - missed.length) + ' matched, ' + missed.length + ' not matched');
    for (const l of missed) console.log('  no match: ' + l);
    process.exit(0);
  })().catch(e => { console.error(e.message); process.exit(1); });
}
