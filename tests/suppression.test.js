'use strict';

/* The do-not-contact list. Every business, person, address and number here
   is invented; phones are in 555-01XX, the range kept for fiction. The
   Postgres store runs on a scripted pool, so the tests see exactly which
   statements a call would run and nothing reaches a database. */

const test = require('node:test');
const assert = require('node:assert');

const S = require('../lib/suppression.js');
const { createDemoStore } = require('../lib/explorer/demo-store.js');
const { createPgStore } = require('../lib/explorer/pg-store.js');
const { importLetters } = require('../db/importers/letters.js');
const { optOutsIn, syncTwilio, keysFor } = require('../db/suppression.js');
const lob = require('../lib/lob.js');

function scriptedPool(answer) {
  const sql = [];
  return { sql, async query(text, params) { sql.push({ text: text.replace(/\s+/g, ' ').trim(), params }); return { rows: answer(text.replace(/\s+/g, ' ').trim(), params) || [] }; } };
}

const PHONE_A = '(318) 555-0161', PHONE_B = '318.555.0162', PHONE_C = '+13185550163';
function seed() {
  return { now: '2026-10-01T00:00:00.000Z', areas: [], runs: [], events: [], notes: [], prospects: [
    { id: 'KL1', company: 'Kestrel Lane Roofing LLC', phone: PHONE_A, mailingStreet: '12 Invented Rd.', mailingZip: '71105-1234', doNotContact: false },
    { id: 'MP2', company: 'Marmot Point Builders', phone: PHONE_B, mailingStreet: '12 INVENTED ROAD', mailingZip: '71105', doNotContact: false },
    { id: 'QH3', company: 'Quill Hollow Fencing', phone: '318-555-0164', mailingStreet: '9 Example Ave', mailingZip: '71111', doNotContact: false }
  ] };
}

/* ---------- the keys ---------- */

test('a phone number has one key however it is written; a number that is not a US one has none', () => {
  for (const n of ['(318) 555-0161', '318.555.0161', '+1 318 555 0161', '13185550161', '3185550161']) assert.strictEqual(S.phoneKey(n), '3185550161', n);
  for (const n of ['', null, '555-0161', '0185550161', '+44 20 7946 0958', '318555016']) assert.strictEqual(S.phoneKey(n), null, String(n));
});

test('an address has one key however the register spells it; no street or no ZIP gives none', () => {
  const k = '1325 barksdale blvd ste 105|71111';
  for (const [st, zip] of [['1325 Barksdale Blvd., Suite 105', '71111'], ['1325 BARKSDALE BOULEVARD STE 105', '71111-4600'],
    ['1325 Barksdale Blvd #105', '71111'].map((x, i) => i ? x : x)]) {
    if (st.includes('#')) assert.strictEqual(S.addressKey(st, zip), '1325 barksdale blvd 105|71111', 'a # is just a separator');
    else assert.strictEqual(S.addressKey(st, zip), k, st);
  }
  assert.strictEqual(S.addressKey('P.O. Box 44', '71006'), 'po box 44|71006');
  assert.strictEqual(S.addressKey('Post Office Box 44', '71006'), 'po box 44|71006');
  assert.strictEqual(S.addressKey('12 North Invented Street', '71105'), '12 n invented st|71105');
  assert.strictEqual(S.addressKey('', '71105'), null);
  assert.strictEqual(S.addressKey('12 Invented Rd', ''), null);
  assert.strictEqual(S.addressKey('12 Invented Rd', '7110'), null);
});

test('the refusal every contact step gives', () => {
  assert.strictEqual(S.whyNotContactable({ company: 'Kestrel Lane Roofing', doNotContact: false }), null);
  assert.match(S.whyNotContactable({ company: 'Kestrel Lane Roofing', doNotContact: true }, 'emailed'), /Kestrel Lane Roofing is marked do not contact; it is never emailed/);
  assert.match(S.whyNotContactable(null), /No such business/);
});

/* ---------- the list, in memory ---------- */

