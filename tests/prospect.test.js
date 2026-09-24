'use strict';

/* The prospect page, the Places proxy and the tracking stub.

   No test here touches Google. The listing markup is built from a stubbed
   place object, and the routes that would call Google are only exercised on
   the paths that refuse before they get there.

   Google's rules these tests hold the code to, read 24 September 2026:
     https://developers.google.com/maps/documentation/places/web-service/policies
     https://developers.google.com/maps/documentation/places/web-service/policies#display-requirements
     https://developers.google.com/maps/documentation/places/web-service/reference/rest/v1/places#Review */

const test = require('node:test');
const assert = require('node:assert');
const { Readable } = require('node:stream');

const { getProspect, DEMO_REF } = require('../site/prospects.js');
const prospectRoute = require('../api/prospect.js');
const placesRoute = require('../api/places.js');
const trackRoute = require('../api/track.js');

function fakeReq(url, { method = 'GET', headers = {}, body = null } = {}) {
  const req = body === null ? new Readable({ read() { this.push(null); } })
                            : Readable.from([Buffer.from(body, 'utf8')]);
  req.method = method;
  req.url = url;
  req.headers = Object.assign({ host: 'coldenjames.com' }, headers);
  return req;
}
function fakeRes() {
  return {
    statusCode: 0, headers: {}, body: '',
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(chunk) { this.body = chunk === undefined ? '' : String(chunk); this.ended = true; }
  };
}

/* ---------- the record ---------- */

test('the demo ref resolves and every other ref does not', async () => {
  const demo = await getProspect(DEMO_REF);
  assert.strictEqual(demo.business, 'Marsh Lane Fencing');
  assert.strictEqual(demo.placeId, null);
  for (const bad of ['NOPE1234', '', null, '../../etc/passwd', 'AB', 'x'.repeat(40)]) {
    assert.strictEqual(await getProspect(bad), null, JSON.stringify(bad));
  }
});

test('nothing about a real prospect is committed', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'site', 'prospects.js'), 'utf8');
  assert.match(src, /Marsh Lane Fencing/);
  assert.strictEqual(/\+1\d{10}/.test(src), false, 'no phone numbers');
  assert.strictEqual(/ChIJ[A-Za-z0-9_-]{10,}/.test(src), false, 'no real place ids');
});

/* ---------- the page ---------- */

test('the demo page renders, and is noindex', async () => {
  const res = fakeRes();
  await prospectRoute(fakeReq('/api/prospect?ref=' + DEMO_REF + '&c=letter'), res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.headers['x-robots-tag'], 'noindex, nofollow');
  assert.match(res.headers['content-type'], /text\/html/);

  const html = res.body;
  assert.match(html, /<h1>Marsh Lane Fencing<\/h1>/);
  assert.ok(html.includes("Here's what I found."));
  assert.ok(html.includes('they call the next fence company'), 'uses the trade noun');
  assert.ok(html.includes('Hi, this is Dale at Marsh Lane Fencing.'), 'the text-back names the owner');
  assert.ok(html.includes('$79 a month'));
  assert.ok(html.includes('First month free.'));
  assert.ok(html.includes("isn't a robot pretending to be you on the phone") ||
            html.includes('isn&#39;t a robot') || html.includes('robot pretending'), 'the dashed box');
  assert.ok(html.includes('Every customer whose job is done gets asked, once.'));
  assert.ok(html.includes('Haughton'), 'names the town');
  assert.ok(html.includes('trade name of COWIE.AI LLC'));
  assert.match(html, /href="\/privacy"/);
  assert.match(html, /href="\/terms"/);
  assert.match(html, /https:\/\/stevencowie73\.github\.io\/shop-check/);
});

test('a section the record cannot support is left out', async () => {
  const res = fakeRes();
  await prospectRoute(fakeReq('/api/prospect?ref=' + DEMO_REF), res);
  /* the demo has no place id, so there is no listing section at all */
  assert.strictEqual(res.body.includes('Your Google listing'), false);
  assert.strictEqual(res.body.includes('id="listing"'), false);
  /* and its website finding is "not found", so that section IS there */
  assert.ok(res.body.includes('Your website'));
  assert.ok(res.body.includes("I looked for your website and couldn't find one"));
  assert.strictEqual(/I also /.test(res.body), false, 'the page never says "also"');
});

