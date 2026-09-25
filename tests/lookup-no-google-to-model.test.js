'use strict';

/* Nothing from Google Maps reaches a model.

   The Signal lookup shows Steven the Google listing, but the judgment is
   asked on first-party data only. These tests run a whole lookup against a
   fake Places response in which every Google field carries a unique marker,
   capture the exact request that would go to Claude, and look for the
   markers in it. Nothing here touches the network. */

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { lookupOne } = require('../finder/lib/lookup.js');
const { JUDGMENT_TOOL, SYSTEM_PROMPT, buildInput, stripGoogleContent } = require('../finder/lib/judge.js');
const { formatPlain } = require('../finder/lib/format.js');

const M = {
  name: 'MKNAME7q Pelican Point Roofing',
  phone: '(318) 555-0MK1',
  address: '1 MKADDR3z Street, Bossier City, LA',
  rating: 3.14159,
  count: 271828,
  review: 'MKREVIEW9x they never called me back after three tries.',
  review2: 'MKREVIEWB2 great work on our roof, would hire again.',
  author: 'MKAUTHOR4k Reviewer',
  hours: 'Monday: MKHOURS5p 7:00 AM – 5:00 PM',
  summary: 'MKSUMMARY6w roofing contractor',
  type: 'MKTYPE8v Roofer',
  site: 'https://mksite2j-roofing.example.com/'
};
const MARKERS = ['MKNAME7q', '0MK1', 'MKADDR3z', '3.14159', '271828', 'MKREVIEW9x', 'MKREVIEWB2',
  'MKAUTHOR4k', 'MKHOURS5p', 'MKSUMMARY6w', 'MKTYPE8v', 'mksite2j'];

const PLACE = {
  id: 'ChIJmarker',
  displayName: { text: M.name },
  formattedAddress: M.address,
  nationalPhoneNumber: M.phone,
  rating: M.rating,
  userRatingCount: M.count,
  businessStatus: 'OPERATIONAL',
  primaryType: 'roofing_contractor',
  primaryTypeDisplayName: { text: M.type },
  editorialSummary: { text: M.summary },
  websiteUri: M.site,
  regularOpeningHours: { weekdayDescriptions: [M.hours] },
  reviews: [
    { rating: 1, relativePublishTimeDescription: 'a month ago', text: { text: M.review }, originalText: { text: M.review },
      authorAttribution: { displayName: M.author, uri: 'https://maps.google.com/contrib/1' } },
    { rating: 5, relativePublishTimeDescription: 'a year ago', text: { text: M.review2 },
      authorAttribution: { displayName: 'MKAUTHOR4k Second' } }
  ]
};

/* Their own homepage, which — like many trade sites — embeds a Google
   reviews widget and copies its hours from the listing. */
const HOMEPAGE = 'Family-run roofing since 1998. Free estimates, call Dale any time. ' +
  'What our customers say: ' + M.review + ' — ' + M.author + '. ' + M.review2 + ' ' +
  'Hours: ' + M.hours + '. Serving Bossier and Caddo parishes.';

function fakes() {
  const sent = [];
  class FakeAnthropic {
    constructor() {
      this.messages = {
        create: async body => {
          sent.push(JSON.parse(JSON.stringify(body)));
          return {
            content: [{ type: 'tool_use', name: 'record_judgment', input: {
              size: 'small crew', size_evidence: 'family-run, per the homepage', customer: 'homeowners',
              owner_name: 'Dale', best_pitch: 'website', verdict_score: 64,
              one_line: 'I had a look at your website and it is hard to read on a phone.',
              reasoning: 'Homeowner roofing crew. The site is not built for phones.'
            } }],
            usage: { input_tokens: 900, output_tokens: 120 }
          };
        }
      };
    }
  }
  FakeAnthropic.RateLimitError = class extends Error {};
  FakeAnthropic.APIError = class extends Error {};
  FakeAnthropic.APIConnectionError = class extends Error {};

  const deps = {
    Anthropic: FakeAnthropic,
    places: {
      searchText: async () => ({ places: [{ id: PLACE.id, displayName: PLACE.displayName, formattedAddress: M.address }] }),
      placeDetails: async () => JSON.parse(JSON.stringify(PLACE))
    },
    siteAudit: {
      checkSite: async row => ({ website: row.website, loads: true, skipped: false, status: 200, title: 'Home | Roofing',
        viewport: false, phoneOnPage: true, newestYear: 2019, deadTech: [] }),
      scoreSite: () => ({ score: 55, signals: [], whatsWrong: 'it was never built for phones' }),
      fetchSiteText: async () => ({ text: HOMEPAGE, note: '' })
    }
  };
  return { sent, deps };
}

