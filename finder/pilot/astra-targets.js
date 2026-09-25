'use strict';

/* Who Astra should be asked about, written to astra/targets.json.

     node finder/pilot/astra-targets.js 1   before the shortlist: the top 20
                                            by rank with no website from their
                                            own email domain
     node finder/pilot/astra-targets.js 2   after the rules: top-20 companies
                                            still never searched — their email
                                            domain turned out not to be theirs,
                                            or they rose into the 20 after the
                                            first round

   Anyone already asked is never asked again. Sends nothing; step 8 does. */

const fs = require('fs');
const path = require('path');
const P = require('./lib/paths.js');
const { rank } = require('./lib/rank.js');
const { titleCase } = require('./lib/names.js');

const ROUND = process.argv[2] || '1';
const TOP = 20;
const full = JSON.parse(fs.readFileSync(P.spine, 'utf8'));
const byCompany = new Map(full.records.map(r => [r.company, r]));

let pool;
if (ROUND === '1') {
  pool = rank(full.records).slice(0, TOP).map(x => x.rec).filter(r => !r.websiteCandidate);
} else {
  const rows = (full.pilotShortlist && full.pilotShortlist.rows || []).filter(r => r.top20 && !r.excluded);
  pool = rows.map(r => byCompany.get(r.company)).filter(Boolean)
    .filter(r => r.needsAstra || (!r.websiteCandidate && !r.astra && !r.websiteAudit));
}
/* A company only carries rec.astra once its round has been folded in, and a
   rebuild (npm run pilot:rebuild) folds round 2 in only at step 15. So read
   every round's saved answers too: a lookup that came back, found or not, is
   never paid for twice. An errored lookup searched nothing and may be asked
   again. */
const answered = new Set();
for (const round of ['1', '2']) {
  if (!fs.existsSync(P.astraWebsites(round))) continue;
  for (const a of JSON.parse(fs.readFileSync(P.astraWebsites(round), 'utf8')).results || []) {
    if (!a.error) answered.add(a.company);
  }
}
const targets = pool.filter(r => !r.astra && !answered.has(r.company))
  .map(r => ({ company: r.company, city: titleCase(r.mailingAddress.city || '') }));

fs.mkdirSync(path.dirname(P.astraTargets), { recursive: true });
fs.writeFileSync(P.astraTargets, JSON.stringify(targets, null, 1));
console.log('round ' + ROUND + ': ' + targets.length + ' companies to ask Astra about, written to ' +
  path.relative(process.cwd(), P.astraTargets));
if (!targets.length) console.log('nothing to ask — step 8 can be skipped for this round');
