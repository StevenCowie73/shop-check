#!/usr/bin/env node
'use strict';

/* ---------------------------------------------------------------------
   Shop Check prospect finder.

   Builds a ranked call list of small trade businesses from the Google
   Places API (New). It only reads data and writes two files. It never
   contacts anybody.

   Run:  node find-prospects.js
   Key:  finder/.env  ->  GOOGLE_PLACES_API_KEY=...
   --------------------------------------------------------------------- */

const fs = require('fs');
const path = require('path');

/* =====================================================================
   1. SEARCH CONFIG — edit me.
   center        the middle of the area you want to call into
   radiusMiles   how far out from there (the API caps a circle at ~31
                 miles, so anything larger is clamped; to cover more
                 ground, run again from a second center point)
   terms         one search per term, deduplicated by place id
   ===================================================================== */
const SEARCH = {
  center: { lat: 32.5160, lng: -93.7321 },   /* Bossier City, LA */
  radiusMiles: 30,
  terms: [
    'plumber',
    'electrician',
    'HVAC contractor',
    'general contractor',
    'roofing contractor',
    'landscaper',
    'painter',
    'flooring contractor',
    'fencing contractor',
    'pressure washing'
  ],
  maxPagesPerTerm: 3,        /* 20 results a page, so 3 pages = 60 max per term */
  pauseBetweenCallsMs: 300,  /* be polite; also lets a page token settle */
  languageCode: 'en',
  regionCode: 'US'
};

/* =====================================================================
   2. SCORING WEIGHTS — edit me.
   Higher total = the business is missing more of what we sell.
   A business with no phone number scores 0: we cannot call it.
   ===================================================================== */
const SCORING = {
  noWebsite: 40,                 /* no website at all */
  socialOnlyWebsite: 30,         /* "website" is a Facebook or Instagram page */
  underTenReviews: 25,           /* fewer than 10 reviews */
  tenToTwentyFourReviews: 15,    /* 10-24 reviews */
  noRating: 10,                  /* no star rating yet */
  noHours: 10,                   /* no opening hours listed */
  hasPhone: 15,                  /* we can actually reach them */
  maxScore: 100
};

/* =====================================================================
   3. CHAINS AND FRANCHISES — edit me.
   Lowercase fragments. If a business name contains one, it is skipped.
   Keep entries specific enough not to catch a local shop by accident.
   ===================================================================== */
const CHAIN_BLOCKLIST = [
  /* plumbing / hvac / electrical */
  'roto-rooter', 'roto rooter', 'mr. rooter', 'mr rooter', 'benjamin franklin plumbing',
  'ars/rescue rooter', 'rescue rooter', 'one hour heating', 'one hour air', 'aire serv',
  'mister sparky', 'mr. electric', 'mr electric', 'service experts', 'horizon services',
  'bath fitter', 're-bath', 'rebath', 'west shore home', 'leaf filter', 'leaffilter',
  'leafguard', 'renewal by andersen', 'champion windows',
  /* landscaping / lawn */
  'trugreen', 'tru green', 'weed man', 'lawn doctor', 'u.s. lawns', 'us lawns',
  'the grounds guys', 'scotts lawn',
  /* painting */
  'certapro', 'five star painting', 'fresh coat painters', '360 painting', 'wow 1 day painting',
  /* flooring */
  'empire today', 'floor coverings international', 'footprints floors', '50 floor',
  'll flooring', 'lumber liquidators', 'floor & decor', 'floor and decor',
  /* roofing / restoration / handyman */
  'erie home', 'power home remodeling', 'servpro', 'servicemaster', 'paul davis',
  'rainbow restoration', '911 restoration', 'stanley steemer', 'dreammaker bath',
  'handyman connection', 'mr. handyman', 'mr handyman', 'ace handyman',
  /* cleaning / washing */
  'window genie', 'men in kilts', 'shack shine', 'chem-dry', 'chemdry', 'molly maid',
  /* big box and suppliers */
  'home depot', "lowe's", 'lowes home improvement', 'ace hardware', 'menards',
  'sherwin-williams', 'sherwin williams', 'benjamin moore', 'tractor supply',
  'ferguson', 'grainger'
];

/* A "website" on one of these hosts is really just a social page. */
const SOCIAL_HOSTS = ['facebook.com', 'fb.com', 'fb.me', 'instagram.com'];

/* =====================================================================
   Nothing below here normally needs editing.
   ===================================================================== */

