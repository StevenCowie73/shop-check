'use strict';

/* Explorer: the password gate, the demo banner, the filters, the Google
   listing's attribution, notes, and that nothing from Google is kept.

   Everything here runs on the invented demo data. Nothing calls Google,
   Twilio or a database: those are stubbed through makeHandler's deps. */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');

const { makeHandler } = require('../api/explorer.js');
const { createDemoStore } = require('../lib/explorer/demo-store.js');
const { build } = require('../lib/explorer/demo-data.js');
const { getStore, resetStore, dataMode } = require('../lib/explorer/store.js');
const { whereFor } = require('../lib/explorer/pg-store.js');
const { mask, maskInText, liveTwilioFeed } = require('../lib/explorer/twilio-feed.js');
const { GOOGLE_LOGO } = require('../api/places.js');

const PW = 'correct horse';

function fakeReq(url, { method = 'GET', password, body } = {}) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  req.url = url;
  req.method = method;
  req.headers = password === undefined ? {} : { 'x-lookup-password': password };
  return req;
}

function fakeRes() {
  return {
    statusCode: 200, headers: {}, body: '',
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(b) { this.body = b || ''; },
    json() { return JSON.parse(this.body); }
  };
}

function setup(extra = {}) {
  const store = createDemoStore(build());
  const handler = makeHandler({
    env: { LOOKUP_PASSWORD: PW, ...(extra.env || {}) },
    store,
    twilioFeed: extra.twilioFeed || (async () => []),
    placeDetails: extra.placeDetails || (async () => { throw new Error('Google must not be called'); })
  });
  const call = async (url, opts = {}) => {
    const res = fakeRes();
    await handler(fakeReq(url, { password: PW, ...opts }), res);
    return res;
  };
  return { store, handler, call };
}

/* ---------- the password gate ---------- */

test('every data action is refused without the password, or with a wrong one', async () => {
  const { handler } = setup();
  for (const action of ['bootstrap', 'list', 'pins', 'business&id=x', 'letter&id=x', 'google&id=x', 'runs', 'run&id=x']) {
    for (const password of [undefined, '', 'wrong', PW + ' ']) {
      const res = fakeRes();
      await handler(fakeReq('/explorer?action=' + action, { password }), res);
      assert.strictEqual(res.statusCode, 401, action + ' with ' + JSON.stringify(password));
      assert.strictEqual(res.body.includes('Marsh Lane'), false);
    }
  }
  for (const action of ['note', 'dnc']) {
    const res = fakeRes();
    await handler(fakeReq('/explorer?action=' + action + '&id=x', { method: 'POST', password: 'wrong', body: { body: 'x' } }), res);
    assert.strictEqual(res.statusCode, 401, action);
  }
});

test('with no password configured, nothing is served at all', async () => {
  const handler = makeHandler({ env: {}, store: createDemoStore(build()), twilioFeed: async () => [] });
  const res = fakeRes();
  await handler(fakeReq('/explorer?action=bootstrap', { password: '' }), res);
  assert.strictEqual(res.statusCode, 500);
  assert.match(res.body, /LOOKUP_PASSWORD/);
});

test('the page shell is noindex, not cached, and carries no data', async () => {
  const { handler, store } = setup();
  const res = fakeRes();
  await handler(fakeReq('/explorer'), res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.headers['x-robots-tag'], 'noindex, nofollow');
  assert.strictEqual(res.headers['cache-control'], 'no-store');
  assert.match(res.body, /<meta name="robots" content="noindex, nofollow">/);
  for (const p of store._snapshot().prospects) {
    assert.strictEqual(res.body.includes(p.company), false, p.company + ' is not in the shell');
  }
  assert.match(res.body, /Signal password/);
});

test('the right password opens it', async () => {
  const { call } = setup();
  const res = await call('/explorer?action=bootstrap');
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.headers['cache-control'], 'no-store');
  assert.deepStrictEqual(res.json().funnel, { found: 25, selected: 18, letterSent: 16, pageOpened: 8, replied: 4, client: 1 });
});

/* ---------- the demo banner ---------- */

test('the DEMO DATA banner is on the page, above every screen, and demo mode says so', async () => {
  const { call, handler } = setup();
  const res = fakeRes();
  await handler(fakeReq('/explorer'), res);
  const html = res.body;
  /* it sits outside <main>, which is the only part a screen replaces */
  const banner = html.indexOf('id="demo"'), main = html.indexOf('<main id="view">');
  assert.ok(banner > 0 && banner < main, 'banner comes before the screen area');
  assert.match(html, /<div class="demo" id="demo">DEMO DATA/);
  assert.strictEqual(/<div class="demo" id="demo"[^>]*hidden/.test(html), false, 'shown by default, not opt-in');
  /* the script hides it only when the server says the data is real */
  assert.match(html, /getElementById\('demo'\)\.hidden = b\.mode !== 'demo'/);
  assert.strictEqual((await call('/explorer?action=bootstrap')).json().mode, 'demo');
});

test('demo data is invented: example.com emails, 555 numbers, generic streets', () => {
  const d = build();
  assert.ok(d.prospects.length >= 20 && d.prospects.length <= 30);
  for (const p of d.prospects) {
    if (p.email) assert.match(p.email, /\.example\.com$/, p.company);
    assert.match(p.phone, /^318-555-01\d\d$/, p.company);
    assert.match(p.id, /^DM/, 'demo refs are marked');
    assert.strictEqual(p.placeId, null, 'no demo business has a Google place id');
  }
  assert.deepStrictEqual([...new Set(d.prospects.map(p => p.mailingCity))].sort(), ['Bossier City', 'Shreveport', 'Youngsville']);
  assert.strictEqual(d.notes.length, 2);
  assert.strictEqual(d.runs.length, 2);
});

/* ---------- filters ---------- */

