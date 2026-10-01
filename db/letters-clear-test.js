'use strict';

/* Clears a draft's test Lob id, so a letter re-rendered since its test
   send no longer points at a proof of the old version. Only a draft with a
   test id; a live id is the record of real mail and is never cleared.

     node db/letters-clear-test.js --letter 42 [--https] --confirm */

const { args, cliPool } = require('./importers/common.js');
const { createPgStore } = require('../lib/explorer/pg-store.js');

if (require.main === module) {
  (async () => {
    const o = args(process.argv.slice(2));
    if (!/^\d+$/.test(String(o.letter || ''))) throw new Error('--letter ID is required (the letters table id).');
    const r = await createPgStore(cliPool(o)).clearTestLob(o.letter);
    console.log('letter ' + r.id + ' no longer carries test Lob id ' + r.cleared);
    process.exit(0);
  })().catch(e => { console.error(e.message); process.exit(1); });
}
