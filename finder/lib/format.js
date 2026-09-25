'use strict';

/* One business as plain text — what the Copy button puts on the clipboard
   and what the CLI prints. Kept next to the lookup so the two cannot say
   different things. */

const UNKNOWN = 'unknown';
const show = v => (v === null || v === undefined || v === '' ? UNKNOWN : String(v));

function formatPlain(r) {
  if (!r.found) {
    return [
      r.headline.toUpperCase(),
      '',
      `Searched for: ${r.query}`,
      '',
      r.explanation,
      '',
      r.whatItMeans,
      '',
      'Evidence:',
      ...r.evidence.map(e => '  - ' + e)
    ].join('\n');
  }

  const L = r.listing, a = r.audit, j = r.judgment;
  const out = [];
  out.push(L.name.toUpperCase());
  out.push('');
  out.push(`Trade:          ${show(L.trade)}`);
  out.push(`Address:        ${show(L.address)}`);
  out.push(`Status:         ${show(L.businessStatus)}`);
  out.push(`Rating:         ${L.rating === null ? UNKNOWN : L.rating} from ${L.reviewCount} review${L.reviewCount === 1 ? '' : 's'}`);
  out.push(`Website:        ${L.website || 'none listed'}`);
  out.push(`Shop Check score: ${L.prospectScore}/100 — ${L.prospectWhy}`);

  out.push('');
  out.push('WEBSITE AUDIT');
  if (!a) out.push('  No website listed, so nothing to audit.');
  else {
    out.push(`  Needs-replacing score: ${a.siteScore === null ? UNKNOWN : a.siteScore + '/100'}`);
    out.push(`  ${a.whatsWrong || 'nothing recorded'}`);
    const loaded = a.skipped ? 'not checked' : (a.loads ? 'yes' : 'no');
    out.push(`  Loaded: ${loaded}${a.problem ? ' — ' + a.problem : ''}${a.status ? ' (HTTP ' + a.status + ')' : ''}`);
  }

  out.push('');
  out.push('JUDGMENT');
  if (!j) {
    out.push(`  Not available${r.judgeError ? ' — ' + r.judgeError : ''}.`);
  } else {
    out.push(`  Likely to buy:  ${j.verdict_score}/100`);
    out.push(`  Size:           ${show(j.size)}${j.size_evidence ? ' — ' + j.size_evidence : ''}`);
    out.push(`  Customers:      ${show(j.customer)}`);
    out.push(`  Owner:          ${j.owner_name === null ? UNKNOWN : j.owner_name}`);
    out.push(`  Reputation:     not assessed`);
    out.push(`  Best pitch:     ${show(j.best_pitch)}`);
    out.push('');
    out.push(`  Opening line:   ${show(j.one_line)}`);
    out.push(`  Reasoning:      ${show(j.reasoning)}`);
    out.push('');
    out.push('  Signs of missed calls in reviews: not assessed — reviews are not sent to the model.');
  }

  out.push('');
  out.push('EVIDENCE');
  out.push(`  Sent to model:  what was typed, our website check, homepage text — nothing from Google`);
  out.push(`  Homepage text:  ${r.evidence.siteTextChars ? r.evidence.siteTextChars + ' characters read' : r.evidence.siteTextNote}`);
  out.push('');
  out.push(`  Google listing: ${L.googleMapsUrl}`);
  out.push(`  Shop Check link: ${L.shopCheckLink}`);
  return out.join('\n');
}

module.exports = { formatPlain, UNKNOWN, show };
