'use strict';

/* Where nothing of ours may print on page one of a Lob letter, and the
   check that measures a real render against it.

   One copy, used twice: tests/lob.test.js measures an invented worst-case
   letter, and finder/pilot/check-zones.js measures every rendered pilot
   letter. A rule changed here changes both.

   From Lob's letter template (help.lob.com, letter_template_updated 4_25),
   in inches from the top-left corner: [left, top, right, bottom]. */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const LOB_ZONES = {
  'address box (printed over)': [0.6, 0.84, 3.75, 2.84],
  'top envelope window': [0.625, 0.5, 3.875, 1.375],
  'bottom envelope window': [0.625, 1.708, 4.625, 2.708],
  'barcode box': [0.087, 10.413, 0.587, 10.913],
  'serial number strip': [0.202, 8.748, 0.293, 10.204]
};
const SAFE = 1 / 16;

/* The folds the QR must stay clear of, as bands, with FOLD_MARGIN either
   side. Lob's C-fold is nominally at 3.75in and 7.75in, but the lower
   fold is not reliably there, so the QR keeps clear of it anywhere from
   7.2in to 7.9in. */
const FOLDS = [[3.75, 3.75], [7.2, 7.9]];
const FOLD_MARGIN = 0.1;

/* Runs in the page: every visible element's box, in inches, relative to
   the .page it is on. */
const MEASURE_SCRIPT = `<script>
  addEventListener('load', () => {
    const i = v => +(v / 96).toFixed(3);
    const pages = [...document.querySelectorAll('.page')].map(page => {
      const o = page.getBoundingClientRect();
      const boxes = [...page.querySelectorAll('*')].filter(e => e.getClientRects().length && e.tagName !== 'BR')
        .map(e => { const r = e.getBoundingClientRect();
          return { el: e.tagName + '.' + (e.getAttribute('class') || ''), b: [i(r.left - o.left), i(r.top - o.top), i(r.right - o.left), i(r.bottom - o.top)] }; })
        .filter(x => x.b[2] > x.b[0] && x.b[3] > x.b[1]);
      return { height: i(page.scrollHeight), boxes };
    });
    document.body.setAttribute('data-pages', JSON.stringify(pages));
  });</script>`;

/* Opens the HTML in Chromium and returns one { height, boxes } per page. */
function measure(html, chrome) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lob-layout-'));
  try {
    const file = path.join(dir, 'l.html');
    fs.writeFileSync(file, html.replace(/<\/body>/, MEASURE_SCRIPT + '</body>'));
    const dom = execFileSync(chrome, ['--headless', '--disable-gpu', '--no-sandbox', '--window-size=816,1056',
      '--virtual-time-budget=12000', '--dump-dom', 'file://' + file],
      { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
    const tag = /<body[^>]*\sdata-pages="([^"]*)"/.exec(dom);
    if (!tag) throw new Error('the page was not measured');
    return JSON.parse(tag[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const hit = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

/* Everything wrong with one measured page, as sentences; empty when it is
   fit to send. */
function problems({ height, boxes }) {
  const out = [];
  if (boxes.length < 15) out.push('only ' + boxes.length + ' elements measured');
  if (height > 11) out.push('two pages: the letter is ' + height + 'in tall');
  for (const { el, b } of boxes) {
    for (const [zone, z] of Object.entries(LOB_ZONES)) if (hit(b, z)) out.push(el + ' ' + JSON.stringify(b) + ' is in the ' + zone);
    if (!(b[0] >= SAFE && b[1] >= SAFE && b[2] <= 8.5 - SAFE && b[3] <= 11 - SAFE)) out.push(el + ' ' + JSON.stringify(b) + ' is outside the 1/16in clear space');
  }
  const qr = boxes.find(x => x.el === 'IMG.qr');
  if (!qr) out.push('no QR on the page');
  else {
    for (const [from, to] of FOLDS) {
      if (!(qr.b[3] < from - FOLD_MARGIN || qr.b[1] > to + FOLD_MARGIN)) {
        out.push('the QR ' + JSON.stringify(qr.b) + ' is within ' + FOLD_MARGIN + 'in of a fold at ' + (from === to ? from : from + '-' + to) + 'in');
      }
    }
  }
  if (!boxes.some(x => x.el === 'P.greeting' && x.b[1] >= 2.84)) out.push('the letter does not start below the address area');
  return out;
}

module.exports = { LOB_ZONES, SAFE, FOLDS, FOLD_MARGIN, MEASURE_SCRIPT, measure, problems };
