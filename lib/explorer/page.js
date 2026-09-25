'use strict';

/* Explorer's page: one HTML document, no data in it. Everything it shows
   arrives from /explorer?action=... after the password, which is Signal's
   own and is kept in the same sessionStorage key, so being signed in to
   Signal on this phone means being signed in here.

   Hash routes: #/home  #/map  #/list?…  #/b/ID  #/runs  #/run/ID

   Written as String.raw so the browser script below keeps its backslashes;
   it deliberately uses no backticks or template placeholders of its own. */

/* The map is Google's (Maps JavaScript API), because the business screen
   shows Google Places content and Google's terms do not allow that in an
   app with a non-Google map. The script is loaded only when the map
   screen opens, with the browser key the bootstrap action returns after
   the password; there is no map, and no key, in the shell. */
const MAPS_JS = 'https://maps.googleapis.com/maps/api/js';

/* Status colours. Brand blue is kept for the mark alone, so "letter sent"
   is a different, darker blue. */
const STATUS_COLOUR = {
  not_contacted: '#8A8178', letter_sent: '#2F6FA3', page_opened: '#B7791F',
  replied: '#C4501B', client: '#2E7D4F', closed: '#1C1917'
};

const CSS = String.raw`
:root { --ground:#F4EFE6; --surface:#FBF8F2; --ink:#1C1917; --accent:#C4501B; --muted:#6B635B; --line:#E2D9CB; --r:8px; }
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--ground); color: var(--ink); }
body { font: 16px/1.45 "IBM Plex Sans", system-ui, sans-serif; -webkit-font-smoothing: antialiased; padding-bottom: 76px; }
a { color: var(--accent); }
button, input, select, textarea { font: inherit; color: inherit; }
.demo { position: sticky; top: 0; z-index: 1000; background: var(--accent); color: #fff; text-align: center; font-weight: 600; font-size: 13px; letter-spacing: .08em; padding: 5px 16px; }
.demo span { font-weight: 400; letter-spacing: 0; opacity: .9; }
header.top { display: flex; align-items: baseline; justify-content: space-between; padding: 14px 16px 6px; }
header.top h1 { font-size: 20px; margin: 0; font-weight: 600; }
header.top .mode { font-size: 13px; color: var(--muted); }
main { padding: 0 16px 16px; max-width: 640px; margin: 0 auto; }
h2 { font-size: 15px; font-weight: 600; margin: 22px 0 8px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); }
.card { background: var(--surface); border: 1px solid var(--line); border-radius: var(--r); padding: 12px 14px; }
.muted { color: var(--muted); }
.small { font-size: 14px; }
nav.tabs { position: fixed; left: 0; right: 0; bottom: 0; z-index: 1000; display: flex; background: var(--surface); border-top: 1px solid var(--line); padding-bottom: env(safe-area-inset-bottom); }
nav.tabs a { flex: 1; text-align: center; padding: 10px 0 12px; text-decoration: none; color: var(--muted); font-size: 14px; font-weight: 500; }
nav.tabs a.on { color: var(--accent); font-weight: 600; box-shadow: inset 0 2px 0 var(--accent); }
.funnel { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.funnel .step { background: var(--surface); border: 1px solid var(--line); border-radius: var(--r); padding: 10px; }
.funnel .n { font-size: 26px; font-weight: 600; line-height: 1.1; }
.funnel .l { font-size: 13px; color: var(--muted); }
.funnel .pct { font-size: 12px; color: var(--muted); }
.chips { display: flex; flex-wrap: wrap; gap: 8px; }
.chip { display: inline-block; padding: 7px 12px; border: 1px solid var(--line); border-radius: 999px; background: var(--surface); text-decoration: none; color: var(--ink); font-size: 14px; }
.chip.on { background: var(--ink); color: var(--surface); border-color: var(--ink); }
.feed { list-style: none; margin: 0; padding: 0; }
.feed li a { display: block; padding: 10px 0; border-bottom: 1px solid var(--line); text-decoration: none; color: var(--ink); }
.feed .when { font-size: 13px; color: var(--muted); }
.feed .who { font-weight: 600; }
.tag { display: inline-block; font-size: 11px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; padding: 1px 6px; border-radius: 4px; border: 1px solid var(--line); color: var(--muted); vertical-align: 1px; }
.dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; vertical-align: 0; margin-right: 6px; }
.row { display: block; padding: 11px 0; border-bottom: 1px solid var(--line); text-decoration: none; color: var(--ink); }
.row .name { font-weight: 600; }
.row .meta { font-size: 14px; color: var(--muted); }
.filters { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px; }
.filters select, input[type=search], textarea, input[type=password] { width: 100%; padding: 9px 10px; border: 1px solid var(--line); border-radius: var(--r); background: var(--surface); }
input[type=search] { font-size: 16px; }
.btn { display: inline-block; padding: 9px 14px; border-radius: var(--r); border: 1px solid var(--ink); background: var(--ink); color: var(--surface); text-decoration: none; font-weight: 500; cursor: pointer; }
.btn.ghost { background: transparent; color: var(--ink); }
[hidden] { display: none !important; }
#map { position: relative; z-index: 0; height: 58vh; min-height: 300px; border-radius: var(--r); border: 1px solid var(--line); background: var(--surface); }
.legend { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 13px; margin: 8px 0; }
.pinnote { font-size: 13px; color: var(--muted); margin: 6px 0 0; }
dl.facts { display: grid; grid-template-columns: 9.5em 1fr; gap: 6px 10px; margin: 0; font-size: 15px; }
dl.facts dt { color: var(--muted); }
dl.facts dd { margin: 0; overflow-wrap: anywhere; }
.pill { display: inline-block; font-size: 13px; font-weight: 600; padding: 2px 9px; border-radius: 999px; color: #fff; }
.flag { background: var(--ink); color: var(--surface); border-radius: var(--r); padding: 8px 12px; font-weight: 600; font-size: 14px; margin-top: 10px; }
.checks { list-style: none; padding: 0; margin: 8px 0 0; font-size: 15px; }
.checks li { padding: 2px 0; }
.timeline { list-style: none; margin: 0; padding: 0; border-left: 2px solid var(--line); }
.timeline li { padding: 0 0 12px 14px; position: relative; }
.timeline li::before { content: ""; position: absolute; left: -6px; top: 7px; width: 10px; height: 10px; border-radius: 50%; background: var(--surface); border: 2px solid var(--accent); }
.notes li { list-style: none; padding: 8px 0; border-bottom: 1px solid var(--line); }
.notes { padding: 0; margin: 0 0 10px; }
.letterbox { overflow: hidden; border: 1px solid var(--line); border-radius: var(--r); background: #fff; }
.letterbox iframe { border: 0; width: 816px; height: 1056px; transform-origin: 0 0; display: block; }
.listing-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.stars { font-size: 20px; font-weight: 700; }
.gmaps-logo { height: 18px; margin: 14px 10px 5px 0; display: inline-block; vertical-align: middle; }
.attrib { font-size: 14px; color: var(--muted); margin: 6px 0 0; }
.rev { border-top: 1px solid var(--line); padding: 12px 0 4px; }
.rev-who { display: flex; align-items: center; gap: 10px; }
.rev-who img { width: 34px; height: 34px; border-radius: 50%; flex: none; background: var(--ground); }
.rev-name { font-weight: 600; }
.rev-when { font-size: 14px; color: var(--muted); }
.rev-text { margin: 8px 0 0; }
.rev-link { font-size: 14px; }
.hours { margin: 8px 0 0; font-size: 15px; }
#listing h3 { font-size: 15px; margin: 14px 0 0; }
.gate { max-width: 360px; margin: 18vh auto 0; padding: 0 16px; }
.err { color: var(--accent); font-size: 14px; }
.back { display: inline-block; margin: 4px 0 6px; text-decoration: none; font-size: 15px; }
.pincard { margin-top: 10px; }
.mapmsg { padding: 14px; color: var(--muted); font-size: 15px; }
.ai-summary { border-bottom: 1px solid var(--line); padding: 0 0 12px; margin: 0 0 12px; }
.ai-summary h3 { font-size: 15px; margin: 0 0 6px; }
.ai-text { margin: 0; }
.ai-disclosure { margin: 4px 0 0; font-size: 13px; color: var(--muted); }
.ai-links { margin: 6px 0 0; font-size: 14px; }
.ai-report-note { margin: 6px 0 0; font-size: 13px; color: var(--muted); }
`;

