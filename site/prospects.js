'use strict';

/* Who a prospect page is for.

   Today there is exactly one record and it is invented. Real prospects live
   in finder/pilot/out/, which is git-ignored and must stay that way, so
   nothing real can be committed here. When the database arrives, replace the
   body of getProspect with the query — the page, the Places route and the
   tracking route all go through this one function and none of them knows
   where the record came from.

   A record is:
     ref            the code printed on the letter and in the QR
     business       the trading name, as it should be printed
     ownerFirstName used in the text-back message; may be empty
     tradeNoun      roofer, fence company, contractor ...
     city
     placeId        their Google listing, or null when we never found one.
                    The only place ID the Places route will ever use.
     websiteState   fine | poor | dead | unknown | not found
     websiteAudit   what we observed, for the wording. null when not found. */

const DEMO = {
  ref: 'DEMO2026',
  business: 'Marsh Lane Fencing',
  ownerFirstName: 'Dale',
  tradeNoun: 'fence company',
  city: 'Haughton',
  placeId: null,
  websiteState: 'not found',
  websiteAudit: null,
  demo: true
};

const RECORDS = new Map([[DEMO.ref, DEMO]]);

/* Letters print the ref in capitals and people retype it, so the lookup is
   forgiving about case and whitespace and strict about everything else. */
function normaliseRef(raw) {
  const ref = String(raw || '').trim().toUpperCase();
  return /^[A-Z0-9]{4,24}$/.test(ref) ? ref : null;
}

/* Returns the record, or null. Async on purpose: the database version will
   need to be, and every caller already awaits it. */
async function getProspect(rawRef) {
  const ref = normaliseRef(rawRef);
  if (!ref) return null;
  return RECORDS.get(ref) || null;
}

module.exports = { getProspect, normaliseRef, DEMO_REF: DEMO.ref };
