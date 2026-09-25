'use strict';

/* Step 1. Walks every Residential (25) and Home Improvement (27) licence in
   the run's parishes on the LSLBC public ARLS, and saves each detail page
   to disk. The parishes (default Caddo 2098 and Bossier 1815) and an
   optional town list come from lib/area.js; with a town list, only those
   towns' detail pages are fetched.

   Manners: one request at a time, at least three seconds apart, never in
   parallel. This is a public register run by a small state board, not a CDN.

   HTTP 204 from this server means "you are going too fast", never "no such
   record". Reading it as an empty result is the single most expensive mistake
   available here: the walk finishes, looks complete, and silently omits every
   record it was throttled on. So a 204 backs off 60 seconds, then doubles, and
   asks for the same record again. If the throttle has not lifted after ten
   minutes the walk stops rather than guessing.

   Resumable: every detail page is written to out/lslbc/details/ as it arrives
   and a record already on disk is never fetched twice, so if it stops for any
   reason, run it again and it picks up where it left off. */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const P = require('./lib/paths.js');
const AREA = require('./lib/area.js');
/* Through lib/http.js, so a proxy is honoured the same way as everywhere else. */
const { fetch } = require('../lib/http.js');
const DETAILS = P.lslbcDetails;
fs.mkdirSync(DETAILS, { recursive: true });
const BASE = 'https://arlspublic.lslbc.louisiana.gov';
const UA = 'ShopCheckResearch/1.0';
const GAP_MS = 3200;          /* the floor the task sets, plus a little */
const BACKOFF_START_MS = 60000;
const THROTTLE_GIVE_UP_MS = 10 * 60 * 1000;

const PARISHES = AREA.parishes();
const TYPES = { 25: 'Residential License Certificate', 27: 'Home Improvement Registration' };

const sleep = ms => new Promise(r => setTimeout(r, ms));
const slug = key => crypto.createHash('sha1').update(key).digest('hex').slice(0, 16);
const log = msg => {
  const line = new Date().toISOString().slice(11, 19) + '  ' + msg;
  console.log(line);
  fs.appendFileSync(P.crawlLog, line + '\n');
};

/* One request, with the 204 back-off wrapped around it. Returns the body,
   or throws if the throttle outlasts THROTTLE_GIVE_UP_MS. */
async function request(url, init) {
  let waited = 0;
  let backoff = BACKOFF_START_MS;
  for (;;) {
    const res = await fetch(url, init);
    if (res.status === 204) {
      if (waited >= THROTTLE_GIVE_UP_MS) {
        throw new Error('THROTTLED: still 204 after ' + Math.round(waited / 1000) + 's');
      }
      log('  throttled (204) — backing off ' + (backoff / 1000) + 's');
      await sleep(backoff);
      waited += backoff;
      backoff *= 2;
      continue;
    }
    if (res.status !== 200) throw new Error('HTTP ' + res.status + ' for ' + url);
    return await res.text();
  }
}

function parseRows(html) {
  const out = [];
  for (const cell of html.split(/<tr[^>]*>/i).slice(1)) {
    const k = /ShowAccountDetails\('([^']+)'/.exec(cell);
    if (!k) continue;
    const nm = /href="#void"[^>]*>([^<]*)</.exec(cell);
    const tds = [...cell.matchAll(/<td>\s*([^<]*?)\s*<\/td>/g)].map(x => x[1]);
    out.push({ key: k[1], listName: (nm ? nm[1] : '').trim(), listCity: tds[0] || '', listState: tds[1] || '' });
  }
  return out;
}

async function main() {
  /* ---- 1. the four result lists ---------------------------------- */
  const index = new Map();   /* key -> { key, listName, listCity, sources[] } */
  const listCounts = {};
  for (const [countyId, parish] of Object.entries(PARISHES)) {
    for (const [typeId, typeName] of Object.entries(TYPES)) {
      const label = parish + ' / ' + typeName;
      const html = await request(BASE + '/Public/_DetailedSearch/', {
        method: 'POST',
        headers: {
          'User-Agent': UA,
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Requested-With': 'XMLHttpRequest',
          Referer: BASE + '/Public/DetailedSearch/Advanced'
        },
        body: new URLSearchParams({
          SearchType: 'Advanced', LocationCounty: countyId, AccountDefinitionIdnt: typeId
        }).toString()
      });
      if (/ResultsTruncated[^>]*>\s*-\s*Displaying First 1500/.test(html)) {
        throw new Error('list truncated at 1500 for ' + label + ' — needs splitting');
      }
      const rows = parseRows(html);
      listCounts[label] = rows.length;
      for (const r of rows) {
        const seen = index.get(r.key);
        if (seen) seen.sources.push(label);
        else index.set(r.key, { ...r, sources: [label] });
      }
      log('list ' + label + ': ' + rows.length + ' rows');
      await sleep(GAP_MS);
    }
  }
  const everyone = [...index.values()];
  /* Only the towns this run is about get their detail pages fetched. */
  const all = everyone.filter(r => AREA.wantTown(r.listCity));
  fs.writeFileSync(P.lslbcIndex, JSON.stringify({
    listCounts, towns: AREA.towns(), all: everyone, wanted: all
  }, null, 1));
  log('unique licence holders across the lists: ' + everyone.length +
      (AREA.towns().length ? '; in ' + AREA.towns().join('/') + ': ' + all.length : ''));

  /* ---- 2. the detail pages, resumably ----------------------------- */
  let fetched = 0, skipped = 0;
  for (let i = 0; i < all.length; i++) {
    const rec = all[i];
    const file = path.join(DETAILS, slug(rec.key) + '.html');
    if (fs.existsSync(file) && fs.statSync(file).size > 200) { skipped++; continue; }
    const url = BASE + '/Public/_DisplayOnlineDetails/?key=' +
      rec.key.replace(/%3d/gi, '%3D') + '&Source=DetailedSearch';
    const html = await request(url, { headers: { 'User-Agent': UA } });
    fs.writeFileSync(file, html);
    fetched++;
    if (fetched % 25 === 0) log('  ' + (i + 1) + '/' + all.length + ' (' + fetched + ' fetched, ' + skipped + ' already had)');
    await sleep(GAP_MS);
  }
  log('DONE. fetched ' + fetched + ', already had ' + skipped + ', total ' + all.length);
}

main().catch(err => {
  log('STOPPED: ' + err.message);
  process.exitCode = 1;
});
