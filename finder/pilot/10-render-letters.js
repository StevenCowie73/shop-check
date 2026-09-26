'use strict';

/* Step 10. Renders the top twenty as one PDF, one US Letter page per letter.

   Each company gets a reference code from lib/refs.js — issued once, kept in
   out/refs.json and never reissued — and the QR on its letter is a real code
   pointing at coldenjames.com/p/REF?c=letter. Every code is decoded from the
   image before it is embedded, so a letter cannot go out carrying a QR that
   does not scan.

   The letterhead address is the business mailbox from site/content.js, the
   same one Lob prints as the return address. With no address there it
   falls back to a literal [MAILING ADDRESS], and a letter carrying that
   cannot be mailed (lib/lob.js).
   The phone number is the one the website shows, from site/content.js.

   The fill rules are the point of this file. What a letter may say about
   somebody's website depends entirely on what we actually established:
   a state of "unknown" or "not found" produces no claim at all, and a
   website we never fetched can never become a complaint. */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const P = require('./lib/paths.js');
const { businessName, firstName, tradeNoun } = require('./lib/names.js');
const { assign } = require('./lib/refs.js');
const { qrDataUri } = require('../../lib/qr.js');
const { prospectUrl } = require('../../lib/refs.js');
/* The texting disclosure under the number is the same line the /sms page
   quotes as "what the letter says", so both read it from one place. */
const { LETTER_SMS_LINE } = require('../../lib/texting-copy.js');
/* Where the letter says Steven is: "Bossier City" for the pilot parishes,
   exactly as before, and "Louisiana" anywhere else (lib/area.js). */
const { hereIn } = require('./lib/area.js');

/* The letterhead: the ColdenJames wordmark, drawn as outlines so it prints
   the same whatever fonts the renderer has. */
const { WORDMARK } = require('../../site/brand-svg.js');
/* One number everywhere: the site, the prospect page and the letter. */
const PHONE = require('../../site/content.js').BUSINESS.phone;
/* The letterhead address, one line per envelope line: company, street,
   town. The placeholder only if content.js has no address; lib/lob.js
   refuses to mail a letter that still carries a [PLACEHOLDER]. */
const { BUSINESS } = require('../../site/content.js');
const MAILING_LINES = BUSINESS.mailingAddress ? BUSINESS.mailingLines : ['[MAILING ADDRESS]'];

/* IBM Plex Sans as static files, one per weight, from the Fontsource
   package (OFL). Google Fonts now serves Plex as a single variable font,
   and Chromium writes a variable font into a PDF as Type 3 glyphs, which a
   print shop's preflight flags; static files embed as ordinary TrueType. */
const FONT_BASE = 'https://cdn.jsdelivr.net/npm/@fontsource/ibm-plex-sans@5/files/';
const FONT_WEIGHTS = [400, 500, 600];
const FONT_SUBSETS = {
  'latin-ext': 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF',
  latin: 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD'
};

/* ---------- the website paragraph ---------- */
/* The wording lives in lib/website-finding.js because the prospect page has
   to say exactly the same thing about the same business. */
const { websiteFinding } = require('../../lib/website-finding.js');

function websiteParagraph(rec, row) {
  return websiteFinding(row.websiteState, rec.websiteAudit);
}

/* ---------- fonts ---------- */
/* Fetched once into out/, never committed. A cache from before the switch
   to static files (one variable font per subset) is replaced. */
function ensureFonts() {
  if (fs.existsSync(P.fontCss) && fs.readFileSync(P.fontCss, 'utf8').includes('fontsource-static')) return;
  fs.mkdirSync(P.fontsDir, { recursive: true });
  console.log('fetching IBM Plex Sans (once) ...');
  let css = '/* fontsource-static: IBM Plex Sans, OFL */\n';
  for (const w of FONT_WEIGHTS) {
    for (const [subset, range] of Object.entries(FONT_SUBSETS)) {
      const name = 'plex-' + subset + '-' + w + '.woff2';
      execFileSync('curl', ['-sSf', '--max-time', '60', FONT_BASE + 'ibm-plex-sans-' + subset + '-' + w + '-normal.woff2',
        '-o', path.join(P.fontsDir, name)]);
      css += `@font-face { font-family: "IBM Plex Sans"; font-style: normal; font-weight: ${w}; font-display: block; ` +
        `src: url(fonts/${name}) format("woff2"); unicode-range: ${range}; }\n`;
    }
  }
  fs.writeFileSync(P.fontCss, css);
  console.log('  ' + FONT_WEIGHTS.length * Object.keys(FONT_SUBSETS).length + ' font files cached in ' + P.fontsDir);
}

/* The font CSS with every font file inlined as a data URI. Each letter's
   HTML is stored on its own (db/importers/letters.js) and rendered again to
   a PDF for Lob (lib/lob.js), far from out/letters/fonts; with relative
   URLs it would quietly print in a fallback face. */
