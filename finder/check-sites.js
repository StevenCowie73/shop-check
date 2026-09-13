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
const { parseCsv } = require('./make-call-list.js');
const { csvCell } = require('./find-prospects.js');

/* =====================================================================
   1. HOW WE VISIT — edit me.
   Polite by design: one page at a time, a real timeout, a normal
   browser user agent, and whatever crawl delay robots.txt asks for.
   ===================================================================== */
const AUDIT = {
  timeoutMs: 10000,
  delayMs: 1500,               /* between requests, on top of any crawl-delay */
  maxBytes: 3 * 1024 * 1024,   /* stop reading a page after this much HTML */
  heavyBytes: 1.5 * 1024 * 1024,
  staleYears: 3,               /* newest year older than this is stale */
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  /* A "website" on one of these is somebody else's page, not their own */
  notTheirOwnSite: [
    { host: 'facebook.com', label: 'a Facebook page' },
    { host: 'fb.com', label: 'a Facebook page' },
    { host: 'fb.me', label: 'a Facebook page' },
    { host: 'instagram.com', label: 'an Instagram page' },
    { host: 'yelp.com', label: 'a Yelp listing' },
    { host: 'sites.google.com', label: 'a Google Sites page' },
    { host: 'business.site', label: 'a Google Business page' },
    { host: 'linktr.ee', label: 'a Linktree page' },
    { host: 'nextdoor.com', label: 'a Nextdoor page' },
    { host: 'angi.com', label: 'an Angi listing' },
    { host: 'homeadvisor.com', label: 'a HomeAdvisor listing' }
  ]
};

/* =====================================================================
   2. SCORING WEIGHTS — edit me.
   Higher total = the site is more in need of replacing. Capped at 100.
   A site that never loads is scored on that alone; we cannot judge a
   page we never saw.
   ===================================================================== */
const WEIGHTS = {
  doesNotLoad: 60,        /* dead, timed out, or an error page */
  socialAsWebsite: 35,    /* their "website" is somebody else's platform */
  noViewport: 20,         /* no mobile viewport tag at all */
  noPhoneOnPage: 20,      /* nowhere to tap or copy a number */
  httpOnly: 18,           /* still plain http, browsers say "not secure" */
  staleContent: 12,       /* newest year on the page is old */
  deadTech: 10,           /* Flash, frames, table layout, <font> */
  heavyPage: 5,           /* a lot of HTML for a small trade site */
  noYearAnywhere: 5,      /* no date at all, so no sign of life */
  maxScore: 100
};

const OUT_DIR = process.env.SHOP_CHECK_OUT_DIR || path.join(__dirname, 'out');
const SRC = path.join(OUT_DIR, 'prospects.csv');
const DEST_CSV = path.join(OUT_DIR, 'site-audit.csv');
const DEST_JSON = path.join(OUT_DIR, 'site-audit.json');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const THIS_YEAR = new Date().getFullYear();

/* ---------- robots.txt ---------- */
function parseRobots(text) {
  const groups = [];
  let current = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const field = m[1].toLowerCase();
    const value = m[2].trim();
    if (field === 'user-agent') {
      if (!current || current.rules.length || current.crawlDelay !== null) {
        current = { agents: [], rules: [], crawlDelay: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if (current && (field === 'allow' || field === 'disallow')) {
      current.rules.push({ allow: field === 'allow', path: value });
    } else if (current && field === 'crawl-delay') {
      const n = parseFloat(value);
      if (!Number.isNaN(n)) current.crawlDelay = n;
    }
  }
  return groups;
}

function matchesRobotsPath(pattern, urlPath) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  const anchored = escaped.endsWith('\\$')
    ? new RegExp('^' + escaped.slice(0, -2) + '$')
    : new RegExp('^' + escaped);
  return anchored.test(urlPath);
}

/* We visit as a browser would, so the "*" group is the one that applies. */
function robotsVerdict(groups, urlPath) {
  const group = groups.find(g => g.agents.includes('*'));
  if (!group) return { allowed: true, crawlDelay: 0 };
  let best = null;
  for (const rule of group.rules) {
    if (rule.path === '') continue;            /* an empty Disallow allows everything */
    if (!matchesRobotsPath(rule.path, urlPath)) continue;
    if (!best ||
        rule.path.length > best.path.length ||
        (rule.path.length === best.path.length && rule.allow)) best = rule;
  }
  return { allowed: best ? best.allow : true, crawlDelay: group.crawlDelay || 0 };
}

/* ---------- fetching ---------- */
async function get(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': AUDIT.userAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });
    return { res };
  } catch (err) {
    const aborted = err && (err.name === 'AbortError' || err.name === 'TimeoutError');
    return { error: aborted ? 'timed out after ' + (timeoutMs / 1000) + 's' : shortError(err) };
  } finally {
    clearTimeout(timer);
  }
}

