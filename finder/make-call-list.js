#!/usr/bin/env node
'use strict';

/* ---------------------------------------------------------------------
   Builds out/call-list.html from out/prospects.csv: a single-file page
   you can open on a phone while working through the list.

   Run the finder first, then:  node make-call-list.js
   or:                          npm run calls
   --------------------------------------------------------------------- */

const fs = require('fs');
const path = require('path');

/* =====================================================================
   EDIT ME.
   minScore    only businesses scoring this or higher reach the page
   smsPrefix   what goes in front of the Shop Check link in the text
   genericTypes  Google types too vague to show as a trade; these cards
                 simply leave the trade line out
   ===================================================================== */
const LIST = {
  minScore: 60,
  smsPrefix: "Hi, this is Steven — here's that link: ",
  genericTypes: ['point_of_interest', 'establishment', 'service', 'store'],
  /* If out/site-audit.json exists (from check-sites.js), a business whose
     website scored this badly or worse gets a "Website: ..." line on its
     card, and lands in the "Bad website" section. */
  siteAuditMinScore: 40,
  /* The page has two tabs. A holds the businesses with nothing online to
     call about; B holds the ones whose website is the problem. A business
     that would qualify for both is only ever shown in B. */
  sectionATitle: "Missing calls and reviews",
  sectionBTitle: "Bad website",
  /* If out/judgments.json exists (from judge-prospects.js), everything
     scoring this or better on verdict score gets its own tab, shown first
     and opened by default. A business can appear here and on A or B —
     this tab is a shortlist, not a category. */
  sectionCTitle: "Best bets",
  verdictMinScore: 60,

  /* =====================================================================
     THE BRIEF — everything you say on the call. Reword freely; it is the
     same on every card and none of it comes from the model.
     ===================================================================== */
  brief: {
    /* The three things we sell. The one the judgment picked leads; the
       other two follow in one line each. */
    modules: {
      'missed calls': {
        name: 'Missed-call text-back',
        what: 'When you cannot pick up, the caller gets a text straight back in your words, so the job does not go to whoever answers first.'
      },
      'reviews': {
        name: 'Review requests',
        what: 'After a job is done, the customer gets one text asking for a Google review, so the good work you already do starts showing up when people search.'
      },
      'website': {
        name: 'A simple website',
        what: 'One page with what you do, the area you cover and a button to call you, so people who look you up find something instead of nothing.'
      }
    },
    /* Asked on nearly every call. Identical on every card. */
    faq: [
      { q: 'How much?',
        a: '$79 a month, first month free, no contract, cancel with a text.' },
      { q: 'Is this a scam?',
        a: "I'm local, I'll come out and set it up in person, the domain is registered in your name, and you pay nothing for the first month." },
      { q: 'Does a robot answer my phone?',
        a: "No. Nothing answers a call. It's a text message, in your words, that you approve beforehand. Your number doesn't change." },
      { q: "I'm too busy.",
        a: "That's the point. It's about nine minutes at your kitchen table, once." }
    ],
    /* What you tap after the call. */
    outcomes: ['No answer', 'Not interested', 'Send link', 'Call back later', 'Interested']
  },
  /* Shown when the page is inside a frame, where tel: and sms: links go
     nowhere, so the buttons copy instead. */
  copiedPhone: "Copied — paste in your dialler",
  copiedMessage: "Copied — paste into a text",
  copyFailed: "Couldn't copy"
};

const OUT_DIR = process.env.SHOP_CHECK_OUT_DIR || path.join(__dirname, 'out');
const SRC = path.join(OUT_DIR, 'prospects.csv');
const AUDIT_SRC = path.join(OUT_DIR, 'site-audit.json');
const JUDGE_SRC = path.join(OUT_DIR, 'judgments.json');
const ENRICH_DIR = path.join(OUT_DIR, 'enrich-cache');
const DEST = path.join(OUT_DIR, 'call-list.html');