test('the List filters by search, area, status, website, licence age and email', async () => {
  const { call } = setup();
  const rows = async qs => (await call('/explorer?action=list' + qs)).json().rows;
  const all = await rows('');
  assert.strictEqual(all.length, 25);

  assert.deepStrictEqual((await rows('&q=fence')).map(r => r.company).sort(), all.filter(r => /fenc/i.test(r.company + r.trade)).map(r => r.company).sort());
  assert.ok((await rows('&q=youngsville')).every(r => r.town === 'Youngsville'));
  assert.ok((await rows('&area=youngsville')).every(r => r.areaId === 'youngsville'));
  for (const s of ['not_contacted', 'letter_sent', 'page_opened', 'replied', 'client', 'closed']) {
    const r = await rows('&status=' + s);
    assert.ok(r.length > 0 && r.every(x => x.status === s), s);
  }
  for (const w of ['fine', 'poor', 'broken', 'not_found', 'unknown', 'blocked']) {
    const r = await rows('&website=' + w);
    assert.ok(r.length > 0 && r.every(x => x.website === w), w);
  }
  const blocked = await rows('&website=blocked');
  assert.strictEqual(blocked[0].websiteLabel, "Blocked — couldn't check");

  const d = build(), cut = '2025-09-24';
  assert.strictEqual((await rows('&licenceAge=12m')).length, d.prospects.filter(p => p.firstIssued >= cut).length);
  assert.strictEqual((await rows('&hasEmail=no')).length, d.prospects.filter(p => !p.email).length);
  /* combined */
  const combo = await rows('&area=bossier-caddo&status=not_contacted');
  assert.ok(combo.every(r => r.areaId === 'bossier-caddo' && r.status === 'not_contacted'));
  /* unknown values are dropped, not passed on */
  assert.strictEqual((await rows('&status=DROP%20TABLE&website=%27')).length, 25);
});

test('the Home chips are ready-made filters', async () => {
  const { call } = setup();
  const rows = async chip => (await call('/explorer?action=list&chip=' + chip)).json().rows;
  assert.ok((await rows('no-website')).every(r => r.website === 'not_found'));
  assert.strictEqual((await rows('no-website')).length, 7);
  assert.ok((await rows('broken')).every(r => r.website === 'broken'));
  assert.ok((await rows('not-contacted')).every(r => r.status === 'not_contacted'));
  assert.ok((await rows('replied')).every(r => r.status === 'replied'));
  assert.ok((await rows('new-licence')).length > 0);
  const chips = (await call('/explorer?action=bootstrap')).json().chips.map(c => c.label);
  assert.deepStrictEqual(chips, ['No website', 'Broken site', 'New licence (12 months)', 'Not contacted', 'Replied']);
});

test('the Postgres store builds the same filters as parameters, never as SQL text', () => {
  const { sql, params } = whereFor({ q: "x'; DROP TABLE prospects; --", status: 'replied', website: 'blocked', area: 'youngsville', hasEmail: 'yes' });
  assert.strictEqual(/drop/i.test(sql), false);
  assert.strictEqual(sql.includes("x'"), false);
  assert.ok(params.includes('%drop%') && params.includes("%x';%"), 'the search text travels as parameters');
  assert.ok(params.includes('replied') && params.includes('blocked') && params.includes('youngsville'));
});

test('EXPLORER_DATA picks the backend; a database URL alone never does', () => {
  const URL_ = 'postgres://u:p@localhost:1/none';
  resetStore();
  assert.strictEqual(getStore({}).mode, 'demo');
  /* What the Neon integration sets on the project, with no switch: still demo. */
  for (const k of ['DATABASE_URL', 'COLDENJAMES_URL', 'COLDENJAMES_DATABASE_URL']) {
    resetStore();
    assert.strictEqual(getStore({ [k]: URL_ }).mode, 'demo', k + ' alone must not switch the backend');
  }
  resetStore();
  assert.strictEqual(getStore({ EXPLORER_DATA: 'demo', COLDENJAMES_DATABASE_URL: URL_ }).mode, 'demo');
  resetStore();
  assert.strictEqual(getStore({ EXPLORER_DATA: 'nonsense', COLDENJAMES_DATABASE_URL: URL_ }).mode, 'demo');
  assert.strictEqual(dataMode({}), 'demo');
  assert.strictEqual(dataMode({ EXPLORER_DATA: ' Postgres ' }), 'postgres');
  resetStore();
});

test('EXPLORER_DATA=postgres reads the database, and says so when there is none', () => {
  const URL_ = 'postgres://u:p@localhost:1/none';
  for (const k of ['DATABASE_URL', 'COLDENJAMES_URL', 'COLDENJAMES_DATABASE_URL']) {
    resetStore();
    assert.strictEqual(getStore({ EXPLORER_DATA: 'postgres', [k]: URL_ }).mode, 'postgres', k);
  }
  resetStore();
  assert.throws(() => getStore({ EXPLORER_DATA: 'postgres' }), /EXPLORER_DATA=postgres but no database URL/);
  resetStore();
});

test('bootstrap reports demo mode with a database URL set but no switch', async () => {
  resetStore();
  const handler = makeHandler({
    env: { LOOKUP_PASSWORD: PW, COLDENJAMES_DATABASE_URL: 'postgres://u:p@localhost:1/none' },
    twilioFeed: async () => []
  });
  const res = fakeRes();
  await handler(fakeReq('/explorer?action=bootstrap', { password: PW }), res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.json().mode, 'demo');
  resetStore();
});

/* ---------- the business screen and Google ---------- */

const STUB_PLACE = {
  id: 'ChIJstub', displayName: { text: 'Pelican Point Roofing' }, rating: 4.6, userRatingCount: 23,
  googleMapsUri: 'https://maps.google.com/?cid=1',
  regularOpeningHours: { weekdayDescriptions: ['Monday: 7:00 AM – 5:00 PM'] },
  reviews: [
    { rating: 5, relativePublishTimeDescription: 'a month ago', text: { text: 'Second in the list.' },
      authorAttribution: { displayName: 'A. Reviewer', uri: 'https://maps.google.com/contrib/1', photoUri: 'https://lh3.googleusercontent.com/a' },
      googleMapsUri: 'https://maps.google.com/review/1' },
    { rating: 4, relativePublishTimeDescription: 'a year ago', text: { text: 'First would be wrong.' },
      authorAttribution: { displayName: 'B. Reviewer', uri: 'https://maps.google.com/contrib/2' },
      googleMapsUri: 'https://maps.google.com/review/2' }
  ],
  generativeSummary: {
    overview: { text: 'Roofing crew doing repairs and full replacements, with free estimates and storm work.', languageCode: 'en-US' },
    overviewFlagContentUri: 'https://www.google.com/local/review/rap/report?postId=PLACEFLAG',
    disclosureText: { text: 'Summarized with Gemini', languageCode: 'en-US' }
  },
  reviewSummary: {
    text: { text: 'People say this roofer shows up on time and cleans up after the job. They highlight fair prices, ' +
      'clear quotes and quick storm repairs, though a few mention slow replies in busy weeks. REVIEWSUMMARYEND', languageCode: 'en-US' },
    flagContentUri: 'https://www.google.com/local/review/rap/report?postId=REVIEWFLAG',
    disclosureText: { text: 'Summarized with Gemini', languageCode: 'en-US' },
    reviewsUri: 'https://www.google.com/maps/place//data=REVIEWSURI'
  }
};

