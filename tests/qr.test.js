'use strict';

/* The QR codes printed on letters. Every case here encodes an image and then
   decodes the image, because a QR that was never read back is a guess. */

const test = require('node:test');
const assert = require('node:assert');

const { qrPng, qrDataUri, decode, LEVEL, MARGIN } = require('../lib/qr.js');
const { randomRef, prospectUrl } = require('../lib/refs.js');

test('a letter QR scans back to the letter URL', async () => {
  const ref = randomRef();
  const url = prospectUrl(ref, 'letter');
  const png = await qrPng(url);
  assert.strictEqual(decode(png), url);
  assert.ok(url.endsWith('?c=letter'), 'the channel tag survives into the code');
  assert.ok(url.includes('/p/' + ref));
});

test('the letter code and the email code scan back differently', async () => {
  const ref = randomRef();
  const asLetter = decode(await qrPng(prospectUrl(ref, 'letter')));
  const asEmail = decode(await qrPng(prospectUrl(ref, 'email')));
  assert.strictEqual(asLetter, 'https://coldenjames.com/p/' + ref + '?c=letter');
  assert.strictEqual(asEmail, 'https://coldenjames.com/p/' + ref + '?c=email');
  assert.notStrictEqual(asLetter, asEmail);
});

test('twenty different refs give twenty codes that each scan back', async () => {
  const { allocate } = require('../lib/refs.js');
  const refs = allocate(20, []);
  const read = [];
  for (const ref of refs) {
    const url = prospectUrl(ref, 'letter');
    read.push(decode(await qrPng(url)));
    assert.strictEqual(read[read.length - 1], url, ref + ' did not scan back');
  }
  assert.strictEqual(new Set(read).size, 20, 'two letters carry the same code');
});

test('the demo ref makes a scannable code too', async () => {
  const url = prospectUrl('DEMO2026', 'letter');
  assert.strictEqual(decode(await qrPng(url)), 'https://coldenjames.com/p/DEMO2026?c=letter');
});

test('the data URI is the same image, base64', async () => {
  const url = prospectUrl(randomRef(), 'letter');
  const uri = await qrDataUri(url);
  assert.ok(uri.startsWith('data:image/png;base64,'));
  const buffer = Buffer.from(uri.slice('data:image/png;base64,'.length), 'base64');
  assert.strictEqual(decode(buffer), url, 'the data URI does not decode to the URL');
  assert.strictEqual(buffer.slice(1, 4).toString('latin1'), 'PNG');
});

test('a code that would not read back is refused rather than returned', async () => {
  /* The guard is the reason this file exists, so it is worth proving it can
     actually fail rather than trusting that it would. */
  const QRCode = require('qrcode');
  const real = QRCode.toBuffer;
  QRCode.toBuffer = async () => real('https://example.invalid/wrong',
    { type: 'png', errorCorrectionLevel: LEVEL, margin: MARGIN, width: 200 });
  try {
    await assert.rejects(() => qrPng('https://coldenjames.com/p/ABCDEFGH?c=letter'),
      /does not scan back/);
  } finally {
    QRCode.toBuffer = real;
  }
});

test('an empty string is not encoded at all', async () => {
  await assert.rejects(() => qrPng(''), /nothing to encode/);
});
