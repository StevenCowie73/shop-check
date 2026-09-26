'use strict';

/* Re-importing drafts after a re-render, and taking an approved letter back
   to draft. Every business here is invented. The Postgres store runs on a
   scripted pool: each query is matched by what it does and answered with
   rows, so the test sees exactly which statements a call would run. */

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const { createPgStore, draftReplacement, whyNotUnapprove } = require('../lib/explorer/pg-store.js');
const { createDemoStore } = require('../lib/explorer/demo-store.js');
const { importLetters } = require('../db/importers/letters.js');

function scriptedPool(answer) {
  const sql = [];
  return { sql, async query(text, params) { sql.push({ text: text.replace(/\s+/g, ' ').trim(), params }); return { rows: answer(text, params) || [] }; } };
}

test('a new render replaces the one draft, adds a first letter, and never touches an approved or sent one', () => {
  assert.deepStrictEqual(draftReplacement('KL1', []), {});
  assert.deepStrictEqual(draftReplacement('KL1', [{ id: 7, state: 'draft' }]), { replace: 7 });
  assert.match(draftReplacement('KL1', [{ id: 7, state: 'approved' }]).refuse, /letter 7 for KL1 is approved; only a draft is replaced/);
  assert.match(draftReplacement('KL1', [{ id: 8, state: 'draft' }, { id: 7, state: 'sent' }]).refuse, /letter 7 for KL1 is sent/);
  assert.match(draftReplacement('KL1', [{ id: 8, state: 'draft' }, { id: 7, state: 'draft' }]).refuse, /2 drafts .*8, 7.*not choosing/);
});

test('only an approved letter that has not gone to the post goes back to draft', () => {
  const l = over => ({ id: 3, state: 'approved', sentAt: null, lobLetterId: null, lobMode: null, ...over });
  assert.strictEqual(whyNotUnapprove(l()), null);
  assert.strictEqual(whyNotUnapprove(l({ lobLetterId: 'ltr_test1', lobMode: 'test' })), null, 'a test send does not stop it');
  assert.match(whyNotUnapprove(l({ lobLetterId: 'ltr_live1', lobMode: 'live' })), /live Lob id \(ltr_live1\)/);
  assert.match(whyNotUnapprove(l({ state: 'sent', sentAt: '2026-10-01T00:00:00Z' })), /has been sent/);
  assert.match(whyNotUnapprove(l({ sentAt: '2026-10-01T00:00:00Z' })), /has been sent/);
  assert.match(whyNotUnapprove(l({ state: 'draft' })), /not approved \(state: draft\)/);
  assert.match(whyNotUnapprove(null), /No such letter/);
});

test('pg store: a draft re-import updates the draft row in place and inserts nothing', async () => {
  const pool = scriptedPool(t => /^\s*SELECT id, state FROM letters/.test(t) ? [{ id: 7, state: 'draft' }]
    : /^\s*UPDATE letters SET html/.test(t) ? [{ id: 7 }] : []);
  const r = await createPgStore(pool).addLetter('KL1', { state: 'draft', html: '<p>new</p>', runId: 'run-a' });
  assert.deepStrictEqual(r, { id: 7, replaced: true });
  assert.ok(pool.sql.some(s => /UPDATE letters SET html = \$2 WHERE id = \$1 AND state = 'draft'/.test(s.text)));
  assert.deepStrictEqual(pool.sql.find(s => /UPDATE/.test(s.text)).params, [7, '<p>new</p>']);
  assert.strictEqual(pool.sql.some(s => /INSERT/.test(s.text)), false);
});

test('pg store: a draft re-import refuses over an approved letter, and a first draft is inserted', async () => {
  const approved = scriptedPool(t => /^\s*SELECT id, state FROM letters/.test(t) ? [{ id: 7, state: 'approved' }] : []);
  await assert.rejects(createPgStore(approved).addLetter('KL1', { state: 'draft', html: 'x', runId: 'run-a' }), /letter 7 for KL1 is approved/);
  assert.strictEqual(approved.sql.some(s => /UPDATE|INSERT/.test(s.text)), false);

  const fresh = scriptedPool(() => []);
  await createPgStore(fresh).addLetter('KL1', { state: 'draft', html: 'x', runId: 'run-a' });
  assert.ok(fresh.sql.some(s => /^INSERT INTO letters/.test(s.text)));

  const sent = scriptedPool(() => []);
  await createPgStore(sent).addLetter('KL1', { state: 'sent', html: 'x', runId: 'run-a', sentAt: '2026-10-01T00:00:00Z' });
  assert.strictEqual(sent.sql.some(s => /SELECT id, state FROM letters/.test(s.text)), false, 'sent letters are added as before');
});

