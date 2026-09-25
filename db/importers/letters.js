'use strict';

/* Rendered letters → letters.

   finder/pilot/10-render-letters.js writes out/letters/letters.html (one
   <section class="page"> per letter, in order) and out/letters/table.json
   (one row per letter, same order, carrying the ref). They are paired by
   position, and a count mismatch stops the import rather than attaching a
   letter to the wrong company.

     node db/importers/letters.js [--sent 2026-10-01] [--run ID] --confirm

   A mock run (a test of the engine on a new area, rendered with a
   placeholder code and never to be sent) has no table.json. Pass --mock and
   --spine instead: the table is the shortlist's top twenty in rank order,
   each page must name its own business or nothing is imported, and every
   letter is stored as "mock", which nothing ever sends.

     node db/importers/letters.js --mock --html out/area/mock-letters.html \
       --spine out/area/spine.json --run area-mock --confirm */

const fs = require('fs');
const { readJson, args, cliStore } = require('./common.js');

function splitLetters(html) {
  const style = (/<style>[\s\S]*?<\/style>/.exec(html) || [''])[0];
  const pages = html.split(/(?=<section class="page">)/).slice(1).map(s => s.replace(/<\/body>[\s\S]*$/, ''));
  return pages.map(page => '<!doctype html><html><head><meta charset="utf-8">' + style + '</head><body>' + page + '</body></html>');
}

/* The table for a mock run: the shortlist's top twenty, with each row's id
   worked out exactly as the pilot importer does. */
function tableFromShortlist(spine, refs = {}) {
  const { recordsOf, idOf } = require('./pilot.js');
  const { businessName } = require('../../finder/pilot/lib/names.js');
  const byCompany = new Map(recordsOf(spine).map((r, i) => [r.company, { r, i }]));
  return spine.pilotShortlist.rows.filter(r => r.top20 && !r.excluded).sort((a, b) => a.rank - b.rank).map(row => {
    const hit = byCompany.get(row.company);
    if (!hit) throw new Error('rank ' + row.rank + ' is not in the records; not importing.');
    return { rank: row.rank, ref: idOf(hit.r, refs, hit.i), biz: businessName(row.company) };
  });
}

const escHtml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function importLetters({ html, table, store, sentAt = null, runId = null, mock = false }) {
  if (mock && sentAt) throw new Error('a mock letter is never sent; not importing.');
  const pages = splitLetters(html);
  if (pages.length !== table.length) throw new Error(pages.length + ' letters but ' + table.length + ' table rows; not importing.');
  /* Paired by position, so prove the pairing: each page names its own business. */
  for (let i = 0; i < table.length; i++) {
    if (table[i].biz && !pages[i].includes(escHtml(table[i].biz))) {
      throw new Error('letter ' + (i + 1) + ' does not name the business in row ' + (i + 1) + '; not importing.');
    }
  }
  for (let i = 0; i < table.length; i++) {
    await store.addLetter(table[i].ref, { state: mock ? 'mock' : sentAt ? 'sent' : 'draft', sentAt, html: pages[i], runId });
    if (sentAt) await store.addEvent({ prospectId: table[i].ref, runId, kind: 'letter_sent', at: sentAt, detail: {}, source: 'letters' });
  }
  return { letters: pages.length };
}

module.exports = { importLetters, splitLetters, tableFromShortlist };

if (require.main === module) {
  (async () => {
    const o = args(process.argv.slice(2));
    const P = require('../../finder/pilot/lib/paths.js');
    const table = o.mock ? tableFromShortlist(readJson(o.spine || P.spine), fs.existsSync(o.refs || P.refs) ? readJson(o.refs || P.refs) : {})
      : readJson(o.table || P.lettersTable);
    const store = await cliStore(o);
    const r = await importLetters({ html: fs.readFileSync(o.html || P.lettersHtml, 'utf8'), table,
      store, sentAt: o.sent ? new Date(o.sent).toISOString() : null, runId: o.run || null, mock: !!o.mock });
    console.log('imported ' + r.letters + ' letters');
    process.exit(0);
  })().catch(e => { console.error(e.message); process.exit(1); });
}
