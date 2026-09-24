'use strict';

/* Step 4. Merges the website audit back onto the records and writes the
   spine: one entry per licence holder, with whatever we know about their
   website attached.

   websiteState is the word the rest of the pipeline reasons with:
     fine     we fetched it and it scores under the replace threshold
     poor     we fetched it and it scores at or over the threshold
     dead     it does not load, or the domain is parked (no site there)
     unknown  robots.txt told us to stay away, so we never looked
   unknown is not a polite word for bad. It means we do not know, and nothing
   that reaches a letter may be built on it. */

const fs = require('fs');
const path = require('path');

const P = require('./lib/paths.js');
const AUDIT_JSON = P.auditJson;
const BAD_ENOUGH = 40;               /* LIST.siteAuditMinScore in make-call-list.js */
const SPINE_TYPES = new Set(['Residential License Certificate', 'Home Improvement Registration']);

const today = new Date();
const monthsAgo = n => { const d = new Date(today); d.setMonth(d.getMonth() - n); return d; };
const CUT_12 = monthsAgo(12), CUT_24 = monthsAgo(24);
function asDate(s) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s || '').trim());
  return m ? new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2])) : null;
}

/* A qualifying party we could open a letter with: a human name, not a
   company, and more than a single word. */
const COMPANYISH = /\b(LLC|L\.L\.C|INC|CORP|COMPANY|CO\.|LTD|LP|GROUP|SERVICES|CONSTRUCTION|ENTERPRISES)\b/i;
function isPersonName(n) {
  const s = String(n || '').trim();
  if (!s) return false;
  if (COMPANYISH.test(s)) return false;
  return s.split(/\s+/).filter(Boolean).length >= 2;
}

