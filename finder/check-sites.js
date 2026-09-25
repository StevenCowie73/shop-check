#!/usr/bin/env node
'use strict';

/* ---------------------------------------------------------------------
   Looks at the websites the prospects actually have, and scores how
   badly each one needs replacing.

   Reads out/prospects.csv, visits every row that lists a website, and
   writes out/site-audit.csv (and out/site-audit.json with the full
   detail). One request at a time, robots.txt respected, no retries.

   Run the finder first, then:  node check-sites.js
   or:                          npm run sites

   Options:  --limit 20     only check the first 20 sites
             --start 40     skip the first 40 (resume a part-done run)
   --------------------------------------------------------------------- */

const fs = require('fs');
const path = require('path');

const { sleep } = require('./lib/env.js');
const { csvCell, toCsv: writeCsv } = require('./lib/csv.js');
const { parseCsv } = require('./make-call-list.js');
const { AUDIT, WEIGHTS, checkSite, scoreSite } = require('./lib/site-audit.js');

/* =====================================================================
   AUDIT (how we visit) and WEIGHTS (how we score) moved to
   lib/site-audit.js, so the batch audit and the single-business lookup
   cannot drift apart. Edit them there.
   ===================================================================== */

const OUT_DIR = process.env.SHOP_CHECK_OUT_DIR || path.join(__dirname, 'out');
const SRC = path.join(OUT_DIR, 'prospects.csv');
const DEST_CSV = path.join(OUT_DIR, 'site-audit.csv');
const DEST_JSON = path.join(OUT_DIR, 'site-audit.json');

function readProspectsWithSites(csvText) {
  const rows = parseCsv(csvText);
  if (!rows.length) return [];
  const head = rows[0];
  const ix = Object.fromEntries(head.map((h, i) => [h, i]));
  for (const needed of ['score', 'name', 'phone', 'website', 'place_id']) {
    if (!(needed in ix)) throw new Error(`prospects.csv has no "${needed}" column`);
  }
  return rows.slice(1)
    .filter(r => r.length === head.length && r[ix.website])
    .map(r => ({
      prospectScore: Number(r[ix.score]) || 0,
      name: r[ix.name],
      phone: r[ix.phone],
      website: r[ix.website],
      placeId: r[ix.place_id]
    }));
}

const CSV_COLUMNS = [
  ['site_score', r => r.siteScore],
  ['prospect_score', r => r.prospectScore],
  ['name', r => r.name],
  ['phone', r => r.phone],
  ['website', r => r.website],
  ['whats_wrong', r => r.whatsWrong]
];

const toCsv = rows => writeCsv(CSV_COLUMNS, rows);

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : process.argv[i + 1];
}

async function main() {
  if (!fs.existsSync(SRC)) {
    console.error(`No prospects.csv at ${SRC}`);
    console.error('Run the finder first:  node find-prospects.js');
    process.exit(1);
  }

  let sites = readProspectsWithSites(fs.readFileSync(SRC, 'utf8'));
  const start = Number(arg('--start')) || 0;
  const limit = Number(arg('--limit')) || 0;
  if (start) sites = sites.slice(start);
  if (limit) sites = sites.slice(0, limit);

  console.log(`Checking ${sites.length} websites, one at a time.`);
  console.log(`${AUDIT.timeoutMs / 1000}s timeout, ${AUDIT.delayMs}ms between requests, robots.txt respected.\n`);

  const results = [];
  const started = Date.now();
  for (let i = 0; i < sites.length; i++) {
    const row = sites[i];
    const found = await checkSite(row);
    const scored = scoreSite(found);
    results.push(Object.assign(found, {
      siteScore: scored.score,
      signals: scored.signals,
      whatsWrong: scored.whatsWrong
    }));
    const flag = found.blocked ? 'blocked' : found.skipped ? 'skipped' : (found.loads ? 'ok' : 'dead');
    const shown = scored.score === null ? '?' : String(scored.score);
    console.log(`${String(i + 1).padStart(4)}/${sites.length}  ${shown.padStart(3)}  ${flag.padEnd(7)}  ${row.website.slice(0, 60)}`);
    if (i < sites.length - 1) await sleep(AUDIT.delayMs);
  }

  /* An unscored (skipped) site sorts below every scored one rather than
     turning the comparison into NaN. */
  const rank = r => (Number.isFinite(r.siteScore) ? r.siteScore : -1);
  results.sort((a, b) => rank(b) - rank(a) || b.prospectScore - a.prospectScore || a.name.localeCompare(b.name));

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(DEST_CSV, toCsv(results), 'utf8');
  fs.writeFileSync(DEST_JSON, JSON.stringify({
    checkedAt: new Date().toISOString(),
    weights: WEIGHTS,
    settings: { timeoutMs: AUDIT.timeoutMs, delayMs: AUDIT.delayMs, staleYears: AUDIT.staleYears },
    counts: {
      checked: results.length,
      loaded: results.filter(r => r.loads).length,
      dead: results.filter(r => !r.loads && !r.skipped).length,
      skipped: results.filter(r => r.skipped).length,
      blocked: results.filter(r => r.blocked).length,
      unscored: results.filter(r => r.siteScore === null).length,
      httpOnly: results.filter(r => r.loads && r.finalScheme === 'http:').length,
      noViewport: results.filter(r => r.loads && !r.viewport).length,
      noPhone: results.filter(r => r.loads && !r.phoneOnPage).length,
      social: results.filter(r => r.social).length
    },
    sites: results
  }, null, 2), 'utf8');

  const dead = results.filter(r => !r.loads && !r.skipped).length;
  const skipped = results.filter(r => r.skipped).length;
  console.log('\n----------------------------------------');
  console.log(`Sites checked:        ${results.length}`);
  console.log(`Loaded fine:          ${results.filter(r => r.loads).length}`);
  console.log(`Did not load:         ${dead}`);
  const blocked = results.filter(r => r.blocked).length;
  console.log(`Not checked (robots.txt): ${skipped - blocked}`);
  console.log(`Not checked (the site blocked the check): ${blocked}`);
  console.log(`Still plain http:     ${results.filter(r => r.loads && r.finalScheme === 'http:').length}`);
  console.log(`No mobile viewport:   ${results.filter(r => r.loads && !r.viewport).length}`);
  console.log(`No phone on the page: ${results.filter(r => r.loads && !r.phoneOnPage).length}`);
  console.log(`Somebody else's page: ${results.filter(r => r.social).length}`);
  console.log(`Took:                 ${((Date.now() - started) / 1000 / 60).toFixed(1)} min`);

  console.log('\nWorst 15:');
  results.slice(0, 15).forEach((r, i) => {
    console.log(`${String(i + 1).padStart(2)}. ${String(r.siteScore).padStart(3)}  ${r.name}`);
    console.log(`      ${r.phone || '(no phone)'}  ${r.website}`);
    console.log(`      ${r.whatsWrong}`);
  });

  console.log(`\nWrote ${DEST_CSV}`);
  console.log(`Wrote ${DEST_JSON}`);
}


module.exports = {
  AUDIT, WEIGHTS, readProspectsWithSites, toCsv, checkSite, main
};

if (require.main === module) {
  main().catch(err => {
    console.error('\nFailed: ' + (err && err.message ? err.message : err));
    process.exit(1);
  });
}
