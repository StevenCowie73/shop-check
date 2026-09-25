'use strict';

/* One letter's stored HTML → a PDF, with the same Chromium and the same
   flags the pilot renders with (finder/pilot/10-render-letters.js). Used
   to hand Lob exactly the page that was approved. */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

function renderLetterPdf(html, { chrome } = {}) {
  const exe = chrome || require('../finder/pilot/10-render-letters.js').findChrome();
  if (!exe) throw new Error('No Chromium found: set PILOT_CHROME to a chrome binary.');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coldenjames-letter-'));
  try {
    const src = path.join(dir, 'letter.html'), out = path.join(dir, 'letter.pdf');
    fs.writeFileSync(src, html);
    execFileSync(exe, ['--headless', '--disable-gpu', '--no-sandbox', '--no-pdf-header-footer',
      '--print-to-pdf=' + out, '--virtual-time-budget=12000', 'file://' + src], { stdio: 'pipe' });
    return fs.readFileSync(out);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = { renderLetterPdf };
