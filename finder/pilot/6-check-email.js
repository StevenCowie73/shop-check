'use strict';
/* Scratch only. Two things: ask DNS whether each company-domain email could
   receive anything, and drop a qualifying party's second company so nobody
   gets two letters. Nothing is sent to anyone — MX lookup only. */

const fs = require('fs');
const path = require('path');
const dns = require('dns').promises;

const P = require('./lib/paths.js');
const file = P.spine;
const full = JSON.parse(fs.readFileSync(file, 'utf8'));
const rows = full.pilotShortlist.rows;
const byCompany = new Map(full.records.map(r => [r.company, r]));

/* "yes" there is somewhere to deliver, "no" there is not, "unknown" the
   question could not be answered. A domain with no MX but a working A record
   is still "no": we are not going to guess at implicit-MX fallback. */
async function deliverable(domain) {
  try {
    const mx = await dns.resolveMx(domain);
    return (mx && mx.length) ? 'yes' : 'no';
  } catch (err) {
    const code = err && err.code;
    if (code === 'ENOTFOUND' || code === 'ENODATA' || code === 'NXDOMAIN') {
      /* no MX — does the domain exist at all? */
      try { await dns.lookup(domain); return 'no'; }
      catch (e2) { return (e2 && e2.code === 'ENOTFOUND') ? 'no' : 'unknown'; }
    }
    return 'unknown';
  }
}

(async () => {
  for (const row of rows) {
    const rec = byCompany.get(row.company);
    const domain = rec && rec.emailDomain;
    if (!rec || rec.emailKind !== 'company-domain' || !domain) {
      row.emailDeliverable = null;      /* not a company domain: not asked */
      continue;
    }
    row.emailDomain = domain;
    row.emailDeliverable = await deliverable(domain);
    rec.emailDeliverable = row.emailDeliverable;
  }

  /* ---- one letter per person ---- */
  const seen = new Map();
  const dropped = [];
  const kept = [];
  for (const row of rows) {
    const person = (row.qualifyingParties[0] || '').trim().toLowerCase();
    if (person && seen.has(person)) {
      dropped.push({ ...row, droppedFor: seen.get(person) });
      continue;
    }
    if (person) seen.set(person, row.company);
    kept.push(row);
  }
  kept.forEach((r, i) => { r.rank = i + 1; r.top20 = i < 20; });

  full.pilotShortlist.rows = kept;
  full.pilotShortlist.droppedDuplicatePeople = dropped.map(d => ({
    company: d.company, person: d.qualifyingParties[0], keptInstead: d.droppedFor
  }));
  fs.writeFileSync(file, JSON.stringify(full, null, 1));

  const tally = {};
  for (const r of kept) tally[String(r.emailDeliverable)] = (tally[String(r.emailDeliverable)] || 0) + 1;
  console.log('emailDeliverable across the list:', JSON.stringify(tally));
  console.log('dropped as a duplicate person:', JSON.stringify(full.pilotShortlist.droppedDuplicatePeople));
  console.log('\ncompany-domain rows:');
  for (const r of kept) {
    if (!r.emailDeliverable) continue;
    console.log('  ' + String(r.rank).padStart(2) + (r.top20 ? '*' : ' '),
      r.company.slice(0, 38).padEnd(40), (r.emailDomain || '').padEnd(32), r.emailDeliverable);
  }
})();
