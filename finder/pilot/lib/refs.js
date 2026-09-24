'use strict';

/* Which reference code belongs to which company, and for good.

   A ref is printed on paper and posted. Once it has been, it is the only
   thing tying an opened page back to a letter, so it can never be handed to
   a different company and it can never change for the same one. This file is
   the record of that: out/refs.json, company name to code, append-only.

   It holds real company names, so it lives under out/ with everything else
   the pilot produces and is never committed. */

const fs = require('fs');
const path = require('path');

const P = require('./paths.js');
const { allocate, isRef, RESERVED } = require('../../../lib/refs.js');

function load() {
  if (!fs.existsSync(P.refs)) return {};
  const data = JSON.parse(fs.readFileSync(P.refs, 'utf8'));

  /* A ref that two companies share would send one company's prospect to the
     other's page. Stop rather than print it. */
  const seen = new Map();
  for (const [company, ref] of Object.entries(data)) {
    if (!isRef(ref) && !RESERVED.has(ref)) {
      throw new Error(P.refs + ': ' + JSON.stringify(ref) + ' is not a reference code');
    }
    if (seen.has(ref)) {
      throw new Error(P.refs + ': ' + ref + ' is on two companies');
    }
    seen.set(ref, company);
  }
  return data;
}

function save(map) {
  fs.mkdirSync(path.dirname(P.refs), { recursive: true });
  const ordered = {};
  for (const company of Object.keys(map).sort()) ordered[company] = map[company];
  fs.writeFileSync(P.refs, JSON.stringify(ordered, null, 1) + '\n');
}

/* Every company in `companies` gets a ref. Ones that already have theirs keep
   it untouched; only the new names draw a code. Returns the whole map and how
   many were issued this time. */
function assign(companies) {
  const map = load();
  const taken = new Set(Object.values(map));
  const missing = [...new Set(companies)].filter(c => !map[c]);
  const fresh = allocate(missing.length, taken);
  missing.forEach((company, i) => { map[company] = fresh[i]; });
  if (missing.length) save(map);
  return { refs: map, issued: missing.length };
}

module.exports = { load, save, assign, file: P.refs };
