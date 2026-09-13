# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project

Shop Check is a guided intake for small trade businesses: the owner answers a
few questions and gets one clear recommendation. The whole public site is
`index.html` — a single self-contained page, no build step.

`finder/` is a separate set of Node scripts (no dependencies, Node 18+) for
building a prospect call list from the Google Places API (New):

- `find-prospects.js` — searches near a point, scores each business on how
  much it is missing what Shop Check recommends, writes `out/prospects.csv`
  and `out/prospects.json`.
- `make-call-list.js` — turns that CSV into `out/call-list.html`, a
  phone-friendly tap-to-call page.
- `check-sites.js` — visits the prospects that do have a website and scores
  how badly it needs replacing, writing `out/site-audit.csv` and
  `out/site-audit.json`.

See `finder/README.md` for how to run them and what the settings mean.

**`finder/out/` holds real prospect phone numbers.** It is git-ignored and it
must stay that way. Never commit it, never paste its contents into a commit
message, an issue, a pull request, an artifact, or anywhere else public, and
never publish a generated call list. This is a public repository; generated
lists stay on the machine that made them. The same goes for `finder/.env`,
which holds the Google API key.

## Reporting

End **every** task with a report in exactly this format, inside a single
fenced code block:

```
=== REPORT ===
TASK: one line — what I asked you to do
DONE: bullet list of what you actually did (files created/changed, commits, pushes, with the repo URL if relevant)
NOT DONE / CHANGED: anything you skipped, did differently than asked, or assumed — say why
HOW TO TEST: exact steps or URL to see it working
KNOWN ISSUES: bugs, rough edges, or things you're unsure about
QUESTIONS: anything you need decided before the next step
=== END ===
```

Rules:

- Every section is always present. A section with nothing to say reads `none`.
- The report is never omitted — not for small tasks, not for questions, not
  for tasks that failed or were abandoned partway.
- Nothing follows the closing fence. The report is the last thing in the
  message.
