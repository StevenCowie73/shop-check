'use strict';

/* One prospect, one page. The whole presentation — there is no meeting.

   Reached as /p/REF, which middleware rewrites here. The record comes from
   site/prospects.js and nothing on this page is invented at render time: a
   section that the record cannot support is left out rather than filled in.

   The Google listing is not rendered here. It is fetched by the browser from
   /api/places?ref=REF after the page loads, so that nothing from Places is
   ever held by this function, and a slow or failing Places call costs the
   prospect a missing panel rather than a blank page. */

const { getProspect } = require('../site/prospects.js');
const { websiteFinding } = require('../lib/website-finding.js');
const C = require('../site/content.js');
const { pageShell, esc } = require('../site/shell.js');
const { clientKey, counter, distinctCounter, retryAfter } = require('../lib/ratelimit.js');

const INTAKE_URL = 'https://stevencowie73.github.io/shop-check';

/* Read lib/ratelimit.js before trusting these.

   These only ever count requests for codes that do not resolve. A code that
   does resolve belongs to somebody holding a letter, and their page is served
   however many times they ask for it — the first version of this counted
   every request, and a live burst through one address showed exactly what
   that costs: everyone behind a shared mobile gateway sharing one budget, so
   the thirteenth prospect to open their letter on that carrier gets a 429.
   A walker learns nothing from a 404 either way, so the counting belongs on
   the misses.

   Twelve different dud codes in ten minutes, or forty misses in a minute,
   and the rest are refused. */
const MISS_RATE = counter({ windowMs: 60 * 1000, max: 40 });
const MISS_WALK = distinctCounter({ windowMs: 10 * 60 * 1000, max: 12 });

function notFound(res) {
  res.statusCode = 404;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Cache-Control', 'no-store');
  res.end(require('../site/notfound-html.js'));
}

/* The phone mockup. Four beats: a missed call, the text that goes out for
   them, the caller answering it, and the owner picking it up later. */
function phoneDemo(p) {
  const first = p.ownerFirstName ? p.ownerFirstName : 'the owner';
  const autoText = p.ownerFirstName
    ? `Hi, this is ${p.ownerFirstName} at ${p.business}. Sorry I missed your call. I'll get back to you today.`
    : `Hi, this is ${p.business}. Sorry I missed your call. I'll get back to you today.`;

  return `<div class="demo" id="demo" role="img" aria-label="A missed call, then a text from ${esc(p.business)} to the caller, then the caller replying, then ${esc(first)} replying later.">
  <div class="phone">
    <div class="missed" data-beat="1">
      <span class="dot"></span>
      <div>
        <strong>Missed call</strong>
        <span class="sub">Unknown number &middot; just now</span>
      </div>
    </div>
    <div class="bubble out" data-beat="2">${esc(autoText)}</div>
    <div class="bubble in" data-beat="3">Thanks — need a quote for 120ft of privacy fence.</div>
    <div class="bubble out" data-beat="4">No problem. I can swing by tomorrow morning.</div>
    <p class="beat-note" data-beat="4">Sent for you, straight away. You replied when you were off the job.</p>
  </div>
  <button class="replay" id="replay" type="button">Play again</button>
</div>`;
}

