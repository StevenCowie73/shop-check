'use strict';

/* Asking Claude to judge one business, and the prompt that holds it to
   what is actually in front of it. Moved out of judge-prospects.js so the
   single-business lookup asks exactly the question the batch run asks.

   Nothing here touches the filesystem, and nothing from Google reaches the
   model. Google's listing is shown to Steven on the card, live and with
   attribution; it is never part of what Claude is asked to read. The model
   sees only first-party material: what Steven typed, our own check of the
   business's website, and the text on that website. buildInput is the only
   door, and it does not read the Places response at all. */

const { sleep } = require('./env.js');

/* =====================================================================
   1. EDIT ME.
   ===================================================================== */
const JUDGE = {
  model: 'claude-sonnet-4-6',
  maxTokens: 2000,
  concurrency: 4,            /* judgments in flight at once */
  maxRetries: 6,             /* on top of the SDK's own retrying */
  previewCount: 10,          /* how many to do before stopping for confirmation */

  siteTextChars: 6000,       /* how much homepage text to send */
  fetchTimeoutMs: 10000,
  fetchDelayMs: 1200,        /* between homepage fetches */
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',

  /* Cost estimates are arithmetic on these numbers, not quotes. CHECK BOTH
     against current pricing before running the full set.
     places: Place Details including reviews falls in the Places API (New)
     Enterprise + Atmosphere SKU, priced per 1000 calls.
     claude: claude-sonnet-4-6 input/output, per million tokens. */
  pricing: {
    placesPer1000Usd: 25.00,
    claudeInputPerMTokUsd: 3.00,
    claudeOutputPerMTokUsd: 15.00
  }
};

/* The judging prompt. Everything it is allowed to say comes from the
   input; there is nothing here inviting it to fill gaps. */
const SYSTEM_PROMPT = `You are helping a one-person web services business decide which small trade
businesses are worth a cold call. You are given the name the caller typed, the result of our
own check of the business's website, and, when there is one, the text of that website. You
are not given anything from Google or any review site, so you cannot know how the business
is rated, how many reviews it has, or what customers said. Do not guess at any of that.

Rules, in order of importance:

1. Use only what is in the input. Never state a fact that is not there. If the input does
   not settle a field, answer "unknown" or null rather than guessing. An inferred fact is
   still a guess.
2. Everything you write may be read aloud to the business owner. Write nothing that would
   embarrass the caller: no mockery, no speculation about their competence or finances, no
   sales patter, no flattery, no exclamation marks.
3. one_line is a plain spoken opening sentence, the kind one person says to another on the
   phone. It should sound like somebody local who looked them up, not somebody working
   through a list. It must be specific to this business and grounded in the input. No pitch,
   no "I noticed you might be losing customers", no questions designed to corner them.
4. one_line leads with the most specific thing the website check or the website itself
   shows: no website found, the specific thing wrong with it, or something concrete on it.
   Never mention reviews, ratings or anything a customer said.
5. When the evidence is thin and verdict_score is low, say so plainly instead of
   manufacturing a hook. "I could not find much about you online" is a better opener than a
   reason invented to have something to say.

Scoring verdict_score, 0-100, is how likely this business is to actually buy:
  - Small homeowner-facing operations with no website, or a website that does not work on
    a phone, are the best fit. Score them high.
  - Established firms whose customers are other contractors or businesses are the worst fit,
    however bad their web presence looks. Score them low.
  - Too little evidence means a middling score, not a high one.`;

const JUDGMENT_TOOL = {
  name: 'record_judgment',
  description: 'Record the judgment of one business.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      size: { type: 'string', enum: ['solo', 'small crew', 'established firm', 'unknown'] },
      size_evidence: { type: 'string', description: 'The evidence that decided size. The single word unknown if there is none.' },
      customer: { type: 'string', enum: ['homeowners', 'businesses/contractors', 'both', 'unknown'] },
      owner_name: { type: 'string', description: "The owner's name if it appears on their website text. The single word unknown if it does not." },
      best_pitch: { type: 'string', enum: ['missed calls', 'website', 'multiple', 'skip'] },
      /* A strict tool schema rejects minimum/maximum, so the range lives in
         the description and the value is clamped when it comes back. */
      verdict_score: { type: 'integer', description: 'How likely this business is to actually buy, from 0 to 100.' },
      one_line: { type: 'string', description: 'One plain spoken sentence to open a phone call with.' },
      reasoning: { type: 'string', description: 'Two sentences at most.' }
    },
    required: ['size', 'size_evidence', 'customer', 'owner_name',
               'best_pitch', 'verdict_score', 'one_line', 'reasoning'],
    additionalProperties: false
  }
};


/* ---------- what Claude is shown ---------- */

/* Judgment fields that used to come from Google reviews. The model is no
   longer shown reviews, so these are never assessed; the card says so
   rather than leaving a gap that looks like "none found". */
const NOT_ASSESSED = Object.freeze(['reputation', 'responsiveness_signals']);

/* Google content that can turn up on a business's own homepage — an
   embedded reviews widget, or hours copied from the listing. It is still
   Google's, so it is cut out of the homepage text before the model sees
   it. Matching is on whole review sentences, reviewer names and hours
   lines; the business's own name, phone and address are left alone, since
   those are theirs to publish. */