const SCRIPT = String.raw`
(function () {
  var KEY = 'signal.pw';
  var COLOUR = __COLOUR__;
  var pw = '';
  try { pw = sessionStorage.getItem(KEY) || ''; } catch (e) {}
  var boot = null, map = null, markers = [], listTimer = null, mapsLoading = null, mapsAuthFailed = false;
  var view = document.getElementById('view');

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function when(iso, withTime) {
    if (!iso) return '';
    var o = { timeZone: 'America/Chicago', month: 'short', day: 'numeric' };
    if (withTime) { o.hour = 'numeric'; o.minute = '2-digit'; }
    return new Date(iso).toLocaleString('en-US', o);
  }
  function day(iso) { return iso ? new Date(iso + (iso.length === 10 ? 'T12:00:00Z' : '')).toLocaleDateString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric' }) : ''; }
  function slabel(s) { return (boot && boot.labels.status[s]) || s; }
  function wlabel(s) { return (boot && boot.labels.website[s]) || s; }
  function pill(s) { return '<span class="pill" style="background:' + (COLOUR[s] || '#8A8178') + '">' + esc(slabel(s)) + '</span>'; }

  function api(action, params, body) {
    var q = new URLSearchParams(params || {}); q.set('action', action);
    var opts = { headers: { 'x-lookup-password': pw } };
    if (body) { opts.method = 'POST'; opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return fetch('/explorer?' + q.toString(), opts).then(function (r) {
      if (r.status === 401) { signOut(); throw new Error('password'); }
      return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'Failed'); return j; });
    });
  }

  function signOut() { pw = ''; try { sessionStorage.removeItem(KEY); } catch (e) {} gate('That password did not work.'); }

  function gate(msg) {
    document.getElementById('tabs').hidden = true;
    view.innerHTML = '<form class="gate" id="gate"><h1 style="font-size:22px;margin:0 0 6px">Explorer</h1>' +
      '<p class="muted small" style="margin:0 0 14px">Signal password.</p>' +
      '<input type="password" id="pw" autocomplete="current-password" aria-label="Password">' +
      '<p class="err" id="gerr">' + esc(msg || '') + '</p><button class="btn" type="submit">Open</button></form>';
    document.getElementById('gate').onsubmit = function (e) {
      e.preventDefault();
      pw = document.getElementById('pw').value;
      try { sessionStorage.setItem(KEY, pw); } catch (x) {}
      start();
    };
  }

  function start() {
    if (!pw) return gate('');
    view.innerHTML = '<p class="muted">Loading…</p>';
    api('bootstrap').then(function (b) {
      boot = b;
      document.getElementById('tabs').hidden = false;
      document.getElementById('demo').hidden = b.mode !== 'demo';
      document.getElementById('mode').textContent = b.mode === 'demo' ? 'demo data' : 'live database';
      route();
    }).catch(function (e) { if (e.message !== 'password') view.innerHTML = '<p class="err">' + esc(e.message) + '</p>'; });
  }

  function parseHash() {
    var h = location.hash.replace(/^#\/?/, '') || 'home';
    var parts = h.split('?');
    return { path: parts[0].split('/'), q: new URLSearchParams(parts[1] || '') };
  }

  function route() {
    if (!boot) return;
    var r = parseHash(), p = r.path;
    var tab = p[0] === 'b' ? 'list' : p[0] === 'run' ? 'runs' : p[0];
    Array.prototype.forEach.call(document.querySelectorAll('nav.tabs a'), function (a) { a.classList.toggle('on', a.dataset.tab === tab); });
    window.scrollTo(0, 0);
    if (map) { markers.forEach(function (m) { m.setMap(null); }); markers = []; map = null; }
    if (p[0] === 'map') return mapView(r.q);
    if (p[0] === 'list') return listView(r.q);
    if (p[0] === 'b' && p[1]) return businessView(p[1]);
    if (p[0] === 'runs') return runsView();
    if (p[0] === 'run' && p[1]) return runView(p[1]);
    return homeView();
  }

  /* ---------- Home ---------- */
  function funnelHtml(f) {
    var steps = [['found', 'Found'], ['selected', 'Selected'], ['letterSent', 'Letter sent'], ['pageOpened', 'Page opened'], ['replied', 'Replied'], ['client', 'Client']];
    return '<div class="funnel">' + steps.map(function (s, i) {
      var prev = i ? f[steps[i - 1][0]] : null;
      /* a percentage only once the step before it counts 100 or more */
      var pct = prev != null && prev >= 100 ? '<div class="pct">' + Math.round(100 * f[s[0]] / prev) + '% of ' + esc(steps[i - 1][1].toLowerCase()) + '</div>' : '';
      return '<div class="step" data-step="' + s[0] + '"><div class="n">' + esc(f[s[0]]) + '</div><div class="l">' + s[1] + '</div>' + pct + '</div>';
    }).join('') + '</div>';
  }

  function feedHref(it) {
    if (it.prospectId) return '#/b/' + encodeURIComponent(it.prospectId);
    if (it.runId) return '#/run/' + encodeURIComponent(it.runId);
    return null;
  }

  function homeView() {
    var b = boot;
    var chips = b.chips.map(function (c) { return '<a class="chip" href="#/list?chip=' + c.id + '">' + esc(c.label) + '</a>'; }).join('');
    var feed = b.feed.map(function (it) {
      var href = feedHref(it);
      var inner = '<div class="when">' + esc(when(it.at, true)) + (it.live ? ' <span class="tag">live</span>' : '') + '</div>' +
        (it.company ? '<div class="who">' + esc(it.company) + '</div>' : '') + '<div>' + esc(it.text) + '</div>';
      return '<li>' + (href ? '<a href="' + href + '">' + inner + '</a>' : '<a>' + inner + '</a>') + '</li>';
    }).join('');
    view.innerHTML = '<h2>Funnel</h2>' + funnelHtml(b.funnel) +
      '<h2>Quick filters</h2><div class="chips">' + chips + '</div>' +
      '<h2>Activity</h2><ul class="feed">' + (feed || '<li class="muted">Nothing yet.</li>') + '</ul>';
  }

  /* ---------- Map ---------- */
  function areaOptions(sel) {
    return '<option value="">All areas</option>' + boot.areas.map(function (a) {
      return '<option value="' + esc(a.id) + '"' + (a.id === sel ? ' selected' : '') + '>' + esc(a.name) + '</option>';
    }).join('');
  }

  /* Loads the Maps JavaScript API once, with the browser key. Google calls
     gm_authFailure if it refuses the key (wrong referrer, API not enabled). */
  function loadMaps(key) {
    if (window.google && window.google.maps && window.google.maps.Map) return Promise.resolve();
    if (mapsLoading) return mapsLoading;
    mapsLoading = new Promise(function (resolve, reject) {
      window.__explorerMapsReady = function () {
        Promise.all([google.maps.importLibrary('maps'), google.maps.importLibrary('marker')]).then(function () { resolve(); }, reject);
      };
      window.gm_authFailure = function () {
        mapsAuthFailed = true;
        var el = document.getElementById('map');
        if (el) el.innerHTML = '<p class="mapmsg">Google refused the map key. Check its website restrictions in Google Cloud.</p>';
      };
      var s = document.createElement('script');
      s.src = '__MAPS_JS__?key=' + encodeURIComponent(key) + '&v=weekly&loading=async&callback=__explorerMapsReady';
      s.async = true;
      s.onerror = function () { mapsLoading = null; reject(new Error('The map did not load.')); };
      document.head.appendChild(s);
    });
    return mapsLoading;
  }

  function mapView(q) {
    var area = q.get('area') || '';
    var legend = boot.statuses.map(function (s) { return '<span><span class="dot" style="background:' + COLOUR[s] + '"></span>' + esc(slabel(s)) + '</span>'; }).join('');
    view.innerHTML = '<h2>Map</h2><select id="marea" aria-label="Area" style="width:100%;padding:9px 10px;border:1px solid var(--line);border-radius:8px;background:var(--surface)">' + areaOptions(area) + '</select>' +
      '<div class="legend">' + legend + '</div><div id="map"></div>' +
      '<p class="pinnote" id="pinnote">Pins sit at the mailing address on the state licence, geocoded with the US Census Geocoder' +
      (boot.mode === 'demo' ? ' — demo pins are scattered around each town centre' : '') + '.</p>' +
      '<div id="pincard" class="pincard"></div>';
    document.getElementById('marea').onchange = function () { location.hash = '#/map' + (this.value ? '?area=' + encodeURIComponent(this.value) : ''); };
    var el = document.getElementById('map');
    if (!boot.mapsKey) { el.innerHTML = '<p class="mapmsg" id="nokey">Map key not set</p>'; return; }
    if (mapsAuthFailed) { el.innerHTML = '<p class="mapmsg">Google refused the map key. Check its website restrictions in Google Cloud.</p>'; return; }
    el.innerHTML = '<p class="mapmsg">Loading the map…</p>';
    Promise.all([loadMaps(boot.mapsKey), api('pins', area ? { area: area } : {})]).then(function (r) {
      var j = r[1];
      if (!document.getElementById('map') || mapsAuthFailed) return;
      map = new google.maps.Map(document.getElementById('map'), {
        center: { lat: 31.5, lng: -92.3 }, zoom: 7, gestureHandling: 'greedy', clickableIcons: false,
        mapTypeControl: false, streetViewControl: false, fullscreenControl: false
      });
      var bounds = new google.maps.LatLngBounds();
      j.pins.forEach(function (p) {
        var m = new google.maps.Marker({
          map: map, position: { lat: p.lat, lng: p.lng }, title: p.company,
          icon: { path: google.maps.SymbolPath.CIRCLE, scale: 9, fillColor: COLOUR[p.status] || '#8A8178', fillOpacity: 1, strokeColor: '#FBF8F2', strokeWeight: 2 }
        });
        m.addListener('click', function () { pinCard(p); });
        markers.push(m); bounds.extend(m.getPosition());
      });
      if (j.pins.length > 1) {
        map.fitBounds(bounds, 24);
        google.maps.event.addListenerOnce(map, 'idle', function () { if (map.getZoom() > 13) map.setZoom(13); });
      } else if (j.pins.length === 1) { map.setCenter(bounds.getCenter()); map.setZoom(13); }
    }).catch(function (e) {
      var m = document.getElementById('map');
      if (m) m.innerHTML = '<p class="mapmsg">' + esc(e.message) + '</p>';
    });
  }

  function pinCard(p) {
    document.getElementById('pincard').innerHTML = '<a class="card row" style="display:block" href="#/b/' + encodeURIComponent(p.id) + '">' +
      '<div class="name">' + esc(p.company) + '</div><div class="meta">' + esc(p.town) + ' · ' + esc(wlabel(p.website)) + '</div>' +
      '<div style="margin-top:6px">' + pill(p.status) + ' <span class="small" style="float:right">Open →</span></div></a>';
  }

  /* ---------- List ---------- */
  function listView(q) {
    function sel(id, label, opts) {
      var cur = q.get(id) || '';
      return '<select data-f="' + id + '" aria-label="' + esc(label) + '"><option value="">' + esc(label) + ': any</option>' + opts.map(function (o) {
        return '<option value="' + esc(o[0]) + '"' + (o[0] === cur ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
      }).join('') + '</select>';
    }
    var chip = q.get('chip');
    var chipBar = boot.chips.map(function (c) {
      return '<a class="chip' + (c.id === chip ? ' on' : '') + '" href="#/list' + (c.id === chip ? '' : '?chip=' + c.id) + '">' + esc(c.label) + '</a>';
    }).join('');
    view.innerHTML = '<h2>List</h2>' +
      '<input type="search" id="q" placeholder="Search name, town, trade" value="' + esc(q.get('q') || '') + '">' +
      '<div class="filters">' +
        sel('area', 'Area', boot.areas.map(function (a) { return [a.id, a.name]; })) +
        sel('status', 'Status', boot.statuses.map(function (s) { return [s, slabel(s)]; })) +
        sel('website', 'Website', boot.websiteStates.map(function (s) { return [s, wlabel(s)]; })) +
        sel('licenceAge', 'Licence', Object.keys(boot.labels.licenceAge).map(function (k) { return [k, boot.labels.licenceAge[k]]; })) +
        sel('hasEmail', 'Email', [['yes', 'Has email'], ['no', 'No email']]) +
      '</div><div class="chips" style="margin-top:10px">' + chipBar + '</div>' +
      '<p class="muted small" id="count" style="margin:12px 0 0"></p><div id="rows"></div>';
    function apply() {
      var n = new URLSearchParams();
      var s = document.getElementById('q').value.trim(); if (s) n.set('q', s);
      Array.prototype.forEach.call(view.querySelectorAll('select[data-f]'), function (el) { if (el.value) n.set(el.dataset.f, el.value); });
      if (chip) n.set('chip', chip);
      history.replaceState(null, '', '#/list' + (n.toString() ? '?' + n.toString() : ''));
      load(n);
    }
    function load(n) {
      var params = {}; n.forEach(function (v, k) { params[k] = v; });
      api('list', params).then(function (j) {
        document.getElementById('count').textContent = j.rows.length + (j.rows.length === 1 ? ' business' : ' businesses');
        document.getElementById('rows').innerHTML = j.rows.map(function (r) {
          return '<a class="row" href="#/b/' + encodeURIComponent(r.id) + '" data-id="' + esc(r.id) + '"><div class="name">' + esc(r.company) +
            (r.doNotContact ? ' <span class="tag">do not contact</span>' : '') + '</div>' +
            '<div class="meta">' + esc(r.town) + ' · ' + esc(r.trade) + '</div>' +
            '<div class="meta"><span class="dot" style="background:' + COLOUR[r.status] + '"></span>' + esc(r.statusLabel) + ' · Website: ' + esc(r.websiteLabel) + '</div></a>';
        }).join('') || '<p class="muted">Nothing matches.</p>';
      });
    }
    document.getElementById('q').oninput = function () { clearTimeout(listTimer); listTimer = setTimeout(apply, 250); };
    Array.prototype.forEach.call(view.querySelectorAll('select[data-f]'), function (el) { el.onchange = apply; });
    load(q);
  }

  /* ---------- Business ---------- */
  function websiteHtml(a) {
    if (!a) return '<p>Not checked yet.</p>';
    var s = a.state, lines = [];
    var head = {
      fine: 'Their website looks fine.',
      poor: 'They have a website, but it is poor.',
      broken: 'Their website is broken.',
      not_found: 'No website found. We searched and found nothing of their own.',
      unknown: 'Not checked.',
      blocked: "Couldn't check — the site blocks automated visits."
    }[s] || wlabel(s);
    if (a.whatsWrong && s !== 'blocked' && s !== 'not_found') lines.push(a.whatsWrong.charAt(0).toUpperCase() + a.whatsWrong.slice(1) + '.');
    var checks = [];
    function yn(v, yes, no) { if (v === true) checks.push('✓ ' + yes); else if (v === false) checks.push('✗ ' + no); }
    yn(a.loads, 'It loads', 'It does not load');
    yn(a.https, 'Secure (https)', 'Not secure (no https)');
    yn(a.viewport, 'Built for phones', 'Not built for phones');
    yn(a.phoneOnPage, 'Phone number on the page', 'No phone number on the page');
    if (a.newestYear) checks.push('Newest year on the page: ' + a.newestYear);
    var how = a.url ? (a.foundBy === 'astra' ? 'Found through a web search.' : 'Found from their email address.') : '';
    return '<p style="margin:0 0 6px;font-weight:600">' + esc(head) + '</p>' +
      (lines.length ? '<p style="margin:0 0 6px">' + esc(lines.join(' ')) + '</p>' : '') +
      (checks.length ? '<ul class="checks">' + checks.map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('') + '</ul>' : '') +
      (a.url ? '<p class="small muted" style="margin:8px 0">' + esc(a.url) + ' · ' + esc(how) + (a.checkedAt ? ' Checked ' + esc(day(a.checkedAt)) + '.' : '') + '</p>' +
               '<a class="btn ghost" href="' + esc(a.url) + '" target="_blank" rel="noopener noreferrer">Open site ↗</a>' : '');
  }

  function businessView(id) {
    view.innerHTML = '<p class="muted">Loading…</p>';
    api('business', { id: id }).then(function (j) {
      var b = j.business;
      var addr = [b.mailingStreet, b.mailingCity, (b.mailingState || '') + ' ' + (b.mailingZip || '')].filter(Boolean).join(', ');
      var notes = (b.notes || []).map(function (n) { return '<li><div class="small muted">' + esc(when(n.createdAt, true)) + '</div>' + esc(n.body) + '</li>'; }).join('');
      var timeline = (b.timeline || []).map(function (t) { return '<li><div class="small muted">' + esc(when(t.at, true)) + '</div>' + esc(t.text) + '</li>'; }).join('');
      var letter = b.letter ? (b.letter.state === 'sent' ? 'Sent ' + day(b.letter.sentAt) : 'Drafted, not sent') : 'No letter yet';
      view.innerHTML = '<a class="back" href="javascript:history.back()">← Back</a>' +
        '<h1 style="font-size:24px;margin:2px 0 4px;line-height:1.2" id="bname">' + esc(b.company) + '</h1>' +
        '<div class="muted">' + esc(b.mailingCity) + ' · ' + esc(b.trade) + '</div>' +
        '<div style="margin-top:8px">' + pill(b.status) + '</div>' +
        (b.doNotContact ? '<div class="flag" id="dncflag">Do not contact</div>' : '') +

        '<h2>Licence</h2><div class="card"><dl class="facts">' +
          '<dt>Qualifying party</dt><dd>' + esc(b.ownerName) + '</dd>' +
          '<dt>Licence</dt><dd>' + esc((b.licenceTypes || []).join(', ')) + '</dd>' +
          '<dt>Status</dt><dd>' + esc(b.licenceStatus) + '</dd>' +
          '<dt>First issued</dt><dd>' + esc(day(b.firstIssued)) + '</dd>' +
          '<dt>Mailing address</dt><dd>' + esc(addr) + '</dd>' +
          '<dt>Phone</dt><dd>' + (b.phone ? '<a href="tel:' + esc(b.phone.replace(/[^0-9+]/g, '')) + '">' + esc(b.phone) + '</a>' : '—') + '</dd>' +
          '<dt>Email</dt><dd>' + (b.email ? esc(b.email) : '—') + '</dd>' +
          '<dt>Reference</dt><dd>' + esc(b.id) + '</dd>' +
        '</dl></div>' +

        '<h2>Website</h2><div class="card" id="website">' + websiteHtml(b.audit) + '</div>' +

        '<h2>Google listing</h2><div class="card" id="listing"><p class="muted" style="margin:0">' +
          (b.hasPlaceId ? 'Fetching from Google…' : "No Google listing on file — there's no place_id for this business.") + '</p></div>' +

        '<h2>Letter</h2><div class="card"><p style="margin:0 0 8px">' + esc(letter) + '</p><button class="btn ghost" id="showletter" type="button">Show the letter</button><div id="letter" style="margin-top:10px"></div></div>' +

        '<h2>Timeline</h2>' + (timeline ? '<ul class="timeline">' + timeline + '</ul>' : '<p class="muted">Nothing yet.</p>') +

        '<h2>Notes</h2><ul class="notes" id="notes">' + (notes || '<li class="muted" id="nonotes">No notes yet.</li>') + '</ul>' +
        '<form id="noteform"><textarea id="notebody" rows="3" maxlength="500" placeholder="Add a note"></textarea>' +
        '<p class="err" id="noteerr"></p><button class="btn" type="submit">Save note</button></form>' +

        '<h2>Contact</h2><label style="display:flex;gap:10px;align-items:center"><input type="checkbox" id="dnc"' + (b.doNotContact ? ' checked' : '') + '> Do not contact</label>' +
        (boot.mode === 'demo' ? '<p class="small muted">Demo: notes and this flag are kept in memory and are gone when the server restarts.</p>' : '');

      if (b.hasPlaceId) {
        api('google', { id: b.id }).then(function (g) {
          document.getElementById('listing').innerHTML = g.ok ? g.html :
            '<p class="muted" style="margin:0">' + esc(g.reason === 'no place_id' ? "No Google listing on file — there's no place_id for this business." : 'Google did not return a listing (' + g.reason + ').') + '</p>';
        });
      }
      document.getElementById('showletter').onclick = function () {
        var box = document.getElementById('letter');
        this.hidden = true;
        box.innerHTML = '<p class="muted">Loading…</p>';
        api('letter', { id: b.id }).then(function (l) {
          if (!l.html) { box.innerHTML = '<p class="muted">No letter for this business.</p>'; return; }
          box.innerHTML = '<p class="small muted" style="margin:0 0 6px">' + (l.drafted ? 'Drafted from the current record — not a stored copy.' : 'As ' + esc(l.state) + '.') + '</p><div class="letterbox"><iframe title="Letter" sandbox=""></iframe></div>';
          var fr = box.querySelector('iframe'), wrap = box.querySelector('.letterbox');
          fr.srcdoc = l.html;
          var k = wrap.clientWidth / 816;
          fr.style.transform = 'scale(' + k + ')';
          wrap.style.height = Math.ceil(1056 * k) + 'px';
        });
      };
      document.getElementById('noteform').onsubmit = function (e) {
        e.preventDefault();
        var body = document.getElementById('notebody').value.trim();
        if (!body) return;
        api('note', { id: b.id }, { body: body }).then(function (r) {
          var none = document.getElementById('nonotes'); if (none) none.remove();
          var li = document.createElement('li');
          li.innerHTML = '<div class="small muted">' + esc(when(r.note.createdAt, true)) + '</div>' + esc(r.note.body);
          document.getElementById('notes').prepend(li);
          document.getElementById('notebody').value = '';
          document.getElementById('noteerr').textContent = '';
        }).catch(function (x) { document.getElementById('noteerr').textContent = x.message; });
      };
      document.getElementById('dnc').onchange = function () {
        var v = this.checked;
        api('dnc', { id: b.id }, { value: v }).then(function () { businessView(b.id); });
      };
    }).catch(function (e) { view.innerHTML = '<p class="err">' + esc(e.message) + '</p>'; });
  }

  /* ---------- Runs ---------- */
  function runFunnel(f) {
    var names = { licences: 'licences read', inArea: 'in the area', active: 'active', picked: 'picked' };
    return Object.keys(names).filter(function (k) { return f[k] != null; }).map(function (k) { return '<b>' + esc(f[k]) + '</b> ' + names[k]; }).join(' → ');
  }
  function areaName(id) { var a = boot.areas.filter(function (x) { return x.id === id; })[0]; return a ? a.name : id; }
  function runCard(r, link) {
    var inner = '<div class="name" style="font-weight:600">' + esc(r.label) + '</div>' +
      '<div class="meta muted small">' + esc(areaName(r.areaId)) + ' · ' + esc(day(r.startedAt)) + ' · $' + Number(r.costUsd).toFixed(2) + '</div>' +
      '<div style="margin-top:6px;font-size:15px">' + runFunnel(r.funnel || {}) + '</div>' +
      ((r.problems || []).length ? '<div class="small" style="margin-top:6px"><span class="muted">Problems:</span><ul style="margin:2px 0 0;padding-left:18px">' + r.problems.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + '</ul></div>' : '');
    return link ? '<a class="card" style="display:block;text-decoration:none;color:inherit;margin-bottom:10px" href="#/run/' + encodeURIComponent(r.id) + '">' + inner + '<div class="small" style="margin-top:6px;color:var(--accent)">See the picked businesses →</div></a>'
                : '<div class="card">' + inner + '</div>';
  }
  function runsView() {
    view.innerHTML = '<h2>Runs</h2><div id="runs"><p class="muted">Loading…</p></div>';
    api('runs').then(function (j) {
      document.getElementById('runs').innerHTML = j.runs.slice().sort(function (a, b) { return b.startedAt.localeCompare(a.startedAt); }).map(function (r) { return runCard(r, true); }).join('') || '<p class="muted">No runs yet.</p>';
    });
  }
  function runView(id) {
    api('run', { id: id }).then(function (j) {
      var r = j.run;
      view.innerHTML = '<a class="back" href="#/runs">← Runs</a>' + runCard(r, false) +
        '<h2>Picked (' + r.picked.length + ')</h2>' + r.picked.map(function (p) {
          return '<a class="row" href="#/b/' + encodeURIComponent(p.id) + '"><div class="name">' + esc(p.company) + '</div>' +
            '<div class="meta">' + esc(p.town) + ' · ' + esc(p.trade) + '</div><div class="meta"><span class="dot" style="background:' + COLOUR[p.status] + '"></span>' + esc(p.statusLabel) + ' · Website: ' + esc(p.websiteLabel) + '</div></a>';
        }).join('');
    }).catch(function (e) { view.innerHTML = '<p class="err">' + esc(e.message) + '</p>'; });
  }

  window.addEventListener('hashchange', route);
  start();
})();
`;

function pageHtml() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#F4EFE6">
<!-- The site default is no-referrer. Google checks a browser key against
     the page's address, so this page sends its origin (never the path)
     to other sites. -->
<meta name="referrer" content="strict-origin-when-cross-origin">
<title>Explorer</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&display=swap">
<style>${CSS}</style>
</head>
<body>
<div class="demo" id="demo">DEMO DATA <span>— invented businesses, not real prospects</span></div>
<header class="top"><h1>Explorer</h1><span class="mode" id="mode"></span></header>
<main id="view"></main>
<nav class="tabs" id="tabs" hidden>
  <a href="#/home" data-tab="home">Home</a>
  <a href="#/map" data-tab="map">Map</a>
  <a href="#/list" data-tab="list">List</a>
  <a href="#/runs" data-tab="runs">Runs</a>
</nav>
<script>${SCRIPT.replace('__COLOUR__', JSON.stringify(STATUS_COLOUR)).replace('__MAPS_JS__', MAPS_JS)}</script>
</body>
</html>`;
}

module.exports = { pageHtml, STATUS_COLOUR };
