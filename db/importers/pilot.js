'use strict';

/* LSLBC pilot outputs → areas, runs, prospects, audits, events.

   Reads finder/pilot/out/spine.json ({ counts, records, pilotShortlist }:
   one record per licence holder, with websiteState and websiteAudit merged
   on, and the ranked shortlist) and out/refs.json (company → reference
   code).

   Every record becomes a prospect, "found". The shortlist says who was
   picked: its top twenty (excluded companies never) are "selected", and
   every shortlisted company keeps its rank. refs.json is append-only, so a
   company can hold a code from an earlier pass and no longer be in the
   twenty: the code is still its id, so a tracked page open finds it, but it
   is not selected. A company with no code gets an id from its licence
   number. Codes never contain an L (lib/refs.js), so the two cannot meet.

   The audit facts (https, viewport, phone on the page, newest year, status
   code) come from the audit files themselves, matched by URL; the spine
   keeps only a summary of them.

   Pins go at the licence mailing address, geocoded with the US Census
   Geocoder. Pass --geocodes FILE (written by db/importers/geocode.js) to use
   saved matches; otherwise each address is looked up live. A failed match
   leaves the pin off the map rather than guessing.

   Nothing from Google is read or written: place_id is left empty.

     node db/importers/pilot.js --area bossier-caddo --name "Bossier / Caddo" \
       --parishes 2098:Caddo,1815:Bossier --here-in "Bossier City" \
       --run bossier-pilot --label "Bossier pilot" [--mock] \
       [--geocodes FILE] [--https] --confirm */

const fs = require('fs');
const path = require('path');
const { isoDate, readJson, args, cliStore } = require('./common.js');
const { tradeNoun } = require('../../finder/pilot/lib/names.js');

const SPINE_TYPES = new Set(['Residential License Certificate', 'Home Improvement Registration']);

/* The pipeline's words for a website, in Explorer's. A check the site
   refused is "blocked"; one never made, or never searched for, is
   "unknown". `site` is the audit's own record for this URL, if we have it. */
function auditOf(rec, site = null) {
  const a = rec.websiteAudit || {};
  const s = rec.websiteState;
  let state = 'unknown';
  if (s === 'fine' || s === 'poor') state = s;
  /* An audit made before the blocked-check fix recorded a 401, 403 or 429
     as dead. The site refused a robot; that is blocked, never broken. */
  else if (s === 'dead' && site && [401, 403, 429].includes(site.status)) state = 'blocked';
  else if (s === 'dead') state = 'broken';
  else if (s === 'not found') state = 'not_found';
  else if (s === 'unknown' && ((site && site.blocked) || /blocked|403|forbidden|\bbot\b/i.test(a.skipNote || ''))) state = 'blocked';
  const finalUrl = (site && site.finalUrl) || a.finalUrl || '';
  const looked = site && !site.skipped;
  return {
    url: finalUrl || a.url || (rec.website !== 'not found' ? rec.website : null) || null,
    state,
    loads: state === 'blocked' ? null : (a.loads ?? null),
    https: looked && site.loads ? /^https/i.test(site.finalScheme || finalUrl) : null,
    viewport: looked && site.loads ? !!site.viewport : null,
    phoneOnPage: looked && site.loads ? !!site.phoneOnPage : null,
    newestYear: looked && site.loads ? (site.newestYear || null) : null,
    statusCode: site && Number.isFinite(site.status) ? site.status : null,
    whatsWrong: state === 'blocked' ? 'unknown — the site blocked the check'
      : (a.whatsWrong || a.skipNote || (site && site.skipNote) || null),
    foundBy: rec.astra && rec.website && rec.astra.website === rec.website ? 'astra' : (rec.websiteCandidate ? 'email' : null),
    checkedAt: (site && site.checkedAt) || null
  };
}

/* A company's id: its letter code if it has one, else its licence number. */
function idOf(rec, refs, fallback) {
  if (refs[rec.company]) return refs[rec.company];
  const licence = ((rec.licenses || [])[0] || {}).number || String(fallback);
  return 'L' + String(licence).replace(/[^A-Za-z0-9]/g, '');
}