function inlineFonts(css, dir = path.dirname(P.fontCss)) {
  return css.replace(/url\((['"]?)(fonts\/[^'")]+\.woff2)\1\)/g, (m, q, rel) =>
    'url(data:font/woff2;base64,' + fs.readFileSync(path.join(dir, rel)).toString('base64') + ')');
}

/* ---------- chromium ---------- */
function findChrome() {
  if (process.env.PILOT_CHROME) return process.env.PILOT_CHROME;
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, '/opt/pw-browsers'].filter(Boolean);
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const dir of fs.readdirSync(root)) {
      const exe = path.join(root, dir, 'chrome-linux', 'chrome');
      if (fs.existsSync(exe)) return exe;
    }
  }
  for (const exe of ['/usr/bin/chromium', '/usr/bin/chromium-browser',
                     '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable']) {
    if (fs.existsSync(exe)) return exe;
  }
  return null;
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function letterHtml(row, rec, code) {
  const biz = businessName(row.company);
  const first = firstName(rec.qualifyingParties[0]);
  const greeting = first ? `${first} —` : `To the owner of ${biz} —`;
  const trade = tradeNoun(row.company);
  const website = websiteParagraph(rec, row);
  const pageLine = website.text
    ? 'I made a page for you showing what I found and how it would work:'
    : 'I made a page for you showing how it would work:';
  const date = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const html = `<section class="page">
  <header class="head">
    <div class="bizname">${WORDMARK}</div>
    <p class="bizaddr">${MAILING_LINES.map(esc).join('<br>')}</p>
    <div class="rule"></div>
    <p class="date">${esc(date)}</p>
  </header>
  <p class="greeting">${esc(greeting)}</p>
  <p>When you're on a job and the phone rings, you can't always get to it. Most people who get voicemail don't leave a message. They call the next ${esc(trade.noun)}.</p>
  <p>I'm Steven, here in ${esc(hereIn(rec))}. I set up a simple fix for that. When you miss a call, the caller gets a text from ${esc(biz)} straight away, so they know you'll get back to them. You reply when you're off the job.</p>
  <p>You can try it on me. Call the number at the bottom of this letter, and if I can't pick up, you'll get the text yourself.</p>
  ${website.text ? `<p>${esc(website.text)}</p>` : ''}
  <p>${esc(pageLine)}</p>
  <div class="qrblock">
    <img class="qr" src="${code.image}" alt="">
    <p class="url">${esc(code.printed)}</p>
  </div>
  <p>$79 a month covers three things: the missed-call text, a text asking your customers for a review, and a simple website that works on a phone, registered in your name. The first month is free, there's no contract, and you can cancel with a text. I do the setup. The one thing you'd do is change a setting on your phone, and I'll walk you through it.</p>
  <p>If it's not for you, no hard feelings. If it is, text me.</p>
  <p class="sig">Steven Cowie<br>${esc(PHONE)}</p>
  <p class="smsnote">${esc(LETTER_SMS_LINE)}</p>
  <p class="foot">Sent to the mailing address on your state contractor license.<br>Text STOP to the number above and you won't hear from me again.</p>
</section>`;

  return {
    html,
    row: {
      rank: row.rank, company: row.company, biz, greeting,
      ref: code.ref, url: code.url,
      trade: trade.noun, tradeFrom: trade.from,
      paragraph: website.which,
      emailUsable: row.emailUsable === true,
      websiteState: row.websiteState
    }
  };
}

function pageCss(fontCss) {
  return `${fontCss}
@page { size: Letter; margin: 0; }
html, body { margin: 0; padding: 0; background: #fff; }
body {
  font-family: "IBM Plex Sans", system-ui, sans-serif;
  color: #1C1917;
  font-size: 11.5pt;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}
/* Lob prints the envelope addresses on page one (address_placement
   top_first_page) and they show through a #10 double-window envelope.
   From Lob's letter template (help.lob.com, letter_template_updated 4_25):
     white address box  0.6in from the left, 0.84in from the top, 3.15 x 2in;
                        anything under it is printed over
     top window         0.625in left, 0.5in top, 3.25 x 0.875in
     bottom window      0.625in left, 1.708in top, 4 x 1in
     barcode box        0.5 x 0.5in, 0.087in from the left and bottom edges,
                        and a serial number up the left edge below 8.75in
     clear space        1/16in on every side
   So nothing of ours goes left of 4.625in above 2.84in: the letterhead and
   date sit top right, clear of both windows, and the letter starts at 3in.
   The folds (C-fold, at about 3.75in and 7.75in) must not cut the QR.
   tests/lob.test.js measures all of this in a real render. */
.page {
  width: 8.5in; height: 11in; box-sizing: border-box;
  padding: 2.98in 0.8in 0.45in 0.85in;
  position: relative;
  page-break-after: always; break-after: page;
  display: flex; flex-direction: column;
}
.page:last-child { page-break-after: auto; break-after: auto; }
p { margin: 0 0 8pt; }
.head { position: absolute; top: 0.6in; left: 4.95in; right: 0.8in; }
.bizname { margin: 0 0 5pt; }
.bizname svg { display: block; height: 0.2in; width: auto; }
.bizaddr { font-size: 10pt; line-height: 1.35; margin: 0; }
/* The page is a column flex container, so a 1.3pt box shrinks to nothing
   unless it is told not to. That is how this rule once vanished silently. */
.rule { flex: none; height: 1.3pt; background: #C4501B; width: 100%; margin: 10pt 0 12pt; }
.date { font-size: 10.5pt; margin: 0; }
.greeting { font-weight: 600; font-size: 12pt; margin-bottom: 13pt; }
.qrblock { flex: none; margin: 2pt 0 10pt; display: flex; align-items: center; gap: 14pt; }
/* A real code, drawn at 720px and printed into one inch, so the printer
   rather than the image decides how fine the modules are. No border: the
   quiet zone is inside the image and a rule drawn against it is exactly what
   a scanner does not want. */
.qr { flex: none; display: block; width: 1in; height: 1in; }
.url { font-size: 10.5pt; margin: 0; }
.sig { margin-top: 14pt; margin-bottom: 0; }
/* Directly under the number, small: what a caller agrees to by calling. */
.smsnote { font-size: 8.5pt; line-height: 1.45; color: #57534E; margin: 3pt 0 0; text-wrap: balance; }
/* Two deliberate lines, broken where the sentence breaks, so no word is
   left stranded on a line of its own. */
.foot {
  margin-top: auto; padding-top: 10pt;
  font-size: 8.5pt; line-height: 1.45; color: #57534E;
  max-width: 5.4in;
}`;
}

async function main() {
  const full = JSON.parse(fs.readFileSync(P.spine, 'utf8'));
  const byCompany = new Map(full.records.map(r => [r.company, r]));
  const rows = full.pilotShortlist.rows
    .filter(r => r.top20 && !r.excluded)
    .sort((a, b) => a.rank - b.rank);

  if (!rows.length) throw new Error('no letters to render — run steps 5 to 9 first');

  ensureFonts();

  /* Codes first, and all of them, so that a company whose QR will not encode
     stops the run before any PDF is written. */
  const { refs, issued } = assign(rows.map(r => r.company));
  console.log(issued
    ? 'issued ' + issued + ' new reference code' + (issued === 1 ? '' : 's') + ' into ' + P.refs
    : 'every company already had its reference code');

  const codes = new Map();
  for (const row of rows) {
    const ref = refs[row.company];
    const url = prospectUrl(ref, 'letter');
    codes.set(row.company, {
      ref, url,
      printed: url.replace(/^https:\/\//, '').replace(/\?.*$/, ''),
      image: await qrDataUri(url)      /* decoded before it comes back */
    });
  }
  console.log('all ' + codes.size + ' QR codes encoded and read back');

  const built = rows.map(row => letterHtml(row, byCompany.get(row.company), codes.get(row.company)));
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Pilot letters — review</title>
<style>
${pageCss(inlineFonts(fs.readFileSync(P.fontCss, 'utf8')))}
</style></head><body>
${built.map(b => b.html).join('\n')}
</body></html>`;

  fs.mkdirSync(path.dirname(P.lettersHtml), { recursive: true });
  fs.writeFileSync(P.lettersHtml, html);
  fs.writeFileSync(P.lettersTable, JSON.stringify(built.map(b => b.row), null, 1));

  const chrome = findChrome();
  if (!chrome) {
    console.log('wrote ' + P.lettersHtml);
    console.log('no chromium found — set PILOT_CHROME to a chrome binary to get the PDF');
  } else {
    execFileSync(chrome, ['--headless', '--disable-gpu', '--no-sandbox', '--no-pdf-header-footer',
      '--print-to-pdf=' + P.lettersPdf, '--virtual-time-budget=12000',
      'file://' + P.lettersHtml], { stdio: 'pipe' });
    const pages = (fs.readFileSync(P.lettersPdf).toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
    console.log('wrote ' + P.lettersPdf + '  (' + pages + ' pages)');
  }

  for (const b of built) {
    const r = b.row;
    console.log(String(r.rank).padStart(2), r.ref.padEnd(10),
      r.biz.slice(0, 30).padEnd(32),
      r.greeting.padEnd(22), (r.trade + ' (' + r.tradeFrom + ')').padEnd(26),
      r.paragraph.padEnd(32), r.emailUsable ? 'emailUsable' : '');
  }
}

/* Run as a script it renders the pilot. Required, it only lends out the
   template, so one letter can be rendered from an invented record without
   reading or writing anything real. */
if (require.main === module) {
  main().catch(err => { console.error(err.message); process.exit(1); });
}

module.exports = { letterHtml, pageCss, ensureFonts, findChrome, inlineFonts };
