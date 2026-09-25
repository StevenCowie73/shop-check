'use strict';

/* Marks one drafted letter approved, after a person has read it. Only an
   approved letter can be sent (lib/lob.js). Mock letters and letters
   already sent cannot be approved.

     node db/letters-approve.js --letter 42 [--https] --confirm */

const { args, cliPool } = require('./importers/common.js');
const { createPgStore } = require('../lib/explorer/pg-store.js');

if (require.main === module) {
  (async () => {
    const o = args(process.argv.slice(2));
    if (!/^\d+$/.test(String(o.letter || ''))) throw new Error('--letter ID is required (the letters table id).');
    const r = await createPgStore(cliPool(o)).approveLetter(o.letter);
    if (!r) throw new Error('Letter ' + o.letter + ' is not a draft; nothing approved.');
    console.log('approved letter ' + r.id + ' at ' + new Date(r.approved_at).toISOString());
    process.exit(0);
  })().catch(e => { console.error(e.message); process.exit(1); });
}
