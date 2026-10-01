'use strict';

/* The Lob sender, with Lob mocked (no request ever leaves), and the letter
   template measured against Lob's page-one address area in a real render.
   Every business here is invented. */

const test = require('node:test');
const assert = require('node:assert');

const lob = require('../lib/lob.js');

const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Pages /Kids [2 0 R] /Count 1 >> endobj\n' +
  '2 0 obj << /Type /Page /MediaBox [0 0 612 792] >> endobj\n%%EOF\n', 'latin1');
const FROM = { name: 'Steven Cowie', company: 'ColdenJames', line1: '100 Invented Plaza Ste 5', city: 'Bossier City', state: 'LA', zip: '71111' };

function approved(extra = {}) {
  return {
    id: 7, prospectId: 'DEMO2026', runId: 'run-test', state: 'approved', approvedAt: '2026-09-25T12:00:00Z',
    lobLetterId: null, lobMode: null, doNotContact: false,
    html: '<html><body><section class="page"><p>Dale —</p><p>Hello from Marsh Lane Fencing.</p></section></body></html>',
    to: { name: 'Dale Example', company: 'Marsh Lane Fencing', line1: '12 Invented Rd', city: 'Shreveport', state: 'LA', zip: '71105' },
    ...extra
  };
}

function harness({ status = 200, body = { id: 'ltr_4868c3b754655f90', expected_delivery_date: '2026-10-01' } } = {}) {
  const calls = [], recorded = [];
  return {
    calls, recorded,
    fetchImpl: async (url, init) => { calls.push({ url, init }); return { ok: status < 300, status, text: async () => JSON.stringify(body) }; },
    store: { async recordLobLetter(id, r) { recorded.push({ id, ...r }); } },
    renderPdf: async () => PDF
  };
}

const send = (h, over = {}) => lob.sendLetter({ letter: approved(), from: FROM, key: 'test_abc123', renderPdf: h.renderPdf,
  fetchImpl: h.fetchImpl, store: h.store, now: () => new Date('2026-09-25T15:00:00Z'), ...over });

/* ---------- sending ---------- */

test('an approved letter goes to Lob once, as a one-page PDF with both addresses, and its id and date are stored', async () => {
  const h = harness();
  const r = await send(h);
  assert.deepStrictEqual(r, { lobLetterId: 'ltr_4868c3b754655f90', expectedDeliveryDate: '2026-10-01', mode: 'test', sentAt: '2026-09-25T15:00:00.000Z' });
  assert.deepStrictEqual(h.recorded, [{ id: 7, ...r }]);
  assert.strictEqual(h.calls.length, 1);
  const { url, init } = h.calls[0];
  assert.strictEqual(url, 'https://api.lob.com/v1/letters');
  assert.strictEqual(init.method, 'POST');
  assert.strictEqual(init.headers.Authorization, 'Basic ' + Buffer.from('test_abc123:').toString('base64'), 'key as username, blank password');
  assert.match(init.headers['Idempotency-Key'], /^coldenjames-letter-7-test-[0-9a-f]{24}$/);
  assert.match(init.headers['Content-Type'], /^multipart\/form-data; boundary=/);
  const body = init.body.toString('latin1');
  const field = name => { const m = new RegExp('name="' + name.replace(/[[\]]/g, '\\$&') + '"\\r\\n\\r\\n([^\\r]*)').exec(body); return m && m[1]; };
  assert.strictEqual(field('to[company]'), 'Marsh Lane Fencing');
  assert.strictEqual(field('to[address_line1]'), '12 Invented Rd');
  assert.strictEqual(field('to[address_zip]'), '71105');
  assert.strictEqual(field('from[company]'), 'ColdenJames');
  assert.strictEqual(field('from[address_line1]'), '100 Invented Plaza Ste 5');
  assert.strictEqual(field('address_placement'), 'top_first_page');
  assert.strictEqual(field('double_sided'), 'false');
  assert.strictEqual(field('color'), 'true');
  assert.strictEqual(field('use_type'), 'marketing');
  assert.strictEqual(field('mail_type'), 'usps_first_class');
  assert.strictEqual(field('metadata[ref]'), 'DEMO2026');
  assert.strictEqual(field('to[address_line2]'), null, 'empty parts are left out');
  assert.match(body, /name="file"; filename="letter-7\.pdf"\r\nContent-Type: application\/pdf\r\n\r\n%PDF-1\.4/);
});

