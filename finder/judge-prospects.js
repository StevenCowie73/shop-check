#!/usr/bin/env node
'use strict';

/* RETIRED. This script fed each business's Google listing — rating,
   reviews, hours — to Claude to judge it. Google Maps content must not be
   sent to any model, and the acquisition spec retires this batch judgment,
   so it refuses to run. The code below is kept for the record only.
   The single-business Signal lookup still judges, on first-party data
   only: see finder/lib/judge.js. */
console.error('judge-prospects.js is retired: it sent Google Maps content (reviews, ratings, hours) to a model, ' +
  'which is not allowed. Nothing was run. Use the Signal lookup, which judges on first-party data only.');
process.exit(1);

/* ---------------------------------------------------------------------
   Reads out/prospects.csv and out/site-audit.json, gathers more depth on
   each business from the Places API (reviews and the fields the finder
   skipped) plus the text of their homepage, asks Claude to judge how
   likely each one is to actually buy, and writes a ranked judgment file.

   It contacts nobody. It writes no outreach beyond a single opening
   sentence per business, for you to read down the phone.

   Two stages, each cached per business so a re-run or a crashed run
   resumes instead of restarting:

     out/enrich-cache/<place_id>.json   raw Places response + page text
     out/judgments/<place_id>.json      one judgment

   Run:  node judge-prospects.js            first 10, then stop with a cost estimate
         node judge-prospects.js --all      the whole set (only after you have seen the estimate)
         node judge-prospects.js --gather   gather data only, no judging
         node judge-prospects.js --judge    judge only what is already gathered

   Options:  --limit 25   cap how many businesses are processed
             --start 40   skip the first 40 (resume a part-done run)
   --------------------------------------------------------------------- */

const fs = require('fs');
const path = require('path');

const { loadEnvFile, scrub, sleep } = require('./lib/env.js');
const { csvCell, toCsv: writeCsv } = require('./lib/csv.js');
const { parseCsv } = require('./make-call-list.js');
const places = require('./lib/places.js');
const { fetchSiteText } = require('./lib/site-audit.js');
const {
  JUDGE, SYSTEM_PROMPT, JUDGMENT_TOOL,
  reviewLines, ownerReplies, buildInput,
  loadSdk, judgeRecord, pool
} = require('./lib/judge.js');

/* =====================================================================
   JUDGE (the model and the limits), the prompt and the answer schema moved
   to lib/judge.js, so the batch run and the single-business lookup ask the
   same question. Edit them there.
   ===================================================================== */

const OUT_DIR = process.env.SHOP_CHECK_OUT_DIR || path.join(__dirname, 'out');
const SRC = path.join(OUT_DIR, 'prospects.csv');
const AUDIT_SRC = path.join(OUT_DIR, 'site-audit.json');
const ENRICH_DIR = path.join(OUT_DIR, 'enrich-cache');
const JUDGE_DIR = path.join(OUT_DIR, 'judgments');
const DEST_CSV = path.join(OUT_DIR, 'judgments.csv');
const DEST_JSON = path.join(OUT_DIR, 'judgments.json');


function readProspects(csvText) {
  const rows = parseCsv(csvText);
  if (!rows.length) return [];
  const head = rows[0];
  const ix = Object.fromEntries(head.map((h, i) => [h, i]));
  for (const needed of ['score', 'name', 'phone', 'website', 'place_id', 'primary_type', 'why']) {
    if (!(needed in ix)) throw new Error(`prospects.csv has no "${needed}" column`);
  }
  return rows.slice(1)
    .filter(r => r.length === head.length && r[ix.place_id])
    .map(r => ({
      id: r[ix.place_id],
      prospectScore: Number(r[ix.score]) || 0,
      name: r[ix.name],
      phone: r[ix.phone],
      website: r[ix.website],
      trade: r[ix.primary_type],
      why: r[ix.why]
    }));
}

function readAudit() {
  const byId = new Map();
  if (!fs.existsSync(AUDIT_SRC)) return byId;
  let data;
  try { data = JSON.parse(fs.readFileSync(AUDIT_SRC, 'utf8')); } catch (e) { return byId; }
  for (const site of (data && data.sites) || []) {
    if (site && site.placeId) byId.set(site.placeId, site);
  }
  return byId;
}