function shortError(err) {
  const cause = err && err.cause;
  const code = (cause && cause.code) || (err && err.code);
  const map = {
    ENOTFOUND: 'domain not found',
    ECONNREFUSED: 'connection refused',
    ECONNRESET: 'connection reset',
    EHOSTUNREACH: 'host unreachable',
    ETIMEDOUT: 'connection timed out',
    CERT_HAS_EXPIRED: 'security certificate expired',
    ERR_TLS_CERT_ALTNAME_INVALID: 'security certificate does not match the domain',
    DEPTH_ZERO_SELF_SIGNED_CERT: 'untrusted security certificate',
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'untrusted security certificate'
  };
  if (code && map[code]) return map[code];
  if (code) return String(code);
  return (err && err.message ? String(err.message) : 'request failed').slice(0, 120);
}

/* Read the body but stop at a cap, so one enormous page cannot stall a run. */
async function readCapped(res, maxBytes) {
  if (!res.body) return { text: '', bytes: 0, truncated: false };
  const reader = res.body.getReader();
  const chunks = [];
  let bytes = 0, truncated = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes <= maxBytes) chunks.push(Buffer.from(value));
      else { truncated = true; reader.cancel().catch(() => {}); break; }
    }
  } catch (e) { /* take whatever arrived */ }
  return { text: Buffer.concat(chunks).toString('utf8'), bytes, truncated };
}

/* ---------- reading the page ---------- */
function stripTags(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ');
}