/* ---------- reading the CSV the finder wrote ---------- */
function parseCsv(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function prettyTrade(type) {
  if (!type || LIST.genericTypes.includes(type)) return '';
  const s = String(type).replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* tel: and sms: want digits, not "(318) 555-0100" */
function dialable(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  if (d.length === 10) return '+1' + d;
  if (d.length === 11 && d[0] === '1') return '+' + d;
  return d ? '+' + d : '';
}

/* The Places detail judge-prospects.js already gathered. Read only for the
   businesses that reach the "Best bets" tab, and only for the few things the
   brief needs that prospects.csv does not carry: how recent the newest
   review is, and whether opening hours are listed at all. No API calls. */
function readEnrichment(placeId) {
  const file = path.join(ENRICH_DIR, placeId + '.json');
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
}

/* Reviews come back in relevance order, not date order, so take the latest
   by timestamp rather than trusting position. */
function newestReviewAge(details, now) {
  const times = ((details && details.reviews) || [])
    .map(r => Date.parse(r.publishTime))
    .filter(Number.isFinite);
  if (!times.length) return null;
  const days = Math.floor((now - Math.max(...times)) / 86400000);
  if (days <= 1) return 'today';
  if (days < 14) return days + ' days ago';
  if (days < 60) return Math.round(days / 7) + ' weeks ago';
  if (days < 365) return Math.round(days / 30) + ' months ago';
  const years = days / 365;
  return years < 1.5 ? 'about a year ago' : Math.round(years) + ' years ago';
}

/* One plain line about their website, for someone reading it aloud. */
function websiteLine(business, audit) {
  if (!business.hasWebsite) return { state: 'none', line: 'No website at all — just the Google listing.' };
  if (!audit) return { state: 'ok', line: 'Has a website. It was not checked.' };
  if (!audit.loads) {
    return { state: 'broken',
             line: 'Website does not load — ' + (audit.problem || 'it could not be reached') + '.' };
  }
  return { state: audit.siteScore >= LIST.siteAuditMinScore ? 'broken' : 'ok',
           line: audit.whatsWrong ? 'Website loads. ' + audit.whatsWrong + '.' : 'Website loads and looks fine.' };
}

/* The judgments are optional too. No judgments file, no "Best bets" tab.
   Read from judgments.json rather than judgments.csv: the CSV has no
   place_id column, and without it a card cannot carry its tick state,
   its Google link or its Shop Check link. */
function readJudgments(jsonText) {
  const byPlaceId = new Map();
  if (!jsonText) return byPlaceId;
  let data;
  try { data = JSON.parse(jsonText); } catch (e) { return byPlaceId; }
  for (const j of (data && data.judgments) || []) {
    if (!j || !j.placeId) continue;
    const score = Number(j.verdict_score);
    if (!Number.isFinite(score)) continue;
    byPlaceId.set(j.placeId, {
      score,
      pitch: String(j.best_pitch || ''),
      oneLine: String(j.one_line || ''),
      size: String(j.size || 'unknown'),
      customer: String(j.customer || 'unknown'),
      signals: Array.isArray(j.responsiveness_signals) ? j.responsiveness_signals : []
    });
  }
  return byPlaceId;
}

/* The website audit is optional. No audit file, no website lines. */
/* readAudit keeps only the sites bad enough to mention on a card. The brief
   needs every audited site, good or bad, so it can say "loads and looks
   fine" as readily as "does not load". */
function readAuditRecords(jsonText) {
  const byPlaceId = new Map();
  if (!jsonText) return byPlaceId;
  let data;
  try { data = JSON.parse(jsonText); } catch (e) { return byPlaceId; }
  for (const site of (data && data.sites) || []) {
    if (site && site.placeId) byPlaceId.set(site.placeId, site);
  }
  return byPlaceId;
}

function readAudit(jsonText) {
  const byPlaceId = new Map();
  if (!jsonText) return byPlaceId;
  let data;
  try { data = JSON.parse(jsonText); } catch (e) { return byPlaceId; }
  const sites = Array.isArray(data && data.sites) ? data.sites : [];
  for (const site of sites) {
    if (!site || !site.placeId) continue;
    const score = Number(site.siteScore);
    if (!Number.isFinite(score) || score < LIST.siteAuditMinScore) continue;
    if (!site.whatsWrong) continue;
    byPlaceId.set(site.placeId, { score, whatsWrong: String(site.whatsWrong) });
  }
  return byPlaceId;
}

function siteLine(audit, placeId, website) {
  if (!audit || !website) return '';          /* no website, card unchanged */
  const hit = audit.get(placeId);
  return hit ? hit.whatsWrong : '';
}

function siteScore(audit, placeId, website) {
  if (!audit || !website) return 0;
  const hit = audit.get(placeId);
  return hit ? hit.score : 0;
}

function readProspects(csvText, audit, judgments, auditRecords) {
  const rows = parseCsv(csvText);
  if (!rows.length) return { total: 0, businesses: [] };
  const head = rows[0];
  const ix = Object.fromEntries(head.map((h, i) => [h, i]));
  for (const needed of ['score', 'name', 'phone', 'primary_type', 'google_maps_url', 'place_id', 'why', 'shop_check_link', 'website']) {
    if (!(needed in ix)) throw new Error(`prospects.csv has no "${needed}" column`);
  }
  const body = rows.slice(1).filter(r => r.length === head.length && r[ix.place_id]);
  const all = body
    .map(r => ({
      id: r[ix.place_id],
      score: Number(r[ix.score]) || 0,
      name: r[ix.name],
      phone: r[ix.phone],
      dial: dialable(r[ix.phone]),
      trade: prettyTrade(r[ix.primary_type]),
      why: r[ix.why],
      maps: r[ix.google_maps_url],
      link: r[ix.shop_check_link],
      site: siteLine(audit, r[ix.place_id], r[ix.website]),
      siteScore: siteScore(audit, r[ix.place_id], r[ix.website]),
      hasWebsite: Boolean(r[ix.website]),
      verdict: (judgments && judgments.get(r[ix.place_id])) || null
    }));

  /* B first: a bad website is the more specific complaint, and a business
     that qualifies for both sections belongs here. Sorted worst site first. */
  const b = all
    .filter(x => x.siteScore >= LIST.siteAuditMinScore)
    .sort((x, y) => y.siteScore - x.siteScore || x.name.localeCompare(y.name));
  const inB = new Set(b.map(x => x.id));

  /* A: worth a call because there is nothing of theirs online at all. */
  const a = all
    .filter(x => x.score >= LIST.minScore && !x.hasWebsite && !inB.has(x.id))
    .sort((x, y) => y.score - x.score || x.name.localeCompare(y.name));

  /* C: the shortlist. Deliberately not deduped against A or B — a business
     worth ringing should be on this tab whatever else it is. */
  const now = Date.now();
  const c = all
    .filter(x => x.verdict && x.verdict.score >= LIST.verdictMinScore)
    .sort((x, y) => y.verdict.score - x.verdict.score || x.name.localeCompare(y.name))
    .map(x => {
      const enriched = readEnrichment(x.id);
      const details = (enriched && enriched.details) || null;
      const auditRec = (auditRecords && auditRecords.get(x.id)) || null;
      return {
        ...x,
        score: x.verdict.score,
        pitch: x.verdict.pitch,
        oneLine: x.verdict.oneLine,
        /* Everything the brief needs, worked out here so the page only renders. */
        brief: {
          website: websiteLine(x, auditRec),
          reviewCount: details && Number.isFinite(details.userRatingCount) ? details.userRatingCount : null,
          newestReview: newestReviewAge(details, now),
          hasHours: details
            ? Boolean(details.regularOpeningHours &&
                      Array.isArray(details.regularOpeningHours.weekdayDescriptions) &&
                      details.regularOpeningHours.weekdayDescriptions.length)
            : null,
          size: x.verdict.size,
          customer: x.verdict.customer,
          signals: x.verdict.signals,
          oneLine: x.verdict.oneLine,
          pitch: x.verdict.pitch
        }
      };
    });

  return { total: body.length, sections: { c, a, b } };
}

/* ---------- the page ---------- */
function buildHtml(sections) {
  const payload = JSON.stringify(sections).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>Shop Check Call List</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root {
    --ground: #F4EFE6;
    --surface: #FBF8F2;
    --callout: #F3E7D3;
    --ink: #1C1917;
    --body-muted: #3D3833;
    --muted: #5C5650;
    --line: #CFC6B6;
    --track: #D9D1C3;
    --accent: #C4501B;
    --accent-hover: #A94314;
    --accent-dark: #8F3810;
    --on-accent: #FFF7EE;
    --hover-fill: #EFE7D9;
    --pressed-fill: #E6DCC9;
    --font: "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    --radius: 8px;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: var(--font);
    font-size: 17px;
    line-height: 1.5;
    background: var(--ground);
    color: var(--ink);
    -webkit-font-smoothing: antialiased;
    -webkit-text-size-adjust: 100%;
  }
  h1, h2, p { margin: 0; }
  a, button { font-family: inherit; }
  :focus { outline: none; }
  :focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }

  .wrap { max-width: 520px; margin: 0 auto; padding: 0 24px 40px; }
  /* The list is designed for a phone. On a tablet the column widens so an
     open brief gets two real columns rather than two narrow ones. */
  @media (min-width: 768px) { .wrap { max-width: 900px; } }

  header {
    position: sticky; top: 0; z-index: 5;
    background: var(--ground);
    padding: 20px 0 10px;
    border-bottom: 1px solid var(--line);
    margin-bottom: 20px;
  }
  .headrow { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
  .brand {
    font-size: 13px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.08em; color: var(--muted);
  }
  .counts {
    font-size: 26px; font-weight: 700; letter-spacing: -0.01em;
    line-height: 1.2; margin: 4px 0 10px;
  }
  .counts .done { color: var(--muted); font-weight: 600; }
  .bar { height: 4px; background: var(--track); border-radius: 2px; overflow: hidden; }
  .bar > div { height: 100%; width: 0%; background: var(--ink); border-radius: 2px; transition: width 200ms ease; }
  .reset {
    background: none; border: 0; padding: 8px 0; cursor: pointer;
    font-size: 14px; font-weight: 600; color: var(--muted);
    text-decoration: underline; text-underline-offset: 3px;
  }
  .reset:hover { color: var(--accent); }

  .hide {
    display: flex; align-items: center; gap: 10px;
    background: none; border: 0; cursor: pointer;
    padding: 10px 0; margin-top: 2px;
    font-size: 15px; font-weight: 600; color: var(--muted);
  }
  .hide:hover { color: var(--ink); }
  .hide .box {
    width: 22px; height: 22px; flex: none; border-radius: 5px;
    border: 2px solid var(--line); background: transparent;
    display: flex; align-items: center; justify-content: center;
  }
  .hide .box svg { width: 13px; height: 13px; display: none; }
  .hide[aria-pressed="true"] { color: var(--ink); }
  .hide[aria-pressed="true"] .box { border-color: var(--accent); background: var(--accent); }
  .hide[aria-pressed="true"] .box svg { display: block; }

  .card {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 18px;
    margin-bottom: 14px;
    display: flex; flex-direction: column; gap: 12px;
  }
  .card.hot { border: 2px solid var(--ink); }
  .card.done > *:not(.toggle) { opacity: 0.4; }
  .card.done { border-color: var(--line); border-width: 1px; background: transparent; }
  .list.hiding .card.done { display: none; }

  .top { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
  .name { font-size: 22px; font-weight: 700; line-height: 1.2; text-wrap: pretty; }
  .badge {
    flex: none; min-width: 44px; text-align: center;
    font-size: 15px; font-weight: 700; border-radius: 6px; padding: 4px 8px;
    background: var(--callout); color: var(--accent-dark);
  }
  .badge.high { background: var(--accent); color: var(--on-accent); }
  .trade {
    font-size: 13px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.06em; color: var(--muted); margin-top: -6px;
  }
  .why { font-size: 15px; line-height: 1.45; color: var(--body-muted); text-wrap: pretty; }
  .site {
    font-size: 14px; line-height: 1.45; color: var(--accent-dark);
    background: var(--callout); border-radius: 6px; padding: 10px 12px;
    text-wrap: pretty;
  }
  .site strong { font-weight: 700; }

  .call {
    display: flex; align-items: center; justify-content: center; gap: 10px;
    min-height: 60px; padding: 8px 14px; border-radius: var(--radius);
    background: var(--accent); color: var(--on-accent);
    font-size: 24px; font-weight: 700; letter-spacing: -0.01em;
    text-decoration: none; touch-action: manipulation;
  }
  .call:hover { background: var(--accent-hover); }
  .call:active { background: var(--accent-dark); }
  .call svg { width: 20px; height: 20px; flex: none; }
  button.call {
    appearance: none; -webkit-appearance: none;
    border: 0; width: 100%; cursor: pointer; text-align: center;
  }
  /* the copied message is longer than a phone number, so it steps down */
  .call.copied .calllabel { font-size: 17px; line-height: 1.25; }

  .links { display: flex; flex-wrap: wrap; gap: 20px; }
  .links a, .links button {
    font-size: 15px; font-weight: 600; color: var(--ink);
    text-decoration: underline; text-underline-offset: 3px; padding: 8px 0;
  }
  .links button {
    appearance: none; -webkit-appearance: none;
    background: none; border: 0; cursor: pointer; text-align: left;
  }
  .links a:hover, .links button:hover { color: var(--accent); }

  .toggle {
    display: flex; align-items: center; gap: 12px;
    width: 100%; min-height: 56px; padding: 10px 16px;
    background: transparent; border: 2px solid var(--ink); border-radius: var(--radius);
    font-size: 17px; font-weight: 600; color: var(--ink);
    text-align: left; cursor: pointer; touch-action: manipulation;
  }
  .toggle:hover { background: var(--hover-fill); }
  .toggle:active { background: var(--pressed-fill); }
  .toggle .ring {
    width: 26px; height: 26px; flex: none; border-radius: 50%;
    border: 2px solid var(--line); background: transparent;
    display: flex; align-items: center; justify-content: center;
  }
  .toggle .ring svg { width: 14px; height: 14px; display: none; }
  .card.done .toggle { border-color: var(--line); color: var(--muted); }
  .card.done .toggle .ring { border-color: var(--accent); background: var(--accent); }
  .card.done .toggle .ring svg { display: block; }

  .tabs { display: flex; gap: 6px; margin: 12px 0 2px; }
  .tab {
    flex: 1 1 0; min-width: 0;
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1px;
    min-height: 56px; padding: 7px 6px;
    background: transparent; border: 2px solid var(--line); border-radius: var(--radius);
    font-weight: 600; color: var(--muted);
    cursor: pointer; text-align: center; touch-action: manipulation;
  }
  .tab:hover { background: var(--hover-fill); color: var(--ink); }
  .tab .tablabel { font-size: 12.5px; line-height: 1.2; text-wrap: balance; }
  .tab .tabcount { font-size: 19px; font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1.1; }
  .tab[aria-selected="true"] {
    border-color: var(--ink); background: var(--surface); color: var(--ink);
  }

  /* the opening line is the thing being read off the screen mid-call */
  .opener {
    font-size: 19px; line-height: 1.45; color: var(--ink);
    text-wrap: pretty; margin: 2px 0;
  }
  .pitch {
    align-self: flex-start; flex: none;
    font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em;
    color: var(--accent-dark); background: var(--callout);
    border-radius: 4px; padding: 3px 8px;
  }

  /* ---------- the brief ---------- */
  /* While a brief is open the header stops being pinned, so the whole brief
     has the screen. You are reading it mid-call, not switching tabs. */
  body.reading header { position: static; }
  .card.open { border-color: var(--ink); }
  .expandable { cursor: pointer; }
  .brief {
    border-top: 2px solid var(--line); margin-top: 4px; padding-top: 18px;
    display: grid; gap: 22px;
  }
  @media (min-width: 768px) {
    .brief { grid-template-columns: 1fr 1fr; gap: 20px 32px; align-items: start; }
    .brief .col { display: flex; flex-direction: column; gap: 18px; }
  }
  .brief h3 {
    font-size: 13px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.09em; color: var(--muted); margin: 0 0 7px;
  }
  .know { margin: 0; padding: 0; list-style: none; }
  .know li {
    font-size: 16px; line-height: 1.4; padding: 4px 0 4px 18px;
    position: relative; text-wrap: pretty;
  }
  .know li::before {
    content: ""; position: absolute; left: 0; top: 13px;
    width: 7px; height: 7px; border-radius: 50%; background: var(--line);
  }
  .know li.flag::before { background: var(--accent); }

  .said { font-size: 16px; line-height: 1.45; margin: 0 0 8px;
          padding: 10px 14px; background: var(--callout); border-radius: 6px; text-wrap: pretty; }
  .said em { font-style: normal; font-weight: 700; text-transform: uppercase;
             font-size: 11px; letter-spacing: 0.07em; color: var(--accent-dark);
             display: block; margin-bottom: 3px; }
  .attrib { font-size: 13px; color: var(--muted); margin: 0 0 10px; }

  .opener-brief {
    font-size: 21px; line-height: 1.4; text-wrap: pretty; margin: 0;
    padding: 14px 18px; background: var(--callout); border-radius: 8px;
  }
  .offer { margin: 0; }
  .offer .lead { font-size: 16px; line-height: 1.45; margin: 0 0 12px; text-wrap: pretty; }
  .offer .lead b { display: block; font-size: 17px; }
  .offer .also { font-size: 15px; line-height: 1.4; color: var(--body-muted); margin: 0 0 5px; }
  .offer .also b { font-weight: 700; color: var(--ink); }

  .faq { margin: 0; }
  .faq dt { font-size: 15px; font-weight: 700; margin-top: 8px; }
  .faq dt:first-child { margin-top: 0; }
  .faq dd { margin: 2px 0 0; font-size: 15px; line-height: 1.45;
            color: var(--body-muted); text-wrap: pretty; }

  .outcomes { display: flex; flex-wrap: wrap; gap: 8px; }
  .outcome {
    flex: 1 1 auto; min-height: 48px; padding: 10px 14px; cursor: pointer;
    font-family: inherit; font-size: 15px; font-weight: 600; color: var(--ink);
    background: transparent; border: 2px solid var(--line); border-radius: 8px;
    touch-action: manipulation; white-space: nowrap;
  }
  .outcome:hover { background: var(--hover-fill); }
  .outcome[aria-pressed="true"] {
    background: var(--accent); border-color: var(--accent); color: var(--on-accent);
  }
  .notes {
    width: 100%; min-height: 96px; resize: vertical;
    font-family: inherit; font-size: 16px; line-height: 1.45; padding: 12px 14px;
    background: var(--surface); color: var(--ink);
    border: 2px solid var(--line); border-radius: 8px;
  }
  .saved { font-size: 13px; color: var(--muted); margin: 6px 0 0; min-height: 18px; }

  .empty { color: var(--muted); text-align: center; padding: 40px 0; font-size: 17px; }
  .foot { color: var(--muted); font-size: 14px; text-align: center; margin-top: 24px; line-height: 1.45; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div class="headrow">
      <div class="brand">Shop Check call list</div>
      <button class="reset" id="reset" type="button">Reset</button>
    </div>
    <h1 class="counts" id="counts">&nbsp;</h1>
    <div class="bar" aria-hidden="true"><div id="bar"></div></div>
    <div class="tabs" role="tablist">
      <button class="tab" id="tab-c" type="button" role="tab" aria-selected="true" aria-controls="list">
        <span class="tabcount" id="count-c"></span><span class="tablabel" id="label-c"></span>
      </button>
      <button class="tab" id="tab-a" type="button" role="tab" aria-selected="false" aria-controls="list">
        <span class="tabcount" id="count-a"></span><span class="tablabel" id="label-a"></span>
      </button>
      <button class="tab" id="tab-b" type="button" role="tab" aria-selected="false" aria-controls="list">
        <span class="tabcount" id="count-b"></span><span class="tablabel" id="label-b"></span>
      </button>
    </div>
    <button class="hide" id="hide" type="button" aria-pressed="false">
      <span class="box"></span><span>Hide called</span>
    </button>
  </header>
  <main class="list" id="list"></main>
  <p class="foot" id="foot"></p>
</div>

<script>
const SECTIONS = ${payload};
const TITLES = ${JSON.stringify({ c: LIST.sectionCTitle, a: LIST.sectionATitle, b: LIST.sectionBTitle })};
const TAB_ORDER = ["c", "a", "b"];
const SMS_PREFIX = ${JSON.stringify(LIST.smsPrefix)};
const MIN_SCORE = ${LIST.minScore};
const COPY = ${JSON.stringify({ copiedPhone: LIST.copiedPhone, copiedMessage: LIST.copiedMessage, copyFailed: LIST.copyFailed })};
const CALLED_KEY = "shopCheckCalled.v1";
const HIDE_KEY = "shopCheckHideCalled.v1";
const TAB_KEY = "shopCheckTab.v1";
const OUTCOME_KEY = "shopCheckOutcome.v1";
const NOTES_KEY = "shopCheckNotes.v1";
const SITE_MIN = ${LIST.siteAuditMinScore};
const VERDICT_MIN = ${LIST.verdictMinScore};
const BRIEF = ${JSON.stringify(LIST.brief)};

/* iPhones want "sms:NUMBER&body=", everything else "?body=" */
function isApple() {
  const ua = navigator.userAgent || "";
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 0);
}
function smsLink(number, body) {
  return "sms:" + number + (isApple() ? "&" : "?") + "body=" + encodeURIComponent(body);
}

/* Inside a frame (the claude.ai artifact viewer, for one) a tel: or sms:
   link never reaches the phone's dialler or messages app. There is no
   reliable way to find out whether the link fired, so when we are framed
   the buttons copy instead and say so. */
function inFrame() {
  try { return window.self !== window.top; } catch (e) { return true; }
}
const FRAMED = inFrame();

async function copyText(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) { /* blocked in this frame; fall through */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:0;left:0;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch (e) { return false; }
}

/* Swap a label to a message, then put it back. */
function flash(el, node, message, original) {
  if (node._flashTimer) clearTimeout(node._flashTimer);
  el.textContent = message;
  node.classList.add("copied");
  node._flashTimer = setTimeout(() => {
    el.textContent = original;
    node.classList.remove("copied");
    node._flashTimer = null;
  }, 2000);
}

/* localStorage can be missing or blocked; never let that break the page */
function readStore(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch (e) { return fallback; }
}
function writeStore(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode */ }
}

const called = new Set(Array.isArray(readStore(CALLED_KEY, [])) ? readStore(CALLED_KEY, []) : []);
let hiding = readStore(HIDE_KEY, false) === true;
/* A fresh visitor opens on "Best bets"; after that the page remembers. */
const storedTab = readStore(TAB_KEY, null);
let active = TAB_ORDER.includes(storedTab) ? storedTab : "c";
/* Outcome and notes live beside the ticks: keyed on the business, on this
   device only, same as everything else the page remembers. */
const outcomes = readStore(OUTCOME_KEY, {}) || {};
const notes = readStore(NOTES_KEY, {}) || {};
let openId = null;          /* only one brief open at a time */
/* Never open on an empty tab while another has work in it. */
if (!SECTIONS[active].length) {
  active = TAB_ORDER.find(k => SECTIONS[k].length) || active;
}
const rows = () => SECTIONS[active];

const listEl = document.getElementById("list");
const countsEl = document.getElementById("counts");
const barEl = document.getElementById("bar");
const footEl = document.getElementById("foot");
const hideEl = document.getElementById("hide");
const tabEls = Object.fromEntries(TAB_ORDER.map(k => [k, document.getElementById("tab-" + k)]));
const emptyEl = document.createElement("p");
emptyEl.className = "empty";

function svgPath(d, stroke) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", stroke ? "0 0 16 16" : "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute("d", d);
  if (stroke) {
    p.setAttribute("fill", "none");
    p.setAttribute("stroke", "#FFF7EE");
    p.setAttribute("stroke-width", "2.4");
    p.setAttribute("stroke-linecap", "round");
    p.setAttribute("stroke-linejoin", "round");
  } else {
    p.setAttribute("fill", "#FFF7EE");
  }
  svg.appendChild(p);
  return svg;
}
const tick = () => svgPath("M3 8.5l3.2 3.2L13 5", true);
const phoneIcon = () => svgPath("M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.58 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.46.57 3.6a1 1 0 0 1-.25 1z", false);

function el(tag, attrs, kids) {
  const n = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else n.setAttribute(k, v);
  }
  (kids || []).forEach(c => n.appendChild(typeof c === "string" ? document.createTextNode(c) : c));
  return n;
}

/* The counts come from the data, never from what is on screen, so
   hiding cards cannot change them. They follow the tab you are on; the
   tab buttons carry each section's own "left to call" number. */
function updateCounts() {
  const list = rows();
  const total = list.length;
  const done = list.filter(b => called.has(b.id)).length;
  const left = total - done;
  countsEl.textContent = "";
  countsEl.appendChild(document.createTextNode(left + " to call, "));
  countsEl.appendChild(el("span", { class: "done", text: done + " done" }));
  barEl.style.width = total ? Math.round((done / total) * 100) + "%" : "0%";

  for (const key of TAB_ORDER) {
    const sect = SECTIONS[key];
    const remaining = sect.filter(b => !called.has(b.id)).length;
    document.getElementById("label-" + key).textContent = TITLES[key];
    document.getElementById("count-" + key).textContent = String(remaining);
    tabEls[key].setAttribute("aria-selected", key === active ? "true" : "false");
    tabEls[key].setAttribute("aria-label",
      TITLES[key] + ", " + remaining + " of " + sect.length + " left to call");
  }

  if (!total) emptyEl.textContent = "Nothing in this section.";
  else if (!left && hiding) emptyEl.textContent = "All done. Nothing left to call.";
  else emptyEl.textContent = "";
  emptyEl.hidden = !emptyEl.textContent;
}

function applyHiding() {
  listEl.classList.toggle("hiding", hiding);
  hideEl.setAttribute("aria-pressed", hiding ? "true" : "false");
}

/* ---------- the brief ---------- */
function block(title, node) {
  const d = el("div");
  d.appendChild(el("h3", { text: title }));
  d.appendChild(node);
  return d;
}

function knowList(br) {
  const ul = el("ul", { class: "know" });
  const add = (text, flag) => {
    const li = el("li", { text });
    if (flag) li.className = "flag";
    ul.appendChild(li);
  };
  add(br.website.line, br.website.state !== "ok");

  if (br.reviewCount === null) add("Review count unknown.");
  else if (!br.reviewCount) add("No reviews at all.", true);
  else {
    add(br.reviewCount + " review" + (br.reviewCount === 1 ? "" : "s") +
        (br.newestReview ? ", newest " + br.newestReview + "." : "."),
        br.reviewCount < 10);
  }

  if (br.hasHours === null) add("Opening hours unknown.");
  else add(br.hasHours ? "Opening hours are listed." : "No opening hours listed.", !br.hasHours);

  add(br.size === "unknown" ? "Size unknown." : "Looks like a " + br.size + ".");
  add(br.customer === "unknown" ? "Who they work for is unknown."
      : "Works mainly for " + br.customer + ".");
  return ul;
}

function saidBlock(br) {
  const wrap = el("div");
  wrap.appendChild(el("p", { class: "attrib",
    text: "Their own words, from their Google reviews:" }));
  for (const s of br.signals) {
    wrap.appendChild(el("p", { class: "said" }, [
      el("em", { text: s.kind }), '"' + s.quote + '"'
    ]));
  }
  return wrap;
}

/* The module the judgment picked leads; the other two follow. */
function offerBlock(br) {
  const names = Object.keys(BRIEF.modules);
  const lead = names.includes(br.pitch) ? br.pitch
    : (br.signals.length ? "missed calls" : "website");
  const rest = names.filter(n => n !== lead);
  const wrap = el("div", { class: "offer" });
  const m = BRIEF.modules[lead];
  wrap.appendChild(el("p", { class: "lead" }, [ el("b", { text: m.name }), m.what ]));
  for (const n of rest) {
    wrap.appendChild(el("p", { class: "also" }, [
      el("b", { text: BRIEF.modules[n].name }), " — " + BRIEF.modules[n].what
    ]));
  }
  return wrap;
}

function faqBlock() {
  const dl = el("dl", { class: "faq" });
  for (const item of BRIEF.faq) {
    dl.appendChild(el("dt", { text: item.q }));
    dl.appendChild(el("dd", { text: item.a }));
  }
  return dl;
}

function outcomeBlock(b) {
  const row = el("div", { class: "outcomes" });
  const buttons = [];
  for (const name of BRIEF.outcomes) {
    const btn = el("button", { class: "outcome", type: "button", text: name,
                               "aria-pressed": outcomes[b.id] === name ? "true" : "false" });
    btn.addEventListener("click", () => {
      /* tapping the chosen one again clears it */
      outcomes[b.id] = outcomes[b.id] === name ? undefined : name;
      if (!outcomes[b.id]) delete outcomes[b.id];
      writeStore(OUTCOME_KEY, outcomes);
      buttons.forEach(x => x.setAttribute("aria-pressed",
        x.textContent === outcomes[b.id] ? "true" : "false"));
    });
    buttons.push(btn);
    row.appendChild(btn);
  }
  return row;
}

function notesBlock(b) {
  const wrap = el("div");
  const ta = el("textarea", { class: "notes", rows: "4",
    placeholder: "What they actually said\u2026" });
  ta.value = notes[b.id] || "";
  const saved = el("p", { class: "saved", text: notes[b.id] ? "Saved on this device." : "" });
  let timer = null;
  ta.addEventListener("input", () => {
    notes[b.id] = ta.value;
    if (!ta.value) delete notes[b.id];
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      writeStore(NOTES_KEY, notes);
      saved.textContent = ta.value ? "Saved on this device." : "";
    }, 250);
  });
  wrap.appendChild(ta);
  wrap.appendChild(saved);
  return wrap;
}

