'use strict';

/* Which active licence holders to approach first.

   Four signals, in the order of weight the pilot settled on. Age dominates by
   construction: 200 beats 100 + 50 + 25 + 10, so no combination of the other
   three can lift a company licensed within 24 months above one licensed
   within 12. That is deliberate — a business that has just gone out on its
   own is the one most likely to have nothing set up yet. */

const WEIGHTS = {
  issued12: 200,      /* first licensed within the last 12 months */
  issued24: 100,      /* within 24 months */
  websiteBad: 50,     /* their website is dead or genuinely poor */
  residential: 25,    /* holds a Residential licence, not Home Improvement only */
  oneQp: 10           /* exactly one qualifying party: one person to write to */
};

const SPINE_TYPES = new Set(['Residential License Certificate', 'Home Improvement Registration']);
const RESIDENTIAL = 'Residential License Certificate';

const statusOf = l => String(l.status || '').trim().toLowerCase();

function parseDate(s) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s || '').trim());
  return m ? new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2])) : null;
}

function cutoffs(now) {
  const at = n => { const d = new Date(now); d.setMonth(d.getMonth() - n); return d; };
  return { m12: at(12), m24: at(24) };
}

function scoreRecord(rec, now) {
  const { m12, m24 } = cutoffs(now || new Date());
  const active = rec.licenses.filter(l => SPINE_TYPES.has(l.type) && statusOf(l) === 'active');
  if (!active.length) return null;

  /* the newest active licence is the one that says how new the business is */
  let newest = null;
  for (const l of active) {
    const d = parseDate(l.firstIssued);
    if (d && (!newest || d > newest)) newest = d;
  }

  const reasons = [];
  let score = 0;
  if (newest && newest >= m12) { score += WEIGHTS.issued12; reasons.push('licensed within 12 months'); }
  else if (newest && newest >= m24) { score += WEIGHTS.issued24; reasons.push('licensed within 24 months'); }

  const state = rec.websiteState;
  if (state === 'dead' || state === 'poor') {
    score += WEIGHTS.websiteBad;
    reasons.push('website ' + state);
  }
  const hasResidential = active.some(l => l.type === RESIDENTIAL);
  if (hasResidential) { score += WEIGHTS.residential; reasons.push('holds a Residential licence'); }
  if (rec.qualifyingParties.length === 1) { score += WEIGHTS.oneQp; reasons.push('one named qualifying party'); }

  return { score, reasons, newest, active, hasResidential };
}

function rank(records, now) {
  const scored = [];
  for (const rec of records) {
    const s = scoreRecord(rec, now);
    if (s) scored.push({ rec, ...s });
  }
  scored.sort((a, b) =>
    b.score - a.score ||
    (b.newest ? b.newest.getTime() : 0) - (a.newest ? a.newest.getTime() : 0) ||
    a.rec.company.localeCompare(b.rec.company));
  return scored;
}

module.exports = { WEIGHTS, SPINE_TYPES, RESIDENTIAL, statusOf, parseDate, scoreRecord, rank };
