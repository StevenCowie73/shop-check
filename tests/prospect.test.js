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
  assert.ok(res.body.includes("I also looked for your website and couldn't find one"));
});

test('the website wording is the same one the letter uses', () => {
  const { websiteFinding } = require('../lib/website-finding.js');
  assert.strictEqual(websiteFinding('not found').text,
    "I also looked for your website and couldn't find one, so people who search for you have nothing to click through to.");
  assert.strictEqual(websiteFinding('fine').text, '', 'nothing to say about a site that is fine');
  assert.strictEqual(websiteFinding('unknown').text, '', 'nothing to say about one we never saw');
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
