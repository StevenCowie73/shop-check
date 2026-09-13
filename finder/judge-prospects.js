#!/usr/bin/env node
'use strict';

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

const { loadEnvFile, redact, csvCell } = require('./find-prospects.js');
const { parseCsv } = require('./make-call-list.js');
const { parseRobots, robotsVerdict, stripTags } = require('./check-sites.js');

/* =====================================================================
   1. EDIT ME.
   ===================================================================== */
const JUDGE = {
  model: 'claude-sonnet-4-6',
  maxTokens: 2000,
  concurrency: 4,            /* judgments in flight at once */
  maxRetries: 6,             /* on top of the SDK's own retrying */
  previewCount: 10,          /* how many to do before stopping for confirmation */

  siteTextChars: 6000,       /* how much homepage text to send */
  reviewsPerBusiness: 5,     /* Places returns at most 5 */
  fetchTimeoutMs: 10000,
  fetchDelayMs: 1200,        /* between homepage fetches */
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',

  /* Cost estimates are arithmetic on these numbers, not quotes. CHECK BOTH
     against current pricing before running the full set.
     places: Place Details including reviews falls in the Places API (New)
     Enterprise + Atmosphere SKU, priced per 1000 calls.
     claude: claude-sonnet-4-6 input/output, per million tokens. */
  pricing: {
    placesPer1000Usd: 25.00,
    claudeInputPerMTokUsd: 3.00,
    claudeOutputPerMTokUsd: 15.00
  }
};

/* The judging prompt. Everything it is allowed to say comes from the
   input; there is nothing here inviting it to fill gaps. */
const SYSTEM_PROMPT = `You are helping a one-person web services business decide which small trade
businesses are worth a cold call. You are given what is publicly on a business's Google
listing and, when they have one, the text of their website.

Rules, in order of importance:

1. Use only what is in the input. Never state a fact that is not there. If the input does
   not settle a field, answer "unknown" or null rather than guessing. An inferred fact is
   still a guess.
2. Quote reviews only in short fragments, at most a dozen words, copied exactly.
3. Everything you write may be read aloud to the business owner. Write nothing that would
   embarrass the caller: no mockery, no speculation about their competence or finances, no
   sales patter, no flattery, no exclamation marks.
4. one_line is a plain spoken opening sentence, the kind one person says to another on the
   phone. It should sound like somebody local who looked them up, not somebody working
   through a list. It must be specific to this business and grounded in the input. No pitch,
   no "I noticed you might be losing customers", no questions designed to corner them.

5. one_line leads with the strongest evidence you actually have, in this order:
   a. A responsiveness problem a customer described. Speak to the customer's experience
      itself - somebody could not get a call back, somebody was waiting - not to the review
      as a review. Never say "a reviewer said" or "your reviews mention".
   b. Reviews being thin or old: only a handful, or nothing recent.
   c. The website: missing, or the specific thing wrong with it.
   Only lead with the website when there is genuinely nothing above it. Leading with a
   missing website when you had something better is the wrong answer.

6. When the evidence is thin and verdict_score is low, say so plainly instead of
   manufacturing a hook. "I could not find much about you online beyond the listing" is a
   better opener than a reason invented to have something to say.

Scoring verdict_score, 0-100, is how likely this business is to actually buy:
  - Small homeowner-facing operations showing signs they are missing calls or slow to reply
    are the best fit. Score them high.
  - Established firms whose customers are other contractors or businesses are the worst fit,
    however bad their web presence looks. Score them low.
  - Too little evidence means a middling score, not a high one.`;

