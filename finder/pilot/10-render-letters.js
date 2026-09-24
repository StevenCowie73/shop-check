'use strict';

/* Step 10. Renders the top twenty as one PDF, one US Letter page per letter.

   Review-only: the QR is a grey placeholder, and OUTREACH_DOMAIN/p/REF,
   [PHONE], [BUSINESS NAME] and [MAILING ADDRESS] are literal placeholders.

   The fill rules are the point of this file. What a letter may say about
   somebody's website depends entirely on what we actually established:
   a state of "unknown" or "not found" produces no claim at all, and a
   website we never fetched can never become a complaint. */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const P = require('./lib/paths.js');
const { businessName, firstName, tradeNoun } = require('./lib/names.js');

const FONT_CSS_URL =
  'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&display=swap';
const BROWSER_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

/* ---------- the website paragraph ---------- */
const showDomain = url => String(url || '')
  .replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '');

function websiteParagraph(rec, row) {
  const state = row.websiteState;
  const audit = rec.websiteAudit || {};

  /* Nothing we did not see may reach the page. */
  if (state === 'fine' || state === 'unknown') return { text: '', which: 'omitted (' + state + ')' };

  if (state === 'not found') {
    return {
      text: "I also looked for your website and couldn't find one, so people who search for you have nothing to click through to.",
      which: 'not found'
    };
  }

  const domain = showDomain(audit.url);
  const fromEmail = audit.source !== 'astra';
  const gone = audit.parked || /domain not found/i.test(audit.whatsWrong || '');

  if (state === 'dead') {
    if (gone) {
      return fromEmail
        ? { text: `I also tried ${domain}, the web address from your business email, and it doesn't lead to a website.`,
            which: 'gone (email)' }
        : { text: `I found ${domain} listed for you, but it doesn't lead to a website.`,
            which: 'gone (astra)' };
    }
    return fromEmail
      ? { text: `I also tried ${domain}, the web address from your business email, and it comes back with an error.`,
          which: 'error (email)' }
      : { text: `I found ${domain} listed for you, but it comes back with an error, so anyone who looks you up hits a dead end.`,
          which: 'error (astra)' };
  }

  if (state === 'poor' && (audit.signals || []).includes('viewport')) {
    return {
      text: `I also looked at your website, ${domain}. It doesn't work well on a phone, which is where most people look you up.`,
      which: 'poor, not built for phones (' + (fromEmail ? 'email' : 'astra') + ')'
    };
  }
  return { text: '', which: 'omitted (no rule matched)' };
}

