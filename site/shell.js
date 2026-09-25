'use strict';

/* The look of every ColdenJames page, in one place: the palette, the type,
   and the shell each page is poured into.

   The static pages are written to disk by site/build.js; the prospect page
   is rendered per request by api/prospect.js. Both come through here, so
   they cannot drift into two different-looking sites. */

const esc = s => String(s === undefined || s === null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const CSS = `
:root {
  --ground: #F4EFE6;
  --surface: #FBF8F2;
  --ink: #1C1917;
  --muted: #5C5650;
  --line: #CFC6B6;
  --accent: #C4501B;
  --callout: #F3E7D3;
  /* The blue half of the C and the J in the mark (blue eyes; the rust half
     is --accent, red hair). Used in the mark and nowhere else. */
  --brand-blue: #3F7FC0;
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

/* ---- the mark ---- */
/* The wordmark is drawn as outlines (site/brand-svg.js), so it looks the
   same with or without the web font. Heights are its ink height: 32px sits
   where 40px type used to, 15px where the 15px back link was. */
.mark svg { display: block; height: 32px; width: auto; max-width: 100%; }
.brand-link { display: inline-block; margin: 0 0 14px; }
.brand-link svg, .back svg { display: inline-block; height: 15px; width: auto; vertical-align: -2px; }
.back { text-decoration: none; }

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

/* ---- the texting page ---- */
/* Numbered steps, each quoting the exact words used at that step. */
.flow { margin: 0; padding: 0 0 0 26px; }
.flow > li { margin: 0 0 22px; padding-left: 4px; }
.flow > li::marker { font-weight: 700; color: var(--accent); font-size: 19px; }
.flow h3 { margin: 0 0 6px; }
.quote-label { margin: 10px 0 4px; font-size: 15px; color: var(--muted); }
.quote {
  margin: 8px 0 12px; padding: 12px 16px;
  background: var(--surface); border: 1px solid var(--line);
  border-left: 4px solid var(--accent); border-radius: var(--radius);
  font-size: 17px; line-height: 1.5; text-wrap: pretty;
}
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

/* What a link preview shows (iMessage, Facebook, WhatsApp and the rest):
   the page's own title and description, the wordmark on cream, and the
   page's canonical https://coldenjames.com address. Pages that pass no
   `share` get no preview tags. A page can override the title or leave the
   description out — the prospect page does both, so no business name ever
   appears in a preview. */
const SITE = 'https://coldenjames.com';
function shareTags({ title, description, share }) {
  if (!share) return '';
  const t = share.title !== undefined ? share.title : title;
  const d = share.description !== undefined ? share.description : description;
  return [
    `<meta property="og:type" content="website">`,
    `<meta property="og:url" content="${esc(SITE + share.path)}">`,
    `<meta property="og:title" content="${esc(t)}">`,
    d ? `<meta property="og:description" content="${esc(d)}">` : '',
    `<meta property="og:image" content="${SITE}/brand/share.png">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta name="twitter:card" content="summary_large_image">`
  ].filter(Boolean).join('\n') + '\n';
}

function pageShell({ title, description, body, extraCss, share }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="icon" href="/brand/icon.svg" type="image/svg+xml">
<link rel="icon" href="/brand/favicon-32.png" sizes="32x32" type="image/png">
<link rel="icon" href="/brand/favicon-48.png" sizes="48x48" type="image/png">
<link rel="icon" href="/brand/favicon-96.png" sizes="96x96" type="image/png">
<link rel="apple-touch-icon" href="/brand/apple-touch-icon.png">
${shareTags({ title, description, share })}<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;600;700&display=swap" rel="stylesheet">
<style>
${CSS}${extraCss || ''}
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


/* The wordmark for a header: the heading itself on the homepage, a small
   link home everywhere else. Its accessible name is "ColdenJames". */
const { WORDMARK } = require('./brand-svg.js');
const brandLink = () => `<a class="brand-link" href="/">${WORDMARK}</a>`;

module.exports = { pageShell, esc, CSS, WORDMARK, brandLink };
