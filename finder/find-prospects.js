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

const { loadEnvFile, redact, sleep } = require('./lib/env.js');
const { csvCell, toCsv: writeCsv } = require('./lib/csv.js');
const places = require('./lib/places.js');
const {
  SCORING, CHAIN_BLOCKLIST, SOCIAL_HOSTS,
  milesBetween, isChain, socialHost, isSocialOnly,
  scoreBusiness, whyText, slugFromPlaceId, shopCheckLink
} = require('./lib/prospect.js');

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
   SCORING and CHAIN_BLOCKLIST moved to lib/prospect.js, so the finder and
   the single-business lookup cannot drift apart. Edit them there.
   ===================================================================== */

/* =====================================================================
   Nothing below here normally needs editing.
   ===================================================================== */

const MAX_CIRCLE_METERS = 50000;          /* API limit on a circular bias */
const METERS_PER_MILE = 1609.344;
const OUT_DIR = process.env.SHOP_CHECK_OUT_DIR || path.join(__dirname, 'out');

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

const toCsv = rows => writeCsv(CSV_COLUMNS, rows);

/* The shared searchText does the calling and the backing off; this keeps
   the console voice the batch run has always had. */
async function searchPage(apiKey, textQuery, radiusMeters, pageToken) {
  return places.searchText(apiKey, {
    textQuery, pageSize: 20,
    languageCode: SEARCH.languageCode,
    regionCode: SEARCH.regionCode,
    locationBias: {
      circle: {
        center: { latitude: SEARCH.center.lat, longitude: SEARCH.center.lng },
        radius: radiusMeters
      }
    },
    pageToken,
    onRetry: (attempt, wait, max) =>
      console.log(`    retrying in ${wait / 1000}s (attempt ${attempt} of ${max})`),
    onWarn: msg => console.warn('    ' + msg)
  });
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
    apiCalls: places.counts().apiCalls,
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
  const { apiCalls, apiRetries } = places.counts();
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
