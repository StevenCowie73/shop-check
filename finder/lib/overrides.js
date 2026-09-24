'use strict';

/* Facts you or I established by hand, which the Places API does not know
   and a re-run would otherwise throw away.

   Say Greenfield Tiling has a website but Google does not list it: every
   run of find-prospects.js would score them as having none. An override
   says otherwise, permanently.

   The file is finder/overrides.json, keyed by place id, and it is
   git-ignored because its contents are tied to real businesses. See
   overrides.example.json for the shape.

   Two consumers:
     find-prospects.js  applies them to the Places record BEFORE scoring,
                        so score and reasons come out right on a fresh run
     make-call-list.js  applies them when reading prospects.csv, so a card
                        is right without re-running the finder at all */

const fs = require('fs');
const path = require('path');

const FILE = process.env.SHOP_CHECK_OVERRIDES || path.join(__dirname, '..', 'overrides.json');

function loadOverrides(file) {
  const target = file || FILE;
  if (!fs.existsSync(target)) return new Map();
  let data;
  try { data = JSON.parse(fs.readFileSync(target, 'utf8')); }
  catch (e) { throw new Error(`overrides file is not valid JSON: ${target}`); }
  const byPlaceId = new Map();
  for (const [placeId, value] of Object.entries(data || {})) {
    if (!placeId || !value || typeof value !== 'object') continue;
    byPlaceId.set(placeId, value);
  }
  return byPlaceId;
}

/* A Places record, corrected. Only fields we have actually established get
   touched; everything else is left exactly as Google returned it. */
function applyToPlace(place, ov) {
  if (!ov) return place;
  if (ov.website && !place.websiteUri) place.websiteUri = ov.website;
  return place;
}

/* The owner, if somebody has written one down. Shape matches what the card
   expects: a name, where it came from, and whether a second source agreed. */
function ownerOf(ov) {
  if (!ov || !ov.owner || !ov.owner.name) return null;
  return {
    name: String(ov.owner.name),
    source: ov.owner.source ? String(ov.owner.source) : null,
    confirmed: Boolean(ov.owner.confirmed)
  };
}

module.exports = { FILE, loadOverrides, applyToPlace, ownerOf };
