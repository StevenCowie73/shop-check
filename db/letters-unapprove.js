'use strict';

/* Takes one approved letter back to draft (db/letters-approve.js undone),
   so it can be read again or replaced by a new render. Refused once the
   letter has gone to the post: a live Lob id, or a sent date. A test send's
   Lob id stays on the letter, as the record of that test.

     node db/letters-unapprove.js --letter 42 [--https] --confirm */

const { args, cliPool } = require('./importers/common.js');
const { createPgStore } = require('../lib/explorer/pg-store.js');

if (require.main === module) {
  (async () => {
    const o = args(process.argv.slice(2));
    if (!/^\d+$/.test(String(o.letter || ''))) throw new Error('--letter ID is required (the letters table id).');
    const r = await createPgStore(cliPool(o)).unapproveLetter(o.letter);
    console.log('letter ' + r.id + ' is a draft again' + (r.lob_letter_id ? ' (keeps its ' + r.lob_mode + ' Lob id ' + r.lob_letter_id + ')' : ''));
    process.exit(0);
  })().catch(e => { console.error(e.message); process.exit(1); });
}