function render(p, channel) {
  const finding = websiteFinding(p.websiteState, p.websiteAudit);
  const brand = C.BUSINESS.brand;

  /* Two actions once there is a number to put in them, because half the
     people this reaches will not text a stranger and the other half will not
     ring one. While the number is still empty a tel: link would dial nothing
     and an sms: link would open an empty thread, so there is one email link
     instead. */
  const smsBody = `Hi Steven, this is ${p.business}. Saw the page.`;
  const dialled = String(C.BUSINESS.phone || '').replace(/[^0-9+]/g, '');
  const action = dialled
    ? `<div class="actions">
  <a class="action" data-event="text_tapped" href="sms:${esc(dialled)}?&body=${encodeURIComponent(smsBody)}">Text me</a>
  <a class="action" data-event="call_tapped" href="tel:${esc(dialled)}">Call me</a>
</div>`
    : `<a class="action" data-event="text_tapped" href="mailto:${esc(C.BUSINESS.email)}?subject=${encodeURIComponent(p.business)}&body=${encodeURIComponent(smsBody)}">Email me</a>`;

  const listing = p.placeId
    ? `<section>
  <h2>Your Google listing</h2>
  <div id="listing" data-ref="${esc(p.ref)}"><p class="muted">Loading your listing&hellip;</p></div>
</section>`
    : '';

  const websiteSection = finding.text
    ? `<section>
  <h2>Your website</h2>
  <p>${esc(finding.text)}</p>
</section>`
    : '';

  const body = `<header>
  <h1>${esc(p.business)}</h1>
  <p class="tagline">Here's what I found.</p>
</header>
<div class="rule"></div>

<section>
  <h2>When you can't get to the phone</h2>
  <p>You're on a job, the phone rings, and you can't answer it. Most people who get voicemail don't leave a message — they call the next ${esc(p.tradeNoun)}. This is what happens instead.</p>
  ${phoneDemo(p)}
</section>

${listing}

${websiteSection}

<section>
  <h2>Two other things</h2>
  <h3>Reviews</h3>
  <p>After a job is done, ${esc(p.business)} sends a short text with the review link already in it. Every customer whose job is done gets asked, once. No chasing, no awkward ask in person.</p>
  <h3>A simple website</h3>
  <p>One page that loads fast on a phone: who you are, what you do, where you work in ${esc(p.city)} and how to reach you. Registered in your name, not mine. If you ever leave, it goes with you.</p>
</section>

<section>
  <h2>What it costs</h2>
  <div class="card">
    <p class="price">$79 a month</p>
    <ul class="price-points">
      <li>First month free.</li>
      <li>No contract.</li>
      <li>Cancel with a text.</li>
      <li>Website registered in your name.</li>
    </ul>
  </div>
</section>

<div class="note">${esc(C.HOME.reassurance)}</div>

<section>
  ${action}
  <p class="second"><a href="${esc(INTAKE_URL)}" id="intake" data-event="intake_opened" rel="noopener">Not sure which one you need? Two-minute check.</a></p>
</section>

<footer>
  <p>${esc(brand)} is a trade name of ${esc(C.BUSINESS.legal)}, ${esc(C.BUSINESS.city)}, ${esc(C.BUSINESS.state)}.</p>
  <nav><a href="/privacy">Privacy</a><a href="/terms">Terms</a></nav>
</footer>

<script>
(function () {
  var REF = ${JSON.stringify(p.ref)};
  var CHANNEL = ${JSON.stringify(channel)};
  var HAS_LISTING = ${p.placeId ? 'true' : 'false'};

  /* Fire and forget. The page never waits for this and never shows an error
     because of it. */
  var sent = {};
  function track(event) {
    if (sent[event]) return;
    sent[event] = true;
    try {
      var body = JSON.stringify({
        ref: REF, event: event, channel: CHANNEL,
        device: window.matchMedia('(pointer: coarse)').matches ? 'phone' : 'desktop'
      });
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/track', new Blob([body], { type: 'application/json' }));
      } else {
        fetch('/api/track', { method: 'POST', body: body, keepalive: true,
          headers: { 'Content-Type': 'application/json' } }).catch(function () {});
      }
    } catch (e) { /* never the page's problem */ }
  }

  /* Only count an open once the page has actually been looked at. An email
     scanner that fetches and closes has not opened anything. */
  var visibleFor = 0, timer = null;
  function startClock() {
    if (document.visibilityState !== 'visible' || timer) return;
    timer = setInterval(function () {
      visibleFor += 250;
      if (visibleFor >= 2000) { clearInterval(timer); timer = null; track('page_open'); }
    }, 250);
  }
  function stopClock() { if (timer) { clearInterval(timer); timer = null; } }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') startClock(); else stopClock();
  });
  startClock();

  var actions = document.querySelectorAll('.action');
  Array.prototype.forEach.call(actions, function (el) {
    el.addEventListener('click', function () { track(el.getAttribute('data-event')); });
  });
  var intake = document.getElementById('intake');
  if (intake) intake.addEventListener('click', function () { track('intake_opened'); });

  /* ---- the phone mockup ---- */
  var demo = document.getElementById('demo');
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (demo) {
    var beats = demo.querySelectorAll('[data-beat]');
    function showAll() {
      for (var i = 0; i < beats.length; i++) beats[i].classList.add('on');
    }
    function play() {
      if (reduced) { showAll(); return; }
      for (var i = 0; i < beats.length; i++) beats[i].classList.remove('on');
      var delays = [200, 1400, 2900, 4200, 4600];
      beats.forEach(function (el, i) {
        setTimeout(function () { el.classList.add('on'); }, delays[i] || 4600);
      });
      track('animation_played');
    }
    if (reduced) {
      showAll();
    } else if ('IntersectionObserver' in window) {
      var seen = false;
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting && !seen) { seen = true; play(); }
        });
      }, { threshold: 0.4 });
      io.observe(demo);
    } else {
      play();
    }
    var replay = document.getElementById('replay');
    if (replay) replay.addEventListener('click', play);
    demo.addEventListener('click', function (e) { if (e.target !== replay) play(); });
  }

  /* ---- the Google listing ---- */
  if (HAS_LISTING) {
    fetch('/api/places?ref=' + encodeURIComponent(REF))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        var box = document.getElementById('listing');
        if (!box) return;
        if (!data || !data.ok) { box.parentNode.removeChild(box.closest('section')); return; }
        box.innerHTML = data.html;
        track('listing_shown');
      })
      .catch(function () {
        var box = document.getElementById('listing');
        if (box && box.closest('section')) box.closest('section').removeChild(box);
      });
  }
})();
</script>`;

  return pageShell({
    title: p.business + ' — ' + brand,
    description: "What I found for " + p.business + ".",
    body,
    extraCss: PROSPECT_CSS
  });
}