const API_URL = 'https://places.googleapis.com/v1/places:searchText';
const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.nationalPhoneNumber',
  'places.websiteUri',
  'places.rating',
  'places.userRatingCount',
  'places.businessStatus',
  'places.primaryType',
  'places.location',
  'places.googleMapsUri',
  'places.regularOpeningHours',
  'nextPageToken'
].join(',');

const SHOP_CHECK_URL = 'https://stevencowie73.github.io/shop-check/';
const MAX_CIRCLE_METERS = 50000;          /* API limit on a circular bias */
const METERS_PER_MILE = 1609.344;
const MAX_RETRIES = 4;
const OUT_DIR = process.env.SHOP_CHECK_OUT_DIR || path.join(__dirname, 'out');

let apiCalls = 0;
let apiRetries = 0;

/* ---------- tiny .env reader (so there are no dependencies) ---------- */
function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

/* Never let the key reach a log line, whatever went wrong. */
function redact(text) {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  const s = String(text);
  return key ? s.split(key).join('[REDACTED_KEY]') : s;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- geography ---------- */
function milesBetween(a, b) {
  const R = 3958.7613;
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/* ---------- classification ---------- */
function isChain(name) {
  const n = String(name || '').toLowerCase();
  return CHAIN_BLOCKLIST.some(bad => n.includes(bad));
}

function socialHost(website) {
  if (!website) return null;
  let host;
  try { host = new URL(website).hostname.toLowerCase().replace(/^www\./, ''); }
  catch (e) { return null; }
  const hit = SOCIAL_HOSTS.find(h => host === h || host.endsWith('.' + h));
  if (!hit) return null;
  return hit.startsWith('insta') ? 'Instagram' : 'Facebook';
}

const isSocialOnly = website => socialHost(website) !== null;

/* ---------- scoring ---------- */
function scoreBusiness(p) {
  const phone = p.nationalPhoneNumber || '';
  if (!phone) {
    return {
      score: 0,
      unreachable: true,
      signals: ['noPhone'],
      why: 'No phone number listed, so there is nobody to call'
    };
  }

  const website = p.websiteUri || '';
  const reviews = Number.isFinite(p.userRatingCount) ? p.userRatingCount : 0;
  const hasRating = typeof p.rating === 'number' && p.rating > 0;
  const hours = p.regularOpeningHours;
  const hasHours = !!(hours && (
    (Array.isArray(hours.weekdayDescriptions) && hours.weekdayDescriptions.length) ||
    (Array.isArray(hours.periods) && hours.periods.length)
  ));

  const signals = [];
  let score = SCORING.hasPhone;

  if (!website) { score += SCORING.noWebsite; signals.push('noWebsite'); }
  else if (isSocialOnly(website)) { score += SCORING.socialOnlyWebsite; signals.push('socialOnlyWebsite'); }

  if (reviews < 10) { score += SCORING.underTenReviews; signals.push('underTenReviews'); }
  else if (reviews < 25) { score += SCORING.tenToTwentyFourReviews; signals.push('tenToTwentyFourReviews'); }

  if (!hasRating) { score += SCORING.noRating; signals.push('noRating'); }
  if (!hasHours) { score += SCORING.noHours; signals.push('noHours'); }

  score = Math.max(0, Math.min(SCORING.maxScore, score));
  return { score, unreachable: false, signals, why: whyText(signals, p) };
}

function whyText(signals, p) {
  const reviews = Number.isFinite(p.userRatingCount) ? p.userRatingCount : 0;
  const parts = [];
  for (const s of signals) {
    if (s === 'noPhone') parts.push('no phone number listed, so there is nobody to call');
    else if (s === 'noWebsite') parts.push('no website');
    else if (s === 'socialOnlyWebsite') {
      const host = socialHost(p.websiteUri);
      parts.push('only ' + (host === 'Instagram' ? 'an Instagram' : 'a ' + (host || 'social')) + ' page');
    }
    else if (s === 'underTenReviews') parts.push(reviews === 0 ? 'no reviews yet' : `only ${reviews} review${reviews === 1 ? '' : 's'}`);
    else if (s === 'tenToTwentyFourReviews') parts.push(`only ${reviews} reviews`);
    else if (s === 'noRating') parts.push('no rating yet');
    else if (s === 'noHours') parts.push('no hours listed');
  }
  if (!parts.length) return 'Nothing obvious missing, low priority';
  const line = parts.join(', ');
  return line.charAt(0).toUpperCase() + line.slice(1);
}

/* ---------- the pre-filled Shop Check link ---------- */
function slugFromPlaceId(placeId) {
  return String(placeId || '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 32);
}

function shopCheckLink(name, placeId) {
  const params = ['name=' + encodeURIComponent(String(name || '').slice(0, 80))];
  const ref = slugFromPlaceId(placeId);
  if (ref) params.push('ref=' + ref);
  return SHOP_CHECK_URL + '?' + params.join('&');
}

/* ---------- CSV ---------- */
function csvCell(value) {
  let s = value === null || value === undefined ? '' : String(value);
  /* stop a spreadsheet treating a cell as a formula */
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

const CSV_COLUMNS = [
  ['score', r => r.score],
  ['name', r => r.name],
  ['phone', r => r.phone],
  ['address', r => r.address],
  ['website', r => r.website],
  ['rating', r => r.rating],
  ['reviews', r => r.reviews],
  ['primary_type', r => r.primaryType],
  ['google_maps_url', r => r.googleMapsUrl],
  ['place_id', r => r.placeId],
  ['why', r => r.why],
  ['shop_check_link', r => r.shopCheckLink]
];

function toCsv(rows) {
  const lines = [CSV_COLUMNS.map(c => csvCell(c[0])).join(',')];
  for (const r of rows) lines.push(CSV_COLUMNS.map(c => csvCell(c[1](r))).join(','));
  return '﻿' + lines.join('\r\n') + '\r\n';   /* BOM keeps Excel happy */
}

/* ---------- the API ---------- */
async function searchPage(apiKey, textQuery, radiusMeters, pageToken) {
  const body = {
    textQuery,
    pageSize: 20,
    languageCode: SEARCH.languageCode,
    regionCode: SEARCH.regionCode,
    locationBias: {
      circle: {
        center: { latitude: SEARCH.center.lat, longitude: SEARCH.center.lng },
        radius: radiusMeters
      }
    }
  };
  if (pageToken) body.pageToken = pageToken;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      apiRetries++;
      const wait = 2000 * 2 ** (attempt - 1);
      console.log(`    retrying in ${wait / 1000}s (attempt ${attempt} of ${MAX_RETRIES})`);
      await sleep(wait);
    }
    let res;
    try {
      apiCalls++;
      res = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': FIELD_MASK
        },
        body: JSON.stringify(body)
      });
    } catch (err) {
      console.warn('    network error: ' + redact(err.message));
      if (attempt === MAX_RETRIES) throw new Error('network failed after retries');
      continue;
    }

    if (res.ok) return res.json();

    const text = redact(await res.text().catch(() => ''));
    if (res.status === 429 || res.status >= 500) {
      console.warn(`    ${res.status} from Places API`);
      if (attempt === MAX_RETRIES) throw new Error(`gave up after ${MAX_RETRIES} retries: ${res.status}`);
      continue;
    }
    /* 400/401/403 are our problem, not a blip: stop now */
    throw new Error(`Places API ${res.status}: ${text.slice(0, 400)}`);
  }
  throw new Error('unreachable');
}

