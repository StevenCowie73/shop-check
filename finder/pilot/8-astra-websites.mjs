/* Step 8. Asks Astra for one thing per company: their own website.

   It is sent the company name and the town, and nothing else. No phone, no
   email, no licence detail, and nothing from Google — Places terms forbid
   passing their data to a third party, and none of it would help anyway.

   Costs money. Roughly $0.20 a lookup at the time of writing, and the run
   stops rather than pass SPEND_CAP. Every raw response is written to disk
   before anything is parsed, because a crash after the API call has billed
   should not also lose the answer.

   Usage:  PILOT_ASTRA_ROUND=1 GPT_API_KEY=... node 8-astra-websites.mjs */

import fs from 'fs';
import { createRequire } from 'module';
const P = createRequire(import.meta.url)('./lib/paths.js');

const ROUND = process.env.PILOT_ASTRA_ROUND || '1';
const RAW = P.astraRaw(ROUND);
const TARGETS = P.astraTargets;
const RESULTS = P.astraWebsites(ROUND);
const KEY = process.env.GPT_API_KEY;
if (!KEY) { console.error('GPT_API_KEY is not set'); process.exit(1); }
const scrub = s => String(s).split(KEY).join('[REDACTED]');
const PRICE = { in: 10 / 1e6, cachedIn: 1 / 1e6, out: 50 / 1e6, search: 10 / 1000 };
const SPEND_CAP = 15;            /* stop and report rather than run past this */
const sleep = ms => new Promise(r => setTimeout(r, ms));

fs.mkdirSync(RAW, { recursive: true });
fs.mkdirSync(P.at('astra'), { recursive: true });
const targets = JSON.parse(fs.readFileSync(TARGETS, 'utf8'));

const prompt = (name, city) => `Find the official website of this business, if it has one.

Business name: ${name}
Town: ${city}, Louisiana, USA

Rules you must follow:
- Answer with the website's full address, and the URL of the page where you found it stated to belong to this business.
- If you cannot establish a website from a source you actually opened, answer exactly "not found". Never guess, never infer from the name, never offer a likely-looking domain.
- A Facebook, Instagram or directory listing is not a website of their own. If that is all that exists, answer "not found" and say what you did find.
- Be certain the source refers to this business in this town in Louisiana, not a similarly named business elsewhere. If you cannot tell, answer "not found".

Answer in exactly two lines:
WEBSITE: <full address, or not found>
SOURCE: <URL you opened, or why nothing could be confirmed>`;

const slug = s => s.replace(/[^A-Za-z0-9]+/g, '_').slice(0, 60);
let spent = 0;
const results = [];

for (let i = 0; i < targets.length; i++) {
  const t = targets[i];
  if (spent >= SPEND_CAP) {
    console.error(`STOPPED at ${i}/${targets.length}: spend cap $${SPEND_CAP} reached ($${spent.toFixed(2)})`);
    break;
  }
  const started = Date.now();
  let res, text;
  try {
    res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-6-astra',
        input: prompt(t.company, t.city),
        tools: [{ type: 'web_search' }],
        max_output_tokens: 1200
      })
    });
    text = await res.text();
  } catch (err) {
    results.push({ ...t, error: scrub(String(err && err.message)) , website: 'not found' });
    console.error(`${i + 1}/${targets.length} ${t.company}: request failed`);
    continue;
  }
  /* on disk before anything is parsed — a crash after billing must not lose it */
  fs.writeFileSync(`${RAW}/${String(i).padStart(2, '0')}_${slug(t.company)}.json`, scrub(text));

  let j = null;
  try { j = JSON.parse(text); } catch (e) { /* handled below */ }
  if (!j || j.error) {
    results.push({ ...t, error: 'HTTP ' + res.status, website: 'not found' });
    console.error(`${i + 1}/${targets.length} ${t.company}: HTTP ${res.status}`);
    await sleep(1000);
    continue;
  }

  const u = j.usage || {};
  const cachedIn = (u.input_tokens_details && u.input_tokens_details.cached_tokens) || 0;
  const freshIn = (u.input_tokens || 0) - cachedIn;
  const searches = (j.output || []).filter(o => o.type === 'web_search_call').length;
  const cost = freshIn * PRICE.in + cachedIn * PRICE.cachedIn +
               (u.output_tokens || 0) * PRICE.out + searches * PRICE.search;
  spent += cost;

  let answer = '';
  for (const m of (j.output || []).filter(o => o.type === 'message')) {
    for (const c of (m.content || [])) if (c.type === 'output_text') answer += c.text;
  }
  const w = /WEBSITE:\s*(.+)/i.exec(answer);
  const src = /SOURCE:\s*(.+)/i.exec(answer);
  let website = w ? w[1].trim() : 'not found';
  if (/^not found$/i.test(website) || !/^https?:\/\/|\./.test(website)) website = 'not found';
  if (website !== 'not found') {
    const m2 = /(https?:\/\/[^\s)]+|[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/.exec(website);
    website = m2 ? (m2[1].startsWith('http') ? m2[1] : 'https://' + m2[1]) : 'not found';
  }

  results.push({ ...t, website, source: src ? src[1].trim() : '', answer, cost, searches });
  console.error(`${i + 1}/${targets.length} ${((Date.now() - started) / 1000).toFixed(0)}s $${cost.toFixed(3)}  ${t.company.slice(0, 34).padEnd(36)} ${website}`);
  fs.writeFileSync(RESULTS, JSON.stringify({ spent, results }, null, 1));
  await sleep(800);
}

fs.writeFileSync(RESULTS, JSON.stringify({ spent, results }, null, 1));
console.error(`\nTOTAL SPEND: $${spent.toFixed(2)} over ${results.length} lookups`);
console.error(`found: ${results.filter(r => r.website !== 'not found').length}, not found: ${results.filter(r => r.website === 'not found').length}`);
