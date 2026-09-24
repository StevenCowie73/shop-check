# The pilot: a call-and-letter list from public licence records

This builds a shortlist of small contractors in Caddo and Bossier parishes
from the Louisiana State Licensing Board for Contractors public register, and
renders a letter for each of the top twenty.

It exists because the Places-based finder cannot be the source of **stored**
prospect records: Google's terms forbid keeping business names, addresses,
phones and reviews. A state licence register is public record, so it can be
stored, and it carries something Places never gives you — an email address and
the owner's name.

Everything it reads or writes lives in `out/`, which is git-ignored and must
stay that way. It is all real names, addresses, phone numbers and email
addresses of real people, and this repository is public.

## The chain

Run in order. Steps 4 onwards are cheap and can be re-run freely.

| | command | what it does | reaches out to |
|-|---------|--------------|----------------|
| 1 | `npm run pilot:walk` | Walks every Residential and Home Improvement licence in Caddo and Bossier, saving each detail page | lslbc.louisiana.gov |
| 2 | `npm run pilot:parse` | Turns the saved pages into `out/records.json` | — |
| 3 | `npm run pilot:candidates` | Picks website candidates from company-domain emails | — |
| 4 | `npm run pilot:audit` | Visits those websites and scores them (`check-sites.js`) | the prospects' own sites |
| 5 | `npm run pilot:spine` | Merges the audit into `out/spine.json` | — |
| 6 | `npm run pilot:shortlist` | Ranks, takes the top 40, folds in Astra round 1 | — |
| 7 | `npm run pilot:email` | MX lookup per company domain, one letter per person | DNS |
| 8 | `npm run pilot:rules` | Mismatch rule, exclusions, website source | DNS |
| 9 | `npm run pilot:astra` | Asks Astra for the websites we could not derive | api.openai.com |
| 10 | `npm run pilot:merge` | Folds Astra in and re-ranks | — |
| 11 | `npm run pilot:letters` | Renders the top twenty to `out/pilot-letters.pdf` | Google Fonts, once |

`npm run pilot:rebuild` runs steps 5, 6, 7, 8, 10 and 11 — everything that
costs nothing and touches nobody. Use it after changing a rule.

## What it costs

Only step 9 costs money. It calls `gpt-6-astra` with web search, one lookup
per company, and each lookup runs about **$0.20**. The two rounds that built
the current shortlist came to **$5.49 over 26 lookups**. The script stops
rather than pass `SPEND_CAP` (currently $15) and writes every raw response to
disk before parsing anything, so a crash after the API has billed does not
also lose the answer.

Set `GPT_API_KEY`, and `PILOT_ASTRA_ROUND` to 1 or 2.

Each lookup is sent the **company name and the town, and nothing else**. No
phone, no email, no licence detail, and nothing from Google.

## Resuming the register walk

The walk is the long step — about 650 records at three seconds apart, plus
back-offs, so an hour or so.

The board's server answers **HTTP 204** when you go too fast. That is a
throttle, never an empty result, and reading it as "no such record" is the
expensive mistake here: the walk finishes, looks complete, and silently omits
everything it was throttled on. Step 1 backs off 60 seconds, doubles, and asks
again; after ten minutes without relief it stops rather than guess.

**To resume, just run it again.** Every detail page is written to
`out/lslbc/details/` as it arrives and is never re-fetched, so a second run
picks up exactly where the first stopped. `out/lslbc/crawl.log` records what
happened, including every throttle.

## Behind a proxy

If `HTTPS_PROXY` is set, read the "Behind a proxy" section in
`finder/README.md` first. Node's fetch ignores it unless helped, and left
alone the audit marks live websites dead.

## Exclusions

Companies you never want in the pilot, whatever they score, go in
`out/exclusions.json` as `{"Company name": "why"}`. It names real businesses,
so it stays out of the repository like everything else in `out/`. Copy
`exclusions.example.json` to start one; with no file, nothing is excluded.

## The rules worth knowing

- **`unknown` is not a polite word for bad.** A site whose robots.txt told us
  to stay away was never looked at. It produces no finding and no claim.
- **A parked domain is not a bad website, it is no website.** Complaining that
  a holding page "isn't built for phones" is a fact about the placeholder.
- **A free-provider email is a usable email.** A gmail address is the one the
  owner gave the state board. It says nothing about a website either way, and
  a business with no company domain is not a business with no website.
- **A company domain must plausibly be theirs.** Licence records often carry
  an attorney's or a filing agent's address; quoting one back as "the web
  address from your business email" reads as a mistake. `lib/domains.js`
  decides, and treats a domain built from the qualifying party's own name as
  the company's own.
- **The trade noun comes from the business name, never the licence
  classification.** A metal-buildings company carries a RESIDENTIAL ROOFING
  classification and is not a roofer.

## Layout

```
lib/paths.js     every path in one place
lib/names.js     title case, business name, trade noun
lib/domains.js   email classification and the mismatch rule
lib/rank.js      the four signals and their weights
1..10-*.js       the chain, in order
```
