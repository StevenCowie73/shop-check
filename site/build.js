'use strict';

/* Renders the ColdenJames pages from site/content.js into
   public/coldenjames/. The project has no build step on Vercel, so the
   output is committed; run this after editing the copy.

   Run:  npm run site:build
   Check it is in sync:  npm run site:check */

const fs = require('fs');
const path = require('path');
const C = require('./content.js');

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
    '404.html': notFound()
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
    'export default ' + JSON.stringify(files['404.html']) + ';\n';
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

module.exports = { build, home, legal, notFound, page, CSS };
