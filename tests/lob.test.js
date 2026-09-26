'use strict';

/* The Lob sender, with Lob mocked (no request ever leaves), and the letter
   template measured against Lob's page-one address area in a real render.
   Every business here is invented. */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

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
  assert.strictEqual(init.headers['Idempotency-Key'], 'coldenjames-letter-7-test');
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
  assert.strictEqual(h.calls[0].init.headers['Idempotency-Key'], 'coldenjames-letter-7-live');
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

/* From Lob's letter template (help.lob.com, letter_template_updated 4_25),
   in inches from the top-left corner: [left, top, right, bottom]. */
const LOB_ZONES = {
  'address box (printed over)': [0.6, 0.84, 3.75, 2.84],
  'top envelope window': [0.625, 0.5, 3.875, 1.375],
  'bottom envelope window': [0.625, 1.708, 4.625, 2.708],
  'barcode box': [0.087, 10.413, 0.587, 10.913],
  'serial number strip': [0.202, 8.748, 0.293, 10.204]
};
const SAFE = 1 / 16;
const FOLDS = [3.75, 7.75];

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

test('nothing on page one lands in Lob\'s address area, windows or barcode corner; the QR clears the folds; it is one page',
  { skip: chrome ? false : 'no Chromium on this machine' }, async () => {
    const { qrDataUri } = require('../lib/qr.js');
    const measure = `<script>
      addEventListener('load', () => {
        const i = v => +(v / 96).toFixed(3);
        const boxes = [...document.querySelectorAll('.page *')].filter(e => e.getClientRects().length && e.tagName !== 'BR')
          .map(e => { const r = e.getBoundingClientRect(); return { el: e.tagName + '.' + (e.getAttribute('class') || ''), b: [i(r.left), i(r.top), i(r.right), i(r.bottom)] }; })
          .filter(x => x.b[2] > x.b[0] && x.b[3] > x.b[1]);
        document.body.setAttribute('data-boxes', JSON.stringify(boxes));
        document.body.setAttribute('data-height', i(document.querySelector('.page').scrollHeight));
      });</script>`;
    const html = '<!doctype html><html><head><meta charset="utf-8"><style>' + pageCss('') + '</style></head><body>' +
      inventedLetter(await qrDataUri('https://coldenjames.com/p/DEMO2026?c=letter')) + measure + '</body></html>';
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lob-layout-'));
    try {
      fs.writeFileSync(path.join(dir, 'l.html'), html);
      const dom = execFileSync(chrome, ['--headless', '--disable-gpu', '--no-sandbox', '--window-size=816,1056',
        '--virtual-time-budget=5000', '--dump-dom', 'file://' + path.join(dir, 'l.html')], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      const attr = name => JSON.parse(/<body[^>]*\sdata-[^>]*>/.exec(dom)[0].match(new RegExp(name + '="([^"]*)"'))[1].replace(/&quot;/g, '"'));
      const boxes = attr('data-boxes');
      assert.ok(boxes.length > 15, 'the page was measured');
      assert.ok(attr('data-height') <= 11, 'one page: the letter is ' + attr('data-height') + 'in tall');
      const hit = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
      for (const { el, b } of boxes) {
        for (const [zone, z] of Object.entries(LOB_ZONES)) assert.ok(!hit(b, z), el + ' ' + JSON.stringify(b) + ' is in the ' + zone);
        assert.ok(b[0] >= SAFE && b[1] >= SAFE && b[2] <= 8.5 - SAFE && b[3] <= 11 - SAFE, el + ' is outside the 1/16in clear space');
      }
      const qr = boxes.find(x => x.el === 'IMG.qr').b;
      for (const f of FOLDS) assert.ok(qr[3] < f - 0.1 || qr[1] > f + 0.1, 'the QR ' + JSON.stringify(qr) + ' crosses the fold at ' + f + 'in');
      assert.ok(boxes.some(x => x.el === 'P.greeting' && x.b[1] >= 2.84), 'the letter starts below the address area');

      const pdf = require('../lib/letter-pdf.js').renderLetterPdf(html, { chrome });
      assert.deepStrictEqual(lob.checkPdf(pdf).pages, 1);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

test('the letterhead carries the mailbox, one envelope line at a time, and no placeholder', () => {
  const html = inventedLetter('data:image/png;base64,');
  assert.match(html, /<p class="bizaddr">COWIE\.AI LLC<br>601 Kingston Rd, Ste 300 #1016<br>Benton, LA 71006<\/p>/);
  assert.doesNotThrow(() => lob.assertNoPlaceholder(html));
});

test('the template keeps the approved wording', () => {
  const html = inventedLetter('data:image/png;base64,');
  for (const line of [
    "When you're on a job and the phone rings, you can't always get to it. Most people who get voicemail don't leave a message. They call the next roofer.",
    "I'm Steven, here in Bossier City. I set up a simple fix for that.",
    'You can try it on me. Call the number at the bottom of this letter, and if I can\'t pick up, you\'ll get the text yourself.',
    'I made a page for you showing what I found and how it would work:',
    "$79 a month covers three things: the missed-call text, a text asking your customers for a review, and a simple website that works on a phone, registered in your name.",
    "If it's not for you, no hard feelings. If it is, text me.",
    'Sent to the mailing address on your state contractor license.'
  ]) assert.ok(html.replace(/&amp;/g, '&').includes(line), line);
});