test('pg store: un-approving keeps the test Lob id, and a mailed letter is refused before any write', async () => {
  const row = over => ({ id: 1, state: 'approved', sent_at: null, lob_letter_id: 'ltr_test1', lob_mode: 'test', ...over });
  const ok = scriptedPool(t => /^\s*SELECT id, state, sent_at/.test(t) ? [row()]
    : /^\s*UPDATE letters SET state = 'draft'/.test(t) ? [{ id: 1, state: 'draft', lob_letter_id: 'ltr_test1', lob_mode: 'test' }] : []);
  const r = await createPgStore(ok).unapproveLetter(1);
  assert.deepStrictEqual(r, { id: 1, state: 'draft', lob_letter_id: 'ltr_test1', lob_mode: 'test' });
  const upd = ok.sql.find(s => /^UPDATE/.test(s.text)).text;
  assert.match(upd, /SET state = 'draft', approved_at = NULL WHERE/);
  assert.match(upd, /state = 'approved' AND sent_at IS NULL AND lob_mode IS DISTINCT FROM 'live'/);
  assert.doesNotMatch(upd, /lob_letter_id =/, 'the Lob id is left as it is');

  for (const [over, why] of [[{ lob_letter_id: 'ltr_live1', lob_mode: 'live' }, /live Lob id/], [{ state: 'sent', sent_at: '2026-10-01' }, /has been sent/],
    [{ state: 'draft' }, /not approved/]]) {
    const pool = scriptedPool(t => /^\s*SELECT id, state, sent_at/.test(t) ? [row(over)] : []);
    await assert.rejects(createPgStore(pool).unapproveLetter(1), why);
    assert.strictEqual(pool.sql.some(s => /^UPDATE/.test(s.text)), false);
  }
  const raced = scriptedPool(t => /^\s*SELECT id, state, sent_at/.test(t) ? [row()] : []);
  await assert.rejects(createPgStore(raced).unapproveLetter(1), /changed while it was being un-approved/);
});

test('importing drafts again replaces them in place; one approved letter stops the whole import before any write', async () => {
  const seed = { now: '2026-09-26T00:00:00.000Z', areas: [], runs: [], events: [], notes: [],
    prospects: [{ id: 'KL1', company: 'Kestrel Lane Roofing LLC' }, { id: 'MP2', company: 'Marmot Point Builders' }] };
  const store = createDemoStore(seed);
  const table = [{ ref: 'KL1', biz: 'Kestrel Lane Roofing' }, { ref: 'MP2', biz: 'Marmot Point Builders' }];
  const html = head => '<html><head><style>.page{}</style></head><body>' +
    table.map(t => '<section class="page"><p>' + head + '</p><p>' + t.biz + '</p></section>').join('') + '</body></html>';

  assert.deepStrictEqual(await importLetters({ html: html('old letterhead'), table, store, runId: 'run-a' }), { letters: 2, replaced: 0 });
  assert.deepStrictEqual(await importLetters({ html: html('new letterhead'), table, store, runId: 'run-a' }), { letters: 2, replaced: 2 });
  assert.match((await store.letterSource('MP2')).letter.html, /new letterhead/);
  assert.strictEqual((await store.letterSource('MP2')).letter.state, 'draft');

  (await store.letterSource('MP2')).letter.state = 'approved';
  await assert.rejects(importLetters({ html: html('newer still'), table, store, runId: 'run-a' }), /MP2 is approved; only a draft is replaced/);
  assert.match((await store.letterSource('KL1')).letter.html, /new letterhead/, 'the draft before it was not written either');
});

test('letters-unapprove refuses to start without a letter id', () => {
  const { execFileSync } = require('node:child_process');
  let err = null;
  try { execFileSync(process.execPath, [path.join(__dirname, '..', 'db', 'letters-unapprove.js'), '--confirm'], { stdio: 'pipe' }); }
  catch (e) { err = e; }
  assert.ok(err && /--letter ID is required/.test(String(err.stderr)));
});
