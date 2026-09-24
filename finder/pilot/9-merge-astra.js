'use strict';
/* Scratch only. Folds the second Astra round in, then re-ranks within the
   pilot set. The population is not re-opened to the wider 382: these are the
   companies already chosen, re-ordered on what we now know about them. */

const fs = require('fs');
const path = require('path');
const P = require('./lib/paths.js');
const { scoreRecord } = require('./lib/rank.js');
const BAD_ENOUGH = 40;

const file = P.spine;
const full = JSON.parse(fs.readFileSync(file, 'utf8'));
const byCompany = new Map(full.records.map(r => [r.company, r]));

const astra = JSON.parse(fs.readFileSync(P.astraWebsites(2), 'utf8'));
const auditFile = P.astraAuditJson(2);
const audit = fs.existsSync(auditFile) ? JSON.parse(fs.readFileSync(auditFile, 'utf8')) : { sites: [] };
const byUrl = new Map(audit.sites.map(s => [s.website, s]));

for (const a of astra.results) {
  const rec = byCompany.get(a.company);
  if (!rec) continue;
  /* Only fold in a lookup for a company that is a mismatch NOW. A company
     that failed the rule on an earlier pass and passes it today keeps the
     website it always had; replaying the old "not found" would erase it. */
  if (!rec.needsAstra) continue;
  rec.astra = {
    askedWith: { company: a.company, city: a.city },
    website: a.website,
    source: a.source || '',
    costUsd: a.cost === undefined ? null : Number(a.cost.toFixed(4)),
    round: 2
  };
  rec.needsAstra = false;
  if (a.website === 'not found') {
    rec.website = 'not found';
    rec.websiteState = 'not found';
    continue;
  }
  const s = byUrl.get(a.website);
  if (!s) continue;
  const scored = Number.isFinite(s.siteScore) ? s.siteScore : null;
  rec.website = a.website;
  rec.websiteAudit = {
    url: s.website, siteScore: scored,
    loads: s.skipped ? null : !!s.loads,
    skipped: !!s.skipped, parked: !!s.parked,
    whatsWrong: s.whatsWrong || '', signals: s.signals || [],
    source: 'astra',
    badEnoughToReplace: scored !== null && scored >= BAD_ENOUGH
  };
  rec.websiteState = s.skipped ? 'unknown'
    : ((!s.loads || s.parked) ? 'dead' : (scored >= BAD_ENOUGH ? 'poor' : 'fine'));
}

/* ---- re-rank inside the pilot set ---- */
const live = full.pilotShortlist.rows.filter(r => !r.excluded);
for (const row of live) {
  const rec = byCompany.get(row.company);
  const s = scoreRecord(rec);
  row.score = s ? s.score : 0;
  row.reasons = s ? s.reasons : [];
  row.websiteState = rec.websiteState || 'not found';
  row.website = rec.website || rec.websiteCandidate || 'not found';
  row.websiteSource = rec.websiteAudit ? rec.websiteAudit.source : null;
  row.usableFinding = (rec.websiteAudit && rec.websiteAudit.siteScore !== null &&
    (row.websiteState === 'dead' || row.websiteState === 'poor'))
    ? (rec.websiteAudit.whatsWrong || '') : '';
  row._newest = s && s.newest ? s.newest.getTime() : 0;
}
live.sort((a, b) => b.score - a.score || b._newest - a._newest || a.company.localeCompare(b.company));
live.forEach((r, i) => { r.rank = i + 1; r.top20 = i < 20; delete r._newest; });
full.pilotShortlist.rows = live.concat(full.pilotShortlist.rows.filter(r => r.excluded));
full.pilotShortlist.astraRound2 = {
  lookups: astra.results.length,
  costUsd: Number(astra.spent.toFixed(2)),
  found: astra.results.filter(r => r.website !== 'not found').length
};
fs.writeFileSync(file, JSON.stringify(full, null, 1));

console.log('top 20 after re-rank:');
for (const r of live.filter(x => x.top20)) {
  console.log(String(r.rank).padStart(2), r.company.slice(0, 40).padEnd(42),
    String(r.score).padStart(4), r.websiteState.padEnd(10),
    String(r.websiteSource || '-').padEnd(7), r.emailUsable ? 'emailUsable' : '');
}
const moved = live.filter(x => !x.top20).slice(0, 3);
console.log('\njust below the line: ' + moved.map(m => m.rank + ' ' + m.company).join(' | '));
