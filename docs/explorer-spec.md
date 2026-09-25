# Explorer — spec (v1)

Steven's private, phone-first page for browsing everything the ColdenJames
engine finds and does. v1 runs on **invented demo data only**; real data
arrives when the database exists.

## Where and who

- `https://signal.cowie.ai/explorer`, behind the same password as Signal
  (`LOOKUP_PASSWORD`). `noindex`. Never linked from coldenjames.com (the
  public site's middleware answers `/explorer` with its 404).
- Portrait phone first. The existing design system: IBM Plex Sans, ground
  `#F4EFE6`, surface `#FBF8F2`, ink `#1C1917`, accent `#C4501B`, 8px radius,
  no shadows, no gradients.

## Screens

1. **Home**
   - Funnel counts: found → selected → letter sent → page opened → replied →
     client. Counts only; no percentages until a denominator reaches 100.
   - Activity feed, newest first: calls to the ColdenJames number, texts in
     and out, prospect pages opened, letters sent, search runs ("Youngsville
     test: 43 active, 20 picked"). Each item taps through to its business
     where there is one.
   - Quick filter chips that jump to the List: No website, Broken site, New
     licence (12 months), Not contacted, Replied.
2. **Map**
   - A Google map (Maps JavaScript API). Changed on 25 September 2026 from
     the original non-Google map: Google's terms do not allow Places content
     (the business screen's listing) in an app that also has a non-Google
     map. Browser key in `GOOGLE_MAPS_BROWSER_KEY`, restricted to this site
     and the Maps JavaScript API; until it is set the screen says "Map key
     not set". Pins are still our own Census-geocoded licence addresses.
   - One pin per business, coloured by status: not contacted, letter sent,
     page opened, replied, client, closed. Legend.
   - Area filter (Bossier/Caddo, Youngsville, later others). Tap a pin →
     small card → open business.
   - Pin location = the licence mailing address, geocoded with the US Census
     Geocoder (public, no storage limits). Labelled clearly: pins show the
     licence address, not necessarily a shop.
3. **List**
   - Search by name, town, trade. Filters: area, status, website state
     (fine / poor / broken / none found / unknown / blocked), licence age,
     has email.
   - Rows: business name, town, trade, status, website state.
4. **Business**
   - Licence board facts: company, owner (qualifying party), licence types,
     first issued, status, email, phone, mailing address.
   - Website check in plain words: loads or not, HTTPS, works on a phone,
     newest year seen, phone number visible, what the audit found
     (including "couldn't check — the site blocks automated visits"), and a
     button to open the actual site in a new tab.
   - Google listing fetched **live** through the Places proxy when opened
     (rating, review count, the reviews Google returns, hours), with the
     Google logo and attribution exactly as on the prospect page. Nothing
     from Google is stored or sent to any model. No place_id: say so.
   - Letter: view the letter as sent (or drafted).
   - Timeline: every event for this business — selected, letter sent, page
     opened (and how often), texts/calls, reply, outcome.
   - Notes: short dated notes ("drove past the yard", "skip — family
     friend") and a "do not contact" flag.
5. **Runs**
   - Each pipeline run: area, date, funnel numbers, cost, problems found.
     Tap to see the businesses it picked.

## Data

- Postgres schema in `db/migrations/` (areas, runs, prospects, audits,
  letters, events, messages, notes, overrides, outcomes).
- A data layer with two backends: **DEMO** (in-memory invented data, used
  now) and **POSTGRES** (used once `COLDENJAMES_URL` or `DATABASE_URL` is
  set). Nothing else changes when switching.
- Importers, ready for later and not run against real data yet: LSLBC pilot
  outputs, audits, rendered letters, tracking events, Twilio call/text
  history.
- Calls and texts in the feed may be read live from the Twilio API for the
  ColdenJames number, numbers masked to the last 4 digits unless the number
  belongs to a known prospect.

## Demo data (invented only)

- About 25 made-up businesses across Bossier City, Shreveport and
  Youngsville, invented owners, fake emails on example.com, generic street
  addresses. A mix of statuses and website states. A few timeline events,
  two notes, two runs.
- "DEMO DATA" bannered at the top of every screen while in demo mode.
- No real business names anywhere. `npm run check:names` must pass.

## Rules

- No real prospect data in the repo or in this build. No emails, letters,
  texts or calls sent.
- Don't change the Twilio routes, the campaign, the prospect pages or
  coldenjames.com.
- Tests for: the password gate, the demo banner, filters, the business
  screen's Google attribution, notes saving (in demo: in memory), and that
  no Google fields are persisted.

## Decisions taken while building v1

- One serverless function (`api/explorer.js`) serves the page and its JSON
  actions, keeping the deployment inside Vercel's function limit.
  `/explorer` is a rewrite to it.
- The Google listing is fetched by the business's stored `place_id` only —
  never a place id from the request — and returned as ready-made HTML using
  the same renderer as the prospect page (`api/places.js`). The only Google
  value the schema keeps is `place_id`, which Google's terms allow storing.
- Demo pins are placed near each town's centre (the invented addresses do
  not exist to geocode). Real records are geocoded by the importer with the
  Census Geocoder and the coordinates stored with `geocode_source = 'census'`.
- Live Twilio calls and texts appear in the feed in demo mode too, marked
  "live", because they are the one real thing Explorer can already show.
- **Google's AI summaries (Explorer only).** The business screen asks Places
  for `reviewSummary`, `reviewSummary.reviewsUri` and `generativeSummary`
  (same SKU as reviews, so no extra cost) and shows them exactly as Google's
  AI-summary policy requires: heading "Review summary", full text, the
  disclosure text directly underneath, "About this summary", "Report
  summary", "See reviews", and the line about reporting content. A summary
  missing a required piece is not shown. Display only; never stored or sent
  to a model. The prospect pages do not ask for them.