/* ---------- fonts ---------- */
/* Fetched once into out/, never committed. */
function ensureFonts() {
  if (fs.existsSync(P.fontCss)) return;
  fs.mkdirSync(P.fontsDir, { recursive: true });
  console.log('fetching IBM Plex Sans (once) ...');
  let css = execFileSync('curl', ['-sS', '-A', BROWSER_UA, '--max-time', '60', FONT_CSS_URL],
    { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  const urls = [...new Set(css.match(/https:\/\/fonts\.gstatic\.com[^) ]+\.woff2/g) || [])];
  urls.forEach((url, i) => {
    const file = path.join(P.fontsDir, 'f' + (i + 1) + '.woff2');
    execFileSync('curl', ['-sS', '--max-time', '60', url, '-o', file]);
    css = css.split(url).join('fonts/f' + (i + 1) + '.woff2');
  });
  fs.writeFileSync(P.fontCss, css);
  console.log('  ' + urls.length + ' font files cached in ' + P.fontsDir);
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

function letterHtml(row, rec) {
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
    <p class="bizname">[BUSINESS NAME]</p>
    <p class="bizaddr">[MAILING ADDRESS]</p>
  </header>
  <div class="rule"></div>
  <p class="date">${esc(date)}</p>
  <p class="greeting">${esc(greeting)}</p>
  <p>When you're on a job and the phone rings, you can't always get to it. Most people who get voicemail don't leave a message. They call the next ${esc(trade.noun)}.</p>
  <p>I'm Steven, here in Bossier City. I set up a simple fix for that. When you miss a call, the caller gets a text from ${esc(biz)} straight away, so they know you'll get back to them. You reply when you're off the job.</p>
  <p>You can try it on me. Call the number at the bottom of this letter, and if I can't pick up, you'll get the text yourself.</p>
  ${website.text ? `<p>${esc(website.text)}</p>` : ''}
  <p>${esc(pageLine)}</p>
  <div class="qrblock">
    <div class="qr">QR</div>
    <p class="url">OUTREACH_DOMAIN/p/REF</p>
  </div>
  <p>$79 a month covers three things: the missed-call text, a text asking your customers for a review, and a simple website that works on a phone, registered in your name. The first month is free, there's no contract, and you can cancel with a text. I do the setup. The one thing you'd do is change a setting on your phone, and I'll walk you through it.</p>
  <p>If it's not for you, no hard feelings. If it is, text me.</p>
  <p class="sig">Steven Cowie<br>[PHONE]</p>
  <p class="foot">Sent to the mailing address on your state contractor license.<br>Text STOP to the number above and you won't hear from me again.</p>
</section>`;

  return {
    html,
    row: {
      rank: row.rank, company: row.company, biz, greeting,
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
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
}
.page {
  width: 8.5in; height: 11in; box-sizing: border-box;
  padding: 0.95in 1.1in 0.8in;
  page-break-after: always; break-after: page;
  display: flex; flex-direction: column;
}
.page:last-child { page-break-after: auto; break-after: auto; }
p { margin: 0 0 10.5pt; }
.head { margin-bottom: 9pt; }
.bizname { font-size: 16pt; font-weight: 600; letter-spacing: -0.01em; margin: 0 0 3pt; }
.bizaddr { font-size: 10pt; margin: 0; }
/* The page is a column flex container, so a 1.3pt box shrinks to nothing
   unless it is told not to. That is how this rule once vanished silently. */
.rule { flex: none; height: 1.3pt; background: #C4501B; width: 100%; margin: 0 0 20pt; }
.date { font-size: 10.5pt; margin-bottom: 16pt; }
.greeting { font-weight: 600; font-size: 12pt; margin-bottom: 13pt; }
.qrblock { flex: none; margin: 3pt 0 12pt; }
.qr {
  flex: none; width: 1in; height: 1in; border: 1pt solid #1C1917;
  background: #E7E5E4; color: #57534E;
  display: flex; align-items: center; justify-content: center;
  font-size: 9pt; font-weight: 600; letter-spacing: 0.08em;
}
.url { font-size: 10.5pt; margin: 7pt 0 0; }
.sig { margin-top: 14pt; margin-bottom: 0; }
/* Two deliberate lines, broken where the sentence breaks, so no word is
   left stranded on a line of its own. */
.foot {
  margin-top: auto; padding-top: 20pt;
  font-size: 8.5pt; line-height: 1.45; color: #57534E;
  max-width: 5.4in;
}`;
}

function main() {
  const full = JSON.parse(fs.readFileSync(P.spine, 'utf8'));
  const byCompany = new Map(full.records.map(r => [r.company, r]));
  const rows = full.pilotShortlist.rows
    .filter(r => r.top20 && !r.excluded)
    .sort((a, b) => a.rank - b.rank);

  if (!rows.length) throw new Error('no letters to render — run steps 5 to 9 first');

  ensureFonts();
  const built = rows.map(row => letterHtml(row, byCompany.get(row.company)));
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Pilot letters — review</title>
<style>
${pageCss(fs.readFileSync(P.fontCss, 'utf8'))}
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
    console.log(String(r.rank).padStart(2), r.biz.slice(0, 32).padEnd(34),
      r.greeting.padEnd(22), (r.trade + ' (' + r.tradeFrom + ')').padEnd(26),
      r.paragraph.padEnd(32), r.emailUsable ? 'emailUsable' : '');
  }
}

main();
