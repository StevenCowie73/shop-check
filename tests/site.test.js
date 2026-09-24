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
  for (const [p, file] of [['/', 'index.html'], ['/privacy', 'privacy.html'], ['/terms', 'terms.html'],
                           ['/sms', 'sms.html'], ['/sms/', 'sms.html']]) {
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
  for (const p of ['/p/', '/nope', '/coldenjames/index.html']) {
    const res = middleware(req('coldenjames.com', p));
    assert.strictEqual(res.status, 404, p + ' should be 404');
    assert.strictEqual(rewriteTarget(res), null, p + ' should not rewrite to a page');
    assert.match(res.headers.get('content-type') || '', /text\/html/);
  }
});

test('a reference-code path goes to the prospect route, which decides', async () => {
  const res = middleware(req('coldenjames.com', '/p/DEMO2026?c=letter'));
  const target = rewriteTarget(res);
  assert.ok(target, '/p/DEMO2026 is handled');
  assert.match(target, /\/api\/prospect\?/);
  assert.match(target, /ref=DEMO2026/);
  assert.match(target, /c=letter/);
  assert.strictEqual(res.headers.get('x-robots-tag'), 'noindex, nofollow');
});

test('a malformed reference code never reaches the prospect route', async () => {
  for (const p of ['/p/..%2F..%2Fetc', '/p/ab', '/p/' + 'x'.repeat(40), '/p/a/b']) {
    const res = middleware(req('coldenjames.com', p));
    assert.strictEqual(res.status, 404, p + ' should be refused at the edge');
    assert.strictEqual(rewriteTarget(res), null, p);
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

test('only the four real pages on coldenjames.com are indexable', async () => {
  for (const p of ['/', '/privacy', '/terms', '/sms']) {
    const res = middleware(req('coldenjames.com', p));
    assert.strictEqual(res.headers.get('x-robots-tag'), 'index, follow', p);
  }
});

test('/p/ and other unknown paths on coldenjames.com are noindex', async () => {
  for (const p of ['/p/ABC12345', '/p/', '/anything-else']) {
    const res = middleware(req('coldenjames.com', p));
    assert.strictEqual(res.headers.get('x-robots-tag'), 'noindex, nofollow', p);
  }
});

test('the raw /coldenjames/*.html paths are never indexable', async () => {
  /* On the site host they 404. On every other host middleware does not
     touch them, and vercel.json applies noindex because the host is not
     coldenjames.com. */
  for (const p of ['/coldenjames/index.html', '/coldenjames/privacy.html', '/coldenjames/terms.html',
                   '/coldenjames/sms.html']) {
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
    for (const p of ['/', '/privacy', '/terms', '/sms', '/index.html', '/p/ABC']) {
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
  for (const p of ['/', '/privacy', '/terms', '/sms']) {
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
  assert.ok(html.includes('One text per missed call, at most one per caller in any 24 hours.'));
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
  for (const name of ['index.html', 'privacy.html', 'terms.html', '404.html', 'setup.html']) {
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

/* ---------- the setup page ---------- */

const { CARRIERS } = require('../site/carriers.js');

test('/setup is served, and is never indexable', async () => {
  for (const p of ['/setup', '/setup/']) {
    const res = middleware(req('coldenjames.com', p));
    assert.match(rewriteTarget(res) || '', /\/coldenjames\/setup\.html$/, p + ' serves the page');
    assert.strictEqual(res.headers.get('x-robots-tag'), 'noindex, nofollow', p + ' is hidden');
  }
});

test('/setup is not in the sitemap', () => {
  const xml = fs.readFileSync(path.join(OUT, 'sitemap.xml'), 'utf8');
  assert.strictEqual(xml.includes('/setup'), false);
});

test('the ?n= number is only accepted as E.164', () => {
  const html = fs.readFileSync(path.join(OUT, 'setup.html'), 'utf8');
  /* pull the page's own validation regex out of the page and run it, so the
     test cannot pass while the shipped page validates something else */
  const m = /test\(raw\)[\s\S]{0,40}?/.exec(html);
  const src = /var number = (\/.+?\/)\.test\(raw\)/.exec(html);
  assert.ok(src, 'the page carries an inline validation regex');
  const re = new RegExp(src[1].slice(1, -1));
  for (const good of ['+13185550100', '+447700900123']) {
    assert.strictEqual(re.test(good), true, good + ' should be accepted');
  }
  for (const bad of ['3185550100', '+0185550100', '(318) 555-0100', '+1 318 555 0100',
                     '', 'javascript:alert(1)', '+1318555010012345678', 'tel:+13185550100']) {
    assert.strictEqual(re.test(bad), false, JSON.stringify(bad) + ' should be rejected');
  }
});

test('with no usable number the page still says what to dial', () => {
  const html = fs.readFileSync(path.join(OUT, 'setup.html'), 'utf8');
  assert.ok(html.includes('[your ColdenJames number]'), 'the fallback is printed');
});

test('an unconfirmed carrier tells them to text Steven instead of guessing', () => {
  const html = fs.readFileSync(path.join(OUT, 'setup.html'), 'utf8');
  for (const c of CARRIERS.filter(x => !x.confirmed)) {
    const block = html.split('id="c-' + c.id + '"')[1];
    assert.ok(block, c.name + ' has a panel');
    const panel = block.split('</div>')[0] + (block.split('class="panel"')[0] || '');
    const upTo = block.slice(0, block.indexOf('id="c-') === -1 ? 2000 : block.indexOf('id="c-'));
    assert.ok(upTo.includes("Text Steven and he'll walk you through it."),
      c.name + ' must say text Steven');
    assert.strictEqual(/class="code"/.test(upTo), false, c.name + ' must show no dial code');
    assert.strictEqual(/href="tel:\*/.test(upTo), false, c.name + ' must offer no tap-to-dial');
  }
});

test('a confirmed carrier shows steps, and a dial code only if the carrier publishes one', () => {
  const html = fs.readFileSync(path.join(OUT, 'setup.html'), 'utf8');
  for (const c of CARRIERS.filter(x => x.confirmed)) {
    const block = html.split('id="c-' + c.id + '"')[1];
    const upTo = block.slice(0, block.indexOf('id="c-') === -1 ? block.length : block.indexOf('id="c-'));
    assert.ok(upTo.includes('<ol class="steps">'), c.name + ' has numbered steps');
    assert.ok(upTo.includes('Taken from'), c.name + ' cites its source');
    for (const src of c.sources) assert.ok(upTo.includes(src.url), c.name + ' links ' + src.url);
    if (c.method === 'code') {
      assert.ok(upTo.includes('data-dial="' + c.code + '"'), c.name + ' offers tap-to-dial');
    } else {
      assert.strictEqual(upTo.includes('data-dial='), false,
        c.name + ' must not offer a dial code it does not have');
    }
  }
});

test('every carrier entry carries a source or an explicit reason it could not be confirmed', () => {
  for (const c of CARRIERS) {
    if (c.confirmed) {
      assert.ok(c.sources.length, c.name + ' must cite a source');
      for (const s of c.sources) assert.match(s.url, /^https:\/\//, c.name + ' source is a URL');
      assert.ok(c.steps && c.steps.length, c.name + ' must have steps');
      assert.ok(c.offSteps && c.offSteps.length, c.name + ' must say how to turn it off');
    } else {
      assert.ok(c.why && c.why.length > 30, c.name + ' must say why it is not confirmed');
    }
  }
});

test('no carrier claims a ring time that its own pages do not state', () => {
  for (const c of CARRIERS.filter(x => x.confirmed)) {
    assert.match(c.ringTime, /not confirmed/,
      c.name + ' — no carrier page stated a ring time, so none may be claimed');
  }
});

/* ---------- robots and sitemap ---------- */

test('robots.txt points at the sitemap and hides /p/ and /setup', async () => {
  const res = middleware(req('coldenjames.com', '/robots.txt'));
  assert.strictEqual(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/plain/);
  const txt = await res.text();
  assert.match(txt, /^User-agent: \*/m);
  assert.match(txt, /^Disallow: \/p\/$/m);
  assert.match(txt, /^Disallow: \/setup$/m);
  assert.match(txt, /^Sitemap: https:\/\/coldenjames\.com\/sitemap\.xml$/m);
});

test('the sitemap lists exactly the four public pages', async () => {
  const res = middleware(req('coldenjames.com', '/sitemap.xml'));
  assert.strictEqual(res.status, 200);
  assert.match(res.headers.get('content-type'), /xml/);
  const xml = await res.text();
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  assert.deepStrictEqual(locs, [
    'https://coldenjames.com/',
    'https://coldenjames.com/sms',
    'https://coldenjames.com/privacy',
    'https://coldenjames.com/terms'
  ]);
});

test('robots.txt and the sitemap exist on no other host', async () => {
  for (const host of ['signal.cowie.ai', 'signal-abc.vercel.app']) {
    for (const p of ['/robots.txt', '/sitemap.xml', '/setup']) {
      const res = middleware(req(host, p));
      assert.strictEqual(rewriteTarget(res), null, host + p + ' untouched');
      /* next() is a pass-through: it carries x-middleware-next and no body */
      assert.strictEqual(res.headers.get('x-middleware-next'), '1',
        host + p + ' must be passed straight through, not served by us');
    }
  }
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

/* ---------- the texting page ---------- */

test('/sms shows the whole call flow with the real wording', () => {
  const html = fs.readFileSync(path.join(OUT, 'sms.html'), 'utf8');
  const text = html.replace(/<[^>]+>/g, '').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&middot;/g, '·').replace(/&larr;/g, '←');
  const COPY = require('../lib/texting-copy.js');
  assert.match(html, /<title>Text messages from ColdenJames<\/title>/);
  assert.match(html, /<h1>Text messages from ColdenJames<\/h1>/);
  assert.match(html, /<ol class="flow">/, 'numbered steps');
  for (const [what, line] of [
    ['homepage line', C.HOME.smsLine],
    ['letter line', COPY.LETTER_SMS_LINE],
    ['recorded disclosure', COPY.VOICE_DISCLOSURE],
    ['missed-call text', COPY.MISSED_CALL_TEXT],
    ['STOP reply', C.STOP_REPLY],
    ['HELP reply', C.HELP_REPLY]
  ]) assert.ok(text.includes(line), what + ' quoted word for word');
  assert.ok(text.includes('Staying on the line after this message is how you agree'), 'how consent is given');
  assert.ok(text.includes('Replies are passed to Steven, who may answer you by text.'));
  assert.ok(text.includes('One automated text per missed call, at most one per caller in any 24 hours, ' +
    'plus replies in conversations you start. Message and data rates may apply.'));
  assert.match(html, /Reply <strong>STOP<\/strong>/);
  assert.match(html, /Reply <strong>HELP<\/strong>/);
  assert.ok(text.includes('Numbers are never taken from lists'));
  assert.ok(text.includes('no marketing texts'));
  assert.match(html, /href="\/terms"/);
  assert.match(html, /href="\/privacy"/);
  assert.strictEqual(/noindex/i.test(html), false, 'nothing in the page hides it');
});

test('the quoted wording on /sms is exactly what the Twilio routes use', () => {
  const COPY = require('../lib/texting-copy.js');
  const dial = fs.readFileSync(path.join(ROOT, 'api', 'twilio', 'dial-status.js'), 'utf8');
  const voice = fs.readFileSync(path.join(ROOT, 'api', 'twilio', 'voice.js'), 'utf8');
  assert.match(dial, /MISSED_CALL_TEXT/);
  assert.match(voice, /VOICE_DISCLOSURE/);
  assert.strictEqual(COPY.LETTER_SMS_LINE,
    "If I miss your call, you'll get one text back. Msg & data rates may apply. Reply STOP to opt out, HELP for help.");
});

test('every page links to /sms from the footer', () => {
  for (const f of ['index.html', 'privacy.html', 'terms.html', 'sms.html', '404.html']) {
    const html = fs.readFileSync(path.join(OUT, f), 'utf8');
    const foot = html.slice(html.lastIndexOf('<footer>'));
    assert.match(foot, /<a href="\/sms">Text messages<\/a>/, f);
  }
});

test('the terms quote the recorded line callers hear', () => {
  const html = fs.readFileSync(path.join(OUT, 'terms.html'), 'utf8').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
  const { VOICE_DISCLOSURE } = require('../lib/texting-copy.js');
  assert.ok(html.includes('<strong>What callers hear:</strong>'));
  assert.ok(html.includes('"' + VOICE_DISCLOSURE + '"'));
});

test('the privacy page still says mobile information is not shared', () => {
  const html = fs.readFileSync(path.join(OUT, 'privacy.html'), 'utf8');
  assert.ok(html.includes('No mobile information will be shared with third parties or affiliates for ' +
    'marketing or promotional purposes. Text messaging originator opt-in data and consent will not be ' +
    'shared with any third parties.'));
});

test('the letter template prints the texting line directly under the number', () => {
  const src = fs.readFileSync(path.join(ROOT, 'finder', 'pilot', '10-render-letters.js'), 'utf8');
  assert.match(src, /require\('\.\.\/\.\.\/lib\/texting-copy\.js'\)/);
  assert.match(src, /<p class="sig">Steven Cowie<br>\[PHONE\]<\/p>\n\s*<p class="smsnote">\$\{esc\(LETTER_SMS_LINE\)\}<\/p>/);
  assert.match(src, /\.smsnote \{ font-size: 8\.5pt;/, 'small');
});