/* ---------- Places details, cached per business ---------- */
function enrichPath(id) { return path.join(ENRICH_DIR, id + '.json'); }


/* the shared client does the calling and the backing off */
const fetchDetails = (id, apiKey) => places.placeDetails(apiKey, id, { timeoutMs: JUDGE.fetchTimeoutMs });

async function gatherOne(business, apiKey, audit) {
  const file = enrichPath(business.id);
  if (fs.existsSync(file)) {
    try { return { record: JSON.parse(fs.readFileSync(file, 'utf8')), cached: true }; }
    catch (e) { /* unreadable cache, fetch it again */ }
  }
  const details = await fetchDetails(business.id, apiKey);
  let site = { text: '', note: 'no website listed' };
  if (business.website) {
    await sleep(JUDGE.fetchDelayMs);
    site = await fetchSiteText(business.website);
  }
  const record = {
    placeId: business.id,
    gatheredAt: new Date().toISOString(),
    prospect: business,
    audit: audit.get(business.id) || null,
    details,
    siteText: site.text,
    siteTextNote: site.note
  };
  fs.mkdirSync(ENRICH_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(record, null, 2), 'utf8');
  return { record, cached: false };
}

/* ---------- what Claude is shown ---------- */

function judgePath(id) { return path.join(JUDGE_DIR, id + '.json'); }

/* The API call, the leak check and the normalising all live in
   lib/judge.js. This is only the cache around them. */
async function judgeOne(client, Anthropic, record) {
  const file = judgePath(record.placeId);
  if (fs.existsSync(file)) {
    try { return { judgment: JSON.parse(fs.readFileSync(file, 'utf8')), cached: true }; }
    catch (e) { /* unreadable cache, ask again */ }
  }
  const judgment = await judgeRecord(client, Anthropic, record);
  fs.mkdirSync(JUDGE_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(judgment, null, 2), 'utf8');
  return { judgment, cached: false };
}

const CSV_COLUMNS = [
  ['verdict_score', r => r.verdict_score],
  ['prospect_score', r => r.prospectScore],
  ['site_score', r => r.siteScore],
  ['name', r => r.name],
  ['phone', r => r.phone],
  ['trade', r => r.trade],
  ['size', r => r.size],
  ['customer', r => r.customer],
  ['owner_name', r => r.owner_name || ''],
  ['best_pitch', r => r.best_pitch],
  ['reputation', r => r.reputation],
  ['one_line', r => r.one_line],
  ['reasoning', r => r.reasoning]
];

const toCsv = rows => writeCsv(CSV_COLUMNS, rows);

function estimateChars(records) {
  return records.reduce((n, r) => n + buildInput(r).length, 0);
}

function money(n) { return '$' + n.toFixed(2); }

function printEstimate(done, rest, records, apiCallsMade) {
  const remaining = rest.length;
  /* The preview is taken off the top of the list, where the high scores are,
     and a high score usually means no website — so the preview average
     understates what a business with 6000 characters of homepage text costs.
     Price the page text separately, for the share of the rest that has one. */
  const perBusinessChars = records.length ? estimateChars(records) / records.length : 0;
  const withSite = rest.filter(b => b.website).length;
  const siteShare = remaining ? withSite / remaining : 0;
  /* Rough and deliberately rough: about four characters to a token, plus the
     system prompt and tool schema on every call. */
  const inTokens = (perBusinessChars / 4) + (siteShare * JUDGE.siteTextChars / 4) + 900;
  const outTokens = 350;
  const claudePer = (inTokens / 1e6) * JUDGE.pricing.claudeInputPerMTokUsd
                  + (outTokens / 1e6) * JUDGE.pricing.claudeOutputPerMTokUsd;
  const placesPer = JUDGE.pricing.placesPer1000Usd / 1000;

  console.log('');
  console.log('-'.repeat(60));
  console.log('COST SO FAR');
  console.log(`  Places detail calls made:   ${apiCallsMade}`);
  console.log(`  Places cost so far:         ${money(apiCallsMade * placesPer)}`);
  console.log('');
  console.log(`ESTIMATE FOR THE REMAINING ${remaining}`);
  console.log(`  Places detail calls:        ${remaining}  ->  ${money(remaining * placesPer)}`);
  console.log(`  Claude calls:               ${remaining}  ->  ${money(remaining * claudePer)}`);
  console.log(`  Total for the rest:         ${money(remaining * (placesPer + claudePer))}`);
  console.log(`  Whole set of ${done + remaining}:          ${money((done + remaining) * (placesPer + claudePer))}`);
  console.log('');
  console.log('  Arithmetic on the rates in the JUDGE.pricing block, not quotes:');
  console.log(`    Places Enterprise + Atmosphere ${money(JUDGE.pricing.placesPer1000Usd)} per 1000 calls`);
  console.log(`    ${JUDGE.model} ${money(JUDGE.pricing.claudeInputPerMTokUsd)} in / ${money(JUDGE.pricing.claudeOutputPerMTokUsd)} out per million tokens`);
  console.log(`    about ${Math.round(inTokens)} input and ${outTokens} output tokens a business`);
  console.log(`    ${withSite} of the remaining ${remaining} list a website, so page text is priced in for ${Math.round(siteShare * 100)}% of them`);
  console.log('  Check both against current pricing before running the full set.');
  console.log('-'.repeat(60));
}

