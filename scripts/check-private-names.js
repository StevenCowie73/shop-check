#!/usr/bin/env node
'use strict';

/* Refuses to let a real business or person's name into this repository.

   The repository is public. The prospect data is not: it is real trade
   businesses, the people who hold their licences, their addresses and their
   phone numbers, gathered from Google Places and a state licence register.
   Committing any of it — even one name in a code comment, as an example —
   publishes it.

   This reads every company name and qualifying-party name out of whichever
   private data files happen to exist on this machine, and fails if one turns
   up in a file being committed. On a machine with no prospect data there is
   nothing to check and it passes, so a fresh clone is never blocked.

   Run over the staged change:   node scripts/check-private-names.js
   Run over everything tracked:  node scripts/check-private-names.js --all */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const ALL = process.argv.includes('--all');
const QUIET = process.argv.includes('--quiet');

/* Where prospect data lives. All git-ignored; any or none may be present. */
const SOURCES = [
  'finder/out/prospects.csv',
  'finder/out/judgments.json',
  'finder/out/astra-research.json',
  'finder/out/overrides.json',
  'finder/pilot/out/records.json',
  'finder/pilot/out/spine.json',
  'finder/pilot/out/exclusions.json',
  'finder/pilot/out/refs.json'
];

/* Names are compared with punctuation and case thrown away, so that
   "318 Tile Pro." in the data still matches "318 Tile Pro's" in a comment. */
const normalise = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const SUFFIX = /\b(l l c|llc|inc|incorporated|s corp|corp|ltd|co)$/;

/* Words that identify nobody. A "name" made only of these is a trade
   description, not a business: "A + Roofing" normalises to "a roofing",
   which would match any sentence mentioning a roofing licence. */
const COMMON = new Set([
  'a', 'and', 'of', 'the', 'for', 'to', 'in', 'at', 'on', 'llc', 'inc', 'co',
  'corp', 'ltd', 'company', 'construction', 'contracting', 'contractor',
  'contractors', 'services', 'service', 'group', 'enterprises', 'solutions',
  'builders', 'builder', 'building', 'buildings', 'homes', 'home', 'house',
  'roofing', 'roof', 'roofs', 'plumbing', 'electric', 'electrical', 'fence',
  'fencing', 'remodeling', 'remodel', 'repair', 'repairs', 'improvement',
  'improvements', 'general', 'properties', 'property', 'lawn', 'landscape',
  'air', 'heating', 'cooling', 'painting', 'paint', 'flooring', 'floor',
  'not', 'found', 'name', 'city', 'only', 'new', 'best', 'pro', 'pros'
]);

const names = new Map();          /* normalised -> as it appears in the data */
function remember(raw) {
  const n = normalise(raw);
  if (!n) return;
  const words = n.split(' ');
  /* One short word is not identifying — "integrity", "hughes", "william" are
     all real licence-holder words that also occur innocently in code. Keep
     single words only when they are long enough to be a real giveaway. */
  if (words.length < 2 && n.length < 10) return;
  if (n.length < 8) return;
  /* and at least one word has to be the distinctive part */
  if (!words.some(w => w.length >= 4 && !COMMON.has(w))) return;
  if (!names.has(n)) names.set(n, String(raw).trim());
  const bare = n.replace(SUFFIX, '').trim();
  if (bare && bare !== n && (bare.split(' ').length >= 2 || bare.length >= 10)) {
    if (!names.has(bare)) names.set(bare, String(raw).trim());
  }
}

function readCsvColumn(file, column) {
  const lines = fs.readFileSync(file, 'utf8').replace(/^﻿/, '').split(/\r?\n/);
  if (!lines.length) return;
  const head = lines[0].split(',').map(h => h.replace(/^"|"$/g, ''));
  const idx = head.indexOf(column);
  if (idx === -1) return;
  for (const line of lines.slice(1)) {
    if (!line) continue;
    const cells = [];
    let cur = '', quoted = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (quoted) {
        if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else quoted = false; }
        else cur += c;
      } else if (c === '"') quoted = true;
      else if (c === ',') { cells.push(cur); cur = ''; }
      else cur += c;
    }
    cells.push(cur);
    remember(cells[idx]);
  }
}

/* Read only the fields that actually hold a name. A generic walk over the
   JSON looked tempting and was wrong: it harvested every string near a key
   like "company", including values such as "not found", and then flagged
   half the codebase. */