test('the website wording is the same one the letter uses', () => {
  const { websiteFinding } = require('../lib/website-finding.js');
  assert.strictEqual(websiteFinding('not found').text,
    "I also looked for your website and couldn't find one, so people who search for you have nothing to click through to.");
  assert.strictEqual(websiteFinding('fine').text, '', 'nothing to say about a site that is fine');
  assert.strictEqual(websiteFinding('unknown').text, '', 'nothing to say about one we never saw');
});

/* Every branch that says something, with invented domains. */
const FINDING_CASES = [
  ['not found', null],
  ['dead', { url: 'https://www.example-fence.test/', source: 'email', parked: true }],
  ['dead', { url: 'https://example-fence.test', source: 'email', whatsWrong: 'Domain not found' }],
  ['dead', { url: 'https://example-fence.test', source: 'email', whatsWrong: 'HTTP 500' }],
  ['dead', { url: 'https://example-fence.test', source: 'astra', parked: true }],
  ['dead', { url: 'https://example-fence.test', source: 'astra', whatsWrong: 'HTTP 500' }],
  ['poor', { url: 'https://example-fence.test', source: 'email', signals: ['viewport'] }],
  ['poor', { url: 'https://example-fence.test', source: 'astra', signals: ['viewport'] }]
];

test('the letter keeps "also" wherever it had it', () => {
  const { websiteFinding } = require('../lib/website-finding.js');
  const letter = FINDING_CASES.map(([s, a]) => websiteFinding(s, a).text);
  assert.deepStrictEqual(letter, FINDING_CASES.map(([s, a]) => websiteFinding(s, a, { surface: 'letter' }).text),
    'letter is the default');
  assert.strictEqual(letter[0], "I also looked for your website and couldn't find one, so people who search for you have nothing to click through to.");
  assert.strictEqual(letter[1], "I also tried example-fence.test, the web address from your business email, and it doesn't lead to a website.");
  assert.strictEqual(letter[3], 'I also tried example-fence.test, the web address from your business email, and it comes back with an error.');
  assert.strictEqual(letter[6], "I also looked at your website, example-fence.test. It doesn't work well on a phone, which is where most people look you up.");
  assert.strictEqual(letter.filter(t => t.startsWith('I also ')).length, 6, 'every email-sourced line and the not-found line');
});

test('the page says the same thing without "also"', () => {
  const { websiteFinding } = require('../lib/website-finding.js');
  for (const [state, audit] of FINDING_CASES) {
    const letter = websiteFinding(state, audit).text;
    const page = websiteFinding(state, audit, { surface: 'page' }).text;
    assert.ok(page, state + ' says something');
    assert.strictEqual(/\balso\b/.test(page), false, 'no "also" on the page: ' + page);
    assert.strictEqual(page, letter.replace(/^I also /, 'I '), 'only the opening differs');
  }
  assert.strictEqual(websiteFinding('not found', null, { surface: 'page' }).text,
    "I looked for your website and couldn't find one, so people who search for you have nothing to click through to.");
  assert.strictEqual(websiteFinding('dead', FINDING_CASES[3][1], { surface: 'page' }).text,
    'I tried example-fence.test, the web address from your business email, and it comes back with an error.');
  assert.strictEqual(websiteFinding('poor', FINDING_CASES[6][1], { surface: 'page' }).text,
    "I looked at your website, example-fence.test. It doesn't work well on a phone, which is where most people look you up.");
  assert.strictEqual(websiteFinding('fine', null, { surface: 'page' }).text, '');
});