function summarise(rows) {
  const buckets = {};
  for (const r of rows) buckets[r.best_pitch] = (buckets[r.best_pitch] || 0) + 1;
  console.log('');
  console.log('-'.repeat(40));
  console.log('Best pitch:');
  for (const [k, v] of Object.entries(buckets).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(v).padStart(4)}  ${k}`);
  }
  console.log(`Scoring above 70:  ${rows.filter(r => r.verdict_score > 70).length} of ${rows.length}`);
  console.log('');
  console.log('Top 15 by verdict score:');
  rows.slice(0, 15).forEach((r, i) => {
    console.log(`${String(i + 1).padStart(3)}. ${String(r.verdict_score).padStart(3)}  ${r.name}  [${r.best_pitch}]`);
    console.log(`      ${r.one_line}`);
  });
}

/* ---------- the run ---------- */
function parseArgs(argv) {
  const opts = { all: false, gatherOnly: false, judgeOnly: false, limit: null, start: 0, includeUnreachable: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--all' || a === '--yes') opts.all = true;
    else if (a === '--gather' || a === '--gather-only') opts.gatherOnly = true;
    else if (a === '--judge' || a === '--judge-only') opts.judgeOnly = true;
    else if (a === '--limit') opts.limit = Number(argv[++i]);
    else if (a === '--start') opts.start = Number(argv[++i]) || 0;
    else if (a === '--include-unreachable') opts.includeUnreachable = true;
  }
  return opts;
}


async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(SRC)) {
    console.error(`No prospects.csv at ${SRC}`);
    console.error('Run the finder first:  node find-prospects.js');
    process.exit(1);
  }
  loadEnvFile(path.join(__dirname, '.env'));
  const placesKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!placesKey) {
    console.error('No GOOGLE_PLACES_API_KEY in finder/.env. The gathering stage needs it.');
    process.exit(1);
  }
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  const audit = readAudit();
  const everyone = readProspects(fs.readFileSync(SRC, 'utf8'));
  /* No phone number means there is nobody to ring, so there is nothing to
     judge and no reason to pay for their details. */
  const unreachable = everyone.filter(b => !b.phone);
  const all = opts.includeUnreachable ? everyone : everyone.filter(b => b.phone);
  const workAll = all.slice(opts.start);
  let work = workAll;
  const preview = !opts.all;
  if (preview) work = work.slice(0, opts.limit || JUDGE.previewCount);
  else if (opts.limit) work = work.slice(0, opts.limit);

  console.log(`${everyone.length} businesses in prospects.csv, ${audit.size} of them audited.`);
  if (unreachable.length) {
    console.log(opts.includeUnreachable
      ? `${unreachable.length} have no phone number and are included because of --include-unreachable.`
      : `Skipping ${unreachable.length} with no phone number. ${all.length} left to judge.`);
  }
  console.log(preview
    ? `Preview run: the first ${work.length}. Nothing else runs until you pass --all.`
    : `Full run: ${work.length}.`);
  console.log('');

  /* ---- stage one: gather ---- */
  let fetched = 0, fromCache = 0;
  const records = [];
  for (let i = 0; i < work.length; i++) {
    const b = work[i];
    const { record, cached } = await gatherOne(b, placesKey, audit);
    records.push(record);
    if (cached) fromCache++; else fetched++;
    const site = record.siteText ? `${record.siteText.length} chars` : (record.siteTextNote || 'no text');
    console.log(`${String(i + 1).padStart(4)}/${work.length}  ${cached ? 'cached ' : 'fetched'}  ` +
                `${((record.details && record.details.reviews) || []).length} reviews, site ${site}  ${b.name.slice(0, 40)}`);
  }
  console.log('');
  console.log(`Gathered ${records.length}: ${fetched} fetched, ${fromCache} already cached.`);

  const rest = work.length < workAll.length ? workAll.slice(work.length) : [];
  if (opts.gatherOnly) { printEstimate(records.length, rest, records, fetched); return; }

  /* ---- stage two: judge ---- */
  if (!anthropicKey) {
    console.log('');
    console.log('No ANTHROPIC_API_KEY in finder/.env, so nothing was judged.');
    console.log('Add a line to finder/.env:   ANTHROPIC_API_KEY=sk-ant-...');
    console.log('The gathered data is cached, so judging later costs nothing extra to re-read.');
    printEstimate(records.length, rest, records, fetched);
    return;
  }

  const Anthropic = loadSdk();
  const client = new Anthropic({ apiKey: anthropicKey, maxRetries: 4 });

  let judged = 0, judgedCached = 0, failed = 0;
  const judgments = await pool(records, JUDGE.concurrency, async (record) => {
    try {
      const { judgment, cached } = await judgeOne(client, Anthropic, record);
      if (cached) judgedCached++; else judged++;
      process.stdout.write(`\r  judged ${judged + judgedCached}/${records.length}   `);
      return judgment;
    } catch (err) {
      failed++;
      console.error(`\n  ${record.prospect.name}: ${scrub(String(err && err.message || err)).slice(0, 160)}`);
      return null;
    }
  });
  console.log('');
  console.log(`Judged ${judged + judgedCached}: ${judged} new, ${judgedCached} from cache, ${failed} failed.`);

  /* ---- output ---- */
  const rows = judgments
    .map((j, i) => j && {
      ...j,
      name: records[i].prospect.name,
      phone: records[i].prospect.phone,
      trade: records[i].prospect.trade,
      website: records[i].prospect.website,
      prospectScore: records[i].prospect.prospectScore,
      siteScore: (records[i].audit && records[i].audit.siteScore) || 0
    })
    .filter(Boolean)
    .sort((a, b) => b.verdict_score - a.verdict_score || a.name.localeCompare(b.name));

  if (!rows.length) {
    console.log('');
    console.log('No judgments came back, so judgments.csv and judgments.json were left alone.');
    return;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(DEST_CSV, toCsv(rows), 'utf8');
  fs.writeFileSync(DEST_JSON, JSON.stringify({
    judgedAt: new Date().toISOString(),
    model: JUDGE.model,
    counts: { businesses: rows.length, failed },
    judgments: rows
  }, null, 2), 'utf8');

  summarise(rows);
  console.log('');
  console.log(`Wrote ${DEST_CSV}`);
  console.log(`Wrote ${DEST_JSON}`);
  if (preview) {
    printEstimate(records.length, rest, records, fetched);
    console.log('');
    console.log(`Stopping here. To do the remaining ${rest.length}:  node judge-prospects.js --all`);
  }
}

module.exports = {
  JUDGE, SYSTEM_PROMPT, JUDGMENT_TOOL,
  readProspects, readAudit, fetchSiteText, gatherOne,
  reviewLines, ownerReplies, buildInput, judgeOne, pool, toCsv, main
};

if (require.main === module) {
  main().catch(err => {
    console.error('\nFailed: ' + scrub(err && err.message ? err.message : err));
    process.exit(1);
  });
}
