'use strict';

/* The reference codes printed on letters, and the speed bump in front of
   the routes that read them. */

const test = require('node:test');
const assert = require('node:assert');

const R = require('../lib/refs.js');
const { clientKey, counter, distinctCounter, retryAfter } = require('../lib/ratelimit.js');

/* ---------- the alphabet ---------- */

test('the alphabet leaves out every character that gets misread', () => {
  for (const bad of ['0', 'O', '1', 'I', 'L']) {
    assert.strictEqual(R.ALPHABET.includes(bad), false, bad + ' is in the alphabet');
  }
  assert.strictEqual(R.ALPHABET, R.ALPHABET.toUpperCase(), 'uppercase only');
  assert.strictEqual(new Set(R.ALPHABET).size, R.ALPHABET.length, 'no repeats');
  assert.strictEqual(R.ALPHABET.length, 31);
  assert.strictEqual(R.LENGTH, 8);
});

test('a generated ref is eight uppercase characters from the alphabet', () => {
  for (let i = 0; i < 500; i++) {
    const ref = R.randomRef();
    assert.strictEqual(ref.length, 8, ref);
    assert.ok(R.isRef(ref), ref);
    assert.strictEqual(/[01OIL]/.test(ref), false, ref + ' has a confusable');
    assert.strictEqual(ref, ref.toUpperCase(), ref);
  }
});

test('isRef is strict about length, case and characters', () => {
  assert.strictEqual(R.isRef('ABCDEFGH'), true);
  for (const bad of ['abcdefgh', 'ABCDEFG', 'ABCDEFGHI', '', null, undefined,
                     'ABCDEFG0', 'ABCDEFGO', 'ABCDEFG1', 'ABCDEFGI', 'ABCDEFGL',
                     'ABCD EFG', 'ABCDEFG-', 'DEMO2026']) {
    assert.strictEqual(R.isRef(bad), false, JSON.stringify(bad));
  }
});

/* ---------- never reused ---------- */

test('allocate never repeats itself and never returns a taken ref', () => {
  const taken = new Set(['DEMO2026']);
  const batch = R.allocate(400, taken);
  assert.strictEqual(batch.length, 400);
  assert.strictEqual(new Set(batch).size, 400, 'all distinct');
  for (const ref of batch) assert.strictEqual(taken.has(ref), false);
});

test('a ref already handed out is never handed out again', () => {
  /* Pinning the generator to one value proves the loop actually rejects it
     rather than getting lucky on the second draw. */
  const crypto = require('crypto');
  const real = crypto.randomInt;
  let calls = 0;
  crypto.randomInt = function (max) {
    calls++;
    /* the first eight draws spell one fixed ref, then hand back to the real
       generator */
    return calls <= 8 ? 0 : real(max);
  };
  try {
    const fixed = R.ALPHABET[0].repeat(8);
    const ref = R.newRef(new Set([fixed]));
    assert.notStrictEqual(ref, fixed, 'returned the ref it was told was taken');
    assert.ok(R.isRef(ref));
  } finally {
    crypto.randomInt = real;
  }
});

test('the demo ref is reserved and cannot be generated', () => {
  assert.ok(R.RESERVED.has('DEMO2026'));
  const { DEMO_REF } = require('../site/prospects.js');
  assert.strictEqual(DEMO_REF, 'DEMO2026');
  /* it has a zero in it, so the alphabet rules it out before the reserve list
     ever has to */
  assert.strictEqual([...'DEMO2026'].every(c => R.ALPHABET.includes(c)), false);
  const batch = R.allocate(200, []);
  assert.strictEqual(batch.includes('DEMO2026'), false);
});

/* ---------- channel tags ---------- */

