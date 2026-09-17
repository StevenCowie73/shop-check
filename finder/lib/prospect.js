'use strict';

/* How a business is scored as a prospect, and the words that explain the
   score. Moved out of find-prospects.js so the single-business lookup
   scores exactly the way the batch run does. */

/* =====================================================================
   2. SCORING WEIGHTS — edit me.
   Higher total = the business is missing more of what we sell.
   A business with no phone number scores 0: we cannot call it.
   ===================================================================== */
const SCORING = {
  noWebsite: 40,                 /* no website at all */
  socialOnlyWebsite: 30,         /* "website" is a Facebook or Instagram page */
  underTenReviews: 25,           /* fewer than 10 reviews */
  tenToTwentyFourReviews: 15,    /* 10-24 reviews */
  noRating: 10,                  /* no star rating yet */
  noHours: 10,                   /* no opening hours listed */
  hasPhone: 15,                  /* we can actually reach them */
  maxScore: 100
};


/* =====================================================================
   3. CHAINS AND FRANCHISES — edit me.
   Lowercase fragments. If a business name contains one, it is skipped.
   Keep entries specific enough not to catch a local shop by accident.
   ===================================================================== */
const CHAIN_BLOCKLIST = [
  /* plumbing / hvac / electrical */
  'roto-rooter', 'roto rooter', 'mr. rooter', 'mr rooter', 'benjamin franklin plumbing',
  'ars/rescue rooter', 'rescue rooter', 'one hour heating', 'one hour air', 'aire serv',
  'mister sparky', 'mr. electric', 'mr electric', 'service experts', 'horizon services',
  'bath fitter', 're-bath', 'rebath', 'west shore home', 'leaf filter', 'leaffilter',
  'leafguard', 'renewal by andersen', 'champion windows',
  /* landscaping / lawn */
  'trugreen', 'tru green', 'weed man', 'lawn doctor', 'u.s. lawns', 'us lawns',
  'the grounds guys', 'scotts lawn',
  /* painting */
  'certapro', 'five star painting', 'fresh coat painters', '360 painting', 'wow 1 day painting',
  /* flooring */
  'empire today', 'floor coverings international', 'footprints floors', '50 floor',
  'll flooring', 'lumber liquidators', 'floor & decor', 'floor and decor',
  /* roofing / restoration / handyman */
  'erie home', 'power home remodeling', 'servpro', 'servicemaster', 'paul davis',
  'rainbow restoration', '911 restoration', 'stanley steemer', 'dreammaker bath',
  'handyman connection', 'mr. handyman', 'mr handyman', 'ace handyman',
  /* cleaning / washing */
  'window genie', 'men in kilts', 'shack shine', 'chem-dry', 'chemdry', 'molly maid',
  /* big box and suppliers */
  'home depot', "lowe's", 'lowes home improvement', 'ace hardware', 'menards',
  'sherwin-williams', 'sherwin williams', 'benjamin moore', 'tractor supply',
  'ferguson', 'grainger'
];

/* A "website" on one of these hosts is really just a social page. */
const SOCIAL_HOSTS = ['facebook.com', 'fb.com', 'fb.me', 'instagram.com'];

const SHOP_CHECK_URL = 'https://stevencowie73.github.io/shop-check/';

function milesBetween(a, b) {
  const R = 3958.7613;
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/* ---------- classification ---------- */

/* ---------- classification ---------- */
function isChain(name) {
  const n = String(name || '').toLowerCase();
  return CHAIN_BLOCKLIST.some(bad => n.includes(bad));
}

function socialHost(website) {
  if (!website) return null;
  let host;
  try { host = new URL(website).hostname.toLowerCase().replace(/^www\./, ''); }
  catch (e) { return null; }
  const hit = SOCIAL_HOSTS.find(h => host === h || host.endsWith('.' + h));
  if (!hit) return null;
  return hit.startsWith('insta') ? 'Instagram' : 'Facebook';
}

/* ---------- scoring ---------- */

const isSocialOnly = website => socialHost(website) !== null;

/* ---------- scoring ---------- */
function scoreBusiness(p) {
  const phone = p.nationalPhoneNumber || '';
  if (!phone) {
    return {
      score: 0,
      unreachable: true,
      signals: ['noPhone'],
      why: 'No phone number listed, so there is nobody to call'
    };
  }

  const website = p.websiteUri || '';
  const reviews = Number.isFinite(p.userRatingCount) ? p.userRatingCount : 0;
  const hasRating = typeof p.rating === 'number' && p.rating > 0;
  const hours = p.regularOpeningHours;
  const hasHours = !!(hours && (
    (Array.isArray(hours.weekdayDescriptions) && hours.weekdayDescriptions.length) ||
    (Array.isArray(hours.periods) && hours.periods.length)
  ));

  const signals = [];
  let score = SCORING.hasPhone;

  if (!website) { score += SCORING.noWebsite; signals.push('noWebsite'); }
  else if (isSocialOnly(website)) { score += SCORING.socialOnlyWebsite; signals.push('socialOnlyWebsite'); }

  if (reviews < 10) { score += SCORING.underTenReviews; signals.push('underTenReviews'); }
  else if (reviews < 25) { score += SCORING.tenToTwentyFourReviews; signals.push('tenToTwentyFourReviews'); }

  if (!hasRating) { score += SCORING.noRating; signals.push('noRating'); }
  if (!hasHours) { score += SCORING.noHours; signals.push('noHours'); }

  score = Math.max(0, Math.min(SCORING.maxScore, score));
  return { score, unreachable: false, signals, why: whyText(signals, p) };
}

function whyText(signals, p) {
  const reviews = Number.isFinite(p.userRatingCount) ? p.userRatingCount : 0;
  const parts = [];
  for (const s of signals) {
    if (s === 'noPhone') parts.push('no phone number listed, so there is nobody to call');
    else if (s === 'noWebsite') parts.push('no website');
    else if (s === 'socialOnlyWebsite') {
      const host = socialHost(p.websiteUri);
      parts.push('only ' + (host === 'Instagram' ? 'an Instagram' : 'a ' + (host || 'social')) + ' page');
    }
    else if (s === 'underTenReviews') parts.push(reviews === 0 ? 'no reviews yet' : `only ${reviews} review${reviews === 1 ? '' : 's'}`);
    else if (s === 'tenToTwentyFourReviews') parts.push(`only ${reviews} reviews`);
    else if (s === 'noRating') parts.push('no rating yet');
    else if (s === 'noHours') parts.push('no hours listed');
  }
  if (!parts.length) return 'Nothing obvious missing, low priority';
  const line = parts.join(', ');
  return line.charAt(0).toUpperCase() + line.slice(1);
}

/* ---------- the pre-filled Shop Check link ---------- */
function slugFromPlaceId(placeId) {
  return String(placeId || '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 32);
}

function shopCheckLink(name, placeId) {
  const params = ['name=' + encodeURIComponent(String(name || '').slice(0, 80))];
  const ref = slugFromPlaceId(placeId);
  if (ref) params.push('ref=' + ref);
  return SHOP_CHECK_URL + '?' + params.join('&');
}

/* ---------- CSV ---------- */

module.exports = {
  SCORING, CHAIN_BLOCKLIST, SOCIAL_HOSTS, SHOP_CHECK_URL,
  milesBetween, isChain, socialHost, isSocialOnly,
  scoreBusiness, whyText, slugFromPlaceId, shopCheckLink
};