test('in the mockup the business is on the right and the caller on the left', async () => {
  const p = await getProspect(DEMO_REF);
  const html = prospectRoute.render(p, 'letter');
  const bubbles = [...html.matchAll(/<div class="bubble (out|in)" data-beat="(\d)">([^<]*)<\/div>/g)]
    .map(m => ({ side: m[1], beat: m[2], text: m[3] }));
  assert.deepStrictEqual(bubbles.map(b => b.side + b.beat), ['out2', 'in3', 'out4'],
    'auto-text, caller, owner reply');
  assert.match(bubbles[0].text, /Sorry I missed your call/, 'the auto-text is from the business');
  assert.match(bubbles[2].text, /I can swing by/, 'the reply is from the business');

  const css = prospectRoute.PROSPECT_CSS;
  const rule = sel => (new RegExp(sel.replace(/\./g, '\\.') + '\\s*\\{([^}]*)\\}').exec(css) || [])[1] || '';
  assert.match(rule('.bubble.out'), /align-self:\s*flex-end/, 'business on the right');
  assert.match(rule('.bubble.out'), /background:\s*var\(--callout\)/, 'in the accent tint');
  assert.match(rule('.bubble.in'), /align-self:\s*flex-start/, 'caller on the left');
  assert.match(rule('.bubble.in'), /background:\s*var\(--ground\)/, 'neutral');
});

test('an unknown ref is a 404, not a page about nobody', async () => {
  for (const ref of ['NOPE1234', 'AAAA', '']) {
    const res = fakeRes();
    await prospectRoute(fakeReq('/api/prospect?ref=' + encodeURIComponent(ref)), res);
    assert.strictEqual(res.statusCode, 404, ref);
    assert.strictEqual(res.headers['x-robots-tag'], 'noindex, nofollow');
    assert.ok(res.body.includes("This link doesn't match a page."));
  }
});