function harvestFile(rel, file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (rel.endsWith('judgments.json')) {
    for (const j of data.judgments || []) { remember(j.name); remember(j.owner_name); }
  } else if (rel.endsWith('astra-research.json')) {
    const list = Array.isArray(data) ? data : (data.results || Object.values(data));
    for (const r of list) { remember(r.name || r.business); remember(r.owner_name); }
  } else if (rel.endsWith('overrides.json')) {
    for (const o of Object.values(data)) {
      remember(o && o.name);
      if (o && o.owner) remember(o.owner.name);
    }
  } else if (rel.endsWith('exclusions.json') || rel.endsWith('refs.json')) {
    /* both are keyed by company name */
    for (const company of Object.keys(data)) remember(company);
  } else {
    /* the pilot's records.json (an array) and spine.json (an object) */
    const records = Array.isArray(data) ? data : (data.records || []);
    for (const r of records) {
      remember(r.company);
      for (const qp of r.qualifyingParties || []) remember(qp);
      for (const c of r.classifications || []) remember(c && c.qualifyingParty);
    }
  }
}

let sourcesFound = 0;
for (const rel of SOURCES) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) continue;
  sourcesFound++;
  try {
    if (file.endsWith('.csv')) readCsvColumn(file, 'name');
    else harvestFile(rel, file);
  } catch (err) {
    console.error('check-private-names: could not read ' + rel + ' — ' + err.message);
  }
}

if (!sourcesFound || !names.size) {
  if (!QUIET) console.log('check-private-names: no prospect data on this machine, nothing to check');
  process.exit(0);
}

/* A second line of defence that does not depend on .gitignore being right.
   Every out/ directory in this repository holds generated prospect data, so
   a staged path inside one is a mistake whatever the file contains — and an
   edited or missing .gitignore is exactly when the name check is least
   likely to save you, because the data file would be staged wholesale. */
function stagedUnderOut(files) {
  return files.filter(f => /(^|\/)out\//.test(f));
}

function filesToCheck() {
  const cmd = ALL
    ? 'git ls-files'
    : 'git diff --cached --name-only --diff-filter=ACM';
  return execSync(cmd, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64e6 })
    .split('\n').filter(Boolean);
}

/* A file that holds the names legitimately: the checker itself, and the
   example files that exist to show the shape without real data. */
const ALLOWED = [/^scripts\/check-private-names\.js$/, /\.example\.json$/];

const staged = filesToCheck();

const underOut = ALL ? [] : stagedUnderOut(staged);
if (underOut.length) {
  console.error('');
  console.error('  COMMIT REFUSED — a file under an out/ directory is staged.');
  console.error('  Those directories hold generated prospect data and are never committed.');
  console.error('');
  for (const f of underOut) console.error('    ' + f);
  console.error('');
  console.error('  Unstage it:  git restore --staged ' + underOut[0]);
  console.error('  If .gitignore has lost an entry, put it back.');
  console.error('');
  process.exit(1);
}

const hits = [];
for (const rel of staged) {
  if (ALLOWED.some(re => re.test(rel))) continue;
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) continue;
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (err) { continue; }
  if (text.includes('\u0000')) continue;                 /* binary */
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const padded = ' ' + normalise(lines[i]) + ' ';
    let reported = null;
    for (const [needle, asWritten] of names) {
      if (!padded.includes(' ' + needle + ' ')) continue;
      /* a name and its suffix-stripped form are the same finding */
      if (reported && (reported.includes(needle) || needle.includes(reported))) continue;
      reported = needle;
      hits.push({ file: rel, line: i + 1, name: asWritten, text: lines[i].trim().slice(0, 100) });
    }
  }
}

if (!hits.length) {
  if (!QUIET) {
    console.log('check-private-names: ' + names.size + ' private names checked against ' +
      (ALL ? 'every tracked file' : 'the staged change') + ' — clean');
  }
  process.exit(0);
}

console.error('');
console.error('  COMMIT REFUSED — real prospect data in a file you are committing.');
console.error('  This repository is public.');
console.error('');
for (const h of hits) {
  console.error('    ' + h.file + ':' + h.line + '  "' + h.name + '"');
  console.error('      ' + h.text);
}
console.error('');
console.error('  Replace it with an invented example, or move it into a git-ignored');
console.error('  out/ directory. To override once: git commit --no-verify');
console.error('');
process.exit(1);
