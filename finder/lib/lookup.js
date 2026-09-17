'use strict';

/* Everything the pipeline knows about ONE business, gathered in one go.

   This is the whole of the single-business lookup. It calls the same
   scoring, the same website audit and the same judgment prompt the batch
   scripts call, so what the iPad shows and what judgments.csv says cannot
   disagree.

   It writes nothing. No cache, no files, no prospect data at rest. */

const places = require('./places.js');
const { scoreBusiness, shopCheckLink } = require('./prospect.js');
const { checkSite, scoreSite, fetchSiteText } = require('./site-audit.js');
const { JUDGE, buildInput, reviewLines, ownerReplies, loadSdk, judgeRecord } = require('./judge.js');

/* The search only needs enough to identify a business; details fills the
   rest in. Keeping this mask small keeps the search on the cheaper tier. */
const LOOKUP_SEARCH_FIELDS = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.businessStatus'
].join(',');

/* Arithmetic, not quotes. Check against current pricing. */
const PRICING = {
  searchPer1000Usd: 32.00,     /* Text Search, the identifying fields above */
  detailsPer1000Usd: 25.00,    /* Place Details including reviews */
  claudeInputPerMTokUsd: JUDGE.pricing.claudeInputPerMTokUsd,
  claudeOutputPerMTokUsd: JUDGE.pricing.claudeOutputPerMTokUsd
};

const STEPS = [
  { key: 'search', label: 'finding the business' },
  { key: 'listing', label: 'reading the listing' },
  { key: 'website', label: 'checking the website' },
  { key: 'reviews', label: 'reading reviews' }
];

function costOf({ searches, details, inputTokens, outputTokens }) {
  const search = searches * (PRICING.searchPer1000Usd / 1000);
  const detail = details * (PRICING.detailsPer1000Usd / 1000);
  const claude = (inputTokens / 1e6) * PRICING.claudeInputPerMTokUsd
               + (outputTokens / 1e6) * PRICING.claudeOutputPerMTokUsd;
  return {
    searches, details, inputTokens, outputTokens,
    usd: Math.round((search + detail + claude) * 10000) / 10000,
    breakdown: {
      search: Math.round(search * 10000) / 10000,
      details: Math.round(detail * 10000) / 10000,
      claude: Math.round(claude * 10000) / 10000
    }
  };
}

/* A field nobody could establish says so. It is never blank and never
   filled in with something plausible. */
const UNKNOWN = 'unknown';
const orUnknown = v => (v === null || v === undefined || v === '' ? UNKNOWN : v);