test('the action is an email link while no phone number is configured', async () => {
  const res = fakeRes();
  await prospectRoute(fakeReq('/api/prospect?ref=' + DEMO_REF), res);
  const C = require('../site/content.js');
  if (C.BUSINESS.phone) {
    assert.match(res.body, /href="sms:/);
  } else {
    assert.match(res.body, /href="mailto:steven@coldenjames\.com/);
    assert.strictEqual(/href="sms:"/.test(res.body), false, 'no dead sms link');
  }
  /* the body is URL-encoded in the link, as it has to be */
  const href = /href="(mailto:[^"]+|sms:[^"]+)"/.exec(res.body)[1];
  assert.ok(decodeURIComponent(href).includes('Hi Steven, this is Marsh Lane Fencing. Saw the page.'),
    'the prefilled message names the business');
});

test('the phone mockup has a reduced-motion path and a replay', async () => {
  const res = fakeRes();
  await prospectRoute(fakeReq('/api/prospect?ref=' + DEMO_REF), res);
  assert.match(res.body, /prefers-reduced-motion: reduce/);
  assert.match(res.body, /id="replay"/);
  assert.match(res.body, /IntersectionObserver/);
  assert.ok(res.body.includes('role="img"'), 'the mockup is described for a screen reader');
});

/* ---------- the Places proxy ---------- */

test('the places route refuses a place id supplied in the request', async () => {
  for (const q of ['place_id=ChIJfake', 'placeId=ChIJfake', 'placeid=ChIJfake']) {
    const res = fakeRes();
    await placesRoute(fakeReq('/api/places?ref=' + DEMO_REF + '&' + q), res);
    assert.strictEqual(res.statusCode, 400, q);
    assert.match(res.body, /not a place id/);
  }
});

test('a record with no place id returns nothing, without calling Google', async () => {
  const before = process.env.GOOGLE_PLACES_API_KEY;
  process.env.GOOGLE_PLACES_API_KEY = 'test-key-not-real';
  const realFetch = global.fetch;
  let called = false;
  global.fetch = async () => { called = true; throw new Error('must not call Google'); };
  try {
    const res = fakeRes();
    await placesRoute(fakeReq('/api/places?ref=' + DEMO_REF), res);
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(JSON.parse(res.body), { ok: false, reason: 'no listing' });
    assert.strictEqual(called, false, 'Google was not called');
  } finally {
    global.fetch = realFetch;
    if (before === undefined) delete process.env.GOOGLE_PLACES_API_KEY;
    else process.env.GOOGLE_PLACES_API_KEY = before;
  }
});

test('an unknown ref gets no listing either', async () => {
  const before = process.env.GOOGLE_PLACES_API_KEY;
  process.env.GOOGLE_PLACES_API_KEY = 'test-key-not-real';
  try {
    const res = fakeRes();
    await placesRoute(fakeReq('/api/places?ref=NOPE1234'), res);
    assert.deepStrictEqual(JSON.parse(res.body), { ok: false, reason: 'no listing' });
  } finally {
    if (before === undefined) delete process.env.GOOGLE_PLACES_API_KEY;
    else process.env.GOOGLE_PLACES_API_KEY = before;
  }
});

test('with no API key the route says so rather than crashing', async () => {
  const before = process.env.GOOGLE_PLACES_API_KEY;
  delete process.env.GOOGLE_PLACES_API_KEY;
  try {
    const res = fakeRes();
    await placesRoute(fakeReq('/api/places?ref=' + DEMO_REF), res);
    assert.strictEqual(res.statusCode, 503);
  } finally {
    if (before !== undefined) process.env.GOOGLE_PLACES_API_KEY = before;
  }
});

test('the response may never be cached — Places content must not be stored', async () => {
  const res = fakeRes();
  await placesRoute(fakeReq('/api/places?ref=' + DEMO_REF + '&place_id=x'), res);
  assert.match(res.headers['cache-control'], /no-store/);
});

/* The markup, built from a stubbed place. This is where Google's display
   rules are actually enforced. */
const STUB_PLACE = {
  displayName: { text: 'Marsh Lane Fencing' },
  rating: 4.6,
  userRatingCount: 23,
  googleMapsUri: 'https://maps.google.com/?cid=1234',
  regularOpeningHours: { weekdayDescriptions: ['Monday: 8:00 AM – 5:00 PM', 'Tuesday: 8:00 AM – 5:00 PM'] },
  reviews: [
    {
      rating: 5,
      relativePublishTimeDescription: 'a month ago',
      text: { text: 'Good clean job on the back fence.' },
      googleMapsUri: 'https://maps.google.com/review/1',
      authorAttribution: {
        displayName: 'A Reviewer',
        uri: 'https://www.google.com/maps/contrib/1/reviews',
        photoUri: 'https://lh3.googleusercontent.com/a/example'
      }
    },
    {
      rating: 2,
      relativePublishTimeDescription: 'two months ago',
      text: { text: 'Took a while to get a callback.' },
      googleMapsUri: 'https://maps.google.com/review/2',
      authorAttribution: {
        displayName: 'Another Reviewer',
        uri: 'https://www.google.com/maps/contrib/2/reviews',
        photoUri: 'https://lh3.googleusercontent.com/a/example2'
      }
    }
  ]
};

test('the Google Maps logo is shown, because this is Places data without a map', () => {
  const html = placesRoute.listingHtml(STUB_PLACE);
  assert.match(html, /class="gmaps-logo"/);
  assert.match(html, /alt="Google Maps"/);
  const h = /height="(\d+)"/.exec(placesRoute.GOOGLE_LOGO);
  assert.ok(h && Number(h[1]) >= 16 && Number(h[1]) <= 19,
    'logo height must sit in the documented 16-19dp range, got ' + (h && h[1]));
});

test('every review credits its author by avatar, name and profile link', () => {
  const html = placesRoute.listingHtml(STUB_PLACE);
  for (const rev of STUB_PLACE.reviews) {
    const who = rev.authorAttribution;
    assert.ok(html.includes(who.photoUri), 'avatar for ' + who.displayName);
    assert.ok(html.includes(who.displayName), 'name for ' + who.displayName);
    assert.ok(html.includes(who.uri), 'profile link for ' + who.displayName);
    assert.ok(html.includes(rev.googleMapsUri), 'link to the review itself');
  }
});

test('reviews are shown in the order Google returned them, and the page says so', () => {
  const html = placesRoute.listingHtml(STUB_PLACE);
  const first = html.indexOf('A Reviewer');
  const second = html.indexOf('Another Reviewer');
  assert.ok(first > -1 && second > first, 'order preserved');
  /* the two-star review must be there: nothing is filtered */
  assert.ok(html.includes('Took a while to get a callback.'), 'the poor review is shown too');
  assert.match(html, /in the order Google returned them/);
  assert.match(html, /relevance/);
  assert.match(html, /None have been picked out, left out or reordered/);
});

test('rating, review count and hours are shown', () => {
  const html = placesRoute.listingHtml(STUB_PLACE);
  assert.ok(html.includes('4.6'));
  assert.ok(html.includes('23 reviews on Google'));
  assert.ok(html.includes('Monday: 8:00 AM'));
});

test('a review with no author photo still renders', () => {
  const bare = { reviews: [{ rating: 4, text: { text: 'Fine.' }, authorAttribution: { displayName: 'No Photo' } }] };
  const html = placesRoute.listingHtml(bare);
  assert.ok(html.includes('No Photo'));
  assert.ok(html.includes('<img'), 'an avatar element is still present');
});

/* ---------- tracking ---------- */

async function track(bodyObj, agent) {
  const res = fakeRes();
  await trackRoute(fakeReq('/api/track', {
    method: 'POST',
    headers: { 'user-agent': agent, 'content-type': 'application/json' },
    body: JSON.stringify(bodyObj)
  }), res);
  return res;
}
const PHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15';

test('a real event from a real browser is accepted', async () => {
  for (const event of [...trackRoute.EVENTS]) {
    const res = await track({ ref: 'DEMO2026', event, channel: 'letter', device: 'phone' }, PHONE_UA);
    assert.strictEqual(res.statusCode, 204, event);
  }
});

test('an unknown event name is rejected', async () => {
  for (const event of ['steal_data', 'page_open; drop table', '', 'PAGE_OPEN', 'open']) {
    const res = await track({ ref: 'DEMO2026', event }, PHONE_UA);
    assert.strictEqual(res.statusCode, 400, JSON.stringify(event));
  }
});

test('a bad ref is rejected', async () => {
  for (const ref of ['', 'A', '../../x', 'x'.repeat(40)]) {
    const res = await track({ ref, event: 'page_open' }, PHONE_UA);
    assert.strictEqual(res.statusCode, 400, JSON.stringify(ref));
  }
});

test('crawlers and mail scanners are answered but not counted', async () => {
  const machines = [
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Mozilla/5.0 (compatible; bingbot/2.0)',
    'facebookexternalhit/1.1',
    'Slackbot-LinkExpanding 1.0',
    'curl/8.5.0',
    'python-requests/2.31.0',
    'Mozilla/5.0 (Windows NT 10.0) Microsoft Office Outlook 16.0',
    'Mimecast-Link-Scanner',
    'Proofpoint-URL-Defense',
    'HeadlessChrome/120.0.0.0'
  ];
  for (const agent of machines) {
    const res = await track({ ref: 'DEMO2026', event: 'page_open' }, agent);
    assert.strictEqual(res.statusCode, 204, agent);
  }
  /* an empty agent is a machine too */
  const empty = await track({ ref: 'DEMO2026', event: 'page_open' }, '');
  assert.strictEqual(empty.statusCode, 204);
});

test('tracking sets no cookie and keeps no address', async () => {
  const res = await track({ ref: 'DEMO2026', event: 'page_open' }, PHONE_UA);
  assert.strictEqual(res.headers['set-cookie'], undefined);
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'api', 'track.js'), 'utf8');
  assert.strictEqual(/x-forwarded-for|remoteAddress|set-cookie/i.test(src), false,
    'the route must not read an IP or set a cookie');
});

