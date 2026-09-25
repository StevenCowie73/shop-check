'use strict';

/* placeDetails is placeDetails(apiKey, placeId, opts). Both routes that
   call it once passed the place id as the key and the key as the place id,
   and every test stubbed placeDetails itself, so nothing noticed.

   These tests go one level lower: the real placeDetails runs, and only the
   network is replaced (finder/lib/http.js), so the assertion is on the
   request Google would actually receive — the key in the X-Goog-Api-Key
   header, the place id in the URL path, and the key nowhere in the URL.

   Each test file runs in its own process, so replacing modules in the
   require cache here affects nothing else. */

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const KEY = 'test-key-AbC123';
const PLACE_ID = 'ChIJtestPlaceId42';

const requests = [];
function fakeFetch(url, init) {
  requests.push({ url: String(url), headers: (init && init.headers) || {} });
  const body = JSON.stringify({ id: PLACE_ID, displayName: { text: 'Pelican Point Roofing' } });
  return Promise.resolve({ status: 200, ok: true, text: async () => body, json: async () => JSON.parse(body) });
}

function stub(rel, exports) {
  const file = require.resolve(path.join(__dirname, '..', rel));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}
stub('finder/lib/http.js', { fetch: fakeFetch });
stub('site/prospects.js', {
  getProspect: async ref => (ref === 'TESTREF1' ? { ref, placeId: PLACE_ID } : null),
  normaliseRef: r => r, DEMO_REF: 'DEMO2026'
});

const placesRoute = require('../api/places.js');
const { makeHandler } = require('../api/explorer.js');
const { createDemoStore } = require('../lib/explorer/demo-store.js');
const { build } = require('../lib/explorer/demo-data.js');

function fakeRes() {
  return {
    statusCode: 200, headers: {}, body: '',
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(b) { this.body = b || ''; }
  };
}

function checkRequest(r) {
  const u = new URL(r.url);
  assert.strictEqual(u.origin + u.pathname, 'https://places.googleapis.com/v1/places/' + PLACE_ID,
    'the place id is the last part of the URL path');
  assert.strictEqual(r.headers['X-Goog-Api-Key'], KEY, 'the key is the X-Goog-Api-Key header');
  assert.strictEqual(r.url.includes(KEY), false, 'the key is never in the URL');
  assert.strictEqual(u.searchParams.get('languageCode'), 'en', 'details are asked for in English');
  assert.ok(r.headers['X-Goog-FieldMask'], 'a field mask is always sent');
}

test('the prospect-page proxy sends the key as the key and the place id as the place id', async () => {
  requests.length = 0;
  const before = process.env.GOOGLE_PLACES_API_KEY;
  process.env.GOOGLE_PLACES_API_KEY = KEY;
  try {
    const res = fakeRes();
    await placesRoute({ url: '/api/places?ref=TESTREF1', method: 'GET', headers: {} }, res);
    assert.strictEqual(requests.length, 1);
    checkRequest(requests[0]);
    assert.strictEqual(JSON.parse(res.body).ok, true);
  } finally {
    if (before === undefined) delete process.env.GOOGLE_PLACES_API_KEY; else process.env.GOOGLE_PLACES_API_KEY = before;
  }
});

test('Explorer’s Google action does the same', async () => {
  requests.length = 0;
  const store = createDemoStore(build());
  const id = store._snapshot().prospects[0].id;
  await store.upsertProspect({ id, placeId: PLACE_ID });
  const handler = makeHandler({ env: { LOOKUP_PASSWORD: 'pw', GOOGLE_PLACES_API_KEY: KEY }, store, twilioFeed: async () => [] });
  const res = fakeRes();
  await handler({ url: '/explorer?action=google&id=' + id, method: 'GET', headers: { 'x-lookup-password': 'pw' } }, res);
  assert.strictEqual(requests.length, 1);
  checkRequest(requests[0]);
  assert.strictEqual(JSON.parse(res.body).ok, true);
});
