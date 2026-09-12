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

No `npm install` is needed. The script has no dependencies.

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