function prospectOf(rec, { id, areaId, runId, selected, rank = null }) {
  const active = (rec.licenses || []).filter(l => SPINE_TYPES.has(l.type));
  const newest = active.map(l => isoDate(l.firstIssued)).filter(Boolean).sort().pop() || null;
  const m = rec.mailingAddress || {};
  return {
    id, areaId, runId, selected, rank,
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

/* The one line the Census Geocoder is asked about, and the key a saved
   geocode is kept under. */
function addressLine(p) {
  return [p.mailingStreet, p.mailingCity, p.mailingState, p.mailingZip].filter(Boolean).join(', ');
}

/* The spine as the pipeline writes it; a bare array of records still works. */
function recordsOf(spine) { return Array.isArray(spine) ? spine : spine.records; }

/* company → { rank, selected } from the shortlist. */
function shortlistOf(spine) {
  const out = new Map();
  const rows = (!Array.isArray(spine) && spine.pilotShortlist && spine.pilotShortlist.rows) || [];
  for (const r of rows) {
    if (r.excluded) continue;
    out.set(r.company, { rank: r.rank || null, selected: !!r.top20 });
  }
  return out;
}

async function importPilot({ spine, refs = {}, area, run, store, geocode = null, geocodes = null, sites = [], checkedAt = null }) {
  const records = recordsOf(spine);
  const short = shortlistOf(spine);
  const siteByUrl = new Map();
  for (const s of sites) for (const u of [s.website, s.url, s.finalUrl]) if (u && !siteByUrl.has(u)) siteByUrl.set(u, s);

  await store.upsertArea(area);
  if (run) await store.upsertRun({ ...run, areaId: area.id });
  let n = 0, pinned = 0, selected = 0, audits = 0;
  const seen = new Set();
  for (const rec of records) {
    const s = short.get(rec.company) || { rank: null, selected: false };
    const p = prospectOf(rec, { id: idOf(rec, refs, n), areaId: area.id, runId: run ? run.id : null, selected: s.selected, rank: s.rank });
    if (seen.has(p.id)) throw new Error('two records share the id ' + p.id + '; not importing');
    seen.add(p.id);
    if (p.mailingStreet) {
      const line = addressLine(p);
      let g = null;
      if (geocodes) g = geocodes[line] || null;
      else if (geocode) { try { g = await geocode(line); } catch (e) { /* no pin rather than a wrong one */ } }
      if (g) { p.lat = g.lat; p.lng = g.lng; p.geocodeSource = g.source || 'census'; pinned++; }
    }
    await store.upsertProspect(p);
    if (rec.websiteState) {
      const a = rec.websiteAudit || {};
      const site = siteByUrl.get(a.url) || siteByUrl.get(a.finalUrl) || null;
      const audit = auditOf(rec, site);
      audit.checkedAt = audit.checkedAt || checkedAt;
      await store.addAudit(p.id, audit);
      audits++;
    }
    if (p.selected) {
      selected++;
      if (run) await store.addEvent({ prospectId: p.id, runId: run.id, kind: 'selected', at: run.startedAt,
        detail: { rank: p.rank }, source: 'pilot' });
    }
    n++;
  }
  if (run) await store.addEvent({ prospectId: null, runId: run.id, kind: 'run', at: run.startedAt,
    detail: { runId: run.id, text: run.label + ': ' + n + ' found, ' + selected + ' picked' + (run.mock ? ' (mock letters, never sent)' : '') },
    source: 'pilot' });
  return { prospects: n, pinned, selected, audits };
}

module.exports = { importPilot, auditOf, prospectOf, idOf, addressLine, recordsOf, shortlistOf };

if (require.main === module) {
  (async () => {
    const o = args(process.argv.slice(2));
    const P = require('../../finder/pilot/lib/paths.js');
    if (!o.area) throw new Error('--area is required');
    const spineFile = o.spine || P.spine;
    const spine = readJson(spineFile);
    const refs = fs.existsSync(o.refs || P.refs) ? readJson(o.refs || P.refs) : {};
    /* Every audit file this run wrote: the email candidates and each Astra round. */
    const auditFiles = [P.auditJson, P.astraAuditJson(1), P.astraAuditJson(2)].filter(f => fs.existsSync(f));
    const sites = [];
    let checkedAt = null;
    for (const f of auditFiles) {
      const j = readJson(f);
      for (const s of j.sites || []) sites.push({ ...s, checkedAt: j.checkedAt });
      if (!checkedAt || j.checkedAt > checkedAt) checkedAt = j.checkedAt;
    }
    const parishes = {};
    for (const pair of String(o.parishes || '').split(',').filter(Boolean)) {
      const [id, name] = pair.split(':'); parishes[id] = name;
    }
    const sl = !Array.isArray(spine) && spine.pilotShortlist || {};
    const c = !Array.isArray(spine) && spine.counts || {};
    const picked = [...shortlistOf(spine).values()].filter(x => x.selected).length;
    const cost = ((sl.astra && sl.astra.costUsd) || 0) + ((sl.astraRound2 && sl.astraRound2.costUsd) || 0);
    const run = o.run ? {
      id: o.run, label: o.label || o.run, mock: !!o.mock,
      startedAt: o.started ? new Date(o.started).toISOString() : (sl.builtAt || new Date().toISOString()),
      funnel: { licences: recordsOf(spine).length, active: c.activeCompaniesByWebsite ? c.activeCompaniesByWebsite.totalActiveCompanies : undefined,
        picked, ...(o.mock ? { mock: picked } : { drafted: picked, sent: 0 }) },
      costUsd: Number(cost.toFixed(2)),
      problems: o.problems ? String(o.problems).split('|') : []
    } : null;
    const store = await cliStore(o);
    let geocode = null, geocodes = null;
    if (o.geocodes) geocodes = readJson(o.geocodes);
    else if (!o['no-geocode']) {
      const { fetch } = require('../../finder/lib/http.js');
      const g = require('../../lib/explorer/geocode.js');
      geocode = a => g.geocode(a, { fetchImpl: fetch });
    }
    const r = await importPilot({
      spine, refs, store, geocode, geocodes, sites, checkedAt,
      area: { id: o.area, name: o.name || o.area, parishes, towns: o.towns ? String(o.towns).split(',') : [],
              zips: o.zips ? String(o.zips).split(',') : [], hereIn: o['here-in'] || 'Louisiana' },
      run
    });
    console.log('imported ' + r.prospects + ' prospects (' + r.selected + ' selected, ' + r.audits + ' audits), ' +
      r.pinned + ' pinned, from ' + path.basename(spineFile));
    process.exit(0);
  })().catch(e => { console.error(e.message); process.exit(1); });
}