async function withPlaceId() {
  const env = setup({ env: { GOOGLE_PLACES_API_KEY: 'k' }, placeDetails: async (key, id, opts) => {
    env.calls.push({ id, opts });
    return JSON.parse(JSON.stringify(STUB_PLACE));
  } });
  env.calls = [];
  const target = env.store._snapshot().prospects.find(p => p.company === 'Pelican Point Roofing');
  await env.store.upsertProspect({ id: target.id, placeId: 'ChIJstub' });
  env.id = target.id;
  return env;
}

test('the Google listing carries the logo and attribution exactly as the prospect page does', async () => {
  const { call, id, calls } = await withPlaceId();
  const g = (await call('/explorer?action=google&id=' + id)).json();
  assert.strictEqual(g.ok, true);
  assert.ok(g.html.includes(GOOGLE_LOGO), 'the Google Maps logo');
  assert.match(g.html, /in the order Google returned them/);
  assert.ok(g.html.indexOf('Second in the list.') < g.html.indexOf('First would be wrong.'), 'Google’s order is kept');
  assert.match(g.html, /href="https:\/\/maps\.google\.com\/contrib\/1"[^>]*>A\. Reviewer</, 'author credited with a link');
  assert.match(g.html, /Read this review on Google Maps/);
  assert.match(g.html, /See Pelican Point Roofing on Google Maps/);
  /* the place id came from the store */
  assert.deepStrictEqual(calls.map(c => c.id), ['ChIJstub']);
  assert.match(calls[0].opts.fieldMask, /reviews/);
  /* and the business screen never hands the place id to the browser */
  const b = (await call('/explorer?action=business&id=' + id)).json().business;
  assert.strictEqual(b.hasPlaceId, true);
  assert.strictEqual(JSON.stringify(b).includes('ChIJstub'), false);
});

test('a place id in the request is refused, never used', async () => {
  const { call, calls, id } = await withPlaceId();
  for (const k of ['place_id', 'placeId', 'placeid']) {
    const res = await call('/explorer?action=google&id=' + id + '&' + k + '=ChIJsomeoneelse');
    assert.strictEqual(res.statusCode, 400, k);
  }
  assert.strictEqual(calls.length, 0);
});

test('with no place_id it says so, and does not call Google', async () => {
  const { call, store } = setup({ env: { GOOGLE_PLACES_API_KEY: 'k' } });
  const id = store._snapshot().prospects[0].id;
  const g = (await call('/explorer?action=google&id=' + id)).json();
  assert.deepStrictEqual(g, { ok: false, reason: 'no place_id' });
  const b = (await call('/explorer?action=business&id=' + id)).json().business;
  assert.strictEqual(b.hasPlaceId, false);
  const shell = fakeRes();
  await setup().handler(fakeReq('/explorer'), shell);
  assert.ok(shell.body.includes("No Google listing on file — there's no place_id for this business."));
});

test('nothing Google returns is written to the store', async () => {
  const env = await withPlaceId();
  const before = JSON.stringify(env.store._snapshot());
  await env.call('/explorer?action=google&id=' + env.id);
  await env.call('/explorer?action=business&id=' + env.id);
  const after = JSON.stringify(env.store._snapshot());
  assert.strictEqual(after, before, 'the store is byte-for-byte unchanged');
  for (const s of ['Second in the list', 'A. Reviewer', '4.6', 'Monday: 7:00', 'lh3.googleusercontent',
    'REVIEWSUMMARYEND', 'free estimates and storm work', 'REVIEWFLAG', 'PLACEFLAG', 'REVIEWSURI', 'Summarized with Gemini']) {
    assert.strictEqual(after.includes(s), false, s);
  }
});

test('the database has nowhere to put Google data except place_id', () => {
  const dir = path.join(__dirname, '..', 'db', 'migrations');
  const sql = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n')
    .replace(/--.*$/gm, '');                                     /* comments may mention them; columns may not */
  for (const col of ['rating', 'review', 'opening_hours', 'hours', 'photo', 'user_rating', 'google_maps_uri', 'display_name']) {
    assert.strictEqual(new RegExp('\\b\\w*' + col + '\\w*\\s+(text|jsonb|numeric|int|integer|real)', 'i').test(sql), false, col);
  }
  assert.match(sql, /place_id\s+text/);
});

test('the website check reads in plain words, including a blocked site', async () => {
  const { call, store, handler } = setup();
  const blocked = store._snapshot().prospects.find(p => p.audit.state === 'blocked');
  const b = (await call('/explorer?action=business&id=' + blocked.id)).json().business;
  assert.strictEqual(b.audit.state, 'blocked');
  const shell = fakeRes();
  await handler(fakeReq('/explorer'), shell);
  assert.ok(shell.body.includes("Couldn't check — the site blocks automated visits."));
  assert.ok(shell.body.includes('Open site ↗'));
});

test('the letter comes back as a document, marked DEMO in demo mode', async () => {
  const { call, store } = setup();
  const p = store._snapshot().prospects.find(x => x.letter && x.letter.state === 'sent');
  const l = (await call('/explorer?action=letter&id=' + p.id)).json();
  assert.strictEqual(l.state, 'sent');
  assert.ok(l.drafted, 'no stored copy in the demo, so it is drafted and says so');
  assert.match(l.html, /<section class="page">/);
  assert.ok(l.html.includes('coldenjames.com/p/' + p.id));
  assert.match(l.html, />DEMO</);
});

/* ---------- notes and do-not-contact ---------- */

