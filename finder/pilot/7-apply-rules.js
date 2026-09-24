'use strict';

/* Step 7. Three decisions applied to the shortlist.

   The mismatch rule. An email address on a licence record answers two
   different questions and they must not be confused. Can we write to this
   mailbox? Almost always yes — a gmail address is the one the owner handed
   the state board. Is the domain their website? Only a company domain can
   answer that, and only if it plausibly belongs to them. A law firm's domain on a
   A law firm's domain on a roofing licence is the roofer's attorney, and
   quoting it back to him as "the web address from your business email"
   would read as a mistake. The
   rule lives in lib/domains.js, including the case where the domain is the
   qualifying party's own name.

   The exclusions. Some licence holders are not a fit for a pitch built on
   missed customer calls, whatever they score.

   The source of each website. A letter says "the web address from your
   business email" or "I found X listed for you" depending on where the
   address came from, so the spine records which. */

const fs = require('fs');
const P = require('./lib/paths.js');
const { domainBelongsTo } = require('./lib/domains.js');

const file = P.spine;
const full = JSON.parse(fs.readFileSync(file, 'utf8'));
const byCompany = new Map(full.records.map(r => [r.company, r]));

/* Companies to keep out of the pilot whatever they score, as
   { "Company name exactly as the register spells it": "why" }.

   This names real businesses, so it lives in out/ with the rest of the
   prospect data and never in the repository. See exclusions.example.json. */
function loadExclusions() {
  if (!fs.existsSync(P.exclusions)) return {};
  try {
    return JSON.parse(fs.readFileSync(P.exclusions, 'utf8'));
  } catch (err) {
    console.error('could not read ' + P.exclusions + ': ' + err.message);
    process.exit(1);
  }
}
const EXCLUSIONS = loadExclusions();

/* ---- 1. the mismatch rule, over the shortlist only ---- */
const touched = [];
for (const row of full.pilotShortlist.rows) {
  const rec = byCompany.get(row.company);
  if (!rec) continue;
  /* The mismatch rule is about domains, not about mailboxes. A gmail address
     is the one the owner handed the licensing board — it is theirs and it is
     usable. Only a company-domain address can fail the rule. */
  if (rec.emailKind !== 'company-domain' || !rec.emailDomain) {
    const usable = rec.emailKind === 'free-provider';
    rec.emailUsable = usable;
    row.emailUsable = usable;
    continue;
  }
  const v = domainBelongsTo(rec.company, rec.emailDomain, rec.qualifyingParties);
  rec.emailDomainMatch = v;
  rec.emailUsable = v.match;
  row.emailUsable = v.match;
  if (v.match) continue;

  touched.push({
    company: rec.company, rank: row.rank, domain: rec.emailDomain, why: v.why,
    wasUsedAsWebsite: rec.websiteCandidate || null,
    wasWebsiteState: row.websiteState
  });
  rec.mismatchedDomain = rec.emailDomain;
  delete rec.websiteCandidate;
  delete rec.websiteAudit;
  delete rec.website;
  row.websiteState = 'not found';
  row.website = 'not found';
  row.usableFinding = '';
  rec.websiteState = 'not found';
  rec.needsAstra = true;
}

/* ---- 2. the exclusions ---- */
for (const [company, reason] of Object.entries(EXCLUSIONS)) {
  const rec = byCompany.get(company);
  if (rec) { rec.excluded = true; rec.excludedReason = reason; }
  const row = full.pilotShortlist.rows.find(r => r.company === company);
  if (row) { row.excluded = true; row.excludedReason = reason; row.top20 = false; }
  if (rec) rec.needsAstra = false;
}

/* ---- 3. where each website address came from ---- */
for (const rec of full.records) {
  if (!rec.websiteAudit) continue;
  const fromAstra = rec.astra && rec.astra.website && rec.astra.website !== 'not found' &&
                    rec.astra.website === rec.website;
  rec.websiteAudit.source = fromAstra ? 'astra' : 'email';
  const row = full.pilotShortlist.rows.find(r => r.company === rec.company);
  if (row) row.websiteSource = rec.websiteAudit.source;
}

/* ---- re-mark the top twenty, excluded companies skipped ---- */
const live = full.pilotShortlist.rows.filter(r => !r.excluded);
live.forEach((r, i) => { r.rank = i + 1; r.top20 = i < 20; });
full.pilotShortlist.rows.filter(r => r.excluded).forEach(r => { r.rank = null; r.top20 = false; });
full.pilotShortlist.rows.sort((a, b) => (a.rank || 999) - (b.rank || 999));
full.pilotShortlist.emailDomainMismatches = touched;
full.pilotShortlist.excluded = Object.entries(EXCLUSIONS).map(([company, reason]) => ({ company, reason }));

fs.writeFileSync(file, JSON.stringify(full, null, 1));

console.log('MISMATCHES (' + touched.length + '):');
for (const t of touched) console.log('  ' + t.company + '  <-  ' + t.domain + '\n      ' + t.why +
  (t.wasUsedAsWebsite ? '\n      was being used as their website: ' + t.wasUsedAsWebsite + ' (' + t.wasWebsiteState + ')' : ''));
const needs = full.records.filter(r => r.needsAstra && !r.excluded);
console.log('\nneed an Astra lookup: ' + needs.length + ' — ' + needs.map(r => r.company).join(' | '));
console.log('excluded: ' + full.pilotShortlist.excluded.map(e => e.company).join(' | '));
console.log('live rows: ' + live.length + ', top20: ' + live.filter(r => r.top20).length);