test('nothing that is not approved is ever sent', async () => {
  for (const [letter, why] of [
    [approved({ state: 'draft', approvedAt: null }), /not approved/],
    [approved({ state: 'approved', approvedAt: null }), /not approved/],
    [approved({ state: 'mock' }), /mock/],
    [approved({ state: 'sent', lobLetterId: 'ltr_1', lobMode: 'live' }), /already been mailed/],
    [approved({ lobLetterId: 'ltr_1', lobMode: 'live' }), /already been mailed/],
    [approved({ doNotContact: true }), /do not contact/],
    [null, /No such letter/]
  ]) {
    const h = harness();
    await assert.rejects(send(h, { letter }), why);
    assert.strictEqual(h.calls.length, 0, 'Lob was never called');
    assert.strictEqual(h.recorded.length, 0);
  }
});

test('the Idempotency-Key repeats for a retry of the same letter, and changes when the letter is re-rendered or re-addressed', async () => {
  const keyOf = async over => { const h = harness(); await send(h, over); return h.calls[0].init.headers['Idempotency-Key']; };
  const first = await keyOf();
  assert.strictEqual(await keyOf(), first, 'a retry of the same letter reuses its key, so Lob makes one letter');
  const rerendered = await keyOf({ letter: approved({ html: approved().html.replace('Hello', 'Hello again') }) });
  assert.notStrictEqual(rerendered, first, 'a re-render is a new send, never matched to the earlier one');
  assert.match(rerendered, /^coldenjames-letter-7-test-/, 'still the same letter and mode');
  assert.notStrictEqual(await keyOf({ letter: approved({ to: { ...approved().to, line1: '14 Invented Rd' } }) }), first, 'so is a new address');
  assert.notStrictEqual(await keyOf({ from: { ...FROM, line1: '200 Invented Plaza Ste 5' } }), first, 'and a new return address');
  assert.notStrictEqual(await keyOf({ key: 'live_abc', live: true }), first, 'and the other mode');
  assert.ok(first.length <= 255, 'within Lob\'s length');
  assert.strictEqual(lob.idempotencyKey({ id: 7, html: '<p>a</p>' }, 'test', {}, {}), lob.idempotencyKey({ id: 7, html: '<p>a</p>' }, 'test', {}, {}));
});

test('a live key needs the LIVE flag, and the LIVE flag needs a live key', async () => {
  let h = harness();
  await assert.rejects(send(h, { key: 'live_abc' }), /live Lob key and the LIVE flag is not set/);
  await assert.rejects(send(h, { key: 'live_abc', live: 'yes' }), /LIVE flag is not set/, 'only true itself counts');
  await assert.rejects(send(h, { key: 'test_abc', live: true }), /test key/);
  await assert.rejects(send(h, { key: 'sk_abc' }), /neither test_ nor live_/);
  assert.strictEqual(h.calls.length, 0);
  h = harness();
  const r = await send(h, { key: 'live_abc', live: true });
  assert.strictEqual(r.mode, 'live');
  assert.match(h.calls[0].init.headers['Idempotency-Key'], /^coldenjames-letter-7-live-[0-9a-f]{24}$/);
});

test('a proxy-injected key must be declared, and is never sent by us', async () => {
  let h = harness();
  await assert.rejects(send(h, { key: '' }), /LOB_KEY_MODE/);
  await assert.rejects(send(h, { key: '', declaredMode: 'live' }), /LIVE flag is not set/);
  assert.strictEqual(h.calls.length, 0);
  h = harness();
  await send(h, { key: '', declaredMode: 'test' });
  assert.strictEqual(h.calls[0].init.headers.Authorization, undefined, 'the proxy adds it');
});

test('both addresses must be complete and within Lob\'s lengths', async () => {
  const h = harness();
  const { BUSINESS } = require('../site/content.js');
  assert.deepStrictEqual(lob.lobAddress(BUSINESS.mailbox, 'return'), {
    name: 'Steven Cowie', company: 'COWIE.AI LLC', address_line1: '601 Kingston Rd', address_line2: 'Ste 300 #1016',
    address_city: 'Benton', address_state: 'LA', address_zip: '71006', address_country: 'US' },
  'the return address is the mailbox on the Form 1583: Steven and the LLC, never the trade name');
  await assert.rejects(send(h, { letter: approved({ to: { company: 'Marsh Lane Fencing', line1: '12 Invented Rd', city: 'Shreveport', state: 'LA' } }) }), /recipient address is incomplete: ZIP/);
  await assert.rejects(send(h, { letter: approved({ to: { ...approved().to, company: 'X'.repeat(41) } }) }), /company is 41 characters; Lob allows 40/);
  await assert.rejects(send(h, { from: { ...FROM, line1: 'Y'.repeat(65) } }), /address_line1 is 65 characters; Lob allows 64/);
  assert.strictEqual(h.calls.length, 0);
});

test('a letter still carrying a template placeholder is not mailed', async () => {
  const h = harness();
  await assert.rejects(send(h, { letter: approved({ html: '<p class="bizaddr">[MAILING ADDRESS]</p><p>Dale —</p>' }) }), /\[MAILING ADDRESS\]/);
  assert.strictEqual(h.calls.length, 0);
});

