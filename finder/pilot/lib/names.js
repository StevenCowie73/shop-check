'use strict';

/* Turning register entries into something you can print in a letter.

   The licence register is typed by hand at a counter, so names arrive
   shouted in capitals, with the company suffix attached, and occasionally
   as a person rather than a company. */

const SMALL = new Set(['and', 'of', 'the', 'for', '&']);

/* A name shouted entirely in capitals is a data-entry habit, not a style:
   title-case the lot. A name that is already mixed means any all-capital
   word inside it is an acronym its owner chose, and that stays exactly as
   written rather than being tidied into Title Case. */
function titleCase(s) {
  const raw = String(s).trim();
  const allCaps = raw === raw.toUpperCase();
  return raw.split(/\s+/).map((w, i) => {
    if (/[a-z]/.test(w) && /[A-Z]/.test(w.slice(1))) return w;            /* e.g. IronWorks */
    if (!allCaps && w === w.toUpperCase() && /[A-Z]/.test(w)) return w;   /* an acronym the owner chose */
    const lower = w.toLowerCase();
    if (i > 0 && SMALL.has(lower)) return lower;
    /* an apostrophe, straight or curly, does not start a new word */
    return lower.replace(/(^|[^A-Za-z'’])([a-z])/g, (m, pre, ch) => pre + ch.toUpperCase());
  }).join(' ');
}

const SUFFIX = /[,\s]*\b(L\.?L\.?C\.?|LLC|Inc\.?|Incorporated|S\s*Corp\.?|Corp\.?|Ltd\.?)\s*$/i;

/* The name as a person would say it out loud: no LLC, no Inc. */
function businessName(raw) {
  let s = String(raw).trim();
  for (let i = 0; i < 3 && SUFFIX.test(s); i++) s = s.replace(SUFFIX, '');
  return titleCase(s.replace(/[,\s]+$/, ''));
}

function firstName(qualifyingParty) {
  const s = String(qualifyingParty || '').trim();
  return s ? titleCase(s.split(/\s+/)[0]) : '';
}

/* What they call themselves, or nothing.

   The licence classification is deliberately NOT consulted. A metal-buildings
   company carries a RESIDENTIAL ROOFING classification and is not a roofer;
   "they call the next roofer" would read as a mistake to its owner. */
const BY_NAME = [
  [/roof/i, 'roofer'],
  [/electric/i, 'electrician'],
  [/plumb/i, 'plumber'],
  [/fenc/i, 'fence company'],
  [/window|door/i, 'window company'],
  [/paint/i, 'painter'],
  [/floor/i, 'flooring company'],
  [/hvac|\bair\b|heating|cooling/i, 'HVAC company'],
  [/builder/i, 'builder']
];

function tradeNoun(company) {
  for (const [re, noun] of BY_NAME) {
    if (re.test(String(company))) return { noun, from: 'name' };
  }
  return { noun: 'contractor', from: 'fallback' };
}

module.exports = { titleCase, businessName, firstName, tradeNoun, BY_NAME };