const PROSPECT_CSS = `
h3 { margin: 22px 0 6px; font-size: 19px; font-weight: 600; }
section { margin: 0 0 6px; }
.muted { color: var(--muted); }

/* ---- the phone ---- */
.demo { margin: 20px 0 8px; }
.phone {
  background: var(--surface); border: 2px solid var(--line); border-radius: 18px;
  padding: 16px 14px; display: flex; flex-direction: column; gap: 10px;
  min-height: 330px;
}
.missed, .bubble, .beat-note { opacity: 0; transform: translateY(6px); }
@media (prefers-reduced-motion: no-preference) {
  .missed, .bubble, .beat-note { transition: opacity 320ms ease, transform 320ms ease; }
}
.missed.on, .bubble.on, .beat-note.on { opacity: 1; transform: none; }
.missed {
  display: flex; gap: 12px; align-items: center;
  border-bottom: 1px solid var(--line); padding-bottom: 12px;
}
.missed .dot {
  width: 12px; height: 12px; border-radius: 50%; background: var(--accent); flex: none;
}
.missed strong { display: block; font-size: 17px; }
.missed .sub { font-size: 14px; color: var(--muted); }
.bubble {
  max-width: 85%; padding: 11px 14px; border-radius: 14px;
  font-size: 16px; line-height: 1.45; text-wrap: pretty;
}
.bubble.out { align-self: flex-start; background: var(--callout); border: 1px solid var(--line); }
.bubble.in { align-self: flex-end; background: var(--ground); border: 1px solid var(--line); }
.beat-note { font-size: 14px; color: var(--muted); margin: 4px 0 0; }
.replay {
  margin-top: 12px; min-height: 48px; width: 100%;
  background: transparent; border: 2px solid var(--line); border-radius: var(--radius);
  font-family: inherit; font-size: 16px; font-weight: 600; color: var(--muted);
  cursor: pointer; touch-action: manipulation;
}
.replay:hover { border-color: var(--ink); color: var(--ink); }

/* ---- the listing ---- */
.listing-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.stars { font-size: 22px; font-weight: 700; }
.gmaps-logo { height: 18px; margin: 14px 10px 5px 0; display: inline-block; vertical-align: middle; }
.attrib { font-size: 14px; color: var(--muted); margin: 6px 0 0; }
.rev { border-top: 1px solid var(--line); padding: 14px 0 4px; }
.rev-who { display: flex; align-items: center; gap: 10px; }
.rev-who img { width: 34px; height: 34px; border-radius: 50%; flex: none; background: var(--ground); }
.rev-name { font-weight: 600; font-size: 16px; }
.rev-when { font-size: 14px; color: var(--muted); }
.rev-text { margin: 8px 0 0; font-size: 16px; line-height: 1.5; text-wrap: pretty; }
.rev-link { font-size: 14px; }
.hours { margin: 10px 0 0; font-size: 15px; line-height: 1.6; }

/* ---- the action ---- */
.actions { display: flex; flex-wrap: wrap; gap: 12px; margin: 26px 0 10px; }
.actions .action { flex: 1 1 150px; margin: 0; }
.action {
  display: flex; align-items: center; justify-content: center;
  min-height: 60px; margin: 26px 0 10px; padding: 12px 20px;
  background: var(--accent); color: #FFF7EE; border-radius: var(--radius);
  font-size: 21px; font-weight: 700; text-decoration: none; touch-action: manipulation;
}
.action:hover { background: #A94314; color: #FFF7EE; }
.second { font-size: 16px; }
`;

module.exports = async function handler(req, res) {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Cache-Control', 'no-store');

  const url = new URL(req.url, 'https://placeholder.invalid');
  const ref = url.searchParams.get('ref');
  const channelRaw = String(url.searchParams.get('c') || '').toLowerCase();
  const channel = channelRaw === 'letter' || channelRaw === 'email' ? channelRaw : 'direct';

  let prospect = null;
  try {
    prospect = await getProspect(ref);
  } catch (err) {
    console.error('prospect lookup failed: ' + (err && err.message));
  }

  if (!prospect) {
    const who = clientKey(req);
    const asked = String(ref || '').trim().toUpperCase();
    if (MISS_RATE.exceeded(who) || MISS_WALK.exceeded(who, asked)) {
      res.statusCode = 429;
      res.setHeader('Retry-After', retryAfter(MISS_RATE.windowMs));
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('Too many requests.\n');
      return;
    }
    notFound(res);
    return;
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(render(prospect, channel));
};

module.exports.render = render;
module.exports.MISS_RATE = MISS_RATE;
module.exports.MISS_WALK = MISS_WALK;
/* Tests and local runs share one process, so the counters need emptying
   between cases that are deliberately over the limit. */
module.exports.resetLimits = function () { MISS_RATE.reset(); MISS_WALK.reset(); };
module.exports.PROSPECT_CSS = PROSPECT_CSS;