test('the PDF must be one US Letter page with real fonts, under 5 MB', async () => {
  assert.deepStrictEqual(lob.checkPdf(PDF), { pages: 1, bytes: PDF.length });
  const two = Buffer.from(PDF.toString('latin1').replace('%%EOF', '3 0 obj << /Type /Page /MediaBox [0 0 612 792] >> endobj\n%%EOF'), 'latin1');
  assert.throws(() => lob.checkPdf(two), /2 pages/);
  assert.throws(() => lob.checkPdf(Buffer.from(PDF.toString('latin1').replace('612 792', '595 842'), 'latin1')), /8\.5 x 11/);
  assert.throws(() => lob.checkPdf(Buffer.from(PDF.toString('latin1').replace('%%EOF', '<< /Type /Font /Subtype /Type3 >>\n%%EOF'), 'latin1')), /Type 3/);
  assert.throws(() => lob.checkPdf(Buffer.from('<html>')), /not a PDF/);
  assert.throws(() => lob.checkPdf(Buffer.concat([PDF, Buffer.alloc(5 * 1024 * 1024)])), /under 5 MB/);
  const h = harness();
  h.renderPdf = async () => two;
  await assert.rejects(send(h), /exactly one/);
  assert.strictEqual(h.calls.length, 0);
});

test('Lob refusing says why, never shows the key, and stores nothing', async () => {
  const h = harness({ status: 422, body: { error: { message: 'address_zip is invalid for test_abc123', status_code: 422 } } });
  await assert.rejects(send(h), e => /HTTP 422/.test(e.message) && !e.message.includes('test_abc123') && e.message.includes('[key]'));
  assert.strictEqual(h.recorded.length, 0);
  const odd = harness({ body: { object: 'letter' } });
  await assert.rejects(send(odd), /without a letter id/);
  assert.strictEqual(odd.recorded.length, 0);
});

test('the envelope reads as the letter does: title case, no LLC', () => {
  assert.deepStrictEqual(lob.recipientOf({ company: 'MARSH LANE FENCING LLC', ownerName: 'DALE EXAMPLE', mailingStreet: '12 Invented Rd',
    mailingCity: 'SHREVEPORT', mailingState: 'LA', mailingZip: '71105' }),
  { name: 'Dale Example', company: 'Marsh Lane Fencing', line1: '12 Invented Rd', line2: '', city: 'Shreveport', state: 'LA', zip: '71105' });
});

/* ---------- the template against Lob's page one ---------- */

/* Lob's zones, the folds and the measuring all live in lib/lob-layout.js,
   shared with finder/pilot/check-zones.js, which runs the same check on
   every real letter. */
const layout = require('../lib/lob-layout.js');

const { findChrome, letterHtml, pageCss } = require('../finder/pilot/10-render-letters.js');
const chrome = findChrome();

/* An invented worst case: the longest business name, no first name (so the
   greeting is "To the owner of ..."), and the longest website paragraph. */
function inventedLetter(qrImage) {
  const { html } = letterHtml(
    { company: 'QUOKKA LAGOON ROOFING AND CONSTRUCTION SERVICES LLC', rank: 1, websiteState: 'dead', emailUsable: true },
    { qualifyingParties: [], mailingAddress: { city: 'Bossier City' }, parish: 'Bossier', foundVia: ['Bossier / Residential License Certificate'],
      websiteAudit: { url: 'https://quokkalagoonroofingandconstruction.example.com/', siteScore: 78, loads: false, source: 'astra',
        whatsWrong: 'The site does not load (the server answered 404)' } },
    { ref: 'DEMO2026', url: 'https://coldenjames.com/p/DEMO2026?c=letter', printed: 'coldenjames.com/p/DEMO2026', image: qrImage });
  return html;
}

/* And the other kind: nothing found to say about the website (it was
   fine, or we could not tell), so no website paragraph, and the shorter
   line beside the QR. Same long name and no first name. */
function inventedNoFinding(qrImage) {
  const { html } = letterHtml(
    { company: 'QUOKKA LAGOON ROOFING AND CONSTRUCTION SERVICES LLC', rank: 2, websiteState: 'fine', emailUsable: true },
    { qualifyingParties: [], mailingAddress: { city: 'Bossier City' }, parish: 'Bossier', foundVia: ['Bossier / Residential License Certificate'],
      websiteAudit: { url: 'https://quokkalagoonroofingandconstruction.example.com/', siteScore: 10, loads: true, source: 'astra', whatsWrong: '' } },
    { ref: 'DEMO2027', url: 'https://coldenjames.com/p/DEMO2027?c=letter', printed: 'coldenjames.com/p/DEMO2027', image: qrImage });
  return html;
}