function stripGoogleContent(text, details) {
  let out = String(text || '');
  if (!out || !details) return out;
  const cut = [];
  for (const r of details.reviews || []) {
    for (const t of [r.text && r.text.text, r.originalText && r.originalText.text]) {
      if (!t) continue;
      cut.push(t);
      for (const sentence of String(t).split(/(?<=[.!?])\s+|\n+/)) if (sentence.trim().length >= 20) cut.push(sentence.trim());
    }
    const who = r.authorAttribution && r.authorAttribution.displayName;
    if (who && who.trim().length >= 4) cut.push(who.trim());
  }
  for (const h of (details.regularOpeningHours && details.regularOpeningHours.weekdayDescriptions) || []) cut.push(h);
  for (const h of (details.currentOpeningHours && details.currentOpeningHours.weekdayDescriptions) || []) cut.push(h);
  if (details.editorialSummary && details.editorialSummary.text) cut.push(details.editorialSummary.text);
  cut.sort((a, b) => b.length - a.length);
  for (const c of cut) out = out.split(c).join('[removed: Google content]');
  return out;
}

/* The whole of what the model reads. It takes named first-party fields
   only; a Places response handed to it by mistake is ignored, because
   nothing here reads record.details or record.listing. */
function buildInput(record) {
  const a = record.audit;
  const lines = [];
  lines.push(`Business, as the caller typed it: ${record.query || 'unknown'}`);
  if (record.licence) {
    const l = record.licence;
    lines.push('From the Louisiana contractor licensing board:');
    if (l.company) lines.push(`- licensed name: ${l.company}`);
    if (l.types && l.types.length) lines.push(`- licence: ${l.types.join(', ')}`);
    if (l.firstIssued) lines.push(`- first issued: ${l.firstIssued}`);
    if (l.city) lines.push(`- mailing town: ${l.city}`);
  }

  lines.push('');
  if (a) {
    lines.push('Our check of their website:');
    /* A site we were not allowed to fetch has no score. Say so plainly so
       the judgment cannot read a missing number as a bad one. */
    if (a.siteScore === null || a.skipped) {
      lines.push(`- not checked: ${a.whatsWrong || 'we were not able to look at it'}. Treat its website as unknown, not bad.`);
    } else {
      lines.push(`- needs-replacing score ${a.siteScore} out of 100: ${a.whatsWrong || 'nothing recorded'}`);
    }
    if (a.title) lines.push(`- page title: ${a.title}`);
  } else if (record.hasWebsite) {
    lines.push('Website: found but not checked.');
  } else {
    lines.push('Website: we found none.');
  }

  lines.push('');
  if (record.siteText) {
    lines.push('Text of their homepage:');
    lines.push(record.siteText);
  } else {
    lines.push(`Text of their homepage: ${record.siteTextNote || 'not available'}.`);
  }
  return lines.join('\n');
}

/* ---------- judging ---------- */

/* ---------- guarding the answer ---------- */
const SCAFFOLDING = /<\/?antml|<\/?parameter\b|<\/?function_calls\b|<\/?invoke\b/i;

function leaked(judgment) {
  const bad = [];
  const check = (label, value) => {
    if (typeof value === 'string' && SCAFFOLDING.test(value)) bad.push(label);
  };
  check('owner_name', judgment.owner_name);
  check('size_evidence', judgment.size_evidence);
  check('one_line', judgment.one_line);
  check('reasoning', judgment.reasoning);
  return bad;
}

/* "unknown" is the answer we asked for when there is nothing; null is what
   we store, so the CSV column is empty rather than saying unknown. */
function orNull(value) {
  const s = String(value == null ? '' : value).trim();
  return !s || s.toLowerCase() === 'unknown' || s.toLowerCase() === 'none' ? null : s;
}

function loadSdk() {
  try { return require('@anthropic-ai/sdk'); }
  catch (e) {
    throw new Error(
      'The Anthropic SDK is not installed. From finder/, run:  npm install\n' +
      '(the Signal lookup is the only part of finder/ that calls a model.)'
    );
  }
}


async function judgeRecord(client, Anthropic, record) {
  const input = buildInput(record);
  let wait = 2000;
  for (let attempt = 1; attempt <= JUDGE.maxRetries; attempt++) {
    try {
      const res = await client.messages.create({
        model: JUDGE.model,
        max_tokens: JUDGE.maxTokens,
        system: SYSTEM_PROMPT,
        tools: [JUDGMENT_TOOL],
        tool_choice: { type: 'tool', name: 'record_judgment' },
        messages: [{ role: 'user', content: input }]
      });
      const call = res.content.find(b => b.type === 'tool_use');
      if (!call) throw new Error('Claude returned no judgment for ' + record.placeId);
      const spoiled = leaked(call.input);
      if (spoiled.length) {
        throw Object.assign(
          new Error(`the model wrote tool-call markup into ${spoiled.join(', ')}`),
          { retryable: true }
        );
      }
      const judgment = {
        placeId: record.placeId,
        judgedAt: new Date().toISOString(),
        model: JUDGE.model,
        usage: { input: res.usage.input_tokens, output: res.usage.output_tokens },
        ...call.input,
        /* never shown reviews, so never assessed */
        reputation: 'not assessed',
        responsiveness_signals: null,
        /* the schema asks for the word "unknown"; null is what we store */
        owner_name: orNull(call.input.owner_name),
        size_evidence: orNull(call.input.size_evidence) || '',
        verdict_score: Math.max(0, Math.min(100, Number(call.input.verdict_score) || 0))
      };
      return judgment;
    } catch (err) {
      const retryable = err.retryable
        || err instanceof Anthropic.RateLimitError
        || (err instanceof Anthropic.APIError && err.status >= 500)
        || err instanceof Anthropic.APIConnectionError;
      if (!retryable || attempt === JUDGE.maxRetries) throw err;
      await sleep(wait);
      wait = Math.min(wait * 2, 60000);
    }
  }
}

/* Small pool so we are not firing 333 requests at once. */

async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}

/* ---------- output ---------- */

module.exports = {
  JUDGE, SYSTEM_PROMPT, JUDGMENT_TOOL, NOT_ASSESSED,
  stripGoogleContent, buildInput,
  leaked, orNull, loadSdk, judgeRecord, pool
};
