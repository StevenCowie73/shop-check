'use strict';

/* A prospect's own Google listing, fetched for their page.

   The request carries a reference code and nothing else. The place ID comes
   from the record behind that code, never from the request — otherwise this
   route would be an open proxy for anyone's Places lookups, billed to us.

   Google's display and caching rules are applied here and are quoted beside
   the code that implements them. In short:
     - nothing is stored, cached or logged: the response is assembled and
       sent, and this function keeps no copy;
     - the Google Maps logo is shown, because this is Places data displayed
       without a map;
     - every review credits its author by avatar, name and profile link, and
       links to the review itself on Google Maps;
     - the reviews are shown in the order Google returned them, and the page
       says so. None are picked, dropped or reordered.
   Sources are listed in the header of tests/prospect.test.js. */

const { getProspect } = require('../site/prospects.js');
const { placeDetails } = require('../finder/lib/places.js');

/* Only what the page shows. A field not asked for is a field we cannot
   accidentally keep. */
const FIELDS = [
  'id', 'displayName', 'rating', 'userRatingCount', 'googleMapsUri',
  'regularOpeningHours', 'reviews'
].join(',');

const esc = s => String(s === undefined || s === null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/* Google's own asset, served by Google, so it is always the current mark.
   "When displaying Places API data without a Google Map, you must include
   the Google logo". Height sits inside the documented 16–19dp range. */
const GOOGLE_LOGO =
  '<img class="gmaps-logo" alt="Google Maps" height="18" ' +
  'src="https://maps.gstatic.com/mapfiles/api-3/images/google_gray.svg">';

function stars(rating) {
  const r = Number(rating);
  if (!Number.isFinite(r)) return '';
  const full = Math.round(r);
  return '★'.repeat(Math.max(0, Math.min(5, full))) + '☆'.repeat(Math.max(0, 5 - full));
}

function reviewHtml(rev) {
  const who = rev.authorAttribution || {};
  const name = who.displayName || '';
  const text = (rev.text && rev.text.text) || (rev.originalText && rev.originalText.text) || '';

  /* "You must always credit the author when displaying photos or reviews.
     Each photo and review includes an author attribution (avatar image,
     name, and profile link)." — all three are shown. */
  const avatar = who.photoUri
    ? `<img src="${esc(who.photoUri)}" alt="" width="34" height="34" loading="lazy" referrerpolicy="no-referrer">`
    : '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==" alt="" width="34" height="34">';
  const nameHtml = who.uri
    ? `<a class="rev-name" href="${esc(who.uri)}" rel="noopener nofollow" target="_blank">${esc(name)}</a>`
    : `<span class="rev-name">${esc(name)}</span>`;

  /* "End-users must always have access to view the individual source photo
     or review on Google Maps using the provided googleMapsUri." */
  const link = rev.googleMapsUri
    ? `<p class="rev-link"><a href="${esc(rev.googleMapsUri)}" rel="noopener nofollow" target="_blank">Read this review on Google Maps</a></p>`
    : '';

  return `<div class="rev">
  <div class="rev-who">${avatar}<div>${nameHtml}<div class="rev-when">${esc(stars(rev.rating))} &middot; ${esc(rev.relativePublishTimeDescription || '')}</div></div></div>
  ${text ? `<p class="rev-text">${esc(text)}</p>` : ''}
  ${link}
</div>`;
}

function listingHtml(place) {
  const name = (place.displayName && place.displayName.text) || '';
  const rating = Number(place.rating);
  const count = Number(place.userRatingCount);

  const head = `<div class="listing-head">
  ${Number.isFinite(rating) ? `<span class="stars">${esc(stars(rating))} ${esc(rating.toFixed(1))}</span>` : ''}
  ${Number.isFinite(count) ? `<span class="muted">${esc(count)} review${count === 1 ? '' : 's'} on Google</span>` : ''}
</div>`;

  const hoursList = (place.regularOpeningHours && place.regularOpeningHours.weekdayDescriptions) || [];
  const hours = hoursList.length
    ? `<h3>Your hours, as Google has them</h3><p class="hours">${hoursList.map(esc).join('<br>')}</p>`
    : '';

  /* "Include a clear notice that describes how reviews are being ordered and
     filtered including any search criteria applied. By default, reviews are
     ordered by relevance." We apply no criteria at all, and say so. */
  const reviews = Array.isArray(place.reviews) ? place.reviews : [];
  const reviewBlock = reviews.length
    ? `<h3>What people wrote</h3>
<p class="attrib">These are the reviews Google returned, in the order Google returned them — by relevance. None have been picked out, left out or reordered.</p>
${reviews.map(reviewHtml).join('\n')}`
    : '';

  const mapsLink = place.googleMapsUri
    ? `<p class="attrib"><a href="${esc(place.googleMapsUri)}" rel="noopener nofollow" target="_blank">See ${esc(name)} on Google Maps</a></p>`
    : '';

  return `${head}
${hours}
${reviewBlock}
${GOOGLE_LOGO}
${mapsLink}`;
}

module.exports = async function handler(req, res) {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  /* Places content may not be cached. Nor, therefore, may this response. */
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  const url = new URL(req.url, 'https://placeholder.invalid');

  /* A place ID in the request is refused outright rather than ignored. An
     ignored parameter invites someone to keep trying; a refusal says no. */
  for (const forbidden of ['place_id', 'placeId', 'placeid']) {
    if (url.searchParams.has(forbidden)) {
      res.statusCode = 400;
      res.end(JSON.stringify({ ok: false, error: 'This route takes a reference code, not a place id.' }));
      return;
    }
  }

  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) {
    res.statusCode = 503;
    res.end(JSON.stringify({ ok: false, error: 'Not configured.' }));
    return;
  }

  let prospect = null;
  try {
    prospect = await getProspect(url.searchParams.get('ref'));
  } catch (err) {
    console.error('prospect lookup failed');
  }
  /* No record, or a record we never found a listing for: nothing to show.
     Not an error — most prospects have no place id. */
  if (!prospect || !prospect.placeId) {
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: false, reason: 'no listing' }));
    return;
  }

  try {
    const place = await placeDetails(prospect.placeId, key, { fieldMask: FIELDS, maxRetries: 1 });
    if (!place) {
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: false, reason: 'no listing' }));
      return;
    }
    /* Built and sent. Nothing here is written down, and the place object
       goes out of scope with this function. */
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true, html: listingHtml(place) }));
  } catch (err) {
    /* The message could carry parts of the Google response, so it is not
       logged verbatim. */
    console.error('places lookup failed for a prospect page');
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: false, reason: 'lookup failed' }));
  }
};

module.exports.listingHtml = listingHtml;
module.exports.GOOGLE_LOGO = GOOGLE_LOGO;
