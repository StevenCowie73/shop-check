'use strict';

/* Deciding what an email address on a licence record tells you.

   Two separate questions, often confused:

   1. Is this a mailbox we could write to?  A gmail address is the one the
      owner handed the state board. It is theirs and it is usable.
   2. Is the domain the company's own website?  Only a company domain can
      answer this, and only if it plausibly belongs to that company. A shared
      filing agent, an attorney or an accountant appears on licence records
      often, and their domain is not the contractor's website. */

/* Mailbox providers anyone can sign up to. An address at one of these says
   nothing about whether the business has a website. */
const FREE_PROVIDERS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'rocketmail.com',
  'hotmail.com', 'outlook.com', 'live.com', 'msn.com', 'passport.com',
  'icloud.com', 'me.com', 'mac.com', 'aol.com', 'aim.com',
  'att.net', 'prodigy.net', 'bellsouth.net', 'sbcglobal.net', 'ameritech.net',
  'pacbell.net', 'swbell.net', 'flash.net', 'nvbell.net', 'snet.net',
  'comcast.net', 'xfinity.com', 'charter.net', 'spectrum.net', 'rr.com',
  'roadrunner.com', 'twc.com', 'cox.net', 'verizon.net', 'windstream.net',
  'suddenlink.net', 'centurytel.net', 'centurylink.net', 'embarqmail.com',
  'earthlink.net', 'juno.com', 'netzero.net', 'mail.com', 'gmx.com',
  'protonmail.com', 'proton.me', 'zoho.com', 'yandex.com', 'inbox.com',
  'usa.net', 'excite.com', 'lycos.com', 'hughes.net', 'mchsi.com',
  'bayou.com', 'shreve.net', 'softdisk.com', 'cebridge.net', 'eatel.net'
]);

/* Words that say nothing about which business this is. */
const GENERIC = new Set([
  'construction', 'constructions', 'contracting', 'contractor', 'contractors',
  'services', 'service', 'company', 'companies', 'group', 'enterprises',
  'enterprise', 'solutions', 'systems', 'associates', 'properties', 'property',
  'builders', 'builder', 'building', 'buildings', 'homes', 'home', 'house',
  'roofing', 'roofs', 'roof', 'plumbing', 'electric', 'electrical', 'fence',
  'fencing', 'remodeling', 'remodel', 'repair', 'repairs', 'improvement',
  'improvements', 'general', 'the', 'and', 'of', 'llc', 'inc', 'incorporated',
  'corp', 'ltd', 'co', 'usa', 'la', 'louisiana'
]);

const SUFFIX = /[,\s]*\b(L\.?L\.?C\.?|LLC|Inc\.?|Incorporated|S\s*Corp\.?|Corp\.?|Ltd\.?|Co\.?)\s*$/i;

function nameWords(company) {
  let s = String(company);
  for (let i = 0; i < 3 && SUFFIX.test(s); i++) s = s.replace(SUFFIX, '');
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
}

function classifyEmail(email) {
  const addr = String(email || '').trim().toLowerCase();
  const at = addr.lastIndexOf('@');
  if (at < 1) return { kind: addr ? 'malformed' : 'none', domain: null };
  const domain = addr.slice(at + 1).replace(/[.,;]+$/, '');
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return { kind: 'malformed', domain: null };
  return { kind: FREE_PROVIDERS.has(domain) ? 'free-provider' : 'company-domain', domain };
}

/* A tradesman's domain is often his own name rather than the company's:
   john-smith.com on a licence held by John David Smith is his domain, not a
   stranger's, so it counts as the company's own. The surname has to be present in full
   and be four characters or more — otherwise a short surname like Kay or May
   would match half the internet — with a given name or a real prefix of one
   alongside it. */
function matchesAPerson(qualifyingParties, label) {
  for (const raw of qualifyingParties || []) {
    const parts = String(raw).toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);
    if (parts.length < 2) continue;
    const surname = parts[parts.length - 1];
    if (surname.length < 4 || !label.includes(surname)) continue;
    for (const given of parts.slice(0, -1)) {
      if (given.length >= 3 && label.includes(given)) {
        return { match: true, why: `the domain is the qualifying party's own name (${raw})` };
      }
      for (let n = Math.min(given.length, 6); n >= 3; n--) {
        if (label.includes(given.slice(0, n))) {
          return { match: true, why: `the domain is the qualifying party's own name (${raw})` };
        }
      }
    }
  }
  return null;
}

/* Does this company domain plausibly belong to this company?
   In doubt, no: putting somebody else's domain in a letter is worse than
   saying nothing about a website at all. */
function domainBelongsTo(company, domain, qualifyingParties) {
  const label = String(domain).split('.')[0].replace(/[^a-z0-9]/gi, '').toLowerCase();
  const all = nameWords(company);
  const distinctive = all.filter(w => w.length >= 4 && !GENERIC.has(w));
  const squashed = all.join('');

  for (const w of distinctive) {
    if (label.includes(w)) return { match: true, why: `the domain contains "${w}"` };
  }
  const initials = all.map(w => w[0]).join('');
  if (initials.length >= 2 && (label === initials || label.startsWith(initials))) {
    return { match: true, why: `the domain is the initials "${initials}"` };
  }
  const short = all.filter(w => !GENERIC.has(w));
  const shortInitials = short.map(w => w[0]).join('');
  if (shortInitials.length >= 2 && (label === shortInitials || label.startsWith(shortInitials))) {
    return { match: true, why: `the domain is the initials "${shortInitials}"` };
  }
  if (squashed.length >= 6 && (label.includes(squashed) || squashed.includes(label))) {
    return { match: true, why: 'the domain is the company name run together' };
  }
  const person = matchesAPerson(qualifyingParties, label);
  if (person) return person;

  return {
    match: false,
    why: distinctive.length
      ? `no distinctive word of the name (${distinctive.join(', ')}) appears in "${label}"`
      : `the name offers no distinctive word to match against "${label}"`
  };
}

module.exports = { FREE_PROVIDERS, GENERIC, classifyEmail, domainBelongsTo, matchesAPerson, nameWords };
