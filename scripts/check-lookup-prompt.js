#!/usr/bin/env node
'use strict';

/* Runs one live Signal lookup and checks that what was sent to the model
   contains nothing from the Google listing.

     LOOKUP_PASSWORD=... node scripts/check-lookup-prompt.js "a business name, town"

   The lookup returns the listing it showed and, as evidence.promptSent,
   the exact text the model was given. This compares the two and prints
   field names and verdicts only, never a value, so the output is safe to
   paste anywhere.

   A business's name, phone or address can turn up legitimately inside
   the text of its own homepage. Those are reported as "in homepage text"
   rather than as a failure; anything found outside that section fails. */

const { fetch } = require('../finder/lib/http.js');

const BASE = process.env.SIGNAL_URL || 'https://signal.cowie.ai';

async function main() {
  const query = process.argv.slice(2).join(' ').trim();
  const pw = process.env.LOOKUP_PASSWORD;
  if (!query || !pw) {
    console.error('usage: LOOKUP_PASSWORD=... node scripts/check-lookup-prompt.js "business name, town"');
    process.exit(2);
  }
  const res = await fetch(BASE + '/api/lookup', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-lookup-password': pw },
    body: JSON.stringify({ query })
  });
  if (!res.ok) { console.error('lookup refused: HTTP ' + res.status); process.exit(1); }
  const text = await res.text();
  const m = /event: result\ndata: (.*)\n/.exec(text);
  if (!m) { console.error('no result event (the lookup failed or found nothing to judge)'); process.exit(1); }
  const r = JSON.parse(m[1]);
  if (!r.found) { console.log('no Google listing matched, so nothing was judged. Try another name.'); return; }
  if (!r.judgment) { console.log('the judgment did not run: ' + (r.judgeError || 'unknown reason')); }

  const prompt = r.evidence.promptSent || '';
  const cut = prompt.indexOf('Text of their homepage:');
  const outside = cut >= 0 ? prompt.slice(0, cut) : prompt;
  const L = r.listing;
  const fields = {
    'name': L.name,
    'phone': L.phone,
    'address': L.address,
    'rating': L.rating != null ? String(L.rating) : '',
    'review count': L.reviewCount ? String(L.reviewCount) + ' review' : '',
    'Google trade label': L.trade && L.trade !== 'unknown' ? L.trade : '',
    'editorial summary': L.editorialSummary || '',
    'website address': L.website ? L.website.replace(/^https?:\/\//, '').replace(/\/$/, '') : '',
    ...Object.fromEntries((L.hours || []).map((h, i) => ['hours line ' + (i + 1), h]))
  };
  let failed = 0;
  for (const [label, value] of Object.entries(fields)) {
    if (!value || String(value).length < 3) { console.log('  -     ' + label + ': not on the listing'); continue; }
    const inOutside = outside.includes(value);
    const inPrompt = prompt.includes(value);
    if (inOutside) { failed++; console.log('  FAIL  ' + label + ': sent to the model'); }
    else if (inPrompt) console.log('  note  ' + label + ': appears only in their own homepage text');
    else console.log('  ok    ' + label + ': not sent');
  }
  console.log('googleSentToModel flag: ' + r.evidence.googleSentToModel);
  console.log(failed ? failed + ' Google field(s) reached the model.' : 'PASS: no Google listing field reached the model.');
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error(e.message); process.exit(1); });
