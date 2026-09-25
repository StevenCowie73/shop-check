'use strict';

/* Step 3. Works out which companies have a website worth looking at, and
   writes a prospects.csv that finder/check-sites.js can read.

   The only lead the register gives is the email address. Where that address
   is on a company's own domain, the domain is a candidate for their website.
   Where it is at gmail or att.net it tells us nothing either way — and a
   business with a free-provider address is NOT a business with no website.
   It is a business whose website we have not found yet. Step 8 asks Astra. */

const fs = require('fs');
const path = require('path');

const P = require('./lib/paths.js');
const { classifyEmail } = require('./lib/domains.js');
const { csvCell } = require('../lib/csv.js');

function main() {
  const records = JSON.parse(fs.readFileSync(P.records, 'utf8'));
  const seenDomain = new Set();
  const rows = [];

  for (const rec of records) {
    const { kind, domain } = classifyEmail(rec.email);
    rec.emailKind = kind;
    if (!domain) continue;
    rec.emailDomain = domain;
    if (kind !== 'company-domain') continue;
    rec.websiteCandidate = 'https://' + domain + '/';
    /* one audit per domain — several licences can share one */
    if (seenDomain.has(domain)) continue;
    seenDomain.add(domain);
    rows.push([0, rec.company, rec.phone, rec.websiteCandidate, domain]);
  }

  fs.mkdirSync(P.auditIn, { recursive: true });
  const csv = ['score,name,phone,website,place_id']
    .concat(rows.map(r => r.map(csvCell).join(',')))
    .join('\r\n') + '\r\n';
  fs.writeFileSync(P.auditCsv, csv);
  fs.writeFileSync(P.candidates, JSON.stringify(records, null, 1));

  const kinds = {};
  for (const r of records) kinds[r.emailKind] = (kinds[r.emailKind] || 0) + 1;
  console.log('email kinds:', JSON.stringify(kinds));
  console.log('distinct company domains to audit: ' + rows.length);
  console.log('\nnow run the audit:');
  console.log('  npm run pilot:audit');
}

main();