const JUDGMENT_TOOL = {
  name: 'record_judgment',
  description: 'Record the judgment of one business.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      size: { type: 'string', enum: ['solo', 'small crew', 'established firm', 'unknown'] },
      size_evidence: { type: 'string', description: 'The evidence that decided size. The single word unknown if there is none.' },
      customer: { type: 'string', enum: ['homeowners', 'businesses/contractors', 'both', 'unknown'] },
      owner_name: { type: 'string', description: "The owner's name if it appears anywhere in the input. The single word unknown if it does not." },
      responsiveness_signals: {
        type: 'array',
        description: 'Review fragments suggesting missed calls, slow callbacks, unanswered messages or no-shows. Empty if there are none.',
        items: {
          type: 'object',
          properties: {
            quote: { type: 'string', description: 'A short fragment copied exactly from the review.' },
            kind: { type: 'string', enum: ['missed call', 'slow callback', 'unanswered message', 'no-show', 'other'] }
          },
          required: ['quote', 'kind'],
          additionalProperties: false
        }
      },
      reputation: { type: 'string', enum: ['strong', 'mixed', 'weak', 'too few reviews'] },
      best_pitch: { type: 'string', enum: ['missed calls', 'reviews', 'website', 'multiple', 'skip'] },
      /* A strict tool schema rejects minimum/maximum, so the range lives in
         the description and the value is clamped when it comes back. */
      verdict_score: { type: 'integer', description: 'How likely this business is to actually buy, from 0 to 100.' },
      one_line: { type: 'string', description: 'One plain spoken sentence to open a phone call with.' },
      reasoning: { type: 'string', description: 'Two sentences at most.' }
    },
    required: ['size', 'size_evidence', 'customer', 'owner_name', 'responsiveness_signals',
               'reputation', 'best_pitch', 'verdict_score', 'one_line', 'reasoning'],
    additionalProperties: false
  }
};

const OUT_DIR = process.env.SHOP_CHECK_OUT_DIR || path.join(__dirname, 'out');
const SRC = path.join(OUT_DIR, 'prospects.csv');
const AUDIT_SRC = path.join(OUT_DIR, 'site-audit.json');
const ENRICH_DIR = path.join(OUT_DIR, 'enrich-cache');
const JUDGE_DIR = path.join(OUT_DIR, 'judgments');
const DEST_CSV = path.join(OUT_DIR, 'judgments.csv');
const DEST_JSON = path.join(OUT_DIR, 'judgments.json');

const PLACES_URL = 'https://places.googleapis.com/v1/places/';
/* Only documented Places API (New) v1 fields; an unknown one is a 400. */
const DETAIL_FIELDS = [
  'id', 'displayName', 'businessStatus', 'priceLevel', 'primaryTypeDisplayName',
  'editorialSummary', 'reviews', 'rating', 'userRatingCount', 'websiteUri',
  'nationalPhoneNumber', 'regularOpeningHours'
].join(',');

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* find-prospects' redact only knows the Google key; nothing should be able
   to print either of them. */
function scrub(text) {
  let s = redact(String(text));
  const anth = process.env.ANTHROPIC_API_KEY;
  if (anth) s = s.split(anth).join('[REDACTED_KEY]');
  return s;
}

/* ---------- reading what the other two scripts wrote ---------- */
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

async function getJson(url, headers, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch (e) { /* not json */ }
    return { status: res.status, body, text };
  } finally { clearTimeout(timer); }
}

async function fetchDetails(id, apiKey) {
  let wait = 1000;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const { status, body, text } = await getJson(
      PLACES_URL + encodeURIComponent(id),
      { 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': DETAIL_FIELDS },
      JUDGE.fetchTimeoutMs
    );
    if (status === 200) return body;
    /* A bad key or a malformed request will not improve by asking again. */
    if (status === 400 || status === 401 || status === 403 || status === 404) {
      throw new Error(scrub(`Places API ${status} for ${id}: ${text.slice(0, 300)}`));
    }
    if (attempt === 5) throw new Error(scrub(`Places API ${status} for ${id}, gave up after 5 tries`));
    await sleep(wait);
    wait *= 2;
  }
}