test('one ref, two channels, two different links', () => {
  const ref = R.randomRef();
  assert.strictEqual(R.prospectUrl(ref, 'letter'), 'https://coldenjames.com/p/' + ref + '?c=letter');
  assert.strictEqual(R.prospectUrl(ref, 'email'), 'https://coldenjames.com/p/' + ref + '?c=email');
  assert.strictEqual(R.prospectUrl(ref, 'direct'), 'https://coldenjames.com/p/' + ref);
  assert.strictEqual(R.prospectUrl(ref), 'https://coldenjames.com/p/' + ref);
  assert.notStrictEqual(R.prospectUrl(ref, 'letter'), R.prospectUrl(ref, 'email'));
});

test('the reserved demo ref still makes a link, and rubbish does not', () => {
  assert.strictEqual(R.prospectUrl('DEMO2026', 'letter'),
    'https://coldenjames.com/p/DEMO2026?c=letter');
  for (const bad of ['', 'nope', 'ABCDEFG0', '../../etc']) {
    assert.throws(() => R.prospectUrl(bad, 'letter'), /not a reference code/, JSON.stringify(bad));
  }
});

test('the url middleware will accept is the url the letter prints', () => {
  /* middleware.js is the thing that decides whether /p/REF is a page at all,
     so the generated ref has to satisfy its pattern. */
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'middleware.js'), 'utf8');
  const m = /const prospect = (\/\^[^;]+\/)\.exec/.exec(src);
  assert.ok(m, 'could not find the /p/ pattern in middleware.js');
  const pattern = eval(m[1]);
  for (let i = 0; i < 50; i++) {
    const url = new URL(R.prospectUrl(R.randomRef(), 'letter'));
    assert.ok(pattern.exec(url.pathname), url.pathname + ' is not routable');
  }
  assert.ok(pattern.exec('/p/DEMO2026'));
});

/* ---------- the speed bump ---------- */

test('the address comes from the forwarded header, not the body', () => {
  assert.strictEqual(clientKey({ headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' } }), '203.0.113.7');
  assert.strictEqual(clientKey({ headers: { 'x-real-ip': '203.0.113.8' } }), '203.0.113.8');
  assert.strictEqual(clientKey({ headers: {} }), 'unknown');
  assert.strictEqual(clientKey({}), 'unknown');
});

test('the counter allows the limit and refuses the one after', () => {
  const c = counter({ windowMs: 60000, max: 3 });
  assert.deepStrictEqual([1, 2, 3, 4, 5].map(() => c.exceeded('a')),
    [false, false, false, true, true]);
  /* a different address is counted separately */
  assert.strictEqual(c.exceeded('b'), false);
  c.reset();
  assert.strictEqual(c.exceeded('a'), false, 'reset empties it');
});

test('the counter forgets a window that has passed', () => {
  const c = counter({ windowMs: 20, max: 1 });
  assert.strictEqual(c.exceeded('a'), false);
  assert.strictEqual(c.exceeded('a'), true);
  return new Promise(resolve => setTimeout(() => {
    assert.strictEqual(c.exceeded('a'), false, 'still counting a stale hit');
    resolve();
  }, 40));
});

test('asking for the same code again is always free', () => {
  const d = distinctCounter({ windowMs: 60000, max: 2 });
  for (let i = 0; i < 100; i++) {
    assert.strictEqual(d.exceeded('a', 'AAAAAAAA'), false, 'refusing a refresh at ' + i);
  }
  assert.strictEqual(d.exceeded('a', 'BBBBBBBB'), false);
  assert.strictEqual(d.exceeded('a', 'CCCCCCCC'), true, 'a third code should be refused');
  /* and the refused one is not counted, so the earlier two still work */
  assert.strictEqual(d.exceeded('a', 'AAAAAAAA'), false);
  assert.strictEqual(d.exceeded('b', 'CCCCCCCC'), false, 'a different address is unaffected');
});

test('retry-after is whole seconds, rounded up', () => {
  assert.strictEqual(retryAfter(60000), '60');
  assert.strictEqual(retryAfter(1500), '2');
  assert.strictEqual(retryAfter(600000), '600');
});
