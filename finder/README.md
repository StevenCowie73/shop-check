# Shop Check prospect finder

Builds a ranked call list of small trade businesses near a point, using the
Google Places API (New). It reads public business listings, scores each one
on how much it is missing the things Shop Check recommends, and writes a CSV
and a JSON file.

It does not contact anyone. It sends no messages and writes no outreach copy.
It only builds a list.

## What you need

- Node 18 or newer. Check with `node --version`.
- A Google Cloud project with **Places API (New)** enabled and billing on.
- An API key from that project.

Run `npm install` at the repo root before anything else. `undici` is needed
whenever the machine reaches the internet through a proxy (see **Behind a
proxy** below), and the Signal lookup also needs the Anthropic SDK.
`judge-prospects.js` is retired and refuses to run: it sent Google Maps
content to a model. The lookup's judgment sees first-party data only.

The parts all four share — scoring, the website audit, the judgment prompt —
live in `finder/lib/`. Edit them there, not in the scripts.

## Behind a proxy

If `HTTPS_PROXY` or `https_proxy` is set in your environment, read this before
running anything that fetches a website.

Node's built-in `fetch` ignores those variables. It only honours them when the
process is started with `--use-env-proxy`, and that cannot be switched on once
the process is running. Left alone, every request goes out unproxied, a scatter
of them fail, and the audit records perfectly live websites as dead. There is no
error and no warning — the run simply finishes and lies to you. That happened
here, twice, across two full audits.

So `lib/http.js`, whenever a proxy variable is present, uses undici's own
`fetch` with undici's proxy dispatcher, and every request in `finder/` goes
through it. It must be undici's own fetch: Node's built-in fetch driven by
the npm undici dispatcher loses every response header over HTTP/2 — a 301
arrives with no Location, the redirect is never followed, and a live site is
recorded as "the server answered 301". That also happened here. It needs the
`undici` package:

```
npm install        # at the repo root
```

If a proxy is set and undici is missing, the scripts stop immediately with:

```
Proxy detected but undici is not installed — run npm install at the repo root
```

That is deliberate. A refusal to start costs a minute; an audit that quietly
marks live sites dead costs a re-run and can put a false claim in a letter.

With no proxy variable set — a plain laptop, or Vercel — none of this runs.
undici is not even loaded, and behaviour is exactly as it was.

## Setting the key

```
cd finder
cp .env.example .env
```

Open `.env` and replace the placeholder with your key:

```
GOOGLE_PLACES_API_KEY=AIza...your-key...
```

`.env` is git-ignored. The key is sent only as a request header, never in a
URL, and is stripped out of anything the script prints if an error mentions it.

Lock the key down in the Google Cloud console: restrict it to the Places API,
and set an API restriction or a quota cap so a mistake cannot run up a bill.

## Running it

```
cd finder
node find-prospects.js
```

or `npm run find`.

It prints progress per search term, then a summary: how many businesses it
found, how many scored above 50, how many API calls it made, and the top ten
with score, name and phone.

## The call list page

After a run, build a phone-friendly page from the CSV:

```
node make-call-list.js
```

or `npm run calls`. It writes `out/call-list.html`, a single self-contained
file holding every business scoring 60 or above, best first. Open it on your
phone: each card has the name, score, trade, the reason they need us, and the
phone number as a big tap-to-call button, plus links to the Google listing and
to text them their Shop Check link. Tick businesses off as you call them, and
the ticks stay put on that device. "Hide called" clears the ones you are done
with out of the way.

The cut-off score and the text you send are at the top of
`make-call-list.js`, in the `LIST` block.

## Auditing the websites they do have

Of the businesses the finder turns up, plenty have a website that is worse
than no website. This checks them:

```
node check-sites.js
```

or `npm run sites`. It visits every prospect that lists a website, one at a
time, and scores how badly the site needs replacing: does it load at all, is
it still plain http, was it ever built for phones, is there a phone number on
the page, how old is the newest date on it, is it running dead technology, and
is it really their own site rather than a Facebook or Yelp page.

It writes `out/site-audit.csv` with the site score, the prospect score, name,
phone, website and a plain-English "what's wrong" line, worst first, and
`out/site-audit.json` with everything it recorded for each site. The worst 15
are printed at the end.

It is deliberately polite: one request at a time, a ten second timeout, a
normal browser user agent, `robots.txt` respected including any crawl-delay,
and no retries. A site that errors is recorded and left alone.

Options: `--limit 20` checks only the first 20, `--start 40` skips the first 40
so you can pick up a part-finished run.

The scoring weights and the visiting settings are two objects at the top of
`check-sites.js`.

If every single site comes back with the same error, that is a firewall, a
proxy or a captive network between you and the internet, not 200 broken
websites. Try one of the addresses in your own browser before believing it.

## What it writes

- `out/prospects.csv` — sorted by score, highest first. Columns: score, name,
  phone, address, website, rating, reviews, primary_type, google_maps_url,
  place_id, why, shop_check_link.
- `out/prospects.json` — the same rows plus the settings used, the skip
  counts, the distance in miles, and which search term found each business.

`out/` is git-ignored. The list contains real phone numbers and this is a
public repository, so generated lists stay on your machine.

The `shop_check_link` column is a Shop Check link with the business name
already filled in and a `ref` tag set from the place id, so you can tell which
prospect a reply came from.

## Editing it

Everything editable is at the top of `find-prospects.js`, in three blocks.

**SEARCH** — the center point as lat/lng, the radius in miles, and the list of
search terms. The default is Bossier City, LA at 30 miles. Note that the API
caps a single circular search at about 31 miles; a larger radius is clamped,
so to cover more ground run again from a second center point.

**SCORING** — the weights. Defaults:

| Signal | Points |
| --- | --- |
| No website at all | 40 |
| Website is a Facebook or Instagram page | 30 |
| Fewer than 10 reviews | 25 |
| 10 to 24 reviews | 15 |
| No rating yet | 10 |
| No opening hours listed | 10 |
| Has a phone number | 15 |

A business with no phone number scores 0 and is marked unreachable, because
there is nobody to call. Scores are capped at 100.

**CHAIN_BLOCKLIST** — lowercase name fragments. Any business whose name
contains one is skipped. Add your own. Keep entries specific so a local shop
is not caught by accident.

## Cost

One API call covers up to 20 results, and the script asks for at most three
pages per term, so a full run with the default ten terms is at most 30 calls.
The summary line at the end tells you exactly how many it made.

The fields this script asks for, in particular phone number, website and
opening hours, fall in a higher-priced tier than name and address alone. Check
current Places API pricing before running it repeatedly, and use the API call
count to keep track.

## Notes and limits

- The Places text search returns at most 60 results per term, so a dense area
  can return more businesses than one run can see. Narrowing the radius or
  splitting into several center points gets more coverage.
- Results are only as good as what business owners have put on Google. A shop
  with a real website that it never linked on Google will look like it has no
  website.
- Businesses marked as closed are skipped.
- Retries are automatic on rate limits and server errors, with a growing wait
  between attempts. A bad key or a malformed request stops the run instead of
  retrying.