/* ---------- the homepage, text only, no browser ---------- */
async function fetchText(url, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': JUDGE.userAgent, 'Accept': 'text/html,*/*' },
      redirect: 'follow', signal: ctrl.signal
    });
    const body = await res.text();
    return { status: res.status, body };
  } finally { clearTimeout(timer); }
}

/* Same manners as check-sites.js: ask robots.txt first, one page, no retries. */
async function fetchSiteText(website) {
  let url;
  try { url = new URL(website); } catch (e) { return { text: '', note: 'unreadable website address' }; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { text: '', note: 'not an http address' };
  }
  try {
    const robots = await fetchText(url.origin + '/robots.txt', JUDGE.fetchTimeoutMs);
    if (robots.status === 200) {
      const verdict = robotsVerdict(parseRobots(robots.body), url.pathname || '/');
      if (!verdict.allowed) return { text: '', note: 'robots.txt asks crawlers to stay away' };
      if (verdict.crawlDelay) await sleep(Math.min(verdict.crawlDelay, 10) * 1000);
    }
  } catch (e) { /* no robots.txt we could read; carry on as check-sites does */ }

  try {
    const page = await fetchText(url.href, JUDGE.fetchTimeoutMs);
    if (page.status >= 400) return { text: '', note: `the server answered ${page.status}` };
    const text = stripTags(page.body).replace(/\s+/g, ' ').trim();
    return { text: text.slice(0, JUDGE.siteTextChars), note: text ? '' : 'the page had no readable text' };
  } catch (e) {
    return { text: '', note: 'could not be reached: ' + String(e && e.message || e).slice(0, 80) };
  }
}

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
function reviewLines(details) {
  const reviews = (details && details.reviews) || [];
  return reviews.slice(0, JUDGE.reviewsPerBusiness).map(r => ({
    rating: r.rating,
    when: r.relativePublishTimeDescription || r.publishTime || '',
    author: (r.authorAttribution && r.authorAttribution.displayName) || '',
    text: (r.originalText && r.originalText.text) || (r.text && r.text.text) || ''
  })).filter(r => r.text);
}

/* The Places API (New) does not return the owner's replies to reviews.
   If a field ever appears, it gets picked up here rather than silently. */
function ownerReplies(details) {
  const out = [];
  for (const r of (details && details.reviews) || []) {
    const reply = r.reply || r.ownerResponse || r.authorReply;
    const text = reply && (reply.text && reply.text.text || reply.text);
    if (text) out.push({ to: (r.originalText && r.originalText.text || '').slice(0, 80), text });
  }
  return out;
}

function buildInput(record) {
  const d = record.details || {};
  const a = record.audit;
  const reviews = reviewLines(d);
  const replies = ownerReplies(d);
  const lines = [];
  lines.push(`Name: ${record.prospect.name}`);
  lines.push(`Trade as Google lists it: ${d.primaryTypeDisplayName && d.primaryTypeDisplayName.text || record.prospect.trade || 'unknown'}`);
  lines.push(`Business status: ${d.businessStatus || 'unknown'}`);
  lines.push(`Rating: ${d.rating != null ? d.rating : 'none'} from ${d.userRatingCount != null ? d.userRatingCount : 0} reviews`);
  if (d.priceLevel) lines.push(`Price level: ${d.priceLevel}`);
  if (d.editorialSummary && d.editorialSummary.text) lines.push(`Google's summary: ${d.editorialSummary.text}`);
  if (d.regularOpeningHours && d.regularOpeningHours.weekdayDescriptions) {
    lines.push(`Opening hours: ${d.regularOpeningHours.weekdayDescriptions.join('; ')}`);
  }
  lines.push(`What the finder flagged: ${record.prospect.why || 'nothing'}`);

  lines.push('');
  if (reviews.length) {
    lines.push(`Reviews (${reviews.length} of ${d.userRatingCount || reviews.length}):`);
    for (const r of reviews) lines.push(`- ${r.rating} stars, ${r.when}, ${r.author}: ${r.text}`);
  } else {
    lines.push('Reviews: none returned.');
  }

  lines.push('');
  if (replies.length) {
    lines.push('Owner replies to reviews:');
    for (const r of replies) lines.push(`- ${r.text}`);
  } else {
    lines.push('Owner replies to reviews: not available from this source.');
  }

  lines.push('');
  if (a) {
    lines.push(`Website audit: ${a.website}`);
    lines.push(`- needs-replacing score ${a.siteScore} out of 100: ${a.whatsWrong || 'nothing recorded'}`);
    if (a.title) lines.push(`- page title: ${a.title}`);
  } else if (record.prospect.website) {
    lines.push(`Website: ${record.prospect.website} (not audited)`);
  } else {
    lines.push('Website: none listed.');
  }

  lines.push('');
  if (record.siteText) {
    lines.push('Text of their homepage:');
    lines.push(record.siteText);
  } else {
    lines.push(`Text of their homepage: ${record.siteTextNote || 'not available'}.`);
  }
  return lines.join('\n');
}

/* ---------- judging ---------- */
function judgePath(id) { return path.join(JUDGE_DIR, id + '.json'); }

/* Now and then a model writes its own tool-call delimiters into a string
   field instead of leaving it empty. That is not a judgment, so it is
   thrown away and asked again rather than cached. */
const SCAFFOLDING = /<\/?antml|<\/?parameter\b|<\/?function_calls\b|<\/?invoke\b/i;

function leaked(judgment) {
  const bad = [];
  const check = (label, value) => {
    if (typeof value === 'string' && SCAFFOLDING.test(value)) bad.push(label);
  };
  check('owner_name', judgment.owner_name);
  check('size_evidence', judgment.size_evidence);
  check('one_line', judgment.one_line);
  check('reasoning', judgment.reasoning);
  for (const s of judgment.responsiveness_signals || []) check('responsiveness_signals', s.quote);
  return bad;
}

/* "unknown" is the answer we asked for when there is nothing; null is what
   we store, so the CSV column is empty rather than saying unknown. */
function orNull(value) {
  const s = String(value == null ? '' : value).trim();
  return !s || s.toLowerCase() === 'unknown' || s.toLowerCase() === 'none' ? null : s;
}

function loadSdk() {
  try { return require('@anthropic-ai/sdk'); }
  catch (e) {
    throw new Error(
      'The Anthropic SDK is not installed. From finder/, run:  npm install\n' +
      '(judge-prospects.js is the only part of finder/ with a dependency.)'
    );
  }
}

async function judgeOne(client, Anthropic, record) {
  const file = judgePath(record.placeId);
  if (fs.existsSync(file)) {
    try { return { judgment: JSON.parse(fs.readFileSync(file, 'utf8')), cached: true }; }
    catch (e) { /* unreadable cache, ask again */ }
  }
  const input = buildInput(record);
  let wait = 2000;
  for (let attempt = 1; attempt <= JUDGE.maxRetries; attempt++) {
    try {
      const res = await client.messages.create({
        model: JUDGE.model,
        max_tokens: JUDGE.maxTokens,
        system: SYSTEM_PROMPT,
        tools: [JUDGMENT_TOOL],
        tool_choice: { type: 'tool', name: 'record_judgment' },
        messages: [{ role: 'user', content: input }]
      });
      const call = res.content.find(b => b.type === 'tool_use');
      if (!call) throw new Error('Claude returned no judgment for ' + record.placeId);
      const spoiled = leaked(call.input);
      if (spoiled.length) {
        throw Object.assign(
          new Error(`the model wrote tool-call markup into ${spoiled.join(', ')}`),
          { retryable: true }
        );
      }
      const judgment = {
        placeId: record.placeId,
        judgedAt: new Date().toISOString(),
        model: JUDGE.model,
        usage: { input: res.usage.input_tokens, output: res.usage.output_tokens },
        ...call.input,
        /* the schema asks for the word "unknown"; null is what we store */
        owner_name: orNull(call.input.owner_name),
        size_evidence: orNull(call.input.size_evidence) || '',
        verdict_score: Math.max(0, Math.min(100, Number(call.input.verdict_score) || 0))
      };
      fs.mkdirSync(JUDGE_DIR, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(judgment, null, 2), 'utf8');
      return { judgment, cached: false };
    } catch (err) {
      const retryable = err.retryable
        || err instanceof Anthropic.RateLimitError
        || (err instanceof Anthropic.APIError && err.status >= 500)
        || err instanceof Anthropic.APIConnectionError;
      if (!retryable || attempt === JUDGE.maxRetries) throw err;
      await sleep(wait);
      wait = Math.min(wait * 2, 60000);
    }
  }
}

/* Small pool so we are not firing 333 requests at once. */
async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}

/* ---------- output ---------- */
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

function toCsv(rows) {
  const lines = [CSV_COLUMNS.map(c => csvCell(c[0])).join(',')];
  for (const r of rows) lines.push(CSV_COLUMNS.map(c => csvCell(c[1](r))).join(','));
  return '﻿' + lines.join('\r\n') + '\r\n';
}

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
