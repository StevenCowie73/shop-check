'use strict';

/* Measures every rendered letter against Lob's page one: nothing in the
   address area, the envelope windows, the barcode corner or the clear
   space; the QR clear of both folds, the lower one anywhere from 7.2in to
   7.9in; one page each. The rules are lib/lob-layout.js, the same ones
   tests/lob.test.js applies to an invented letter.

   Run after step 10, with step 17:  npm run pilot:zones

   It prints reference codes, never company names, so its output can be
   pasted anywhere. */

const fs = require('fs');
const P = require('./lib/paths.js');
const layout = require('../../lib/lob-layout.js');
const { findChrome } = require('./10-render-letters.js');

function main() {
  for (const file of [P.lettersHtml, P.lettersTable]) {
    if (!fs.existsSync(file)) throw new Error('missing ' + file + ' — run npm run pilot:letters first');
  }
  const chrome = findChrome();
  if (!chrome) throw new Error('no chromium found — set PILOT_CHROME to a chrome binary');

  const table = JSON.parse(fs.readFileSync(P.lettersTable, 'utf8'));
  const pages = layout.measure(fs.readFileSync(P.lettersHtml, 'utf8'), chrome);
  console.log('letters expected: ' + table.length);
  console.log('pages measured:   ' + pages.length);

  const failed = [];
  if (pages.length !== table.length) failed.push(pages.length + ' pages for ' + table.length + ' letters');
  pages.forEach((page, i) => {
    const ref = table[i] ? table[i].ref : '?';
    const qr = page.boxes.find(x => x.el === 'IMG.qr');
    const wrong = layout.problems(page);
    console.log('  ' + String(i + 1).padStart(2) + '  ' + (wrong.length ? 'WRONG ' : 'ok    ') + ref.padEnd(10) +
      'QR ' + (qr ? qr.b[1].toFixed(2) + '-' + qr.b[3].toFixed(2) + 'in' : 'missing') + '  height ' + page.height + 'in');
    for (const w of wrong) { console.log('        ' + w); failed.push('letter ' + (i + 1) + ': ' + w); }
  });

  if (failed.length) {
    console.error('\nNOT SAFE TO SEND: ' + failed.length + ' problem(s)');
    process.exit(1);
  }
  console.log('\nevery letter is one page, clear of Lob\'s zones, with its QR clear of both folds.');
}

try { main(); } catch (err) { console.error(err.message); process.exit(1); }