async function lookupOne(query, opts) {
  const { placesKey, anthropicKey, onProgress = () => {} } = opts;
  const say = (key, label) => onProgress({ step: key, label, steps: STEPS });
  const startCounts = places.counts();
  let searches = 0, details = 0;

  /* ---- 1. find it ---- */
  say('search', 'finding the business');
  const found = await places.searchText(placesKey, {
    textQuery: query,
    pageSize: 5,
    fieldMask: LOOKUP_SEARCH_FIELDS,
    maxRetries: 2
  });
  searches++;
  const hits = Array.isArray(found.places) ? found.places : [];

  if (!hits.length) {
    /* Not a failure. A trade business with no Google listing is the
       strongest version of the problem Shop Check solves, and saying so
       plainly is the finding. */
    return {
      found: false,
      query,
      headline: 'No Google listing found',
      explanation:
        'Nothing on Google Places matches that name. Either they have no Google Business ' +
        'Profile at all, they trade under a different name on Google, or their listing is ' +
        'unverified or suspended and so is not served by the API.',
      whatItMeans:
        'If they genuinely have no listing, they are invisible to anyone searching for their ' +
        'trade locally — which is a bigger problem than anything on the call list, and worth ' +
        'a conversation.',
      evidence: [`Places text search for "${query}" returned 0 results.`],
      cost: costOf({ searches, details, inputTokens: 0, outputTokens: 0 }),
      alternatives: []
    };
  }

  const pick = hits[0];
  const others = hits.slice(1, 4).map(p => ({
    name: (p.displayName && p.displayName.text) || '',
    address: p.formattedAddress || '',
    placeId: p.id
  }));

  /* ---- 2. read the listing ---- */
  say('listing', 'reading the listing');
  const d = await places.placeDetails(placesKey, pick.id);
  details++;

  const name = (d.displayName && d.displayName.text) || (pick.displayName && pick.displayName.text) || '';
  const website = d.websiteUri || '';
  const scored = scoreBusiness(d);

  const listing = {
    name,
    placeId: pick.id,
    address: pick.formattedAddress || '',
    phone: d.nationalPhoneNumber || '',
    trade: (d.primaryTypeDisplayName && d.primaryTypeDisplayName.text) || UNKNOWN,
    businessStatus: d.businessStatus || UNKNOWN,
    rating: typeof d.rating === 'number' ? d.rating : null,
    reviewCount: Number.isFinite(d.userRatingCount) ? d.userRatingCount : 0,
    priceLevel: d.priceLevel || UNKNOWN,
    hours: (d.regularOpeningHours && d.regularOpeningHours.weekdayDescriptions) || null,
    editorialSummary: (d.editorialSummary && d.editorialSummary.text) || null,
    website: website || null,
    shopCheckLink: shopCheckLink(name, pick.id),
    googleMapsUrl: `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(pick.id)}`,
    prospectScore: scored.score,
    prospectWhy: scored.why,
    prospectSignals: scored.signals,
    unreachable: scored.unreachable
  };

  /* ---- 3. the website ---- */
  say('website', 'checking the website');
  let audit = null, siteText = '', siteTextNote = 'no website listed';
  if (website) {
    /* checkSite records what it saw; scoreSite turns that into the score
       and the plain-English line. Same two steps the batch audit runs. */
    const seen = await checkSite({
      name, phone: listing.phone, website,
      prospectScore: scored.score, placeId: pick.id
    });
    const sited = scoreSite(seen);
    audit = Object.assign(seen, {
      siteScore: sited.score,
      signals: sited.signals,
      whatsWrong: sited.whatsWrong
    });
    const st = await fetchSiteText(website);
    siteText = st.text;
    siteTextNote = st.note;
  }

  /* ---- 4. the judgment ---- */
  say('reviews', 'reading reviews');
  const record = {
    placeId: pick.id,
    prospect: {
      name, phone: listing.phone, website,
      trade: d.primaryType || '',
      why: scored.why,
      prospectScore: scored.score
    },
    audit,
    details: d,
    siteText,
    siteTextNote
  };

  let judgment = null, judgeError = null;
  if (anthropicKey) {
    try {
      const Anthropic = loadSdk();
      const client = new Anthropic({ apiKey: anthropicKey, maxRetries: 3 });
      judgment = await judgeRecord(client, Anthropic, record);
    } catch (err) {
      judgeError = String((err && err.message) || err);
    }
  } else {
    judgeError = 'no Anthropic key configured';
  }

  const usage = (judgment && judgment.usage) || { input: 0, output: 0 };

  return {
    found: true,
    query,
    listing,
    audit: audit ? {
      siteScore: audit.siteScore,
      whatsWrong: audit.whatsWrong,
      loads: audit.loads,
      skipped: audit.skipped,
      problem: audit.problem || null,
      status: audit.status,
      title: audit.title || null,
      scheme: audit.finalScheme || audit.declaredScheme || null,
      viewport: audit.viewport,
      phoneOnPage: audit.phoneOnPage,
      newestYear: audit.newestYear,
      deadTech: audit.deadTech || [],
      signals: audit.signals || []
    } : null,
    judgment,
    judgeError,
    evidence: {
      reviewsRead: reviewLines(d),
      ownerReplies: ownerReplies(d),
      ownerRepliesAvailable: false,   /* Places API (New) does not return them */
      siteTextChars: siteText.length,
      siteTextNote,
      promptSent: buildInput(record)
    },
    alternatives: others,
    cost: costOf({ searches, details, inputTokens: usage.input, outputTokens: usage.output })
  };
}

module.exports = { lookupOne, STEPS, PRICING, costOf, UNKNOWN, orUnknown, LOOKUP_SEARCH_FIELDS };
