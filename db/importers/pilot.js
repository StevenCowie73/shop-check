'use strict';

/* LSLBC pilot outputs → areas, runs, prospects, audits.

   Reads finder/pilot/out/spine.json (one record per licence holder, with
   websiteState and websiteAudit merged on) and out/refs.json (company →
   reference code). A company with a code was picked for a letter; its code
   is its id here, so a tracked page open finds it. The rest get an id from
   their licence number and are kept as "found".

   Pins go at the licence mailing address, geocoded with the US Census
   Geocoder (lib/explorer/geocode.js). A failed match leaves the pin off
   the map rather than guessing.

     node db/importers/pilot.js --area youngsville --name Youngsville \
       --run run-youngsville --label "Youngsville test" --confirm [--no-geocode] */

const path = require('path');
const { isoDate, readJson, args, cliStore } = require('./common.js');
const { tradeNoun } = require('../../finder/pilot/lib/names.js');

const SPINE_TYPES = new Set(['Residential License Certificate', 'Home Improvement Registration']);

/* The pipeline's words for a website, in Explorer's. A check that was
   refused is "blocked"; one we chose not to make is "unknown". */
function auditOf(rec) {
  const a = rec.websiteAudit || {};
  const s = rec.websiteState;
  let state = 'unknown';
  if (s === 'fine' || s === 'poor') state = s;
  else if (s === 'dead') state = 'broken';
  else if (s === 'not found') state = 'not_found';
  else if (s === 'unknown' && /block|403|forbidden|bot/i.test(a.skipNote || '')) state = 'blocked';
  return {
    url: a.finalUrl || a.url || rec.website || null,
    state,
    loads: a.loads ?? null,
    whatsWrong: a.whatsWrong || a.skipNote || null,
    foundBy: rec.astra ? 'astra' : (rec.websiteCandidate ? 'email' : null),
    viewport: Array.isArray(a.signals) ? !a.signals.includes('viewport') : null
  };
}

function prospectOf(rec, { id, areaId, runId, selected }) {
  const active = (rec.licenses || []).filter(l => SPINE_TYPES.has(l.type));
  const newest = active.map(l => isoDate(l.firstIssued)).filter(Boolean).sort().pop() || null;
  const m = rec.mailingAddress || {};
  return {
    id, areaId, runId, selected,
    company: rec.company,
    ownerName: (rec.qualifyingParties || [])[0] || null,
    trade: tradeNoun(rec.company).noun,
    licenceTypes: [...new Set(active.map(l => l.type))],
    licenceStatus: active.some(l => /active/i.test(l.status || '')) ? 'Active' : (active[0] && active[0].status) || null,
    firstIssued: newest,
    email: rec.email || null,
    phone: rec.phone || null,
    mailingStreet: m.street || null,
    mailingCity: m.city || null,
    mailingState: m.state || 'LA',
    mailingZip: m.zip || null,
    status: 'not_contacted'
  };
}

async function importPilot({ spine, refs, area, run, store, geocode = null }) {
  await store.upsertArea(area);
  if (run) await store.upsertRun({ ...run, areaId: area.id });
  let n = 0, pinned = 0;
  for (const rec of spine) {
    const ref = refs[rec.company];
    const licence = ((rec.licenses || [])[0] || {}).number || String(n);
    const p = prospectOf(rec, { id: ref || 'L' + String(licence).replace(/[^A-Za-z0-9]/g, ''), areaId: area.id,
      runId: run ? run.id : null, selected: !!ref });
    if (geocode && p.mailingStreet) {
      try {
        const g = await geocode([p.mailingStreet, p.mailingCity, p.mailingState, p.mailingZip].filter(Boolean).join(', '));
        if (g) { p.lat = g.lat; p.lng = g.lng; p.geocodeSource = g.source; pinned++; }
      } catch (e) { /* no pin rather than a wrong one */ }
    }
    await store.upsertProspect(p);
    if (rec.websiteState) await store.addAudit(p.id, auditOf(rec));
    n++;
  }
  return { prospects: n, pinned };
}

module.exports = { importPilot, auditOf, prospectOf };

if (require.main === module) {
  (async () => {
    const o = args(process.argv.slice(2));
    const P = require('../../finder/pilot/lib/paths.js');
    if (!o.area) throw new Error('--area is required');
    const store = await cliStore(o);
    const { geocode } = require('../../lib/explorer/geocode.js');
    const r = await importPilot({
      spine: readJson(o.spine || P.spine), refs: readJson(o.refs || P.refs),
      area: { id: o.area, name: o.name || o.area },
      run: o.run ? { id: o.run, label: o.label || o.run, startedAt: new Date().toISOString() } : null,
      store, geocode: o['no-geocode'] ? null : a => geocode(a)
    });
    console.log('imported ' + r.prospects + ' prospects, ' + r.pinned + ' pinned from ' + path.basename(o.spine || P.spine));
    process.exit(0);
  })().catch(e => { console.error(e.message); process.exit(1); });
}
