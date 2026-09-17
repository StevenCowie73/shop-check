'use strict';

/* Asking Claude to judge one business, and the prompt that holds it to
   what is actually in front of it. Moved out of judge-prospects.js so the
   single-business lookup asks exactly the question the batch run asks.

   Nothing here touches the filesystem — the batch script owns its cache,
   and the lookup endpoint has nowhere to write anyway. */

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
  reviewsPerBusiness: 5,     /* Places returns at most 5 */
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
businesses are worth a cold call. You are given what is publicly on a business's Google
listing and, when they have one, the text of their website.

Rules, in order of importance:

1. Use only what is in the input. Never state a fact that is not there. If the input does
   not settle a field, answer "unknown" or null rather than guessing. An inferred fact is
   still a guess.
2. Quote reviews only in short fragments, at most a dozen words, copied exactly.
3. Everything you write may be read aloud to the business owner. Write nothing that would
   embarrass the caller: no mockery, no speculation about their competence or finances, no
   sales patter, no flattery, no exclamation marks.
4. one_line is a plain spoken opening sentence, the kind one person says to another on the
   phone. It should sound like somebody local who looked them up, not somebody working
   through a list. It must be specific to this business and grounded in the input. No pitch,
   no "I noticed you might be losing customers", no questions designed to corner them.

5. one_line leads with the strongest evidence you actually have, in this order:
   a. A responsiveness problem a customer described. Speak to the customer's experience
      itself - somebody could not get a call back, somebody was waiting - not to the review
      as a review. Never say "a reviewer said" or "your reviews mention".
   b. Reviews being thin or old: only a handful, or nothing recent.
   c. The website: missing, or the specific thing wrong with it.
   Only lead with the website when there is genuinely nothing above it. Leading with a
   missing website when you had something better is the wrong answer.

6. When the evidence is thin and verdict_score is low, say so plainly instead of
   manufacturing a hook. "I could not find much about you online beyond the listing" is a
   better opener than a reason invented to have something to say.

Scoring verdict_score, 0-100, is how likely this business is to actually buy:
  - Small homeowner-facing operations showing signs they are missing calls or slow to reply
    are the best fit. Score them high.
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
      owner_name: { type: 'string', description: "The owner's name if it appears anywhere in the input. The single word unknown if it does not." },
      responsiveness_signals: {
        type: 'array',
        description: 'Review fragments suggesting missed calls, slow callbacks, unanswered messages or no-shows. Empty if there are none.',
        items: {
          type: 'object',
          properties: {
            quote: { type: 'string', description: 'A short fragment copied exactly from the review.' },
            kind: { type: 'string', enum: ['missed call', 'slow callback', 'unanswered message', 'no-show', 'other'] }
          },
          required: ['quote', 'kind'],
          additionalProperties: false
        }
      },
      reputation: { type: 'string', enum: ['strong', 'mixed', 'weak', 'too few reviews'] },
      best_pitch: { type: 'string', enum: ['missed calls', 'reviews', 'website', 'multiple', 'skip'] },
      /* A strict tool schema rejects minimum/maximum, so the range lives in
         the description and the value is clamped when it comes back. */
      verdict_score: { type: 'integer', description: 'How likely this business is to actually buy, from 0 to 100.' },
      one_line: { type: 'string', description: 'One plain spoken sentence to open a phone call with.' },
      reasoning: { type: 'string', description: 'Two sentences at most.' }
    },
    required: ['size', 'size_evidence', 'customer', 'owner_name', 'responsiveness_signals',
               'reputation', 'best_pitch', 'verdict_score', 'one_line', 'reasoning'],
    additionalProperties: false
  }
};


/* ---------- what Claude is shown ---------- */
function reviewLines(details) {
  const reviews = (details && details.reviews) || [];
  return reviews.slice(0, JUDGE.reviewsPerBusiness).map(r => ({
    rating: r.rating,
    when: r.relativePublishTimeDescription || r.publishTime || '',
    author: (r.authorAttribution && r.authorAttribution.displayName) || '',
    text: (r.originalText && r.originalText.text) || (r.text && r.text.text) || ''
  })).filter(r => r.text);
}

/* The Places API (New) does not return the owner's replies to reviews.
   If a field ever appears, it gets picked up here rather than silently. */
function ownerReplies(details) {
  const out = [];
  for (const r of (details && details.reviews) || []) {
    const reply = r.reply || r.ownerResponse || r.authorReply;
    const text = reply && (reply.text && reply.text.text || reply.text);
    if (text) out.push({ to: (r.originalText && r.originalText.text || '').slice(0, 80), text });
  }
  return out;
}

function buildInput(record) {
  const d = record.details || {};
  const a = record.audit;
  const reviews = reviewLines(d);
  const replies = ownerReplies(d);
  const lines = [];
  lines.push(`Name: ${record.prospect.name}`);
  lines.push(`Trade as Google lists it: ${d.primaryTypeDisplayName && d.primaryTypeDisplayName.text || record.prospect.trade || 'unknown'}`);
  lines.push(`Business status: ${d.businessStatus || 'unknown'}`);
  lines.push(`Rating: ${d.rating != null ? d.rating : 'none'} from ${d.userRatingCount != null ? d.userRatingCount : 0} reviews`);
  if (d.priceLevel) lines.push(`Price level: ${d.priceLevel}`);
  if (d.editorialSummary && d.editorialSummary.text) lines.push(`Google's summary: ${d.editorialSummary.text}`);
  if (d.regularOpeningHours && d.regularOpeningHours.weekdayDescriptions) {
    lines.push(`Opening hours: ${d.regularOpeningHours.weekdayDescriptions.join('; ')}`);
  }
  lines.push(`What the finder flagged: ${record.prospect.why || 'nothing'}`);

  lines.push('');
  if (reviews.length) {
    lines.push(`Reviews (${reviews.length} of ${d.userRatingCount || reviews.length}):`);
    for (const r of reviews) lines.push(`- ${r.rating} stars, ${r.when}, ${r.author}: ${r.text}`);
  } else {
    lines.push('Reviews: none returned.');
  }

  lines.push('');
  if (replies.length) {
    lines.push('Owner replies to reviews:');
    for (const r of replies) lines.push(`- ${r.text}`);
  } else {
    lines.push('Owner replies to reviews: not available from this source.');
  }

  lines.push('');
  if (a) {
    lines.push(`Website audit: ${a.website}`);
    lines.push(`- needs-replacing score ${a.siteScore} out of 100: ${a.whatsWrong || 'nothing recorded'}`);
    if (a.title) lines.push(`- page title: ${a.title}`);
  } else if (record.prospect.website) {
    lines.push(`Website: ${record.prospect.website} (not audited)`);
  } else {
    lines.push('Website: none listed.');
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
  for (const s of judgment.responsiveness_signals || []) check('responsiveness_signals', s.quote);
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
      '(judge-prospects.js is the only part of finder/ with a dependency.)'
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
  JUDGE, SYSTEM_PROMPT, JUDGMENT_TOOL,
  reviewLines, ownerReplies, buildInput,
  leaked, orNull, loadSdk, judgeRecord, pool
};