test('a full lookup sends Claude no Google field at all', async () => {
  const { sent, deps } = fakes();
  const r = await lookupOne('pelican point roofing bossier', { placesKey: 'k', anthropicKey: 'a', deps });

  assert.strictEqual(sent.length, 1, 'one request to the model');
  const body = JSON.stringify(sent[0]);
  for (const m of MARKERS) assert.strictEqual(body.includes(m), false, 'the model request contains ' + m);

  /* what it does contain: first-party material only */
  const input = sent[0].messages[0].content;
  assert.match(input, /as the caller typed it: pelican point roofing bossier/);
  assert.match(input, /needs-replacing score 55 out of 100: it was never built for phones/);
  assert.match(input, /Family-run roofing since 1998/);
  assert.match(input, /\[removed: Google content\]/, 'the embedded reviews widget was cut out');

  /* the card still shows the listing, live, to Steven */
  assert.strictEqual(r.listing.rating, M.rating);
  assert.strictEqual(r.listing.reviewCount, M.count);
  assert.deepStrictEqual(r.listing.hours, [M.hours]);
  assert.strictEqual(r.listing.name, M.name);
  assert.strictEqual(r.evidence.googleSentToModel, false);
  /* and the prompt it shows as "sent" is the one that was sent */
  assert.strictEqual(r.evidence.promptSent, input);
});

test('review-based judgment fields are gone from the schema and read "not assessed"', async () => {
  const props = Object.keys(JUDGMENT_TOOL.input_schema.properties);
  assert.strictEqual(props.includes('responsiveness_signals'), false);
  assert.strictEqual(props.includes('reputation'), false);
  assert.strictEqual(JUDGMENT_TOOL.input_schema.properties.best_pitch.enum.includes('reviews'), false);
  assert.match(SYSTEM_PROMPT, /not given anything from Google/);
  assert.strictEqual(/Quote reviews/.test(SYSTEM_PROMPT), false);

  const { deps } = fakes();
  const r = await lookupOne('pelican point roofing', { placesKey: 'k', anthropicKey: 'a', deps });
  assert.strictEqual(r.judgment.reputation, 'not assessed');
  assert.strictEqual(r.judgment.responsiveness_signals, null);
  const plain = formatPlain(r);
  assert.match(plain, /Reputation:\s+not assessed/);
  assert.match(plain, /Signs of missed calls in reviews: not assessed/);
  assert.match(plain, /nothing from Google/);
});

test('buildInput ignores a Places response even if one is handed to it', () => {
  const input = buildInput({ query: 'x', details: PLACE, listing: PLACE, prospect: { name: M.name, why: M.summary },
    audit: null, hasWebsite: false, siteText: '', siteTextNote: 'no website found' });
  for (const m of MARKERS) assert.strictEqual(input.includes(m), false, m);
  assert.match(input, /Website: we found none\./);
});

test('Google content on a homepage is cut, the business’s own words are kept', () => {
  const out = stripGoogleContent(HOMEPAGE, PLACE);
  for (const m of ['MKREVIEW9x', 'MKREVIEWB2', 'MKAUTHOR4k', 'MKHOURS5p']) assert.strictEqual(out.includes(m), false, m);
  assert.ok(out.includes('Family-run roofing since 1998.'));
  assert.ok(out.includes('Serving Bossier and Caddo parishes.'));
  assert.strictEqual(stripGoogleContent('plain text', null), 'plain text');
});

test('no website: the model is told we found none, not Google’s word for it', async () => {
  const { sent, deps } = fakes();
  deps.places.placeDetails = async () => ({ ...JSON.parse(JSON.stringify(PLACE)), websiteUri: undefined });
  await lookupOne('pelican point roofing', { placesKey: 'k', anthropicKey: 'a', deps });
  const body = JSON.stringify(sent[0]);
  for (const m of MARKERS) assert.strictEqual(body.includes(m), false, m);
  assert.match(sent[0].messages[0].content, /Website: we found none\./);
});

test('judge-prospects.js is retired: it refuses to run and has no npm script', () => {
  let err = null;
  try { execFileSync(process.execPath, [path.join(__dirname, '..', 'finder', 'judge-prospects.js')], { stdio: 'pipe' }); }
  catch (e) { err = e; }
  assert.ok(err, 'it exits non-zero');
  assert.strictEqual(err.status, 1);
  assert.match(String(err.stderr), /retired: it sent Google Maps content/);
  for (const f of ['package.json', 'finder/package.json']) {
    const scripts = require(path.join(__dirname, '..', f)).scripts || {};
    assert.strictEqual(Object.values(scripts).some(v => /judge-prospects/.test(v)), false, f);
  }
});