function main() {
  const spine = JSON.parse(fs.readFileSync(P.candidates, 'utf8'));

  /* ---- merge the website audit, by domain ---- */
  let audit = null;
  if (fs.existsSync(AUDIT_JSON)) audit = JSON.parse(fs.readFileSync(AUDIT_JSON, 'utf8'));
  const byDomain = new Map();
  for (const s of (audit && audit.sites) || []) byDomain.set(s.placeId, s);

  for (const rec of spine) {
    if (!rec.websiteCandidate) continue;
    const a = byDomain.get(rec.emailDomain);
    if (!a) continue;
    /* loads is tri-state: true reached, false genuinely failed,
       null never looked at. A null score is unknown, never bad. */
    const scored = Number.isFinite(a.siteScore) ? a.siteScore : null;
    rec.websiteAudit = {
      url: a.website,
      siteScore: scored,
      loads: a.skipped ? null : !!a.loads,
      skipped: !!a.skipped,
      skipNote: a.skipped ? (a.skipNote || a.problem || 'not checked') : undefined,
      finalUrl: a.finalUrl || '',
      whatsWrong: a.whatsWrong || '',
      signals: a.signals || [],
      parked: !!a.parked,
      badEnoughToReplace: scored !== null && scored >= BAD_ENOUGH
    };
    /* A parked domain is counted with the dead, not the poor: there is no
       website there to replace, so it is the same story for a letter. */
    rec.websiteState = a.skipped ? 'unknown'
      : ((!a.loads || a.parked) ? 'dead' : (scored >= BAD_ENOUGH ? 'poor' : 'fine'));
  }

  /* ---- the licences this spine is actually about ---- */
  const spineLicences = [];
  for (const rec of spine) {
    for (const l of rec.licenses) {
      if (SPINE_TYPES.has(l.type)) spineLicences.push({ rec, l });
    }
  }
  const statusOf = l => {
    const s = String(l.status || '').trim().toLowerCase();
    return s ? s[0].toUpperCase() + s.slice(1) : 'Unknown';
  };
  const count = (arr, fn) => arr.filter(fn).length;

  const byStatus = {};
  for (const { l } of spineLicences) byStatus[statusOf(l)] = (byStatus[statusOf(l)] || 0) + 1;

  const active = spineLicences.filter(({ l }) => statusOf(l) === 'Active');
  const activeWithEmail = active.filter(({ rec }) => rec.email);
  const activeCompanyDomain = active.filter(({ rec }) => rec.emailKind === 'company-domain');
  const activeFree = active.filter(({ rec }) => rec.emailKind === 'free-provider');

  const activeIssued12 = active.filter(({ l }) => { const d = asDate(l.firstIssued); return d && d >= CUT_12; });
  const activeIssued24 = active.filter(({ l }) => { const d = asDate(l.firstIssued); return d && d >= CUT_24; });

  const activeQpPerson = active.filter(({ rec }) => rec.qualifyingParties.some(isPersonName));
  const activeQpMissing = active.filter(({ rec }) => !rec.qualifyingParties.length);
  const activeQpNonPerson = active.filter(({ rec }) =>
    rec.qualifyingParties.length && !rec.qualifyingParties.some(isPersonName));

  /* The five buckets the report asks for, counted over ACTIVE companies
     (a company holding at least one active Residential/HI licence). */
  const activeCompanies = spine.filter(r =>
    r.licenses.some(l => SPINE_TYPES.has(l.type) && statusOf(l) === 'Active'));
  const bucket = st => activeCompanies.filter(r => r.websiteState === st).length;
  const activeByWebsite = {
    loadedAndPoor: bucket('poor'),
    dead: bucket('dead'),
    unknownRobotsSkipped: bucket('unknown'),
    loadedAndFine: bucket('fine'),
    noCompanyDomainCandidate: activeCompanies.filter(r => !r.websiteState).length,
    totalActiveCompanies: activeCompanies.length
  };

  const candidates = spine.filter(r => r.websiteCandidate);
  const audited = candidates.filter(r => r.websiteAudit);
  const loaded = audited.filter(r => r.websiteAudit.loads);
  const failed = audited.filter(r => !r.websiteAudit.loads && !r.websiteAudit.skipped);
  const skipped = audited.filter(r => r.websiteAudit.skipped);
  const bad = audited.filter(r => r.websiteAudit.badEnoughToReplace);

  const out = {
    source: 'Louisiana State Licensing Board for Contractors, public ARLS search (arlspublic.lslbc.louisiana.gov)',
    note: 'Public record. No Google Places data of any kind. Insurance details deliberately not kept.',
    builtAt: new Date().toISOString(),
    scope: { parishes: ['Caddo', 'Bossier'], licenceTypes: [...SPINE_TYPES] },
    counts: {
      companies: spine.length,
      spineLicences: spineLicences.length,
      spineLicencesByStatus: byStatus,
      allLicencesHeldIncludingCommercial: spine.reduce((n, r) => n + r.licenses.length, 0),
      active: {
        licences: active.length,
        withEmail: activeWithEmail.length,
        emailCompanyDomain: activeCompanyDomain.length,
        emailFreeProvider: activeFree.length,
        withoutEmail: active.length - activeWithEmail.length,
        firstIssuedLast12Months: activeIssued12.length,
        firstIssuedLast24Months: activeIssued24.length,
        qualifyingPartyIsPersonName: activeQpPerson.length,
        qualifyingPartyPresentButNotAPersonName: activeQpNonPerson.length,
        qualifyingPartyMissing: activeQpMissing.length
      },
      activeCompaniesByWebsite: activeByWebsite,
      websiteCandidates: {
        found: candidates.length,
        distinctDomainsAudited: byDomain.size,
        recordsWithAuditAttached: audited.length,
        loaded: loaded.length,
        failedToLoad: failed.length,
        notCheckedRobotsSkipped: skipped.length,
        badEnoughToReplace: bad.length,
        threshold: BAD_ENOUGH
      }
    },
    records: spine
  };
  fs.writeFileSync(P.spine, JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out.counts, null, 1));
  console.log('\nwrote ' + P.spine);
}
main();
