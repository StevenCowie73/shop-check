'use strict';

/* Rendered letters → letters.

   finder/pilot/10-render-letters.js writes out/letters/letters.html (one
   <section class="page"> per letter, in order) and out/letters/table.json
   (one row per letter, same order, carrying the ref). They are paired by
   position, and a count mismatch stops the import rather than attaching a
   letter to the wrong company.

     node db/importers/letters.js [--sent 2026-10-01] --confirm */

const fs = require('fs');
const { readJson, args, cliStore } = require('./common.js');

function splitLetters(html) {
  const style = (/<style>[\s\S]*?<\/style>/.exec(html) || [''])[0];
  const pages = html.split(/(?=<section class="page">)/).slice(1).map(s => s.replace(/<\/body>[\s\S]*$/, ''));
  return pages.map(page => '<!doctype html><html><head><meta charset="utf-8">' + style + '</head><body>' + page + '</body></html>');
}

async function importLetters({ html, table, store, sentAt = null, runId = null }) {
  const pages = splitLetters(html);
  if (pages.length !== table.length) throw new Error(pages.length + ' letters but ' + table.length + ' table rows; not importing.');
  for (let i = 0; i < table.length; i++) {
    await store.addLetter(table[i].ref, { state: sentAt ? 'sent' : 'draft', sentAt, html: pages[i], runId });
    if (sentAt) await store.addEvent({ prospectId: table[i].ref, runId, kind: 'letter_sent', at: sentAt, detail: {}, source: 'letters' });
  }
  return { letters: pages.length };
}

module.exports = { importLetters, splitLetters };

if (require.main === module) {
  (async () => {
    const o = args(process.argv.slice(2));
    const P = require('../../finder/pilot/lib/paths.js');
    const store = await cliStore(o);
    const r = await importLetters({ html: fs.readFileSync(o.html || P.lettersHtml, 'utf8'), table: readJson(o.table || P.lettersTable),
      store, sentAt: o.sent ? new Date(o.sent).toISOString() : null, runId: o.run || null });
    console.log('imported ' + r.letters + ' letters');
    process.exit(0);
  })().catch(e => { console.error(e.message); process.exit(1); });
}