test('nothing on page one lands in Lob\'s address area, windows or barcode corner; the QR clears both folds; it is one page',
  { skip: chrome ? false : 'no Chromium on this machine' }, async () => {
    const { qrDataUri } = require('../lib/qr.js');
    for (const [which, make] of [['with a finding', inventedLetter], ['with no finding', inventedNoFinding]]) {
      const html = '<!doctype html><html><head><meta charset="utf-8"><style>' + pageCss('') + '</style></head><body>' +
        make(await qrDataUri('https://coldenjames.com/p/DEMO2026?c=letter')) + '</body></html>';
      const pages = layout.measure(html, chrome);
      assert.strictEqual(pages.length, 1, which);
      assert.deepStrictEqual(layout.problems(pages[0]), [], which);
      const qr = pages[0].boxes.find(x => x.el === 'IMG.qr').b;
      assert.ok(qr[3] < 7.2 - layout.FOLD_MARGIN, which + ': the QR ' + JSON.stringify(qr) + ' sits above a lower fold anywhere from 7.2in');
      assert.ok(qr[1] > 3.75 + layout.FOLD_MARGIN, which + ': and below the upper fold');
      assert.deepStrictEqual([+(qr[2] - qr[0]).toFixed(3), +(qr[3] - qr[1]).toFixed(3)], [1, 1], which + ': the QR is one inch');

      const pdf = require('../lib/letter-pdf.js').renderLetterPdf(html, { chrome });
      assert.deepStrictEqual(lob.checkPdf(pdf).pages, 1, which);
    }
  });

test('the zone check catches a QR anywhere in the 7.2in to 7.9in fold band, and anything in the address box', () => {
  const page = qrTop => ({ height: 11, boxes: [
    { el: 'P.greeting', b: [0.85, 3, 3, 3.2] },
    ...Array.from({ length: 15 }, (_, k) => ({ el: 'P.', b: [0.85, 3.3 + k * 0.1, 7.7, 3.35 + k * 0.1] })),
    { el: 'IMG.qr', b: [0.85, qrTop, 1.85, qrTop + 1] }] });
  assert.deepStrictEqual(layout.problems(page(5.9)), [], 'bottom at 6.9in is clear');
  for (const top of [6.2, 6.5, 6.9, 7.3, 7.95]) {
    assert.ok(layout.problems(page(top)).some(p => /fold at 7\.2-7\.9in/.test(p)), 'a QR from ' + top + 'in to ' + (top + 1) + 'in is caught');
  }
  assert.deepStrictEqual(layout.problems(page(8.05)), [], 'wholly below the band is clear too');
  assert.ok(layout.problems(page(3)).some(p => /fold at 3\.75in/.test(p)));
  const p = page(5.9);
  p.boxes.push({ el: 'P.bizaddr', b: [1, 1, 3, 1.3] });
  assert.ok(layout.problems(p).some(x => /address box/.test(x)));
  assert.ok(layout.problems({ ...page(5.9), height: 11.2 }).some(x => /two pages/.test(x)));
});

test('the letterhead carries the mailbox, one envelope line at a time, and no placeholder', () => {
  const html = inventedLetter('data:image/png;base64,');
  assert.match(html, /<p class="bizaddr">COWIE\.AI LLC<br>601 Kingston Rd, Ste 300 #1016<br>Benton, LA 71006<\/p>/);
  assert.doesNotThrow(() => lob.assertNoPlaceholder(html));
});

test('the letter turns ligatures off, so "fi" and "fl" copy out as plain letters', () => {
  assert.match(pageCss(''), /body \{[^}]*font-variant-ligatures: none;/);
});

test('the template keeps the approved wording', () => {
  const html = inventedLetter('data:image/png;base64,');
  for (const line of [
    "When you're on a job and the phone rings, you can't always get to it. Most people who get voicemail don't leave a message. They call the next roofer.",
    "I'm Steven, here in Bossier City. I set up a simple fix for that.",
    'You can try it on me. Call the number at the bottom of this letter, and if I can\'t pick up, you\'ll get the text yourself.',
    "I made a page for you showing what I found and how it would work. Point your phone's camera at the code, or type in the address:",
    "$79 a month covers three things: the missed-call text, a text asking your customers for a review, and a simple website that works on a phone, registered in your name.",
    "If it's not for you, no hard feelings. If it is, text me.",
    'Sent to the mailing address on your state contractor license.'
  ]) assert.ok(html.replace(/&amp;/g, '&').includes(line), line);
});

test('with no website finding, the letter has no website paragraph and the shorter line, with the same camera instruction', () => {
  const html = inventedNoFinding('data:image/png;base64,').replace(/&amp;/g, '&');
  assert.ok(html.includes("I made a page for you showing how it would work. Point your phone's camera at the code, or type in the address:"));
  assert.ok(!html.includes('what I found'));
  assert.ok(!/I also |I found /.test(html), 'no website paragraph');
});