test('GET is not a tracking event', async () => {
  const res = fakeRes();
  await trackRoute(fakeReq('/api/track', { headers: { 'user-agent': PHONE_UA } }), res);
  assert.strictEqual(res.statusCode, 405);
});

test('the page only counts an open after two seconds of being visible', async () => {
  const res = fakeRes();
  await prospectRoute(fakeReq('/api/prospect?ref=' + DEMO_REF), res);
  assert.match(res.body, /visibleFor >= 2000/);
  assert.match(res.body, /sendBeacon|keepalive/);
});

/* ---------- the actions ---------- */

test('a configured phone number gives a text button and a call button', async () => {
  const C = require('../site/content.js');
  const before = C.BUSINESS.phone;
  C.BUSINESS.phone = '(318) 555-0100';
  try {
    const p = await getProspect(DEMO_REF);
    const html = prospectRoute.render(p, 'letter');
    assert.match(html, /href="sms:3185550100\?&body=/, 'the text link dials the digits only');
    assert.match(html, /href="tel:3185550100"/, 'the call link is a tel: link');
    assert.match(html, /data-event="call_tapped"/, 'tapping call is an event');
    assert.match(html, /data-event="text_tapped"/);
    assert.ok(html.includes('>Call me<') && html.includes('>Text me<'));
    assert.strictEqual(html.includes('>Email me<'), false, 'the email fallback is gone');
    /* side by side, and each still a full-size tap target */
    assert.match(html, /class="actions"/);
    assert.match(prospectRoute.PROSPECT_CSS, /\.actions\s*\{[^}]*display:\s*flex/);
    assert.match(prospectRoute.PROSPECT_CSS, /min-height:\s*60px/);
    /* the tracker has to find both, so it can no longer be looking for an id */
    assert.match(html, /querySelectorAll\('\.action'\)/);
    assert.strictEqual(/getElementById\('action'\)/.test(html), false);
  } finally {
    C.BUSINESS.phone = before;
  }
});

test('with no phone number there is one email button and no dead links', async () => {
  const C = require('../site/content.js');
  const saved = C.BUSINESS.phone;
  try {
    C.BUSINESS.phone = '';
    const p = await getProspect(DEMO_REF);
    const html = prospectRoute.render(p, 'letter');
    assert.ok(html.includes('>Email me<'));
    assert.strictEqual(html.includes('>Call me<'), false);
    assert.strictEqual(/href="tel:/.test(html), false, 'no tel: link with nothing to dial');
    assert.strictEqual(/href="sms:/.test(html), false, 'no sms: link with nothing to text');
  } finally { C.BUSINESS.phone = saved; }
});

test('with a phone number there are Text me and Call me buttons that dial it', async () => {
  const C = require('../site/content.js');
  const saved = C.BUSINESS.phone;
  try {
    C.BUSINESS.phone = '(318) 555-0100';
    const p = await getProspect(DEMO_REF);
    const html = prospectRoute.render(p, 'letter');
    assert.ok(html.includes('>Text me<'));
    assert.ok(html.includes('>Call me<'));
    assert.match(html, /href="tel:3185550100"/);
    assert.match(html, /href="sms:3185550100\?/);
    assert.strictEqual(html.includes('>Email me<'), false);
  } finally { C.BUSINESS.phone = saved; }
});

test('call_tapped is an event the tracker accepts', () => {
  assert.ok(trackRoute.EVENTS.has('call_tapped'));
});

/* ---------- the speed bump ---------- */

test('walking through codes on the page is refused', async () => {
  prospectRoute.resetLimits();
  try {
    const ip = { 'x-forwarded-for': '198.51.100.20' };
    let refused = 0, tried = 0;
    /* unknown codes are 404s until the walk limit bites, and then 429s */
    for (let i = 0; i < 30; i++) {
      const res = fakeRes();
      const ref = 'WALK' + String(i).padStart(4, '0');
      await prospectRoute(fakeReq('/api/prospect?ref=' + ref, { headers: ip }), res);
      tried++;
      if (res.statusCode === 429) {
        refused++;
        assert.ok(Number(res.headers['retry-after']) > 0, 'no Retry-After on the 429');
      }
    }
    assert.ok(refused > 0, 'walked ' + tried + ' codes without being refused once');
    assert.ok(refused >= 15, 'only ' + refused + ' of ' + tried + ' were refused');
  } finally {
    prospectRoute.resetLimits();
  }
});

test('reading your own page over and over is never refused', async () => {
  prospectRoute.resetLimits();
  try {
    const ip = { 'x-forwarded-for': '198.51.100.21' };
    for (let i = 0; i < 20; i++) {
      const res = fakeRes();
      await prospectRoute(fakeReq('/api/prospect?ref=' + DEMO_REF + '&c=letter', { headers: ip }), res);
      assert.strictEqual(res.statusCode, 200, 'refused a refresh at ' + i);
    }
  } finally {
    prospectRoute.resetLimits();
  }
});

test('one address being refused does not refuse another', async () => {
  prospectRoute.resetLimits();
  try {
    const noisy = { 'x-forwarded-for': '198.51.100.22' };
    for (let i = 0; i < 30; i++) {
      await prospectRoute(fakeReq('/api/prospect?ref=NOISE' + i, { headers: noisy }), fakeRes());
    }
    const res = fakeRes();
    await prospectRoute(fakeReq('/api/prospect?ref=' + DEMO_REF,
      { headers: { 'x-forwarded-for': '198.51.100.23' } }), res);
    assert.strictEqual(res.statusCode, 200);
  } finally {
    prospectRoute.resetLimits();
  }
});

test('the tracking stub refuses a flood but never a spread of codes', async () => {
  trackRoute.resetLimits();
  try {
    const ip = { 'x-forwarded-for': '198.51.100.30' };
    const send = async (ref) => {
      const res = fakeRes();
      await trackRoute(fakeReq('/api/track', {
        method: 'POST',
        headers: Object.assign({ 'user-agent': PHONE_UA, 'content-type': 'application/json' }, ip),
        body: JSON.stringify({ ref, event: 'page_open', channel: 'letter', device: 'phone' })
      }), res);
      return res;
    };
    /* a mobile gateway that fifty prospects share is not a walker: this route
       answers the same either way, so there is nothing to learn by trying
       codes against it and nothing to refuse */
    for (let i = 0; i < 50; i++) {
      const res = await send('TRACK' + String(i).padStart(3, '0'));
      assert.strictEqual(res.statusCode, 204, 'refused code ' + i);
    }
    /* sheer volume is still refused */
    trackRoute.resetLimits();
    let floodRefused = 0;
    for (let i = 0; i < 280; i++) {
      const res = await send('DEMO2026');
      if (res.statusCode === 429) floodRefused++;
    }
    assert.ok(floodRefused > 0, 'a flood of 280 events was never refused');
  } finally {
    trackRoute.resetLimits();
  }
});

test('a prospect holding a letter is never rate limited', async () => {
  /* the case a live burst caught: counting every request means everyone
     behind one carrier gateway shares a budget, and the thirteenth person to
     open their letter is turned away */
  prospectRoute.resetLimits();
  try {
    const ip = { 'x-forwarded-for': '198.51.100.24' };
    /* first exhaust the miss budget from that address ... */
    for (let i = 0; i < 40; i++) {
      await prospectRoute(fakeReq('/api/prospect?ref=DUD' + i, { headers: ip }), fakeRes());
    }
    /* ... then ask for a code that does resolve, from the same address */
    for (let i = 0; i < 25; i++) {
      const res = fakeRes();
      await prospectRoute(fakeReq('/api/prospect?ref=' + DEMO_REF + '&c=letter', { headers: ip }), res);
      assert.strictEqual(res.statusCode, 200, 'a real code was refused at ' + i);
    }
  } finally {
    prospectRoute.resetLimits();
  }
});

test('the limits are in memory only and keep no address', () => {
  const fs = require('fs'), path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'ratelimit.js'), 'utf8');
  assert.strictEqual(/require\('fs'\)|writeFile|console\.log/.test(src), false,
    'the rate limiter writes something down');
  /* it says what it cannot do, because these numbers are easy to over-trust */
  assert.ok(src.includes('per instance'), 'the honest caveat is missing');
});