function briefFor(b) {
  const br = b.brief;
  const wrap = el("div", { class: "brief" });
  const left = el("div", { class: "col" });
  const right = el("div", { class: "col" });

  left.appendChild(block("What we know", knowList(br)));
  if (br.signals.length) left.appendChild(block("What their customers said", saidBlock(br)));
  left.appendChild(block("If they ask", faqBlock()));

  right.appendChild(block("Your opener", el("p", { class: "opener-brief", text: br.oneLine })));
  right.appendChild(block("What to offer", offerBlock(br)));
  right.appendChild(block("Outcome", outcomeBlock(b)));
  right.appendChild(block("Notes", notesBlock(b)));

  wrap.appendChild(left);
  wrap.appendChild(right);
  return wrap;
}

function card(b) {
  /* The badge is whatever the tab is ranked by, so the order always reads:
     verdict score on "Best bets", site score on "Bad website", Shop Check
     score on "Missing calls and reviews". */
  const onBestTab = active === "c";
  const onSiteTab = active === "b";
  const shown = onSiteTab ? b.siteScore : b.score;
  const urgent = onBestTab ? b.score >= 70 : onSiteTab ? b.siteScore >= 70 : b.score >= 90;
  const node = el("article", { class: "card" + (urgent ? " hot" : "") });
  node.appendChild(el("div", { class: "top" }, [
    el("h2", { class: "name", text: b.name }),
    el("span", {
      class: "badge" + (urgent ? " high" : ""), text: String(shown),
      title: onBestTab ? "Verdict score" : onSiteTab ? "Website score" : "Shop Check score"
    })
  ]));
  if (b.trade) node.appendChild(el("div", { class: "trade", text: b.trade }));

  if (onBestTab) {
    /* This tab exists to hand you the opening sentence, so that is the
       card: the pitch it belongs to, then the line, big enough to read
       while the phone is ringing. */
    if (b.pitch) node.appendChild(el("span", { class: "pitch", text: b.pitch }));
    if (b.oneLine) node.appendChild(el("p", { class: "opener", text: b.oneLine }));
  } else {
    const whyEl = b.why ? el("p", { class: "why", text: b.why }) : null;
    const siteEl = b.site ? el("p", { class: "site" }, [
      el("strong", { text: "Website: " }), b.site
    ]) : null;
    /* The headline problem comes first: the website on tab B, the reason
       they are worth a call on tab A. */
    for (const part of onSiteTab ? [siteEl, whyEl] : [whyEl, siteEl]) {
      if (part) node.appendChild(part);
    }
  }

  if (b.dial) {
    if (FRAMED) {
      const label = el("span", { class: "calllabel", text: b.phone });
      const btn = el("button", {
        class: "call", type: "button",
        "aria-label": "Copy the number for " + b.name + ", " + b.phone
      }, [phoneIcon(), label]);
      btn.addEventListener("click", async () => {
        const ok = await copyText(b.phone);
        flash(label, btn, ok ? COPY.copiedPhone : COPY.copyFailed, b.phone);
      });
      node.appendChild(btn);
    } else {
      node.appendChild(el("a", {
        class: "call", href: "tel:" + b.dial,
        "aria-label": "Call " + b.name + " on " + b.phone
      }, [phoneIcon(), b.phone]));
    }
  }

  const links = el("div", { class: "links" });
  if (b.maps) links.appendChild(el("a", { href: b.maps, target: "_blank", rel: "noopener", text: "Google listing" }));
  if (b.dial && b.link) {
    const message = SMS_PREFIX + b.link;
    if (FRAMED) {
      const send = el("button", { type: "button", text: "Send Shop Check link" });
      send.addEventListener("click", async () => {
        const ok = await copyText(message);
        flash(send, send, ok ? COPY.copiedMessage : COPY.copyFailed, "Send Shop Check link");
      });
      links.appendChild(send);
    } else {
      links.appendChild(el("a", { href: smsLink(b.dial, message), text: "Send Shop Check link" }));
    }
  }
  if (links.children.length) node.appendChild(links);

  const label = el("span", { text: "" });
  const toggle = el("button", { class: "toggle", type: "button" }, [el("span", { class: "ring" }, [tick()]), label]);
  const paint = () => {
    const done = called.has(b.id);
    node.classList.toggle("done", done);
    toggle.setAttribute("aria-pressed", done ? "true" : "false");
    label.textContent = done ? "Called" : "Mark as called";
  };
  toggle.addEventListener("click", () => {
    if (called.has(b.id)) called.delete(b.id); else called.add(b.id);
    writeStore(CALLED_KEY, [...called]);
    paint();
    updateCounts();
  });
  node.appendChild(toggle);

  /* On "Best bets" the whole card opens a brief. Taps that land on the phone
     button, a link, the tick, or anything inside the brief itself are that
     control's business, not the card's. */
  if (onBestTab && b.brief) {
    node.classList.add("expandable");
    node.setAttribute("tabindex", "0");
    node.setAttribute("aria-expanded", openId === b.id ? "true" : "false");
    let panel = null;

    const setOpen = wanted => {
      if (wanted) {
        if (openId && openId !== b.id) {
          const other = listEl.querySelector('.card.open');
          if (other && other._collapse) other._collapse();
        }
        openId = b.id;
        panel = briefFor(b);
        node.appendChild(panel);
        node.classList.add("open");
        node.setAttribute("aria-expanded", "true");
        /* Put the brief under the sticky header so the whole of it is on
           screen, rather than opening below the fold mid-call. */
        document.body.classList.add("reading");
        requestAnimationFrame(() => {
          const top = window.scrollY + panel.getBoundingClientRect().top - 12;
          window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
        });
      } else {
        if (panel) { panel.remove(); panel = null; }
        if (openId === b.id) openId = null;
        document.body.classList.remove("reading");
        node.classList.remove("open");
        node.setAttribute("aria-expanded", "false");
      }
    };
    node._collapse = () => setOpen(false);

    const fromControl = target =>
      target.closest("button, a, textarea, input, select, label, .brief");
    node.addEventListener("click", ev => {
      if (fromControl(ev.target)) return;
      setOpen(!node.classList.contains("open"));
    });
    node.addEventListener("keydown", ev => {
      if (ev.key !== "Enter" && ev.key !== " ") return;
      if (fromControl(ev.target)) return;
      ev.preventDefault();
      setOpen(!node.classList.contains("open"));
    });
    if (openId === b.id) setOpen(true);
  }

  paint();
  return node;
}

