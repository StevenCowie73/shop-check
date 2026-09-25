'use strict';

/* The US Census Geocoder: public, free, and with no limit on keeping what it
   returns — unlike Google, whose coordinates may not be stored. Used by the
   importers to place each licence's mailing address on the map.
   https://geocoding.geo.census.gov/geocoder/ */

const ENDPOINT = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress';

async function geocode(address, { fetchImpl = fetch } = {}) {
  const line = String(address || '').trim();
  if (!line) return null;
  const url = ENDPOINT + '?' + new URLSearchParams({ address: line, benchmark: 'Public_AR_Current', format: 'json' });
  const res = await fetchImpl(url);
  if (!res.ok) return null;
  const body = await res.json();
  const m = body && body.result && body.result.addressMatches && body.result.addressMatches[0];
  if (!m || !m.coordinates) return null;
  return { lat: Number(m.coordinates.y), lng: Number(m.coordinates.x), matched: m.matchedAddress, source: 'census' };
}

module.exports = { geocode, ENDPOINT };
