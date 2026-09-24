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
const { pageShell, esc, CSS } = require('./shell.js');

const OUT = path.join(__dirname, '..', 'public', 'coldenjames');

/* Plain and sturdy: one column, generous type, no shadow, no gradient, no
   animation. It should read like a well-made sign, not a landing page. */


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
  const dl = `<dl class="contact">\n  ${rows.join('\n  ')}\n</dl>`;
  return C.BUSINESS.phone && C.HOME.smsLine
    ? dl + `\n<p class="sms-note">${esc(C.HOME.smsLine)}</p>`
    : dl;
}

/* Legal copy is plain text; the one markup it allows is **bold**, applied
   after escaping so nothing in the copy can become HTML. */
function inline(text) {
  return esc(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
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

  return pageShell({
    title: C.BUSINESS.brand + ' — missed-call texts, reviews and simple websites for local trades',
    description: C.HOME.tagline,
    body
  });
}

function legal(doc, slug) {
  const sections = doc.sections.map(s => {
    const paras = s.paragraphs.map(p => `<p>${inline(p)}</p>`).join('\n');
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

  return pageShell({
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
    ? `<p><a href="sms:${esc(String(C.BUSINESS.phone).replace(/[^0-9+]/g, ''))}">Text Steven on ${esc(C.BUSINESS.phone)}</a></p>`
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

  return pageShell({
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

  return pageShell({
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
  /* api/prospect.js is a Node function and cannot import the ESM edge
     module, so the same HTML is written once more as CommonJS. */
  const cjsPath = path.join(__dirname, 'notfound-html.js');
  const cjs = "'use strict';\n/* Generated by site/build.js — do not edit. Run: npm run site:build */\n" +
    'module.exports = ' + JSON.stringify(files['404.html']) + ';\n';
  const wasCjs = fs.existsSync(cjsPath) ? fs.readFileSync(cjsPath, 'utf8') : null;
  fs.writeFileSync(cjsPath, cjs);
  written.push({ name: '../site/notfound-html.js', bytes: Buffer.byteLength(cjs), changed: wasCjs !== cjs });

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

module.exports = { build, home, legal, notFound, setup, robotsTxt, sitemapXml, pageShell, CSS };
