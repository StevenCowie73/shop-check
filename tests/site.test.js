'use strict';

/* The ColdenJames site: that it is served on its own host, that it is not
   served anywhere else, and that the committed HTML still matches the copy
   it was generated from. */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'public', 'coldenjames');
const C = require('../site/content.js');

let middleware;
test.before(async () => {
  middleware = (await import('../middleware.js')).default;
});

function req(host, pathname) {
  return new Request('https://' + host + pathname, { headers: { host } });
}
const rewriteTarget = res => res.headers.get('x-middleware-rewrite');

/* ---------- the host gate ---------- */

test('the site is served on coldenjames.com', async () => {
  for (const [p, file] of [['/', 'index.html'], ['/privacy', 'privacy.html'], ['/terms', 'terms.html']]) {
    const res = middleware(req('coldenjames.com', p));
    const target = rewriteTarget(res);
    assert.ok(target, p + ' should rewrite');
    assert.match(target, new RegExp('/coldenjames/' + file + '$'), p + ' -> ' + file);
  }
});

test('www redirects to the bare domain, permanently', async () => {
  const res = middleware(req('www.coldenjames.com', '/privacy'));
  assert.strictEqual(res.status, 308);
  assert.strictEqual(res.headers.get('location'), 'https://coldenjames.com/privacy');
});

test('an unknown path on the site host is a real 404, not the homepage', async () => {
  for (const p of ['/p/SOMEREF', '/p/', '/nope', '/coldenjames/index.html']) {
    const res = middleware(req('coldenjames.com', p));
    assert.strictEqual(res.status, 404, p + ' should be 404');
    assert.strictEqual(rewriteTarget(res), null, p + ' should not rewrite to a page');
    assert.match(res.headers.get('content-type') || '', /text\/html/);
  }
});

test('the 404 page says the right thing and offers a way back', async () => {
  const res = middleware(req('coldenjames.com', '/nope'));
  const html = await res.text();
  assert.ok(html.includes("This link doesn't match a page."), 'the line');
  assert.match(html, /href="\/"/, 'a link home');
  assert.ok(html.includes('#F4EFE6'), 'the design system');
});

/* ---------- indexing ---------- */

test('only the three real pages on coldenjames.com are indexable', async () => {
  for (const p of ['/', '/privacy', '/terms']) {
    const res = middleware(req('coldenjames.com', p));
    assert.strictEqual(res.headers.get('x-robots-tag'), 'index, follow', p);
  }
});

test('/p/ and other unknown paths on coldenjames.com are noindex', async () => {
  for (const p of ['/p/ABC', '/p/', '/anything-else']) {
    const res = middleware(req('coldenjames.com', p));
    assert.strictEqual(res.headers.get('x-robots-tag'), 'noindex, nofollow', p);
  }
});

test('the raw /coldenjames/*.html paths are never indexable', async () => {
  /* On the site host they 404. On every other host middleware does not
     touch them, and vercel.json applies noindex because the host is not
     coldenjames.com. */
  for (const p of ['/coldenjames/index.html', '/coldenjames/privacy.html', '/coldenjames/terms.html']) {
    const onSite = middleware(req('coldenjames.com', p));
    assert.strictEqual(onSite.status, 404, p + ' on the site host');
    assert.strictEqual(onSite.headers.get('x-robots-tag'), 'noindex, nofollow');

    const elsewhere = middleware(req('signal.cowie.ai', p));
    assert.strictEqual(rewriteTarget(elsewhere), null, p + ' elsewhere is untouched');
  }
});

test('vercel.json withholds noindex from the site host and applies it everywhere else', () => {
  const conf = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  const robots = conf.headers.filter(h =>
    h.headers.some(x => x.key === 'X-Robots-Tag'));
  assert.strictEqual(robots.length, 1, 'exactly one rule sets X-Robots-Tag');
  assert.deepStrictEqual(robots[0].missing, [{ type: 'host', value: 'coldenjames.com' }],
    'it is withheld from coldenjames.com and applies to every other host');
  assert.strictEqual(robots[0].headers[0].value, 'noindex, nofollow');
});

/* ---------- Signal is untouched ---------- */

test('no other host is rewritten, redirected or 404ed', async () => {
  for (const host of ['signal.cowie.ai', 'signal-abc123.vercel.app', 'localhost', 'coldenjames.com.evil.test']) {
    for (const p of ['/', '/privacy', '/terms', '/index.html', '/p/ABC']) {
      const res = middleware(req(host, p));
      assert.strictEqual(rewriteTarget(res), null, host + p + ' must not be rewritten');
      assert.notStrictEqual(res.status, 404, host + p + ' must not be 404ed by us');
      assert.notStrictEqual(res.status, 308, host + p + ' must not be redirected');
      assert.strictEqual(res.headers.get('x-robots-tag'), null,
        host + p + ' leaves the robots header to vercel.json');
    }
  }
});

test('the matcher never lets middleware see an api route', () => {
  const src = fs.readFileSync(path.join(ROOT, 'middleware.js'), 'utf8');
  const m = /matcher:\s*\[\s*'([^']+)'/.exec(src);
  assert.ok(m, 'a matcher is declared');
  const re = new RegExp('^' + m[1] + '$');
  for (const p of ['/api/lookup', '/api/twilio/voice', '/api/twilio/dial-status', '/api/twilio/sms']) {
    assert.strictEqual(re.test(p), false, p + ' must be excluded from middleware');
  }
  for (const p of ['/', '/privacy', '/terms']) {
    assert.strictEqual(re.test(p), true, p + ' must be included');
  }
});