test('a STOP from a prospect\'s number marks it, puts its address on the list too, and says so on its timeline', async () => {
  const store = createDemoStore(seed());
  const r = await store.recordOptOut({ from: '+13185550161', word: 'STOP', messageSid: 'SMx1', at: '2026-10-01T10:00:00.000Z' });
  assert.deepStrictEqual(r.matched, ['KL1']);
  const db = store._snapshot();
  const by = id => db.prospects.find(p => p.id === id);
  assert.strictEqual(by('KL1').doNotContact, true);
  assert.strictEqual(by('MP2').doNotContact, true, 'a different number at the same address is the same business');
  assert.strictEqual(by('QH3').doNotContact, false, 'nobody else');
  assert.deepStrictEqual(db.suppressions.map(e => [e.phoneKey, e.addressKey, e.reason]),
    [['3185550161', null, 'stop_text'], [null, '12 invented rd|71105', 'stop_text']]);
  const ev = db.events.filter(e => e.kind === 'do_not_contact');
  assert.deepStrictEqual(ev.map(e => e.prospectId).sort(), ['KL1', 'MP2']);
  const tl = (await store.business('KL1')).timeline.map(e => e.text);
  assert.ok(tl.includes('Marked do not contact: texted STOP'), tl.join(' | '));
  assert.ok((await store.business('MP2')).timeline.some(e => e.text === 'Marked do not contact: texted STOP (phone match)'));
});

test('the same STOP recorded twice adds nothing; a STOP from nobody we know is kept anyway', async () => {
  const store = createDemoStore(seed());
  await store.recordOptOut({ from: '+13185550161', word: 'STOP', messageSid: 'SMx1' });
  const before = store._snapshot();
  const again = await store.recordOptOut({ from: '+13185550161', word: 'STOP', messageSid: 'SMx1' });
  assert.strictEqual(again.already, true);
  assert.deepStrictEqual(store._snapshot().suppressions, before.suppressions);
  assert.strictEqual(store._snapshot().events.length, before.events.length);

  const stranger = await store.recordOptOut({ from: '+13185550199', word: 'UNSUBSCRIBE', messageSid: 'SMx2' });
  assert.deepStrictEqual(stranger.matched, []);
  assert.ok(store._snapshot().suppressions.some(e => e.phoneKey === '3185550199' && e.reason === 'stop_text'));
  assert.deepStrictEqual(await store.recordOptOut({ from: '+442079460958', word: 'STOP' }), { recorded: false, why: 'not a US phone number' });
});

test('the list outlives re-imports and reaches the same business in a later run or another area', async () => {
  const store = createDemoStore(seed());
  await store.recordOptOut({ from: '+13185550199', word: 'STOP', messageSid: 'SMx3' });   /* nobody, yet */
  await store.setDoNotContact('QH3', true);
  /* QH3 re-imported by a new run, with the importer's usual doNotContact false */
  await store.upsertProspect({ id: 'QH3', company: 'Quill Hollow Fencing', phone: '318-555-0164', mailingStreet: '9 Example Ave', mailingZip: '71111', doNotContact: false });
  /* the number that texted STOP turns up on a licence in another area */
  await store.upsertProspect({ id: 'ZZ9', areaId: 'elsewhere', company: 'Heron Gap Electric', phone: '318 555 0199', mailingStreet: '1 Nowhere Ln', mailingZip: '70592' });
  /* the business marked by hand turns up again under a new licence, same address, new number */
  await store.upsertProspect({ id: 'QH4', areaId: 'elsewhere', company: 'Quill Hollow Fence Co', phone: '318-555-0170', mailingStreet: '9 EXAMPLE AVENUE', mailingZip: '71111' });
  await store.upsertProspect({ id: 'NB5', company: 'Newt Bend Painting', phone: '318-555-0171', mailingStreet: '3 Sample St', mailingZip: '71111' });
  assert.deepStrictEqual(await store.doNotContactAmong(['QH3', 'ZZ9', 'QH4', 'NB5', 'KL1']), ['QH3', 'ZZ9', 'QH4']);
});

test('taking a business off by hand needs confirm, keeps the entry as a record, and never undoes a STOP or a deletion request', async () => {
  const store = createDemoStore(seed());
  await store.setDoNotContact('QH3', true);
  assert.match((await store.setDoNotContact('QH3', false)).refused, /explicit confirm/);
  assert.deepStrictEqual(await store.setDoNotContact('QH3', false, { confirm: true }), { id: 'QH3', doNotContact: false });
  assert.ok(store._snapshot().suppressions.every(e => e.revokedAt));
  assert.deepStrictEqual(await store.doNotContactAmong(['QH3']), []);

  await store.suppress({ phoneKey: S.phoneKey(PHONE_B), reason: 'deletion_request', prospectId: 'MP2' });
  assert.match((await store.setDoNotContact('MP2', false, { confirm: true })).refused, /asked for its data to be deleted/);
  await store.recordOptOut({ from: PHONE_A, word: 'STOP' });
  assert.match((await store.setDoNotContact('KL1', false, { confirm: true })).refused, /texted STOP/);
});