async function runSearches(apiKey, radiusMeters) {
  const byPlaceId = new Map();
  const stats = { raw: 0, notOperational: 0, chains: 0, outsideRadius: 0 };

  for (const term of SEARCH.terms) {
    let pageToken = null;
    let page = 0;
    console.log(`\nSearching "${term}"`);
    do {
      let data;
      try {
        data = await searchPage(apiKey, term, radiusMeters, pageToken);
      } catch (err) {
        console.warn(`  giving up on "${term}": ${redact(err.message)}`);
        break;
      }
      const places = Array.isArray(data.places) ? data.places : [];
      page++;
      stats.raw += places.length;
      console.log(`  page ${page}: ${places.length} results`);

      for (const p of places) {
        if (!p.id || byPlaceId.has(p.id)) continue;
        if (p.businessStatus && p.businessStatus !== 'OPERATIONAL') { stats.notOperational++; continue; }
        const name = (p.displayName && p.displayName.text) || '';
        if (isChain(name)) { stats.chains++; continue; }
        if (p.location) {
          const miles = milesBetween(SEARCH.center, { lat: p.location.latitude, lng: p.location.longitude });
          if (miles > SEARCH.radiusMiles) { stats.outsideRadius++; continue; }
          p._miles = miles;
        }
        p._term = term;
        byPlaceId.set(p.id, p);
      }

      pageToken = data.nextPageToken || null;
      if (pageToken && page < SEARCH.maxPagesPerTerm) await sleep(SEARCH.pauseBetweenCallsMs);
    } while (pageToken && page < SEARCH.maxPagesPerTerm);
  }
  return { places: [...byPlaceId.values()], stats };
}