hideEl.addEventListener("click", () => {
  hiding = !hiding;
  writeStore(HIDE_KEY, hiding);
  applyHiding();
  updateCounts();
});

document.getElementById("reset").addEventListener("click", () => {
  if (!called.size) return;
  if (!confirm("Clear all " + called.size + " ticks?")) return;
  called.clear();
  writeStore(CALLED_KEY, []);
  paintList();
});

/* Ticks are keyed on the business, not the section, so a business that
   somehow appeared twice would stay in step. Switching tab just redraws. */
for (const key of TAB_ORDER) {
  tabEls[key].addEventListener("click", () => {
    if (active === key) return;
    active = key;
    writeStore(TAB_KEY, active);
    paintList();
  });
}

function footText() {
  const base = active === "c"
    ? "Scoring " + VERDICT_MIN + " and above on how likely they are to buy, best first."
    : active === "b"
    ? "Websites scoring " + SITE_MIN + " and above, worst first."
    : "No website at all, scoring " + MIN_SCORE + " and above, best prospects first.";
  return base + " Ticks are saved on this device only."
    + (FRAMED ? " Open this page in its own tab to tap straight through to your dialler." : "");
}

function paintList() {
  openId = null;             /* the old nodes are about to go */
  document.body.classList.remove("reading");
  listEl.textContent = "";
  rows().forEach(b => listEl.appendChild(card(b)));
  listEl.appendChild(emptyEl);
  footEl.textContent = footText();
  window.scrollTo(0, 0);
  applyHiding();
  updateCounts();
}