/* ---------- letters ---------- */

test('no draft is imported for a business on the list, and nothing at all is written', async () => {
  const store = createDemoStore(seed());
  await store.recordOptOut({ from: PHONE_A, word: 'STOP' });
  const table = [{ ref: 'QH3', biz: 'Quill Hollow Fencing' }, { ref: 'KL1', biz: 'Kestrel Lane Roofing' }];
  const html = '<html><head><style></style></head><body>' + table.map(t => '<section class="page"><p>' + t.biz + '</p></section>').join('') + '</body></html>';
  await assert.rejects(importLetters({ html, table, store, runId: 'run-a' }), /1 of these letters is to a business marked do not contact \(KL1\); not importing/);
  assert.strictEqual(store._snapshot().prospects.find(p => p.id === 'QH3').letter, undefined, 'not even the letter that was fine');
});

test('pg store: approval is refused for a business on the list, before any write, and the UPDATE checks again', async () => {
  const dnc = scriptedPool(t => /^SELECT l\.id, p\.company/.test(t) ? [{ id: 9, company: 'Kestrel Lane Roofing', dnc: true }] : []);
  await assert.rejects(createPgStore(dnc).approveLetter(9), /Letter 9 not approved: Kestrel Lane Roofing is marked do not contact; it is never written to/);
  assert.strictEqual(dnc.sql.some(s => /^UPDATE/.test(s.text)), false);
  assert.match(dnc.sql[0].text, /FROM suppressions s WHERE s\.revoked_at IS NULL/, 'the list, not only the flag');

  const ok = scriptedPool(t => /^SELECT l\.id, p\.company/.test(t) ? [{ id: 9, company: 'Kestrel Lane Roofing', dnc: false }]
    : /^UPDATE letters l SET state = 'approved'/.test(t) ? [{ id: 9, state: 'approved' }] : []);
  assert.deepStrictEqual(await createPgStore(ok).approveLetter(9), { id: 9, state: 'approved' });
  assert.match(ok.sql.find(s => /^UPDATE/.test(s.text)).text, /l\.state = 'draft' AND p\.id = l\.prospect_id AND NOT \(p\.do_not_contact OR EXISTS \(SELECT 1 FROM suppressions/);
});

test('pg store: the letter handed to Lob carries the list\'s answer, and Lob refuses it', async () => {
  const pool = scriptedPool(t => /^SELECT l\.id, l\.prospect_id/.test(t) ? [{ id: 9, prospect_id: 'KL1', state: 'approved', html: '<p>x</p>',
    approved_at: '2026-10-01', do_not_contact: true, company: 'Kestrel Lane Roofing' }] : []);
  const row = await createPgStore(pool).letterForSending(9);
  assert.match(pool.sql[0].text, /\(p\.do_not_contact OR EXISTS \(SELECT 1 FROM suppressions s WHERE s\.revoked_at IS NULL/);
  assert.strictEqual(row.doNotContact, true);
  let called = false;
  await assert.rejects(lob.sendLetter({ letter: { ...row, to: {} }, from: {}, key: 'test_abc', renderPdf: async () => { called = true; },
    fetchImpl: async () => { called = true; }, store: {} }), /marked do not contact/);
  assert.strictEqual(called, false, 'nothing rendered, nothing sent');
});

test('pg store: a re-import writes the keys, arrives do not contact if the list matches, and never clears the flag', async () => {
  const pool = scriptedPool(() => []);
  await createPgStore(pool).upsertProspect({ id: 'KL1', areaId: 'a', company: 'Kestrel Lane Roofing LLC', phone: PHONE_A, mailingStreet: '12 Invented Rd.', mailingZip: '71105' });
  const s = pool.sql[0];
  assert.deepStrictEqual(s.params.slice(-2), ['3185550161', '12 invented rd|71105']);
  assert.match(s.text, /EXISTS \(SELECT 1 FROM suppressions s WHERE s\.revoked_at IS NULL AND \(\(s\.phone_key IS NOT NULL AND s\.phone_key = \$23::text\)/);
  assert.match(s.text, /do_not_contact = prospects\.do_not_contact OR EXCLUDED\.do_not_contact/);
});

test('pg store: an entry is added once, marks every match, and tells each newly marked timeline', async () => {
  const pool = scriptedPool(t => /^INSERT INTO suppressions/.test(t) ? [{ id: 1 }]
    : /^UPDATE prospects SET do_not_contact = true/.test(t) ? [{ id: 'KL1' }, { id: 'MP2' }] : []);
  const r = await createPgStore(pool).suppress({ phoneKey: '3185550161', reason: 'stop_text', sourceRef: 'SMx9', prospectId: 'KL1', detail: { word: 'STOP' } });
  assert.deepStrictEqual(r, { added: true, id: 1, marked: ['KL1', 'MP2'] });
  assert.match(pool.sql[0].text, /ON CONFLICT \(source_ref\) DO NOTHING/);
  assert.strictEqual(pool.sql.filter(s => /^INSERT INTO events/.test(s.text)).length, 2);

  const dup = scriptedPool(() => []);
  assert.deepStrictEqual(await createPgStore(dup).suppress({ phoneKey: '3185550161', reason: 'stop_text', sourceRef: 'SMx9' }), { added: false, marked: [] });
  assert.strictEqual(dup.sql.length, 1, 'a repeat writes nothing more');
  await assert.rejects(createPgStore(dup).suppress({ reason: 'by_hand' }), /needs a phone number or a mailing address/);
});

test('pg store: taking one off needs confirm and refuses a STOP before any write', async () => {
  const p = { id: 'KL1', company: 'Kestrel Lane Roofing', phone: PHONE_A, mailing_street: '12 Invented Rd', mailing_zip: '71105' };
  const held = scriptedPool(t => /^SELECT id, company, phone/.test(t) ? [p] : /^SELECT reason FROM suppressions/.test(t) ? [{ reason: 'stop_text' }] : []);
  assert.match((await createPgStore(held).setDoNotContact('KL1', false)).refused, /explicit confirm/);
  assert.match((await createPgStore(held).setDoNotContact('KL1', false, { confirm: true })).refused, /texted STOP/);
  assert.strictEqual(held.sql.some(s => /^UPDATE/.test(s.text)), false);

  const free = scriptedPool(t => /^SELECT id, company, phone/.test(t) ? [p] : []);
  assert.deepStrictEqual(await createPgStore(free).setDoNotContact('KL1', false, { confirm: true }), { id: 'KL1', doNotContact: false });
  assert.ok(free.sql.some(s => /^UPDATE suppressions SET revoked_at = now\(\) WHERE revoked_at IS NULL AND reason = 'by_hand'/.test(s.text)));
  assert.ok(free.sql.some(s => /^INSERT INTO events.*'do_not_contact_undone'/.test(s.text)));
});

/* ---------- catching up from Twilio's log ---------- */

test('the Twilio catch-up finds every opt-out sent to the business number, not the owner\'s, and records each once', async () => {
  const BUSINESS = '+13185550103', OWNER = '+13185550101';
  const msg = (sid, from, body, to = BUSINESS) => ({ sid, from, to, body, date_sent: '2026-10-01T0' + sid.slice(-1) + ':00:00Z' });
  const messages = [msg('SM1', PHONE_C, 'Stop'), msg('SM2', '+13185550188', 'Thanks, call me Monday'), msg('SM3', OWNER, 'STOP'),
    msg('SM4', '+13185550199', 'quit'), msg('SM5', BUSINESS, 'STOP', PHONE_C)];
  assert.deepStrictEqual(optOutsIn(messages, BUSINESS, OWNER).map(o => [o.messageSid, o.word]), [['SM1', 'STOP'], ['SM4', 'QUIT']]);
  const store = createDemoStore({ ...seed(), prospects: seed().prospects.map(p => p.id === 'QH3' ? { ...p, phone: PHONE_C } : p) });
  const first = await syncTwilio({ store, messages, businessNumber: BUSINESS, ownerCell: OWNER });
  assert.deepStrictEqual([first.optOuts, first.newlyRecorded, first.alreadyRecorded, first.matchedProspects], [2, 2, 0, 1]);
  assert.ok(first.numbers.every(n => /^…\d{4} /.test(n)), 'last four digits only: ' + first.numbers.join(', '));
  const second = await syncTwilio({ store, messages, businessNumber: BUSINESS, ownerCell: OWNER });
  assert.deepStrictEqual([second.newlyRecorded, second.alreadyRecorded], [0, 2]);
  assert.deepStrictEqual(await store.doNotContactAmong(['QH3', 'KL1']), ['QH3']);
});

test('backfill keys every prospect it can', () => {
  assert.deepStrictEqual(keysFor([{ id: 'KL1', phone: PHONE_A, mailing_street: '12 Invented Rd', mailing_zip: '71105' }, { id: 'X', phone: '', mailing_street: '', mailing_zip: '' }]),
    { ids: ['KL1', 'X'], phones: ['3185550161', null], addresses: ['12 invented rd|71105', null] });
});