/* ---------- shaping the output ---------- */
function toRow(p) {
  const name = (p.displayName && p.displayName.text) || '';
  const scored = scoreBusiness(p);
  return {
    score: scored.score,
    name,
    phone: p.nationalPhoneNumber || '',
    address: p.formattedAddress || '',
    website: p.websiteUri || '',
    rating: typeof p.rating === 'number' ? p.rating : '',
    reviews: Number.isFinite(p.userRatingCount) ? p.userRatingCount : 0,
    primaryType: p.primaryType || '',
    googleMapsUrl: p.googleMapsUri || '',
    placeId: p.id,
    why: scored.why,
    shopCheckLink: shopCheckLink(name, p.id),
    unreachable: scored.unreachable,
    signals: scored.signals,
    searchTerm: p._term || '',
    distanceMiles: typeof p._miles === 'number' ? Math.round(p._miles * 10) / 10 : null
  };
}

async function main() {
  loadEnvFile(path.join(__dirname, '.env'));
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    console.error('No GOOGLE_PLACES_API_KEY found.');
    console.error('Copy finder/.env.example to finder/.env and put your key in it.');
    process.exit(1);
  }

  let radiusMeters = Math.round(SEARCH.radiusMiles * METERS_PER_MILE);
  if (radiusMeters > MAX_CIRCLE_METERS) {
    console.warn(`Radius ${SEARCH.radiusMiles} miles is past the API limit; searching at ${(MAX_CIRCLE_METERS / METERS_PER_MILE).toFixed(1)} miles and filtering the rest out.`);
    radiusMeters = MAX_CIRCLE_METERS;
  }

  console.log(`Shop Check prospect finder`);
  console.log(`Center ${SEARCH.center.lat}, ${SEARCH.center.lng} — ${SEARCH.radiusMiles} miles — ${SEARCH.terms.length} search terms`);

  const started = Date.now();
  const { places, stats } = await runSearches(apiKey, radiusMeters);
  const rows = places.map(toRow).sort((a, b) =>
    b.score - a.score || b.reviews - a.reviews || a.name.localeCompare(b.name));

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const csvPath = path.join(OUT_DIR, 'prospects.csv');
  const jsonPath = path.join(OUT_DIR, 'prospects.json');
  fs.writeFileSync(csvPath, toCsv(rows), 'utf8');
  fs.writeFileSync(jsonPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    center: SEARCH.center,
    radiusMiles: SEARCH.radiusMiles,
    terms: SEARCH.terms,
    weights: SCORING,
    counts: {
      resultsSeen: stats.raw,
      uniqueKept: rows.length,
      skippedNotOperational: stats.notOperational,
      skippedChains: stats.chains,
      skippedOutsideRadius: stats.outsideRadius,
      unreachable: rows.filter(r => r.unreachable).length
    },
    apiCalls,
    prospects: rows
  }, null, 2), 'utf8');

  const hot = rows.filter(r => r.score > 50);
  console.log('\n----------------------------------------');
  console.log(`Total businesses found:   ${rows.length}`);
  console.log(`Scoring above 50:         ${hot.length}`);
  console.log(`No phone, cannot call:    ${rows.filter(r => r.unreachable).length}`);
  console.log(`Skipped, not operational: ${stats.notOperational}`);
  console.log(`Skipped, chain names:     ${stats.chains}`);
  console.log(`Skipped, outside radius:  ${stats.outsideRadius}`);
  console.log(`API calls made:           ${apiCalls}${apiRetries ? ` (${apiRetries} ${apiRetries === 1 ? 'was a retry' : 'were retries'})` : ''}`);
  console.log(`Took:                     ${((Date.now() - started) / 1000).toFixed(1)}s`);

  console.log('\nTop 10:');
  rows.slice(0, 10).forEach((r, i) => {
    console.log(`${String(i + 1).padStart(2)}. ${String(r.score).padStart(3)}  ${r.name}  ${r.phone || '(no phone)'}`);
  });

  console.log(`\nWrote ${csvPath}`);
  console.log(`Wrote ${jsonPath}`);
}

module.exports = {
  SEARCH, SCORING, CHAIN_BLOCKLIST, SOCIAL_HOSTS,
  scoreBusiness, whyText, isChain, isSocialOnly, socialHost,
  slugFromPlaceId, shopCheckLink, csvCell, toCsv, toRow,
  milesBetween, loadEnvFile, redact, main
};

if (require.main === module) {
  main().catch(err => {
    console.error('\nFailed: ' + redact(err && err.message ? err.message : err));
    process.exit(1);
  });
}
