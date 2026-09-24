'use strict';

/* Renders the ColdenJames pages from site/content.js into
   public/coldenjames/. The project has no build step on Vercel, so the
   output is committed; run this after editing the copy.

   Run:  npm run site:build
   Check it is in sync:  npm run site:check */

const fs = require('fs');
const path = require('path');
const C = require('./content.js');
const { CARRIERS, READ_ON } = require('./carriers.js');

const OUT = path.join(__dirname, '..', 'public', 'coldenjames');

const esc = s => String(s === undefined || s === null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/* Plain and sturdy: one column, generous type, no shadow, no gradient, no
   animation. It should read like a well-made sign, not a landing page. */
const CSS = `
:root {
  --ground: #F4EFE6;
  --surface: #FBF8F2;
  --ink: #1C1917;
  --muted: #5C5650;
  --line: #CFC6B6;
  --accent: #C4501B;
  --radius: 8px;
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  background: var(--ground);
  color: var(--ink);
  font-family: "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
  font-size: 17px;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}
.wrap { max-width: 640px; margin: 0 auto; padding: 0 20px 56px; }
a { color: var(--accent); text-underline-offset: 3px; }
a:hover { color: var(--ink); }
:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }

header { padding: 44px 0 28px; }
h1 {
  margin: 0;
  font-size: 40px; font-weight: 700; letter-spacing: -0.02em; line-height: 1.1;
}
.tagline {
  margin: 14px 0 0; font-size: 18px; line-height: 1.5;
  color: var(--muted); text-wrap: pretty; max-width: 30em;
}
.rule { height: 2px; background: var(--line); margin: 0 0 32px; }

h2 {
  margin: 34px 0 8px;
  font-size: 13px; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.09em; color: var(--muted);
}
h3 { margin: 26px 0 6px; font-size: 21px; font-weight: 600; line-height: 1.25; }
p { margin: 0 0 14px; text-wrap: pretty; }

.card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 22px 22px 8px;
  margin: 22px 0;
}
.price { font-size: 32px; font-weight: 700; margin: 0 0 12px; letter-spacing: -0.01em; }
.price-points { margin: 0; padding: 0; list-style: none; }
.price-points li {
  position: relative; padding: 6px 0 6px 20px; font-size: 17px;
  border-top: 1px solid var(--line);
}
.price-points li:first-child { border-top: 0; }
.price-points li::before {
  content: ""; position: absolute; left: 0; top: 15px;
  width: 8px; height: 8px; border-radius: 50%; background: var(--accent);
}
.note {
  border: 2px dashed var(--line);
  border-radius: var(--radius);
  padding: 20px 22px;
  margin: 30px 0;
  font-size: 17px; line-height: 1.55; text-wrap: pretty;
}
.contact { margin: 6px 0 0; }
.contact dt {
  font-size: 13px; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.07em; color: var(--muted); margin-top: 14px;
}
.contact dt:first-child { margin-top: 0; }
.contact dd { margin: 2px 0 0; font-size: 19px; }

footer {
  border-top: 2px solid var(--line);
  margin-top: 44px; padding-top: 22px;
  font-size: 15px; color: var(--muted); line-height: 1.5;
}
footer p { margin: 0 0 10px; }
footer nav a { margin-right: 18px; }

.draft {
  background: var(--surface);
  border: 1px solid var(--line);
  border-left: 4px solid var(--accent);
  border-radius: var(--radius);
  padding: 12px 16px; margin: 0 0 26px;
  font-size: 15px; font-weight: 600;
}
.back { display: inline-block; margin: 0 0 8px; font-size: 15px; }
.updated { font-size: 15px; color: var(--muted); }

/* ---- the setup page ---- */
/* Read one-handed, outdoors, by someone who does not want to be doing this.
   Nothing under 18px, nothing that needs a steady thumb. */
.pick { display: grid; gap: 10px; margin: 18px 0 8px; }
.pick button {
  width: 100%; min-height: 62px; padding: 14px 18px;
  font-family: inherit; font-size: 20px; font-weight: 600; text-align: left;
  color: var(--ink); background: var(--surface);
  border: 2px solid var(--line); border-radius: var(--radius);
  cursor: pointer; touch-action: manipulation;
}
.pick button:hover { border-color: var(--ink); }
.pick button[aria-pressed="true"] { border-color: var(--accent); background: var(--callout, #F3E7D3); }
.pick .net { display: block; font-size: 15px; font-weight: 400; color: var(--muted); margin-top: 2px; }
.steps { margin: 0; padding: 0 0 0 28px; font-size: 18px; line-height: 1.55; }
.steps li { margin: 0 0 12px; text-wrap: pretty; }
.code {
  display: block; margin: 18px 0 10px; padding: 18px 16px;
  background: var(--surface); border: 2px solid var(--ink); border-radius: var(--radius);
  /* shrinks rather than splitting: a number broken across two lines is a
     number somebody types wrong */
  font-size: clamp(21px, 6.5vw, 30px); font-weight: 700; letter-spacing: 0.01em;
  text-align: center; line-height: 1.3; overflow-wrap: normal;
}
.code .num { display: block; margin-top: 6px; white-space: nowrap; }
.dial {
  display: block; min-height: 60px; padding: 16px;
  background: var(--accent); color: #FFF7EE; border-radius: var(--radius);
  font-size: 20px; font-weight: 700; text-align: center; text-decoration: none;
  touch-action: manipulation;
}
.dial:hover { background: #A94314; color: #FFF7EE; }
.warn {
  border: 2px dashed var(--line); border-radius: var(--radius);
  padding: 14px 16px; margin: 16px 0; font-size: 17px; font-weight: 600;
}
.sources { font-size: 14px; color: var(--muted); margin-top: 18px; }
.sources a { color: var(--muted); }
[hidden] { display: none !important; }

@media (min-width: 700px) {
  body { font-size: 18px; }
  h1 { font-size: 52px; }
  .wrap { padding-bottom: 72px; }
}
`.trim();

function page({ title, description, body }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;600;700&display=swap" rel="stylesheet">
<style>
${CSS}
</style>
</head>
<body>
<div class="wrap">
${body}
</div>
</body>
</html>
`;
}

function footer() {
  return `<footer>
  <p>${esc(C.BUSINESS.brand)} is a trade name of ${esc(C.BUSINESS.legal)}, ${esc(C.BUSINESS.city)}, ${esc(C.BUSINESS.state)}.</p>
  <nav><a href="/privacy">Privacy</a><a href="/terms">Terms</a></nav>
</footer>`;
}

function contactBlock() {
  const rows = [
    `<dt>Who you are dealing with</dt><dd>${esc(C.BUSINESS.owner)}</dd>`,
    `<dt>Email</dt><dd><a href="mailto:${esc(C.BUSINESS.email)}">${esc(C.BUSINESS.email)}</a></dd>`
  ];
  /* The phone line appears only once a number is set in content.js. A
     missing line is better than a wrong number on a sign. */
  if (C.BUSINESS.phone) {
    const dial = String(C.BUSINESS.phone).replace(/[^0-9+]/g, '');
    rows.push(`<dt>Phone</dt><dd><a href="tel:${esc(dial)}">${esc(C.BUSINESS.phone)}</a></dd>`);
  }
  if (C.BUSINESS.mailingAddress) {
    rows.push(`<dt>Post</dt><dd>${esc(C.BUSINESS.mailingAddress)}</dd>`);
  }
  return `<dl class="contact">\n  ${rows.join('\n  ')}\n</dl>`;
}

function home() {
  const services = C.HOME.services.map(s =>
    `<h3>${esc(s.title)}</h3>\n<p>${esc(s.body)}</p>`).join('\n\n');

  const points = C.HOME.price.points.map(p => `<li>${esc(p)}</li>`).join('\n    ');

  const body = `<header>
  <h1>${esc(C.BUSINESS.brand)}</h1>
  <p class="tagline">${esc(C.HOME.tagline)}</p>
</header>
<div class="rule"></div>

<h2>What you get</h2>
${services}

<h2>What it costs</h2>
<div class="card">
  <p class="price">${esc(C.HOME.price.headline)}</p>
  <ul class="price-points">
    ${points}
  </ul>
</div>

<p>${esc(C.HOME.setup)}</p>

<div class="note">${esc(C.HOME.reassurance)}</div>

<h2>Getting hold of me</h2>
${contactBlock()}

${footer()}`;

  return page({
    title: C.BUSINESS.brand + ' — missed-call texts, reviews and simple websites for local trades',
    description: C.HOME.tagline,
    body
  });
}

function legal(doc, slug) {
  const sections = doc.sections.map(s => {
    const paras = s.paragraphs.map(p => `<p>${esc(p)}</p>`).join('\n');
    const links = (s.links || []).length
      ? '<p>' + s.links.map(l =>
          `<a href="${esc(l.href)}" rel="noopener">${esc(l.label)}</a>`).join('<br>') + '</p>'
      : '';
    return `<h3>${esc(s.heading)}</h3>\n${paras}${links ? '\n' + links : ''}`;
  }).join('\n\n');

  const body = `<header>
  <a class="back" href="/">&larr; ${esc(C.BUSINESS.brand)}</a>
  <h1>${esc(doc.title)}</h1>
</header>
<p class="draft">${esc(C.DRAFT_NOTE)}</p>
<p>${esc(doc.intro)}</p>

${sections}

<p class="updated">Last updated: ${esc(C.UPDATED)}.</p>

${footer()}`;

  return page({
    title: doc.title + ' — ' + C.BUSINESS.brand,
    description: doc.title + ' for ' + C.BUSINESS.brand + ', a trade name of ' + C.BUSINESS.legal + '.',
    body
  });
}

function carrierBlock(c) {
  if (!c.confirmed) {
    return `<div class="panel" id="c-${esc(c.id)}" hidden>
  <h3>${esc(c.name)}</h3>
  <div class="warn">${esc(C.SETUP.unconfirmed)}</div>
  <p>${esc(C.SETUP.unconfirmedWhy)}</p>
  <p class="muted">${esc(c.why || '')}</p>
</div>`;
  }

  const steps = c.steps.map(t => `<li>${esc(t)}</li>`).join('\n    ');
  const off = c.offSteps.map(t => `<li>${esc(t)}</li>`).join('\n    ');

  /* The dial code only appears where the carrier publishes one. Where the
     steps go through the phone's own menu there is nothing to dial, and a
     button that dialled something would be a guess. */
  const codeBlock = c.method === 'code'
    ? `<p class="code" data-code="${esc(c.code)}">${esc(c.code)} <span class="num">${esc(C.SETUP.numberFallback)}</span></p>
  <a class="dial" data-dial="${esc(c.code)}" href="tel:${esc(c.code)}">${esc(C.SETUP.dialLabel)}</a>
  <p>${esc(c.codeNote || '')}</p>`
    : `<p class="code"><span class="num">${esc(C.SETUP.numberFallback)}</span></p>
  <div class="warn">${esc(C.SETUP.warnAlways)}</div>`;

  const offCode = c.offCode
    ? `<p class="code">${esc(c.offCode)}</p>
  <a class="dial" href="tel:${esc(c.offCode).replace(/#/g, '%23')}">${esc(C.SETUP.dialLabel)}</a>`
    : '';

  const sources = (c.sources || []).map(sr =>
    `<a href="${esc(sr.url)}" rel="noopener">${esc(sr.label)}</a>`).join('<br>');

  return `<div class="panel" id="c-${esc(c.id)}" hidden>
  <h3>${esc(c.name)}</h3>
  <ol class="steps">
    ${steps}
  </ol>
  ${codeBlock}
  ${c.caveat ? `<p>${esc(c.caveat)}</p>` : ''}

  <h3>${esc(C.SETUP.offHeading)}</h3>
  <p>${esc(C.SETUP.offLine)}</p>
  <ol class="steps">
    ${off}
  </ol>
  ${offCode}
  ${c.cost ? `<p class="muted">${esc(c.cost)}</p>` : ''}
  <p class="sources">Taken from ${esc(c.name)}'s own support pages, read ${esc(READ_ON)}:<br>${sources}</p>
</div>`;
}

function setup() {
  const buttons = CARRIERS.map(c =>
    `<button type="button" data-carrier="${esc(c.id)}" aria-pressed="false">${esc(c.name)}` +
    (c.network ? `<span class="net">${esc(c.network)}</span>` : '') +
    `</button>`).join('\n    ');

  const panels = CARRIERS.map(carrierBlock).join('\n\n');

  const stevenLine = C.BUSINESS.phone
    ? `<p><a href="tel:${esc(String(C.BUSINESS.phone).replace(/[^0-9+]/g, ''))}">Text Steven on ${esc(C.BUSINESS.phone)}</a></p>`
    : '';

  const body = `<header>
  <h1>${esc(C.SETUP.title)}</h1>
  <p class="tagline">${esc(C.SETUP.intro)}</p>
</header>
<div class="rule"></div>

<h2>${esc(C.SETUP.pickLabel)}</h2>
<div class="pick" id="pick">
    ${buttons}
</div>

<div id="panels">
${panels}
</div>

<div id="after" hidden>
  <h2>${esc(C.SETUP.testHeading)}</h2>
  <p>${esc(C.SETUP.testLine)}</p>
  <p>${esc(C.SETUP.testFail)}</p>
</div>

<h2>${esc(C.SETUP.notSureHeading)}</h2>
<p>${esc(C.SETUP.notSureLine)}</p>
${stevenLine}

${footer()}

<script>
(function () {
  /* The number comes from the link Steven sends: ?n=+13185550100.
     Anything that is not a plain E.164 number is ignored and the page keeps
     saying "[your ColdenJames number]" — a wrong number here would be worse
     than no number, because the client would set it and it would look done. */
  var raw = new URLSearchParams(location.search).get('n') || '';
  var number = /^[+][1-9][0-9]{6,14}$/.test(raw) ? raw : null;

  if (number) {
    var spans = document.querySelectorAll('.num');
    for (var i = 0; i < spans.length; i++) spans[i].textContent = number;
    var dials = document.querySelectorAll('.dial[data-dial]');
    for (var j = 0; j < dials.length; j++) {
      dials[j].setAttribute('href', 'tel:' + dials[j].getAttribute('data-dial') + number);
    }
  }

  var panels = document.querySelectorAll('.panel');
  var buttons = document.querySelectorAll('#pick button');
  var after = document.getElementById('after');

  function show(id) {
    for (var i = 0; i < panels.length; i++) {
      panels[i].hidden = panels[i].id !== 'c-' + id;
    }
    for (var j = 0; j < buttons.length; j++) {
      buttons[j].setAttribute('aria-pressed', String(buttons[j].getAttribute('data-carrier') === id));
    }
    after.hidden = false;
    var open = document.getElementById('c-' + id);
    if (open) open.scrollIntoView({ block: 'start' });
  }

  for (var k = 0; k < buttons.length; k++) {
    buttons[k].addEventListener('click', function () {
      show(this.getAttribute('data-carrier'));
    });
  }
})();
</script>`;

  return page({
    title: C.SETUP.title + ' — ' + C.BUSINESS.brand,
    description: C.SETUP.title,
    body
  });
}

function robotsTxt() {
  return [
    'User-agent: *',
    'Disallow: /p/',
    'Disallow: /setup',
    '',
    'Sitemap: https://' + C.BUSINESS.domain + '/sitemap.xml',
    ''
  ].join('\n');
}

function sitemapXml() {
  const base = 'https://' + C.BUSINESS.domain;
  const urls = ['/', '/privacy', '/terms']
    .map(p => '  <url><loc>' + base + p + '</loc></url>')
    .join('\n');
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls + '\n</urlset>\n';
}

function notFound() {
  const body = `<header>
  <h1>${esc(C.NOT_FOUND.title)}</h1>
  <p class="tagline">${esc(C.NOT_FOUND.line)}</p>
</header>
<div class="rule"></div>
<p><a href="/">${esc(C.NOT_FOUND.backLabel)}</a></p>

${footer()}`;

  return page({
    title: C.NOT_FOUND.title + ' — ' + C.BUSINESS.brand,
    description: C.NOT_FOUND.line,
    body
  });
}

function build() {
  fs.mkdirSync(OUT, { recursive: true });
  const files = {
    'index.html': home(),
    'privacy.html': legal(C.PRIVACY, 'privacy'),
    'terms.html': legal(C.TERMS, 'terms'),
    'setup.html': setup(),
    '404.html': notFound(),
    'robots.txt': robotsTxt(),
    'sitemap.xml': sitemapXml()
  };
  const written = [];
  for (const [name, html] of Object.entries(files)) {
    const file = path.join(OUT, name);
    const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    fs.writeFileSync(file, html);
    written.push({ name, bytes: Buffer.byteLength(html), changed: before !== html });
  }
  /* The 404 is returned by middleware, which runs at the edge and cannot
     read the filesystem, so the same HTML is also written as a module it
     can import. Generated from the same function: they cannot drift. */
  const module_ = "/* Generated by site/build.js — do not edit. Run: npm run site:build */\n" +
    'export default ' + JSON.stringify(files['404.html']) + ';\n' +
    'export const robotsTxt = ' + JSON.stringify(files['robots.txt']) + ';\n' +
    'export const sitemapXml = ' + JSON.stringify(files['sitemap.xml']) + ';\n';
  const modulePath = path.join(__dirname, 'notfound-page.js');
  const wasModule = fs.existsSync(modulePath) ? fs.readFileSync(modulePath, 'utf8') : null;
  fs.writeFileSync(modulePath, module_);
  written.push({ name: '../site/notfound-page.js', bytes: Buffer.byteLength(module_),
                 changed: wasModule !== module_ });

  return written;
}

if (require.main === module) {
  const written = build();
  for (const w of written) {
    console.log('  ' + w.name.padEnd(14) + String(w.bytes).padStart(6) + ' bytes' +
      (w.changed ? '   (changed)' : ''));
  }
  console.log('wrote ' + written.length + ' pages to public/coldenjames/');
  if (!C.BUSINESS.phone) {
    console.log('note: no phone number set in site/content.js, so the phone line is hidden');
  }
}

module.exports = { build, home, legal, notFound, setup, robotsTxt, sitemapXml, page, CSS };
