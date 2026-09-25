'use strict';

/* What the map should show when it opens.

   A licence's mailing address is not always near the business: a few
   Bossier / Caddo licence holders get their post in Wisconsin or Tennessee,
   and fitting the view to every pin opened the map on half the country.
   So an area opens on its own businesses: pins outside Louisiana are left
   out of the fit, and so are far outliers inside it. Every pin is still
   drawn; only the opening view ignores them. "All areas" opens on
   Louisiana.

   Returns { bounds: {south, west, north, east} } or, for a single pin,
   { center: {lat, lng}, zoom }. Plain ES5 with no dependencies: page.js
   sends this function's own source to the browser. */
function mapFit(pins, area) {
  var LOUISIANA = { south: 28.9, west: -94.05, north: 33.02, east: -88.8 };
  var MIN_KM = 40;          /* never trim anything within this of the middle */
  var SPREAD = 4;           /* ... or within 4x the typical distance from it */
  if (!area) return { bounds: LOUISIANA };
  var inLa = [];
  for (var i = 0; i < (pins || []).length; i++) {
    var p = pins[i];
    if (p && isFinite(p.lat) && isFinite(p.lng) && p.lat >= LOUISIANA.south && p.lat <= LOUISIANA.north &&
        p.lng >= LOUISIANA.west && p.lng <= LOUISIANA.east) inLa.push(p);
  }
  if (!inLa.length) return { bounds: LOUISIANA };
  function median(xs) {
    var s = xs.slice().sort(function (a, b) { return a - b; });
    var m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  var mid = { lat: median(inLa.map(function (p) { return p.lat; })), lng: median(inLa.map(function (p) { return p.lng; })) };
  function km(p) {
    var dLat = (p.lat - mid.lat) * 111.2;
    var dLng = (p.lng - mid.lng) * 111.2 * Math.cos(mid.lat * Math.PI / 180);
    return Math.sqrt(dLat * dLat + dLng * dLng);
  }
  var limit = Math.max(MIN_KM, SPREAD * median(inLa.map(km)));
  var kept = inLa.filter(function (p) { return km(p) <= limit; });
  if (kept.length === 1) return { center: { lat: kept[0].lat, lng: kept[0].lng }, zoom: 13 };
  var b = { south: 90, west: 180, north: -90, east: -180 };
  kept.forEach(function (p) {
    b.south = Math.min(b.south, p.lat); b.north = Math.max(b.north, p.lat);
    b.west = Math.min(b.west, p.lng); b.east = Math.max(b.east, p.lng);
  });
  return { bounds: b };
}

module.exports = { mapFit };
