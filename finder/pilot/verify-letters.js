'use strict';

/* Reads the rendered PDF back and scans every QR code in it.

   Step 10 already decodes each code before embedding it, but that proves the
   PNG was right, not that the right PNG reached the right page. This opens
   the finished file, pulls out every image, decodes it, and checks that the
   codes are the twenty in out/refs.json, one per letter, in rank order.

   It prints reference codes, never company names, so its output can be
   pasted anywhere. */

const fs = require('fs');
const zlib = require('zlib');
const jsQR = require('jsqr');

const P = require('./lib/paths.js');
const { prospectUrl } = require('../../lib/refs.js');

/* Chromium writes each <img> as a FlateDecode image XObject. /ColorSpace is
   usually an indirect reference, so the component count comes from the data
   length rather than from the dictionary. */
function imagesIn(pdf) {
  const latin = pdf.toString('latin1');
  const out = [];
  const re = /<<([^>]*?\/Subtype\s*\/Image[\s\S]*?)>>\s*stream\r?\n/g;
  let m;
  while ((m = re.exec(latin))) {
    const dict = m[1];
    const start = m.index + m[0].length;
    const end = latin.indexOf('endstream', start);
    if (end < 0) continue;
    const width = Number((/\/Width\s+(\d+)/.exec(dict) || [])[1]);
    const height = Number((/\/Height\s+(\d+)/.exec(dict) || [])[1]);
    const bits = Number((/\/BitsPerComponent\s+(\d+)/.exec(dict) || [])[1]);
    const filter = (/\/Filter\s*\/?(\w+)/.exec(dict) || [])[1];
    if (filter !== 'FlateDecode' || bits !== 8 || !width || !height) continue;
    let data;
    try { data = zlib.inflateSync(pdf.slice(start, end)); } catch (err) { continue; }
    const pixels = width * height;
    if (data.length % pixels !== 0) continue;
    const comps = data.length / pixels;
    if (comps !== 1 && comps !== 3 && comps !== 4) continue;
    const rgba = new Uint8ClampedArray(pixels * 4);
    for (let i = 0; i < pixels; i++) {
      const r = data[i * comps];
      const g = comps >= 3 ? data[i * comps + 1] : r;
      const b = comps >= 3 ? data[i * comps + 2] : r;
      rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = b; rgba[i * 4 + 3] = 255;
    }
    const read = jsQR(rgba, width, height);
    out.push({ width, height, text: read ? read.data : null });
  }
  return out;
}

function main() {
  for (const file of [P.lettersPdf, P.lettersTable]) {
    if (!fs.existsSync(file)) throw new Error('missing ' + file + ' — run npm run pilot:letters first');
  }

  const pdf = fs.readFileSync(P.lettersPdf);
  const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  const table = JSON.parse(fs.readFileSync(P.lettersTable, 'utf8'));
  const expected = table.map(r => prospectUrl(r.ref, 'letter'));

  const images = imagesIn(pdf);
  const unreadable = images.filter(i => i.text === null);
  const read = images.filter(i => i.text !== null).map(i => i.text);

  console.log('pages:            ' + pages);
  console.log('letters expected: ' + table.length);
  console.log('images found:     ' + images.length);
  console.log('codes read:       ' + read.length);

  read.forEach((text, i) => {
    const ok = text === expected[i];
    console.log('  ' + String(i + 1).padStart(2) + '  ' + (ok ? 'ok  ' : 'WRONG ') + text);
  });

  const problems = [];
  if (pages !== table.length) problems.push(pages + ' pages for ' + table.length + ' letters');
  if (unreadable.length) problems.push(unreadable.length + ' image(s) would not scan');
  if (read.length !== expected.length) problems.push(read.length + ' codes for ' + expected.length + ' letters');
  for (let i = 0; i < Math.min(read.length, expected.length); i++) {
    if (read[i] !== expected[i]) problems.push('letter ' + (i + 1) + ' carries ' + read[i]);
  }
  if (new Set(read).size !== read.length) problems.push('two letters carry the same code');

  if (problems.length) {
    console.error('\nNOT SAFE TO PRINT:');
    for (const p of problems) console.error('  - ' + p);
    process.exit(1);
  }
  console.log('\nevery letter carries its own code, and every code scans.');
}

main();
