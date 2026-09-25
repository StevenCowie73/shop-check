'use strict';

/* Sends one approved letter through Lob (lib/lob.js).

     node db/lob-send.js --letter 42 [--https] --confirm            test key
     node db/lob-send.js --letter 42 [--https] --live --confirm     real mail

   The key comes from LOB_API_KEY. If a proxy injects it instead, set
   LOB_KEY_MODE to test or live, because this process cannot see it.
   A live key is refused without --live, and --live is refused with a
   test key. Only a letter marked approved (db/letters-approve.js) is sent,
   and never twice. */

const { args, cliPool } = require('./importers/common.js');
const { createPgStore } = require('../lib/explorer/pg-store.js');
const { sendLetter, recipientOf } = require('../lib/lob.js');
const { renderLetterPdf } = require('../lib/letter-pdf.js');
const { BUSINESS } = require('../site/content.js');

if (require.main === module) {
  (async () => {
    const o = args(process.argv.slice(2));
    if (!/^\d+$/.test(String(o.letter || ''))) throw new Error('--letter ID is required (the letters table id).');
    const store = createPgStore(cliPool(o));
    const row = await store.letterForSending(o.letter);
    const letter = row && { ...row, to: recipientOf(row.prospect) };
    const r = await sendLetter({ letter, from: BUSINESS.mailbox, key: process.env.LOB_API_KEY || '',
      declaredMode: process.env.LOB_KEY_MODE || '', live: o.live === true, renderPdf: html => renderLetterPdf(html), store });
    console.log((r.mode === 'live' ? 'MAILED' : 'test send (nothing printed)') + ': letter ' + o.letter + ' → ' + r.lobLetterId +
      ', expected delivery ' + (r.expectedDeliveryDate || 'not given'));
    process.exit(0);
  })().catch(e => { console.error(e.message); process.exit(1); });
}
