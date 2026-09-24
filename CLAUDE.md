# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project

Shop Check is a guided intake for small trade businesses: the owner answers a
few questions and gets one clear recommendation. The whole public site is
`index.html` — a single self-contained page, no build step.

`finder/` is a separate set of Node scripts (Node 18+, one dependency) for
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
must stay that way.

Never put prospect data anywhere public or shareable. That means: never
commit it to this repository, which is public; never serve it from GitHub
Pages; and never paste it into a commit message, an issue, a pull request,
or any page that someone other than the owner can open.

The owner's own private Artifact is the exception. The call list at
https://claude.ai/code/artifact/ed4d3506-ab05-4447-ab64-ebb88237a87d is
republished from `out/call-list.html` on request — that is its intended home,
since the point of the page is to have it on a phone. Republish to that same
URL rather than creating a new one, keep it private, and never share it.

The same care applies to `finder/.env`, which holds the Google API key: never
commit it, and never print the key.

This has been got wrong before, and not by committing a data file — by
naming a real business in a code comment as an example. A pre-commit hook
now catches that:

```
npm run hooks:install
```

It points git at `hooks/`, and `hooks/pre-commit` runs
`scripts/check-private-names.js`. That reads every company name and
qualifying-party name out of whichever private files exist locally
(`finder/out/`, `finder/pilot/out/`) and refuses the commit if one appears in
a staged file. On a machine with no prospect data there is nothing to check
and it passes, so a fresh clone is never blocked. Check the whole repository
at any time with `npm run check:names`.

**Use an invented business name in every example, comment and docstring.**

## Version control

- **Commit and push to `main`.** Do not create feature branches. A previous
  branch was deleted on the remote and nearly took an evening's work with it;
  the branch that does not exist cannot be lost.
- **Push after every commit.** Never batch pushes. Work that exists only in a
  session container is one reclaim away from gone.
- **Before ending any piece of work, confirm the commit is actually on the
  remote** with `git ls-remote origin refs/heads/main`, and report the SHA.
  A local commit is not a saved commit.
- If a task genuinely requires a branch, say so and ask first.

## Reporting

End **every** task with a report in exactly this format, inside a single
fenced code block:

```
=== REPORT ===
TASK: one line — what I asked you to do
DONE: bullet list of what you actually did (files created/changed, commits, pushes, with the repo URL if relevant)
NOT DONE / CHANGED: anything you skipped, did differently than asked, or assumed — say why
HOW TO TEST: exact steps or URL to see it working
DELIVERABLE: anything I have to act on — a walkthrough, steps to follow, a prompt to paste, a list to check, a decision to make. The content itself goes here, in full. "none" if there is nothing to act on
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
- Never report a step as done without reading its output. If a command prints
  an error, the step is not done.

**Everything I need is inside the fence.** Anything I have to act on — a
walkthrough, steps to follow, a prompt to paste, a list to check, a decision
to make — goes in DELIVERABLE, in full, not in prose above the report.

Prose above the fence is your own working notes. I may not read it. Nothing
outside the fence may be load-bearing: if the report were the only thing I
saw, I should still be able to do whatever comes next.