function hasViewport(html) {
  return /<meta[^>]+name\s*=\s*["']?viewport["']?/i.test(html);
}

function pageTitle(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return '';
  return stripTags(m[1]).trim().slice(0, 120);
}

function findsPhone(html, text) {
  if (/href\s*=\s*["']tel:/i.test(html)) return true;
  /* a plain US number, not a date or an id */
  return /(?:\(\d{3}\)\s*|\b\d{3}[.\-\s])\d{3}[.\-\s]?\d{4}\b/.test(text);
}

function newestYear(text) {
  const years = (text.match(/\b(?:19|20)\d{2}\b/g) || [])
    .map(Number)
    .filter(y => y >= 1990 && y <= THIS_YEAR + 1);
  return years.length ? Math.max(...years) : null;
}

function deadTech(html) {
  const found = [];
  if (/\.swf\b/i.test(html) || /application\/x-shockwave-flash/i.test(html) || /<embed[^>]+swf/i.test(html)) found.push('Flash');
  if (/<frameset\b/i.test(html) || /<frame\b/i.test(html)) found.push('frames');
  if (/<marquee\b/i.test(html) || /<blink\b/i.test(html)) found.push('scrolling text');
  if (/<font\b/i.test(html)) found.push('<font> tags');
  if (/<applet\b/i.test(html)) found.push('Java applets');
  const tableLayout = /<table[^>]*(?:cellpadding|cellspacing|border\s*=)/i.test(html) ||
    /<table[\s\S]{0,4000}?<table/i.test(html);
  if (tableLayout) found.push('tables for layout');
  return found;
}

function isNotTheirOwnSite(url) {
  let host;
  try { host = new URL(url).hostname.toLowerCase().replace(/^www\./, ''); }
  catch (e) { return null; }
  const hit = AUDIT.notTheirOwnSite.find(s => host === s.host || host.endsWith('.' + s.host));
  return hit ? hit.label : null;
}

/* ---------- scoring ---------- */
function scoreSite(f) {
  const signals = [];
  let score = 0;
  const add = (key, signal) => { score += WEIGHTS[key]; signals.push(signal); };

  if (f.social) add('socialAsWebsite', { kind: 'social', text: "their website is " + f.social + ", not a site of their own" });

  if (!f.loads) {
    add('doesNotLoad', { kind: 'dead', text: 'the site does not load (' + f.problem + ')' });
    if (f.declaredScheme === 'http:') add('httpOnly', { kind: 'http', text: 'it is plain http, with no secure version' });
    return finish(score, signals);
  }

  if (f.finalScheme === 'http:') add('httpOnly', { kind: 'http', text: 'no https, so browsers warn visitors it is not secure' });
  if (!f.viewport) add('noViewport', { kind: 'viewport', text: 'it was never built for phones' });
  if (!f.phoneOnPage) add('noPhoneOnPage', { kind: 'phone', text: 'no phone number anywhere on the page' });

  if (f.newestYear === null) add('noYearAnywhere', { kind: 'noyear', text: 'no date anywhere, so no sign it is still looked after' });
  else if (THIS_YEAR - f.newestYear > AUDIT.staleYears) {
    add('staleContent', { kind: 'stale', text: 'nothing newer than ' + f.newestYear + ' on the page' });
  }

  if (f.deadTech.length) add('deadTech', { kind: 'deadtech', text: 'built with ' + f.deadTech.slice(0, 2).join(' and ') });
  if (f.bytes > AUDIT.heavyBytes) add('heavyPage', { kind: 'heavy', text: 'the page is ' + mb(f.bytes) + ' of HTML, slow on a phone' });

  return finish(score, signals);
}

function finish(score, signals) {
  return {
    score: Math.max(0, Math.min(WEIGHTS.maxScore, score)),
    signals: signals.map(s => s.kind),
    whatsWrong: sentence(signals)
  };
}

function sentence(signals) {
  if (!signals.length) return 'Nothing obviously wrong with it';
  const line = signals.map(s => s.text).join(', ');
  return line.charAt(0).toUpperCase() + line.slice(1);
}

const mb = b => (b / (1024 * 1024)).toFixed(1) + ' MB';

/* ---------- one site ---------- */
const robotsCache = new Map();

async function robotsFor(origin) {
  if (robotsCache.has(origin)) return robotsCache.get(origin);
  const { res, error } = await get(origin + '/robots.txt', AUDIT.timeoutMs);
  let verdict;
  if (error) verdict = { groups: [], reachable: false };       /* let the page fetch report the real trouble */
  else if (res.status >= 500) verdict = { groups: [], serverError: true };
  else if (res.status >= 400) verdict = { groups: [], reachable: true };
  else {
    const body = await readCapped(res, 512 * 1024);
    verdict = { groups: parseRobots(body.text), reachable: true };
  }
  robotsCache.set(origin, verdict);
  return verdict;
}

async function checkSite(row) {
  const record = {
    name: row.name,
    phone: row.phone,
    website: row.website,
    prospectScore: row.prospectScore,
    placeId: row.placeId,
    checkedAt: new Date().toISOString()
  };

  let url;
  try { url = new URL(row.website); }
  catch (e) {
    return Object.assign(record, {
      loads: false, problem: 'the address is not a valid web address',
      declaredScheme: '', finalScheme: '', social: null, skipped: false,
      status: null, title: '', viewport: false, phoneOnPage: false,
      newestYear: null, deadTech: [], bytes: 0
    });
  }

  record.declaredScheme = url.protocol;
  record.social = isNotTheirOwnSite(row.website);

  const robots = await robotsFor(url.origin);
  if (robots.serverError) {
    return Object.assign(record, {
      loads: false, skipped: true, problem: 'robots.txt could not be read, so we left the site alone',
      finalScheme: url.protocol, status: null, title: '', viewport: false,
      phoneOnPage: false, newestYear: null, deadTech: [], bytes: 0
    });
  }
  const verdict = robotsVerdict(robots.groups, url.pathname || '/');
  if (!verdict.allowed) {
    return Object.assign(record, {
      loads: false, skipped: true, problem: 'robots.txt asks crawlers to stay away',
      finalScheme: url.protocol, status: null, title: '', viewport: false,
      phoneOnPage: false, newestYear: null, deadTech: [], bytes: 0
    });
  }
  if (verdict.crawlDelay) await sleep(Math.min(verdict.crawlDelay, 30) * 1000);

  const { res, error } = await get(row.website, AUDIT.timeoutMs);
  if (error) {
    return Object.assign(record, {
      loads: false, skipped: false, problem: error, finalScheme: url.protocol,
      status: null, title: '', viewport: false, phoneOnPage: false,
      newestYear: null, deadTech: [], bytes: 0
    });
  }

  const finalUrl = res.url || row.website;
  let finalScheme = url.protocol;
  try { finalScheme = new URL(finalUrl).protocol; } catch (e) { /* keep the declared one */ }

  if (!res.ok) {
    const body = await readCapped(res, 64 * 1024).catch(() => ({ bytes: 0 }));
    return Object.assign(record, {
      loads: false, skipped: false, problem: 'the server answered ' + res.status,
      finalUrl, finalScheme, status: res.status, title: '', viewport: false,
      phoneOnPage: false, newestYear: null, deadTech: [], bytes: body.bytes || 0
    });
  }

  const body = await readCapped(res, AUDIT.maxBytes);
  const html = body.text;
  const text = stripTags(html);

  return Object.assign(record, {
    loads: true,
    skipped: false,
    problem: '',
    finalUrl,
    finalScheme,
    status: res.status,
    contentType: (res.headers.get('content-type') || '').split(';')[0],
    title: pageTitle(html),
    viewport: hasViewport(html),
    phoneOnPage: findsPhone(html, text),
    newestYear: newestYear(text),
    deadTech: deadTech(html),
    bytes: body.bytes,
    truncated: body.truncated
  });
}

/* ---------- the run ---------- */
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

function toCsv(rows) {
  const lines = [CSV_COLUMNS.map(c => csvCell(c[0])).join(',')];
  for (const r of rows) lines.push(CSV_COLUMNS.map(c => csvCell(c[1](r))).join(','));
  return '﻿' + lines.join('\r\n') + '\r\n';
}

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
    const flag = found.skipped ? 'skipped' : (found.loads ? 'ok' : 'dead');
    console.log(`${String(i + 1).padStart(4)}/${sites.length}  ${String(scored.score).padStart(3)}  ${flag.padEnd(7)}  ${row.website.slice(0, 60)}`);
    if (i < sites.length - 1) await sleep(AUDIT.delayMs);
  }

  results.sort((a, b) => b.siteScore - a.siteScore || b.prospectScore - a.prospectScore || a.name.localeCompare(b.name));

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
  console.log(`Left alone (robots):  ${skipped}`);
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
  AUDIT, WEIGHTS,
  parseRobots, robotsVerdict, matchesRobotsPath,
  stripTags, hasViewport, pageTitle, findsPhone, newestYear, deadTech,
  isNotTheirOwnSite, scoreSite, readProspectsWithSites, toCsv, checkSite, main
};

if (require.main === module) {
  main().catch(err => {
    console.error('\nFailed: ' + (err && err.message ? err.message : err));
    process.exit(1);
  });
}