function render() {
  hideEl.querySelector(".box").appendChild(tick());
  paintList();
}

render();
</script>
</body>
</html>
`;
}

function main() {
  if (!fs.existsSync(SRC)) {
    console.error(`No prospects.csv at ${SRC}`);
    console.error('Run the finder first:  node find-prospects.js');
    process.exit(1);
  }
  const auditText = fs.existsSync(AUDIT_SRC) ? fs.readFileSync(AUDIT_SRC, 'utf8') : '';
  const audit = readAudit(auditText);
  const judgeText = fs.existsSync(JUDGE_SRC) ? fs.readFileSync(JUDGE_SRC, 'utf8') : '';
  const judgments = readJudgments(judgeText);
  const auditRecords = readAuditRecords(auditText);
  const { total, sections } = readProspects(fs.readFileSync(SRC, 'utf8'), audit, judgments, auditRecords);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(DEST, buildHtml(sections), 'utf8');
  const size = (fs.statSync(DEST).size / 1024).toFixed(0);
  console.log(`Read ${total} businesses from prospects.csv`);
  if (!judgeText) {
    console.log(`${LIST.sectionCTitle}: 0 — no judgments.json. Run judge-prospects.js to fill this tab.`);
  } else {
    console.log(`${LIST.sectionCTitle}: ${sections.c.length} (verdict score ${LIST.verdictMinScore}+)`);
  }
  console.log(`${LIST.sectionATitle}: ${sections.a.length} (no website, scoring ${LIST.minScore}+)`);
  if (!auditText) {
    console.log(`${LIST.sectionBTitle}: 0 — no site-audit.json. Run check-sites.js to fill this tab.`);
  } else {
    console.log(`${LIST.sectionBTitle}: ${sections.b.length} (site score ${LIST.siteAuditMinScore}+)`);
  }
  console.log(`Wrote ${DEST} (${size}K)`);
}

module.exports = { LIST, parseCsv, prettyTrade, dialable, readAudit, readAuditRecords, readJudgments, websiteLine, newestReviewAge, siteLine, siteScore, readProspects, buildHtml, main };

if (require.main === module) main();
