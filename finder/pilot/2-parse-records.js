'use strict';

/* Step 2. Turns the saved detail pages into one records file.

   Keeps company name, mailing address, phone, email, every licence with its
   type, status and dates, and the classifications with their qualifying
   party. The insurance block on each page — policy numbers, issuers, cover
   dates — is read past and deliberately not kept. We have no use for it and
   no business storing it. */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const P = require('./lib/paths.js');
const AREA = require('./lib/area.js');
const { isChain } = require('../lib/prospect.js');
const DETAILS = P.lslbcDetails;
const slug = key => crypto.createHash('sha1').update(key).digest('hex').slice(0, 16);

const decode = s => String(s || '')
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<[^>]*>/g, '')
  .replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
  .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/[ \t]+/g, ' ')
  .split('\n').map(x => x.trim()).filter(Boolean).join('\n');

/* Every fieldset on the page, keyed by its legend. */
function fieldsets(html) {
  const out = {};
  const re = /<fieldset>([\s\S]*?)<\/fieldset>/gi;
  let m;
  while ((m = re.exec(html))) {
    const leg = /<legend>([^<]*)<\/legend>/i.exec(m[1]);
    if (leg) out[leg[1].trim()] = m[1];
  }
  return out;
}

/* The label/value pairs inside a chunk, in document order. */
function pairs(chunk) {
  const out = [];
  const re = /<div class="display-label">([\s\S]*?)<\/div>\s*<div class="display-field">([\s\S]*?)<\/div>/gi;
  let m;
  while ((m = re.exec(chunk))) out.push([decode(m[1]), decode(m[2])]);
  return out;
}
const pick = (ps, label) => (ps.find(p => p[0] === label) || [])[1] || '';

function parseAddress(raw) {
  const lines = String(raw || '').split('\n').map(s => s.trim()).filter(Boolean);
  const last = lines[lines.length - 1] || '';
  const m = /^(.*?),\s*([A-Z]{2})\s+([\d-]+)?\s*$/.exec(last);
  return {
    street: lines.slice(0, Math.max(0, lines.length - 1)).join(', '),
    city: m ? m[1].trim() : '',
    state: m ? m[2] : '',
    zip: m && m[3] ? m[3] : '',
    raw: lines.join(', ')
  };
}

function parseDetail(html) {
  const fs_ = fieldsets(html);
  const contact = pairs(fs_['Contractor Information'] || '');
  const rec = {
    company: pick(contact, 'Name'),
    mailingAddress: parseAddress(pick(contact, 'Mailing Address')),
    phone: pick(contact, 'Phone Number'),
    email: pick(contact, 'Email Address'),
    licenses: [],
    classifications: []
  };

  /* Each licence is its own <div id="ContactDiv"> inside the Licenses set. */
  const lic = fs_['Licenses'] || '';
  for (const block of lic.split(/<div id="ContactDiv">/i).slice(1)) {
    const ps = pairs(block);
    const number = pick(ps, 'License');
    if (!number) continue;
    rec.licenses.push({
      number,
      type: pick(ps, 'Type'),
      status: pick(ps, 'Status'),
      firstIssued: pick(ps, 'First Issued'),
      expires: pick(ps, 'Expiration Date')
    });
  }

  const cls = fs_['Classifications'] || '';
  const re = /<tr>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<\/tr>/gi;
  let m;
  while ((m = re.exec(cls))) {
    rec.classifications.push({ classification: decode(m[1]), qualifyingParty: decode(m[2]) });
  }
  rec.qualifyingParties = [...new Set(rec.classifications.map(c => c.qualifyingParty).filter(Boolean))];
  /* Insurances is present on the page and intentionally not read. */
  return rec;
}

function main() {
  const idx = JSON.parse(fs.readFileSync(P.lslbcIndex, 'utf8'));
  /* The walk only fetched the towns it was asked for; count against those,
     not the whole parish, or every run with a town list looks unfinished. */
  const rows = idx.wanted || idx.all;
  const out = [];
  let missing = 0, otherZip = 0, chains = 0;
  for (const row of rows) {
    const file = path.join(DETAILS, slug(row.key) + '.html');
    if (!fs.existsSync(file)) { missing++; continue; }
    const rec = parseDetail(fs.readFileSync(file, 'utf8'));
    if (!AREA.wantZip(rec.mailingAddress.zip)) { otherZip++; continue; }
    /* National chains and franchises are nobody Steven can help; the same
       blocklist the Places finder uses. */
    if (isChain(rec.company || '')) { chains++; continue; }
    out.push({
      searchedAs: row.listName,
      searchCity: row.listCity,
      foundVia: row.sources,
      ...rec
    });
  }
  fs.writeFileSync(P.records, JSON.stringify(out, null, 1));
  console.log('parsed ' + out.length + ' records, ' + missing + ' detail pages still missing' +
    (AREA.zips().length ? ', ' + otherZip + ' outside ' + AREA.zips().join('/') : '') +
    ', ' + chains + ' chains left out');
  const noCompany = out.filter(r => !r.company).length;
  const noLicence = out.filter(r => !r.licenses.length).length;
  console.log('records with no company name: ' + noCompany + ', with no licence rows: ' + noLicence);
}
main();