test('notes save (in memory, in the demo) and come back newest first', async () => {
  const { call, store } = setup();
  const id = store._snapshot().prospects[3].id;
  const r = await call('/explorer?action=note&id=' + id, { method: 'POST', body: { body: '  Called back, wants a quote.  ' } });
  assert.strictEqual(r.statusCode, 200);
  assert.strictEqual(r.json().note.body, 'Called back, wants a quote.');
  await call('/explorer?action=note&id=' + id, { method: 'POST', body: { body: 'Second note.' } });
  const notes = (await call('/explorer?action=business&id=' + id)).json().business.notes;
  assert.deepStrictEqual(notes.map(n => n.body), ['Second note.', 'Called back, wants a quote.']);
  assert.ok(notes[0].createdAt >= notes[1].createdAt);
  assert.strictEqual(store._snapshot().notes.length, 4, 'two seeded plus two new');
});

test('an empty or overlong note is refused', async () => {
  const { call, store } = setup();
  const id = store._snapshot().prospects[0].id;
  assert.strictEqual((await call('/explorer?action=note&id=' + id, { method: 'POST', body: { body: '   ' } })).statusCode, 400);
  assert.strictEqual((await call('/explorer?action=note&id=' + id, { method: 'POST', body: { body: 'x'.repeat(501) } })).statusCode, 400);
  assert.strictEqual((await call('/explorer?action=note&id=NOPE', { method: 'POST', body: { body: 'x' } })).statusCode, 404);
  assert.strictEqual(store._snapshot().notes.length, 2);
});

test('the do-not-contact flag sets and clears', async () => {
  const { call, store } = setup();
  const id = store._snapshot().prospects[1].id;
  await call('/explorer?action=dnc&id=' + id, { method: 'POST', body: { value: true } });
  assert.strictEqual((await call('/explorer?action=business&id=' + id)).json().business.doNotContact, true);
  await call('/explorer?action=dnc&id=' + id, { method: 'POST', body: { value: false } });
  assert.strictEqual((await call('/explorer?action=business&id=' + id)).json().business.doNotContact, false);
});

test('the seeded notes and flag are there', async () => {
  const { call } = setup();
  const rows = (await call('/explorer?action=list&q=cedar%20bluff')).json().rows;
  assert.strictEqual(rows[0].doNotContact, true);
  const b = (await call('/explorer?action=business&id=' + rows[0].id)).json().business;
  assert.deepStrictEqual(b.notes.map(n => n.body), ['Skip — family friend.']);
});

/* ---------- runs, map, feed ---------- */

test('runs list their funnel, cost and problems, and open to the picked businesses', async () => {
  const { call } = setup();
  const runs = (await call('/explorer?action=runs')).json().runs;
  const y = runs.find(r => r.id === 'run-youngsville');
  assert.deepStrictEqual(y.funnel, { licences: 641, inArea: 76, active: 43, picked: 20 });
  assert.strictEqual(y.costUsd, 2.97);
  assert.ok(y.problems.length > 0);
  const run = (await call('/explorer?action=run&id=run-youngsville')).json().run;
  assert.ok(run.picked.length > 0 && run.picked.every(p => p.areaId === 'youngsville'));
});

test('pins carry a status for every business with a location, and filter by area', async () => {
  const { call } = setup();
  const all = (await call('/explorer?action=pins')).json().pins;
  assert.strictEqual(all.length, 25);
  const y = (await call('/explorer?action=pins&area=youngsville')).json().pins;
  assert.ok(y.length > 0 && y.length < 25 && y.every(p => p.town === 'Youngsville'));
});