test('Signal’s own page is still the file Vercel serves at the root', () => {
  const signalPage = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  assert.match(signalPage, /Signal|lookup/i);
  assert.strictEqual(signalPage.includes('ColdenJames'), false, 'Signal page untouched');
});

/* ---------- the pages themselves ---------- */

test('the committed HTML is what the content file generates', () => {
  const { build } = require('../site/build.js');
  const before = fs.readdirSync(OUT).map(f => [f, fs.readFileSync(path.join(OUT, f), 'utf8')]);
  build();
  for (const [name, was] of before) {
    assert.strictEqual(fs.readFileSync(path.join(OUT, name), 'utf8'), was,
      name + ' is out of date — run npm run site:build');
  }
});

test('the homepage says the things it must say', () => {
  const html = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
  assert.match(html, /<h1>ColdenJames<\/h1>/);
  assert.ok(html.includes(C.HOME.tagline));
  assert.ok(html.includes('$79 a month'));
  for (const point of C.HOME.price.points) assert.ok(html.includes(point), point);
  assert.ok(html.includes("isn't a robot pretending to be you on the phone".replace(/'/g, '&#39;')) ||
            html.includes("isn&#39;t a robot") || html.includes("isn't a robot"),
            'the dashed-box reassurance is present');
  assert.ok(html.includes('steven@coldenjames.com'));
  assert.ok(html.includes('trade name of COWIE.AI LLC'));
  assert.match(html, /href="\/privacy"/);
  assert.match(html, /href="\/terms"/);
});

test('the phone line is hidden until a number is set', () => {
  const html = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
  if (C.BUSINESS.phone) {
    assert.match(html, /<dt>Phone<\/dt>/);
  } else {
    assert.strictEqual(html.includes('<dt>Phone</dt>'), false, 'no phone line while unset');
    assert.strictEqual(/href="tel:/.test(html), false, 'no tel: link while unset');
  }
});

test('setting a phone number makes the line appear', () => {
  const { home } = require('../site/build.js');
  const saved = C.BUSINESS.phone;
  try {
    C.BUSINESS.phone = '(318) 555-0100';
    const html = home();
    assert.match(html, /<dt>Phone<\/dt>/);
    assert.match(html, /href="tel:3185550100"/);
  } finally { C.BUSINESS.phone = saved; }
});

test('the privacy policy carries the sentence the carriers require, verbatim', () => {
  const html = fs.readFileSync(path.join(OUT, 'privacy.html'), 'utf8');
  assert.ok(html.includes(C.CARRIER_SENTENCE), 'exact carrier sentence');
  assert.ok(html.includes('Reply STOP'), 'STOP instruction');
  assert.ok(html.includes('HELP'), 'HELP instruction');
  assert.ok(html.includes('Message and data rates may apply'));
  assert.ok(html.includes('Message frequency varies'));
  assert.match(html, /href="https:\/\/policies\.google\.com\/privacy"/);
  assert.ok(html.includes('Plain-English draft'));
  assert.ok(html.includes('Last updated'));
});

test('the terms carry the Google clause and the commercial terms', () => {
  const html = fs.readFileSync(path.join(OUT, 'terms.html'), 'utf8');
  assert.ok(html.includes('Google Maps/Google Earth Additional Terms of Service'));
  assert.match(html, /href="https:\/\/maps\.google\.com\/help\/terms_maps\/"/);
  assert.match(html, /href="https:\/\/policies\.google\.com\/privacy"/);
  assert.ok(html.includes('$79 a month'));
  assert.ok(html.includes('first month is free') || html.includes('First month free'));
  assert.ok(html.includes('Louisiana'));
  assert.ok(html.includes('Plain-English draft'));
});

/* ---------- house style ---------- */

test('no page uses the word AI in visible copy, and no emoji', () => {
  for (const name of ['index.html', 'privacy.html', 'terms.html', '404.html']) {
    const html = fs.readFileSync(path.join(OUT, name), 'utf8');
    const visible = html
      .replace(/<style[\s\S]*?<\/style>/g, ' ')
      .replace(/<head[\s\S]*?<\/head>/g, ' ')
      .replace(/<[^>]+>/g, ' ');
    /* COWIE.AI LLC is the registered company name and has to appear. */
    const withoutLegalName = visible.split('COWIE.AI LLC').join(' ');
    assert.strictEqual(/\bAI\b/.test(withoutLegalName), false, name + ' uses the word AI');
    assert.strictEqual(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(visible), false, name + ' has an emoji');
  }
});

test('no page asks only happy customers for a review', () => {
  /* Google forbids review gating — asking selectively based on how the job
     went. Nothing customer-facing may suggest it. */
  for (const name of ['index.html', 'privacy.html', 'terms.html', '404.html']) {
    const html = fs.readFileSync(path.join(OUT, name), 'utf8');
    assert.strictEqual(/happy|satisfied|pleased/i.test(html), false, name);
  }
  const home = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
  assert.ok(home.includes('Every customer whose job is done gets asked, once.'));
});

test('the palette and font are the project ones', () => {
  const html = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
  for (const token of ['#F4EFE6', '#FBF8F2', '#1C1917', '#5C5650', '#CFC6B6', '#C4501B']) {
    assert.ok(html.includes(token), 'palette token ' + token);
  }
  assert.match(html, /IBM\+Plex\+Sans/);
  assert.strictEqual(/box-shadow|linear-gradient/.test(html), false, 'no shadows or gradients');
  assert.match(html, /name="viewport" content="width=device-width/);
});
