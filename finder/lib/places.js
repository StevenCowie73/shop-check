'use strict';

/* The two Places API (New) calls the project makes: a text search to find
   businesses, and a details call to read reviews and the fields the search
   does not return. find-prospects.js and judge-prospects.js each had their
   own copy of one of them.

   The key is only ever sent as a request header, never in a URL, and every
   error is scrubbed before it leaves here. */

const { scrub, sleep } = require('./env.js');

const SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';
const DETAILS_URL = 'https://places.googleapis.com/v1/places/';

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


/* Details asks for what the search does not return. Only documented v1
   fields — an unknown one is a 400, not a silently missing value. */
const DETAIL_FIELDS = [
  'id', 'displayName', 'businessStatus', 'priceLevel', 'primaryTypeDisplayName',
  'editorialSummary', 'reviews', 'rating', 'userRatingCount', 'websiteUri',
  'nationalPhoneNumber', 'regularOpeningHours'
].join(',');


/* Both calls count against the same bill, so both count through here. */
let apiCalls = 0, apiRetries = 0;
const counts = () => ({ apiCalls, apiRetries });
const resetCounts = () => { apiCalls = 0; apiRetries = 0; };

const MAX_RETRIES = 4;

/* A rate limit or a server error is worth another go; a 400, 401, 403 or
   404 is our problem and will not improve by asking again. */
async function searchText(apiKey, opts) {
  const { textQuery, pageSize = 20, languageCode, regionCode, locationBias,
          pageToken, fieldMask = FIELD_MASK, maxRetries = MAX_RETRIES,
          onRetry, onWarn } = opts;
  const body = { textQuery, pageSize };
  if (languageCode) body.languageCode = languageCode;
  if (regionCode) body.regionCode = regionCode;
  if (locationBias) body.locationBias = locationBias;
  if (pageToken) body.pageToken = pageToken;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      apiRetries++;
      const wait = 2000 * 2 ** (attempt - 1);
      if (onRetry) onRetry(attempt, wait, maxRetries);
      await sleep(wait);
    }
    let res;
    try {
      apiCalls++;
      res = await fetch(SEARCH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': fieldMask
        },
        body: JSON.stringify(body)
      });
    } catch (err) {
      if (onWarn) onWarn('network error: ' + scrub(err.message));
      if (attempt === maxRetries) throw new Error('network failed after retries');
      continue;
    }

    if (res.ok) return res.json();

    const text = scrub(await res.text().catch(() => ''));
    if (res.status === 429 || res.status >= 500) {
      if (onWarn) onWarn(`${res.status} from Places API`);
      if (attempt === maxRetries) throw new Error(`gave up after ${maxRetries} retries: ${res.status}`);
      continue;
    }
    throw new Error(`Places API ${res.status}: ${text.slice(0, 400)}`);
  }
  throw new Error('unreachable');
}

async function placeDetails(apiKey, placeId, opts) {
  const { fieldMask = DETAIL_FIELDS, timeoutMs = 10000, maxRetries = 4 } = opts || {};
  let wait = 1000;
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    apiCalls++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let status, text, body = null;
    try {
      const res = await fetch(DETAILS_URL + encodeURIComponent(placeId), {
        headers: { 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': fieldMask },
        signal: controller.signal
      });
      status = res.status;
      text = await res.text();
      try { body = JSON.parse(text); } catch (e) { /* not json */ }
    } finally { clearTimeout(timer); }

    if (status === 200) return body;
    if (status === 400 || status === 401 || status === 403 || status === 404) {
      throw new Error(scrub(`Places API ${status} for ${placeId}: ${String(text).slice(0, 300)}`));
    }
    if (attempt === maxRetries + 1) {
      throw new Error(scrub(`Places API ${status} for ${placeId}, gave up after ${attempt} tries`));
    }
    apiRetries++;
    await sleep(wait);
    wait *= 2;
  }
}

module.exports = {
  SEARCH_URL, DETAILS_URL, FIELD_MASK, DETAIL_FIELDS,
  searchText, placeDetails, counts, resetCounts
};