test('the map is Google’s: no Leaflet or OpenStreetMap anywhere in Explorer', async () => {
  const { handler } = setup();
  const res = fakeRes();
  await handler(fakeReq('/explorer'), res);
  const html = res.body;
  assert.match(html, /https:\/\/maps\.googleapis\.com\/maps\/api\/js/);
  assert.match(html, /new google\.maps\.Map\(/);
  assert.match(html, /mailing address on the state licence, geocoded with the US Census Geocoder/);
  const everything = html + fs.readFileSync(path.join(__dirname, '..', 'api', 'explorer.js'), 'utf8') +
    fs.readdirSync(path.join(__dirname, '..', 'lib', 'explorer'))
      .map(f => fs.readFileSync(path.join(__dirname, '..', 'lib', 'explorer', f), 'utf8')).join('\n');
  for (const banned of [/leaflet/i, /openstreetmap/i, /tile\.osm/i, /\bL\.map\(/, /\bOSM\b/]) {
    assert.strictEqual(banned.test(everything), false, 'Explorer still mentions ' + banned);
  }
});

test('the map opens on Bossier / Caddo unless the link names an area', () => {
  const vm = require('node:vm');
  const { pageHtml, DEFAULT_MAP_AREA } = require('../lib/explorer/page.js');
  assert.strictEqual(DEFAULT_MAP_AREA, 'bossier-caddo');
  const html = pageHtml();
  assert.ok(html.includes('var DEFAULT_MAP_AREA = "bossier-caddo";'));
  assert.ok(html.includes('<option value="all">All areas</option>'), '"All areas" has a value of its own');
  const src = html.match(/function mapArea\(q\) \{[\s\S]*?\n  \}/)[0];
  const areas = build().areas.map(a => ({ id: a.id }));
  const mapArea = vm.runInNewContext('(' + src + ')', { boot: { areas }, DEFAULT_MAP_AREA });
  const q = s => new URLSearchParams(s);
  assert.strictEqual(mapArea(q('')), 'bossier-caddo', 'no area in the link: Bossier / Caddo');
  assert.strictEqual(mapArea(q('area=all')), '', '"All areas" stays chosen');
  assert.strictEqual(mapArea(q('area=youngsville')), 'youngsville');
  const without = vm.runInNewContext('(' + src + ')', { boot: { areas: [{ id: 'youngsville' }] }, DEFAULT_MAP_AREA });
  assert.strictEqual(without(q('')), '', 'falls back to all areas where there is no Bossier / Caddo');
});

test('the map opens on the area\'s own businesses, ignoring pins outside Louisiana and far outliers', () => {
  const { mapFit } = require('../lib/explorer/map-fit.js');
  const LA = { south: 28.9, west: -94.05, north: 33.02, east: -88.8 };
  /* invented pins: a cluster around Bossier City and Shreveport, one mailing
     address in Wisconsin, one in Tennessee, one far south in Louisiana */
  const cluster = [[32.52, -93.73], [32.50, -93.75], [32.45, -93.70], [32.60, -93.60], [32.55, -93.65], [32.62, -93.81]]
    .map(([lat, lng], i) => ({ id: 'P' + i, lat, lng }));
  const pins = cluster.concat([{ id: 'WI', lat: 44.5, lng: -88.0 }, { id: 'TN', lat: 35.1, lng: -85.3 }, { id: 'FAR', lat: 29.95, lng: -90.07 }]);
  const f = mapFit(pins, 'bossier-caddo');
  assert.deepStrictEqual(f.bounds, { south: 32.45, west: -93.81, north: 32.62, east: -93.6 }, 'only the cluster is fitted');
  assert.deepStrictEqual(mapFit(pins, ''), { bounds: LA }, '"All areas" fits Louisiana');
  assert.deepStrictEqual(mapFit([{ lat: 44.5, lng: -88 }], 'bossier-caddo'), { bounds: LA }, 'nothing in Louisiana: show Louisiana');
  assert.deepStrictEqual(mapFit([], 'youngsville'), { bounds: LA });
  assert.deepStrictEqual(mapFit([{ lat: 30.2, lng: -91.99 }, { lat: 44.5, lng: -88 }], 'youngsville'),
    { center: { lat: 30.2, lng: -91.99 }, zoom: 13 }, 'one pin left: centre on it');
  /* a spread-out town is not trimmed: everything within 40 km stays */
  const town = [[30.20, -92.00], [30.25, -91.95], [30.10, -92.10], [30.35, -92.05]].map(([lat, lng]) => ({ lat, lng }));
  assert.deepStrictEqual(mapFit(town, 'youngsville').bounds, { south: 30.1, west: -92.1, north: 30.35, east: -91.95 });
});

test('the page sends the map-fit rule to the browser, and uses it', () => {
  const vm = require('node:vm');
  const { pageHtml } = require('../lib/explorer/page.js');
  const html = pageHtml();
  assert.match(html, /var mapFit = function mapFit\(pins, area\)/);
  assert.match(html, /var fit = mapFit\(j\.pins, area\)/);
  assert.doesNotMatch(html, /__MAP_FIT__/);
  const src = html.match(/var mapFit = (function mapFit[\s\S]*?\n\})/)[1];
  const fn = vm.runInNewContext('(' + src + ')');
  assert.strictEqual(JSON.stringify(fn([], '')), JSON.stringify({ bounds: { south: 28.9, west: -94.05, north: 33.02, east: -88.8 } }));
});

test('the map key is handed over only after the password, and its absence is said plainly', async () => {
  const { handler } = setup();
  const shell = fakeRes();
  await handler(fakeReq('/explorer'), shell);
  assert.ok(shell.body.includes('Map key not set'), 'the map screen says so when there is no key');
  assert.strictEqual(shell.headers['referrer-policy'], 'strict-origin-when-cross-origin');
  assert.match(shell.body, /<meta name="referrer" content="strict-origin-when-cross-origin">/);

  const none = (await setup().call('/explorer?action=bootstrap')).json();
  assert.strictEqual(none.mapsKey, null);

  const withKey = setup({ env: { GOOGLE_MAPS_BROWSER_KEY: 'AIzaBrowserKeyForTest' } });
  assert.strictEqual((await withKey.call('/explorer?action=bootstrap')).json().mapsKey, 'AIzaBrowserKeyForTest');
  const s2 = fakeRes();
  await withKey.handler(fakeReq('/explorer'), s2);
  assert.strictEqual(s2.body.includes('AIzaBrowserKeyForTest'), false, 'never in the unauthenticated shell');
  const denied = fakeRes();
  await withKey.handler(fakeReq('/explorer?action=bootstrap', { password: 'wrong' }), denied);
  assert.strictEqual(denied.statusCode, 401);
  assert.strictEqual(denied.body.includes('AIzaBrowserKeyForTest'), false);
});

/* ---------- Google's AI summaries, Explorer only ---------- */

const ABOUT = 'https://support.google.com/local-listings/answer/9851099';

test('Explorer asks Google for the AI summaries; the prospect page does not', async () => {
  const { GOOGLE_FIELDS } = require('../api/explorer.js');
  for (const f of ['reviewSummary', 'reviewSummary.reviewsUri', 'generativeSummary', 'reviews']) {
    assert.ok(GOOGLE_FIELDS.split(',').includes(f), f);
  }
  const { call, id, calls } = await withPlaceId();
  await call('/explorer?action=google&id=' + id);
  assert.strictEqual(calls[0].opts.fieldMask, GOOGLE_FIELDS);
  const prospectRoute = fs.readFileSync(path.join(__dirname, '..', 'api', 'places.js'), 'utf8');
  assert.strictEqual(/reviewSummary|generativeSummary/.test(prospectRoute), false, 'prospect pages unchanged');
});

test('the review summary is shown exactly as Google’s AI-summary policy asks, in order', async () => {
  const { call, id } = await withPlaceId();
  const html = (await call('/explorer?action=google&id=' + id)).json().html;
  const block = html.slice(html.indexOf('<section class="ai-summary review-summary">'));
  const at = s => block.indexOf(s);
  const heading = at('<h3>Review summary</h3>');
  const text = at(STUB_PLACE.reviewSummary.text.text);
  const disclosure = at('<p class="ai-disclosure">Summarized with Gemini</p>');
  const about = at('href="' + ABOUT + '"');
  const report = at('href="https://www.google.com/local/review/rap/report?postId=REVIEWFLAG"');
  const see = at('href="https://www.google.com/maps/place//data=REVIEWSURI"');
  const note = at('To report content that should be removed from Google’s services under applicable laws, use “Report summary”.');
  for (const [k, v] of Object.entries({ heading, text, disclosure, about, report, see, note })) assert.ok(v >= 0, k + ' is present');
  assert.ok(heading < text && text < disclosure && disclosure < about && about < report && report < see && see < note, 'in that order');
  /* the disclosure is the very next thing after the text */
  assert.match(block, /<p class="ai-text">[^<]*REVIEWSUMMARYEND<\/p>\s*<p class="ai-disclosure">Summarized with Gemini<\/p>/);
  assert.match(block, />About this summary<\/a>/);
  assert.match(block, />Report summary<\/a>/);
  assert.match(block, />See reviews<\/a>/);
  assert.ok(block.includes(STUB_PLACE.reviewSummary.text.text), 'the full text, not shortened');
});

test('the place summary is shown with its disclosure, About and Report links', async () => {
  const { call, id } = await withPlaceId();
  const html = (await call('/explorer?action=google&id=' + id)).json().html;
  const block = html.slice(html.indexOf('<section class="ai-summary place-summary">'), html.indexOf('</section>') + 10);
  assert.ok(block.startsWith('<section class="ai-summary place-summary">'));
  assert.match(block, /<p class="ai-text">Roofing crew doing repairs and full replacements, with free estimates and storm work\.<\/p>\s*<p class="ai-disclosure">Summarized with Gemini<\/p>/);
  assert.ok(block.includes('href="' + ABOUT + '"') && block.includes('>About this summary</a>'));
  assert.ok(block.includes('postId=PLACEFLAG') && block.includes('>Report summary</a>'));
  assert.ok(block.includes('use “Report summary”'));
  assert.strictEqual(block.includes('See reviews'), false, 'See reviews belongs to the review summary only');
  /* the listing itself still follows, with Google's logo */
  assert.ok(html.indexOf('ai-summary') < html.indexOf(GOOGLE_LOGO));
});

test('no summary from Google, or one missing a required piece, shows nothing', async () => {
  const { summariesHtml } = require('../api/explorer.js');
  assert.strictEqual(summariesHtml({}), '');
  assert.strictEqual(summariesHtml({ reviewSummary: { text: { text: 'x' }, disclosureText: { text: 'Summarized with Gemini' }, flagContentUri: 'https://f' } }), '',
    'no reviewsUri, no review summary');
  assert.strictEqual(summariesHtml({ reviewSummary: { text: { text: 'x' }, flagContentUri: 'https://f', reviewsUri: 'https://r' } }), '',
    'no disclosure, no review summary');
  assert.strictEqual(summariesHtml({ generativeSummary: { overview: { text: 'x' }, disclosureText: { text: 'Summarized with Gemini' } } }), '',
    'no flag link, no place summary');
  const env = await withPlaceId();
  const plain = { ...STUB_PLACE }; delete plain.reviewSummary; delete plain.generativeSummary;
  const e2 = setup({ env: { GOOGLE_PLACES_API_KEY: 'k' }, placeDetails: async () => plain });
  await e2.store.upsertProspect({ id: env.id, placeId: 'ChIJstub' });
  const html = (await e2.call('/explorer?action=google&id=' + env.id)).json().html;
  assert.strictEqual(html.includes('ai-summary'), false);
  assert.strictEqual(html.includes('Summarized with Gemini'), false);
});

test('summary text is escaped, never treated as markup', () => {
  const { summariesHtml } = require('../api/explorer.js');
  const html = summariesHtml({ reviewSummary: { text: { text: '<img src=x onerror=alert(1)>' }, disclosureText: { text: 'Summarized with Gemini' },
    flagContentUri: 'https://f"><script>', reviewsUri: 'https://r' } });
  assert.strictEqual(html.includes('<img'), false);
  assert.strictEqual(html.includes('"><script>'), false);
});

test('the funnel shows counts, and a percentage only once the step before reaches 100', async () => {
  const { handler } = setup();
  const res = fakeRes();
  await handler(fakeReq('/explorer'), res);
  assert.match(res.body, /prev != null && prev >= 100/);
});

test('the Home feed merges live Twilio items, newest first, each linked where it can be', async () => {
  const live = [{ at: '2026-09-24T16:30:00.000Z', kind: 'text_in', live: true, prospectId: null, company: null, text: 'Text from …0199: "hi"' }];
  const { call } = setup({ twilioFeed: async () => live });
  const feed = (await call('/explorer?action=bootstrap')).json().feed;
  assert.deepStrictEqual(feed[0], live[0]);
  for (let i = 1; i < feed.length; i++) assert.ok(feed[i - 1].at >= feed[i].at);
  assert.ok(feed.some(f => f.kind === 'run' && f.runId === 'run-youngsville' && /Youngsville test: 43 active, 20 picked/.test(f.text)));
});

/* ---------- masking ---------- */

test('Twilio numbers are masked to the last four unless they are a known prospect', async () => {
  assert.strictEqual(mask('+13185550199'), '…0199');
  assert.strictEqual(maskInText('call me on 318-555-0199 or (318) 555 0142'), 'call me on …0199 or …0142');
  const known = new Map([['3185550110', { id: 'DMKNOWN1', company: 'Marsh Lane Fencing' }]]);
  const fetchImpl = async url => ({ ok: true, json: async () => (
    /Calls/.test(url) ? { calls: [{ from: '+13185550110', start_time: '2026-09-24T10:00:00Z', duration: '30' },
                                   { from: '+13185550177', start_time: '2026-09-24T11:00:00Z', duration: '0' }] }
    : /To=/.test(url) ? { messages: [{ from: '+13185550188', body: 'my other number is 318 555 0123', date_sent: '2026-09-24T12:00:00Z' }] }
    : { messages: [] }) });
  const items = await liveTwilioFeed({ sid: 'AC', token: 't', known, fetchImpl });
  const text = items.map(i => i.text).join('\n');
  assert.match(text, /Call from Marsh Lane Fencing/);
  assert.strictEqual(items.find(i => /Marsh/.test(i.text)).prospectId, 'DMKNOWN1');
  assert.match(text, /Call from …0177/);
  assert.match(text, /Text from …0188: "my other number is …0123"/);
  for (const n of ['5550177', '5550188', '5550123']) assert.strictEqual(text.includes(n), false, n);
  assert.deepStrictEqual(await liveTwilioFeed({ sid: '', token: '', known }), [], 'no credentials, no feed');
});

/* ---------- importers, on invented fixtures ---------- */

test('the pilot importer maps a spine record, its ref, audit and pin', async () => {
  const { importPilot } = require('../db/importers/pilot.js');
  const store = createDemoStore({ now: new Date().toISOString(), areas: [], runs: [], prospects: [], events: [], notes: [] });
  const spine = [
    { company: 'Tupelo Ridge Roofing LLC', phone: '318-555-0150', email: 'x@tupeloridge.example.com',
      mailingAddress: { street: '12 Main St', city: 'Youngsville', state: 'LA', zip: '70592' },
      licenses: [{ number: 'RL-1', type: 'Residential License Certificate', status: 'Active', firstIssued: '03/15/2026' }],
      qualifyingParties: ['PAT EXAMPLE'], websiteState: 'unknown',
      websiteAudit: { url: 'https://tupeloridge.example.com', skipped: true, skipNote: 'blocked: 403 bot wall' } },
    { company: 'Quiet Oak Builders', mailingAddress: { street: '9 Elm St', city: 'Youngsville', zip: '70592' },
      licenses: [{ number: 'HI-2', type: 'Home Improvement Registration', status: 'Active', firstIssued: '01/02/2019' }],
      qualifyingParties: [], websiteState: 'dead', websiteAudit: { url: 'https://quietoak.example.com', loads: false } }
  ];
  const r = await importPilot({ spine: { records: spine, pilotShortlist: { rows: [
      { company: 'Tupelo Ridge Roofing LLC', rank: 1, top20: true }, { company: 'Quiet Oak Builders', rank: 2, top20: false }] } },
    refs: { 'Tupelo Ridge Roofing LLC': 'TESTREF1' }, area: { id: 'youngsville', name: 'Youngsville' },
    run: { id: 'run-test', label: 'Test', startedAt: '2026-09-24T00:00:00Z' }, store,
    sites: [{ website: 'https://tupeloridge.example.com', skipped: true, blocked: true, status: 403 }],
    geocode: async a => /12 Main/.test(a) ? { lat: 30.2, lng: -92.0, source: 'census' } : null });
  assert.deepStrictEqual(r, { prospects: 2, pinned: 1, selected: 1, audits: 2 });
  const s = store._snapshot();
  const a = s.prospects.find(p => p.id === 'TESTREF1');
  assert.strictEqual(a.selected, true);
  assert.strictEqual(a.rank, 1);
  assert.strictEqual(a.status, 'not_contacted');
  assert.strictEqual(a.placeId, undefined, 'no Google data, not even a place_id');
  assert.ok(s.events.some(e => e.prospectId === 'TESTREF1' && e.kind === 'selected'));
  assert.ok(s.events.some(e => e.kind === 'run' && /2 found, 1 picked/.test(e.detail.text)));
  assert.strictEqual(a.firstIssued, '2026-03-15');
  assert.strictEqual(a.geocodeSource, 'census');
  assert.strictEqual(a.audit.state, 'blocked');
  const b = s.prospects.find(p => p.company === 'Quiet Oak Builders');
  assert.strictEqual(b.id, 'LHI2');
  assert.strictEqual(b.selected, false);
  assert.strictEqual(b.audit.state, 'broken');
  assert.strictEqual(b.lat, undefined, 'no match, no pin');
  const { auditOf } = require('../db/importers/pilot.js');
  const old = { websiteState: 'dead', websiteAudit: { url: 'https://quietoak.example.com', loads: false } };
  assert.strictEqual(auditOf(old, { website: 'https://quietoak.example.com', loads: false, status: 403 }).state, 'blocked',
    'a 403 recorded as dead by an older audit is blocked, not broken');
  assert.strictEqual(auditOf(old, { website: 'https://quietoak.example.com', loads: false, status: 503 }).state, 'broken');
  const robots = { websiteState: 'unknown', websiteAudit: { url: 'https://quietoak.example.com', skipped: true, skipNote: 'robots.txt timed out, so we left the site alone' } };
  assert.strictEqual(auditOf(robots).state, 'unknown', 'robots.txt kept us out: we chose not to look, the site did not block us');
});

test('the pilot importer takes the twenty from the shortlist, not from who holds a code', async () => {
  const { importPilot } = require('../db/importers/pilot.js');
  const store = createDemoStore({ now: new Date().toISOString(), areas: [], runs: [], prospects: [], events: [], notes: [] });
  const rec = (company, number) => ({ company, mailingAddress: { street: '1 Invented Way', city: 'Bossier City', zip: '71111' },
    licenses: [{ number, type: 'Residential License Certificate', status: 'Active', firstIssued: '01/02/2026' }], qualifyingParties: [] });
  const spine = { records: [rec('Kestrel Lane Roofing LLC', 'R-1'), rec('Marmot Point Builders', 'R-2'), rec('Ocelot Row Fencing', 'R-3')],
    pilotShortlist: { rows: [
      { company: 'Marmot Point Builders', rank: 1, top20: true },
      { company: 'Kestrel Lane Roofing LLC', rank: 21, top20: false },
      { company: 'Ocelot Row Fencing', rank: null, top20: false, excluded: true }] } };
  /* Kestrel was issued a code on an earlier pass and has since dropped out of the twenty */
  const r = await importPilot({ spine, refs: { 'Kestrel Lane Roofing LLC': 'KESTREL2', 'Marmot Point Builders': 'MARMOT23' },
    area: { id: 'bossier-caddo', name: 'Bossier / Caddo' }, store, geocodes: { '1 Invented Way, Bossier City, LA, 71111': { lat: 32.5, lng: -93.7, source: 'census' } } });
  assert.strictEqual(r.selected, 1);
  assert.strictEqual(r.pinned, 3, 'saved geocodes are used, no lookup');
  const s = store._snapshot();
  const k = s.prospects.find(p => p.id === 'KESTREL2');
  assert.strictEqual(k.selected, false, 'a code alone is not a pick');
  assert.strictEqual(k.rank, 21);
  assert.strictEqual(s.prospects.find(p => p.id === 'MARMOT23').selected, true);
  const o = s.prospects.find(p => p.id === 'LR3');
  assert.strictEqual(o.selected, false);
  assert.strictEqual(o.rank, null, 'an excluded company has no rank');
});

test('mock letters are paired by the shortlist, checked by name, stored as mock, and never sent', async () => {
  const { importLetters, tableFromShortlist } = require('../db/importers/letters.js');
  const store = createDemoStore({ now: new Date().toISOString(), areas: [], runs: [], prospects: [
    { id: 'LR1', company: 'Kestrel Lane Roofing LLC' }, { id: 'LR2', company: 'Marmot Point Builders' }], events: [], notes: [] });
  const rec = (company, number) => ({ company, licenses: [{ number }] });
  const spine = { records: [rec('Kestrel Lane Roofing LLC', 'R-1'), rec('Marmot Point Builders', 'R-2')],
    pilotShortlist: { rows: [{ company: 'Marmot Point Builders', rank: 1, top20: true }, { company: 'Kestrel Lane Roofing LLC', rank: 2, top20: true }] } };
  const table = tableFromShortlist(spine, {});
  assert.deepStrictEqual(table.map(t => t.ref), ['LR2', 'LR1']);
  const page = n => '<section class="page"><p>a text from ' + n + ' straight away</p></section>';
  const html = '<html><head><style>.page{}</style></head><body>' + page('Marmot Point Builders') + page('Kestrel Lane Roofing') + '</body></html>';
  await assert.rejects(importLetters({ html, table, store, mock: true, sentAt: '2026-09-20T00:00:00.000Z' }), /never sent/);
  const swapped = '<html><head></head><body>' + page('Kestrel Lane Roofing') + page('Marmot Point Builders') + '</body></html>';
  await assert.rejects(importLetters({ html: swapped, table, store, mock: true }), /does not name the business/);
  await importLetters({ html, table, store, mock: true, runId: 'mock-run' });
  const l = await store.letterSource('LR1');
  assert.strictEqual(l.letter.state, 'mock');
  assert.strictEqual(store._snapshot().events.some(e => e.kind === 'letter_sent'), false);
  const f = await store.funnel();
  assert.strictEqual(f.letterSent, 0, 'a mock letter never counts as sent');
});

test('the letters, tracking and Twilio importers map invented fixtures', async () => {
  const { importLetters } = require('../db/importers/letters.js');
  const { parseLines } = require('../db/importers/tracking.js');
  const { toMessages } = require('../db/importers/twilio.js');
  const seed = build();
  const store = createDemoStore(seed);
  const [p1, p2] = seed.prospects;
  const html = '<html><head><style>.page{}</style></head><body><section class="page">One</section><section class="page">Two</section></body></html>';
  await importLetters({ html, table: [{ ref: p1.id }, { ref: p2.id }], store, sentAt: '2026-09-20T00:00:00.000Z' });
  const l = await store.letterSource(p2.id);
  assert.strictEqual(l.letter.state, 'sent');
  assert.match(l.letter.html, /<section class="page">Two<\/section>/);
  await assert.rejects(importLetters({ html, table: [{ ref: p1.id }], store }), /not importing/);

  const events = parseLines([
    'INFO {"at":"2026-09-24T10:00:00Z","ref":"DMABCDEF","event":"page_open","channel":"letter","device":"phone"}',
    '{"at":"2026-09-24T10:01:00Z","ref":"DMABCDEF","event":"call_tapped","channel":"letter","device":"phone"}',
    'not json', '{"event":"page_open"}', '{"at":"x","ref":"../../x","event":"page_open"}'
  ].join('\n'));
  assert.deepStrictEqual(events.map(e => e.kind), ['page_opened', 'call_tapped']);

  const known = new Map([['3185550110', { id: 'DMKNOWN1', company: 'Marsh Lane Fencing' }]]);
  const rows = toMessages({ calls: [{ sid: 'CA1', from: '+13185550110', to: '+13186666445', status: 'completed', start_time: '2026-09-24T10:00:00Z' }],
    messages: [{ sid: 'SM1', from: '+13186666445', to: '+13185550177', body: 'hi', status: 'delivered', date_sent: '2026-09-24T11:00:00Z' }] }, known);
  assert.deepStrictEqual(rows.map(r => [r.id, r.kind, r.direction, r.prospectId]), [['CA1', 'call', 'in', 'DMKNOWN1'], ['SM1', 'text', 'out', null]]);
});

test('importers refuse to run from the command line without a database and --confirm', () => {
  const { execFileSync } = require('node:child_process');
  const env = { ...process.env, DATABASE_URL: '', COLDENJAMES_URL: '', COLDENJAMES_DATABASE_URL: '' };
  let err = null;
  try { execFileSync(process.execPath, [path.join(__dirname, '..', 'db', 'importers', 'tracking.js'), 'x'], { env, stdio: 'pipe' }); }
  catch (e) { err = e; }
  assert.ok(err && /DATABASE_URL/.test(String(err.stderr)));
});

/* ---------- the database door ---------- */

test('migrations split into plain statements, BEGIN and COMMIT left to the transaction', () => {
  const { statementsOf } = require('../db/migrate.js');
  const stmts = statementsOf(fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', '002_real_data.sql'), 'utf8'));
  assert.ok(stmts.length >= 4);
  assert.ok(stmts.every(x => !/^(BEGIN|COMMIT)$/i.test(x) && !x.includes(';')));
  assert.ok(stmts.some(x => /state IN \('draft','sent','mock'\)/.test(x)));
});

test('the Neon HTTPS client sends bound parameters and never leaks the connection string', async () => {
  const { createNeonHttpPool } = require('../db/neon-http.js');
  const url = 'postgresql://user:s3cret@ep-invented-123.us-east-1.aws.neon.tech/db?sslmode=require';
  const seen = [];
  const ok = createNeonHttpPool(url, { fetchImpl: async (u, init) => { seen.push({ u, init });
    return { ok: true, status: 200, text: async () => JSON.stringify({ rows: [{ n: 1 }], rowCount: 1 }) }; } });
  const r = await ok.query('SELECT $1::int AS n, $2::jsonb AS d', [1, { a: 1 }]);
  assert.deepStrictEqual(r.rows, [{ n: 1 }]);
  assert.strictEqual(seen[0].u, 'https://ep-invented-123.us-east-1.aws.neon.tech/sql');
  const body = JSON.parse(seen[0].init.body);
  assert.strictEqual(body.query, 'SELECT $1::int AS n, $2::jsonb AS d');
  assert.deepStrictEqual(body.params, [1, '{"a":1}']);
  const bad = createNeonHttpPool(url, { fetchImpl: async () => ({ ok: false, status: 400,
    text: async () => JSON.stringify({ message: 'could not connect with ' + url }) }) });
  await assert.rejects(bad.query('SELECT 1'), e => !e.message.includes('s3cret') && /\[connection string\]/.test(e.message));
});
