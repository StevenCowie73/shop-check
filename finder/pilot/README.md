# The pilot: a call-and-letter list from public licence records

This builds a shortlist of small contractors from the Louisiana State
Licensing Board for Contractors public register, and renders a letter for
each of the top twenty. It was built for Caddo and Bossier parishes, which
are still the default, and runs for any parish and town (see "Any area").

It exists because the Places-based finder cannot be the source of **stored**
prospect records: Google's terms forbid keeping business names, addresses,
phones and reviews. A state licence register is public record, so it can be
stored, and it carries something Places never gives you — an email address and
the owner's name.

Everything it reads or writes lives in `out/`, which is git-ignored and must
stay that way. It is all real names, addresses, phone numbers and email
addresses of real people, and this repository is public.

## The chain

Run in order, top to bottom. A fresh area works straight through; steps that
have nothing to do (no Astra round yet, nothing to audit) say so and carry on.

| | command | what it does | reaches out to |
|-|---------|--------------|----------------|
| 1 | `npm run pilot:walk` | Walks every Residential and Home Improvement licence in the area's parishes (only the listed towns' detail pages, if a town list is set) | lslbc.louisiana.gov |
| 2 | `npm run pilot:parse` | Turns the saved pages into `records.json`: zip filter if set, chains left out | — |
| 3 | `npm run pilot:candidates` | Picks website candidates from company-domain emails | — |
| 4 | `npm run pilot:audit` | Visits those websites and scores them (`check-sites.js`) | the prospects' own sites |
| 5 | `npm run pilot:spine` | Merges the audit into `spine.json` | — |
| 6 | `npm run pilot:targets -- 1` | Astra round 1 targets: the top twenty by rank with no website from their own email | — |
| 7 | `npm run pilot:astra` | Asks Astra for their websites (`PILOT_ASTRA_ROUND=1`) | api.openai.com |
| 8 | `npm run pilot:astra-audit -- 1` | Audits the websites Astra named | the prospects' own sites |
| 9 | `npm run pilot:shortlist` | Folds round 1 in, ranks, takes the top 40 | — |
| 10 | `npm run pilot:email` | MX lookup per company domain, one letter per person | DNS |
| 11 | `npm run pilot:rules` | Mismatch rule, exclusions, website source | DNS |
| 12 | `npm run pilot:targets -- 2` | Astra round 2 targets: top-twenty companies still never searched | — |
| 13 | `npm run pilot:astra` | Round 2 (`PILOT_ASTRA_ROUND=2`), if step 12 found anyone | api.openai.com |
| 14 | `npm run pilot:astra-audit -- 2` | Audits round 2's websites | the prospects' own sites |
| 15 | `npm run pilot:merge` | Folds round 2 in and re-ranks | — |
| 16 | `npm run pilot:letters` | Renders the top twenty to `pilot-letters.pdf` | Google Fonts, once |
| 17 | `npm run pilot:verify` | Opens that PDF and scans every QR code in it | — |

`npm run pilot:rebuild` runs steps 5, 9, 10, 11, 15, 16 and 17 — everything
that costs nothing and touches nobody. Use it after changing a rule.

## Any area

The area is set by environment, never by editing code (`lib/area.js`):

| variable | example | default |
|----------|---------|---------|
| `PILOT_PARISHES` | `1467:Lafayette` | `2098:Caddo,1815:Bossier` |
| `PILOT_TOWNS` | `Youngsville,Broussard` | every town in the parishes |
| `PILOT_ZIPS` | `70592` | every zip |
| `PILOT_OUT_DIR` | `finder/pilot/out/youngsville` | `finder/pilot/out` |

The parish ids are the register's own: its Advanced search page lists each
parish name against its id. Give every area its own folder under
`finder/pilot/out/` — it is git-ignored, and `npm run check:names` reads
every folder there.

The town list filters the register's result list **before** any detail page
is fetched, which is what keeps a small area small: Youngsville was 76 pages
out of Lafayette Parish's 641.

The letter says where Steven is. For a record found in Caddo or Bossier it
reads "here in Bossier City", exactly as it always has; anywhere else it
reads "here in Louisiana". It is decided per record, from the parish the
record was found in.

## No claim without a search

A letter says "I looked for your website and couldn't find one" only when a
search actually ran and came back empty. A company nobody searched for, or
whose lookup failed, is **unknown**, and an unknown gets no website
paragraph at all.

## Reference codes

Each company gets an eight-character code, and the QR on its letter points at
`https://coldenjames.com/p/CODE?c=letter`. The alphabet leaves out every
character that gets misread off paper — no `0` or `O`, no `1`, `I` or `L` —
and the codes are drawn with `crypto.randomInt`, so one letter's code tells
you nothing about the next.

Codes live in `out/refs.json`, company name to code. That file is
**append-only**: step 16 issues a code to a company that does not have one and
never touches a company that does, because once a letter is in the post its
code is the only thing tying an opened page back to it. It names real
companies, so like everything in `out/` it is never committed.

`?c=letter` and `?c=email` are the same code reached two ways, so a letter
and its follow-up email can be told apart without giving one company two
codes.

## Before anything is printed

Step 16 decodes every QR it generates and refuses to write a PDF if one does
not read back. Step 17 is the check that matters more: it opens the finished
PDF, pulls every image out of it, decodes them, and fails unless there are
exactly as many codes as letters, each scanning to its own company's URL, in
rank order. Run it before sending anything to a printer.

It prints reference codes and no company names, so its output is safe to
paste anywhere.

## What it costs

Only the Astra steps (7 and 13) cost money. It calls `gpt-6-astra` with web search, one lookup
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
`finder/README.md` first. Every request in `finder/` — the audit, the walk,
Astra and Places — goes through `finder/lib/http.js`, which uses undici's
own fetch with its proxy dispatcher. Mixing Node's built-in fetch with the
npm undici dispatcher lost every response header over HTTP/2, so redirects
were never followed and live websites were recorded as dead.

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
