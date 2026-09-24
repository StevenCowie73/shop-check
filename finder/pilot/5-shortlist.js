'use strict';
/* Scratch only. Merges what Astra found into the ranked forty, re-ranks
   with the website signal the lookups added, and marks the top twenty. */

const fs = require('fs');
const path = require('path');
const P = require('./lib/paths.js');
const { rank } = require('./lib/rank.js');

const BAD_ENOUGH = 40;
const spineFile = P.spine;
const full = JSON.parse(fs.readFileSync(spineFile, 'utf8'));
const spine = full.records;

/* ---- fold the Astra answers into the records ---- */
const astra = JSON.parse(fs.readFileSync(P.astraWebsites(1), 'utf8'));
const audit = JSON.parse(fs.readFileSync(P.astraAuditJson(1), 'utf8'));
const auditByUrl = new Map(audit.sites.map(s => [s.website, s]));

const byCompany = new Map(spine.map(r => [r.company, r]));
for (const a of astra.results) {
  const rec = byCompany.get(a.company);
  if (!rec) continue;
  rec.astra = {
    askedWith: { company: a.company, city: a.city },   /* all that was sent */
    website: a.website,
    source: a.source || '',
    rejected: a.rejected || undefined,
    rejectedWebsite: a.rejectedWebsite || undefined,
    costUsd: a.cost === undefined ? null : Number(a.cost.toFixed(4))
  };
  if (a.website === 'not found') {
    rec.website = 'not found';
    rec.websiteState = 'not found';
    continue;
  }
  const s = auditByUrl.get(a.website);
  if (!s) continue;
  const scored = Number.isFinite(s.siteScore) ? s.siteScore : null;
  rec.website = a.website;
  rec.websiteAudit = {
    url: s.website,
    siteScore: scored,
    loads: s.skipped ? null : !!s.loads,
    skipped: !!s.skipped,
    parked: !!s.parked,
    whatsWrong: s.whatsWrong || '',
    signals: s.signals || [],
    foundBy: 'astra',
    badEnoughToReplace: scored !== null && scored >= BAD_ENOUGH
  };
  rec.websiteState = s.skipped ? 'unknown'
    : ((!s.loads || s.parked) ? 'dead' : (scored >= BAD_ENOUGH ? 'poor' : 'fine'));
}

/* ---- re-rank with what we now know ---- */
const reranked = rank(spine).slice(0, 40);
const SPINE_TYPES = new Set(['Residential License Certificate', 'Home Improvement Registration']);
const statusOf = l => String(l.status || '').trim().toLowerCase();

/* The one thing a letter could open with. Nothing unknown or "not found"
   ever produces one — we did not see a website, so we claim nothing. */
function usableFinding(rec) {
  const st = rec.websiteState;
  if (st !== 'dead' && st !== 'poor') return '';
  const a = rec.websiteAudit;
  if (!a || a.siteScore === null) return '';
  return a.whatsWrong || '';
}

const rows = reranked.map((x, i) => {
  const rec = x.rec;
  const active = rec.licenses.filter(l => SPINE_TYPES.has(l.type) && statusOf(l) === 'active');
  const types = [...new Set(active.map(l => l.type.replace(' License Certificate', '').replace(' Registration', '')))];
  let newest = '';
  let newestD = null;
  for (const l of active) {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(l.firstIssued || '');
    const d = m ? new Date(+m[3], +m[1] - 1, +m[2]) : null;
    if (d && (!newestD || d > newestD)) { newestD = d; newest = l.firstIssued; }
  }
  return {
    rank: i + 1,
    top20: i < 20,
    company: rec.company,
    city: rec.mailingAddress.city,
    licenceTypes: types,
    firstIssued: newest,
    qualifyingParties: rec.qualifyingParties,
    emailKind: rec.emailKind || 'none',
    websiteState: rec.websiteState || 'not found',
    website: rec.website || rec.websiteCandidate || 'not found',
    websiteFoundBy: rec.astra ? 'astra' : (rec.websiteCandidate ? 'company-domain email' : null),
    usableFinding: usableFinding(rec),
    score: x.score,
    reasons: x.reasons
  };
});

full.pilotShortlist = {
  builtAt: new Date().toISOString(),
  method: 'Active companies only. Weights: licensed within 12 months 200, within 24 months 100, website dead or poor 50, holds a Residential licence 25, exactly one qualifying party 10. Age dominates by construction.',
  astra: {
    model: 'gpt-6-astra',
    sentPerCompany: 'company name and mailing-address city only',
    lookups: astra.results.length,
    costUsd: Number(astra.spent.toFixed(2)),
    websitesFound: astra.results.filter(r => r.website !== 'not found').length,
    rejectedOnReview: astra.results.filter(r => r.rejected).length,
    notFound: astra.results.filter(r => r.website === 'not found').length
  },
  rows
};
fs.writeFileSync(spineFile, JSON.stringify(full, null, 1));

const tally = {};
for (const r of rows) tally[r.websiteState] = (tally[r.websiteState] || 0) + 1;
console.log('top 40 website states:', JSON.stringify(tally));
console.log('with a usable finding:', rows.filter(r => r.usableFinding).length);
console.log('astra spend: $' + astra.spent.toFixed(2));
for (const r of rows) {
  console.log(
    String(r.rank).padStart(2) + (r.top20 ? '*' : ' '),
    r.company.slice(0, 38).padEnd(40),
    (r.city || '').slice(0, 12).padEnd(13),
    r.licenceTypes.join('+').padEnd(24),
    (r.firstIssued || '').padEnd(11),
    (r.qualifyingParties[0] || '(none)').slice(0, 24).padEnd(26),
    r.emailKind.padEnd(15),
    r.websiteState.padEnd(10),
    r.usableFinding ? r.usableFinding.slice(0, 70) : '—');
}
