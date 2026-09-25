'use strict';

/* Visiting a prospect's website and scoring how badly it needs replacing.
   Moved out of check-sites.js so the single-business lookup audits a site
   exactly the way the batch run does — same weights, same wording.

   Politeness is built in here, not at the call site: robots.txt is read
   first and honoured including crawl-delay, one request per page, a real
   timeout, a normal browser user agent, and no retries. */

const { sleep } = require('./env.js');
const { get, getText, readCapped, shortError } = require('./http.js');

/* =====================================================================
   1. HOW WE VISIT — edit me.
   Polite by design: one page at a time, a real timeout, a normal
   browser user agent, and whatever crawl delay robots.txt asks for.
   ===================================================================== */
const AUDIT = {
  timeoutMs: 10000,
  delayMs: 1500,               /* between requests, on top of any crawl-delay */
  maxBytes: 3 * 1024 * 1024,   /* stop reading a page after this much HTML */
  heavyBytes: 1.5 * 1024 * 1024,
  staleYears: 3,               /* newest year older than this is stale */
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  /* A "website" on one of these is somebody else's page, not their own */
  notTheirOwnSite: [
    { host: 'facebook.com', label: 'a Facebook page' },
    { host: 'fb.com', label: 'a Facebook page' },
    { host: 'fb.me', label: 'a Facebook page' },
    { host: 'instagram.com', label: 'an Instagram page' },
    { host: 'yelp.com', label: 'a Yelp listing' },
    { host: 'sites.google.com', label: 'a Google Sites page' },
    { host: 'business.site', label: 'a Google Business page' },
    { host: 'linktr.ee', label: 'a Linktree page' },
    { host: 'nextdoor.com', label: 'a Nextdoor page' },
    { host: 'angi.com', label: 'an Angi listing' },
    { host: 'homeadvisor.com', label: 'a HomeAdvisor listing' }
  ]
};

/* =====================================================================
   2. SCORING WEIGHTS — edit me.
   Higher total = the site is more in need of replacing. Capped at 100.
   A site that never loads is scored on that alone; we cannot judge a
   page we never saw.
   ===================================================================== */
const WEIGHTS = {
  doesNotLoad: 60,        /* dead, timed out, or an error page */
  parkedDomain: 60,       /* the domain answers, but there is no site on it */
  socialAsWebsite: 35,    /* their "website" is somebody else's platform */
  noViewport: 20,         /* no mobile viewport tag at all */
  noPhoneOnPage: 20,      /* nowhere to tap or copy a number */
  httpOnly: 18,           /* still plain http, browsers say "not secure" */
  staleContent: 12,       /* newest year on the page is old */
  deadTech: 10,           /* Flash, frames, table layout, <font> */
  heavyPage: 5,           /* a lot of HTML for a small trade site */
  noYearAnywhere: 5,      /* no date at all, so no sign of life */
  maxScore: 100
};


const THIS_YEAR = new Date().getFullYear();
/* how much homepage text the judgment is given */
const SITE_TEXT_CHARS = 6000;

/* ---------- robots.txt ---------- */
function parseRobots(text) {
  const groups = [];
  let current = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const field = m[1].toLowerCase();
    const value = m[2].trim();
    if (field === 'user-agent') {
      if (!current || current.rules.length || current.crawlDelay !== null) {
        current = { agents: [], rules: [], crawlDelay: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if (current && (field === 'allow' || field === 'disallow')) {
      current.rules.push({ allow: field === 'allow', path: value });
    } else if (current && field === 'crawl-delay') {
      const n = parseFloat(value);
      if (!Number.isNaN(n)) current.crawlDelay = n;
    }
  }
  return groups;
}

function matchesRobotsPath(pattern, urlPath) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  const anchored = escaped.endsWith('\\$')
    ? new RegExp('^' + escaped.slice(0, -2) + '$')
    : new RegExp('^' + escaped);
  return anchored.test(urlPath);
}

/* We visit as a browser would, so the "*" group is the one that applies. */
function robotsVerdict(groups, urlPath) {
  const group = groups.find(g => g.agents.includes('*'));
  if (!group) return { allowed: true, crawlDelay: 0 };
  let best = null;
  for (const rule of group.rules) {
    if (rule.path === '') continue;            /* an empty Disallow allows everything */
    if (!matchesRobotsPath(rule.path, urlPath)) continue;
    if (!best ||
        rule.path.length > best.path.length ||
        (rule.path.length === best.path.length && rule.allow)) best = rule;
  }
  return { allowed: best ? best.allow : true, crawlDelay: group.crawlDelay || 0 };
}

/* ---------- fetching ---------- */

/* ---------- reading the page ---------- */
function stripTags(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ');
}

function hasViewport(html) {
  return /<meta[^>]+name\s*=\s*["']?viewport["']?/i.test(html);
}

function pageTitle(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return '';
  return stripTags(m[1]).trim().slice(0, 120);
}

function findsPhone(html, text) {
  if (/href\s*=\s*["']tel:/i.test(html)) return true;
  /* a plain US number, not a date or an id */
  return /(?:\(\d{3}\)\s*|\b\d{3}[.\-\s])\d{3}[.\-\s]?\d{4}\b/.test(text);
}

function newestYear(text) {
  const years = (text.match(/\b(?:19|20)\d{2}\b/g) || [])
    .map(Number)
    .filter(y => y >= 1990 && y <= THIS_YEAR + 1);
  return years.length ? Math.max(...years) : null;
}

function deadTech(html) {
  const found = [];
  if (/\.swf\b/i.test(html) || /application\/x-shockwave-flash/i.test(html) || /<embed[^>]+swf/i.test(html)) found.push('Flash');
  if (/<frameset\b/i.test(html) || /<frame\b/i.test(html)) found.push('frames');
  if (/<marquee\b/i.test(html) || /<blink\b/i.test(html)) found.push('scrolling text');
  if (/<font\b/i.test(html)) found.push('<font> tags');
  if (/<applet\b/i.test(html)) found.push('Java applets');
  const tableLayout = /<table[^>]*(?:cellpadding|cellspacing|border\s*=)/i.test(html) ||
    /<table[\s\S]{0,4000}?<table/i.test(html);
  if (tableLayout) found.push('tables for layout');
  return found;
}

/* A parked domain answers 200 and serves a stub that bounces the visitor to
   a holding page. There is no site there, so the ordinary complaints — no
   viewport, no phone number — are not findings about their website, they
   are findings about a placeholder. Say what is actually true instead. */
function isParked(html, text) {
  if (String(text || '').trim().length > 40) return false;
  if (String(html || '').length > 4000) return false;
  return /location\.(href|replace)\s*=?\s*\(?\s*["'][^"']*\/(lander|parking|park|default\.aspx)/i.test(html) ||
         /<meta[^>]+http-equiv=["']?refresh[^>]*\/(lander|parking)/i.test(html);
}

function isNotTheirOwnSite(url) {
  let host;
  try { host = new URL(url).hostname.toLowerCase().replace(/^www\./, ''); }
  catch (e) { return null; }
  const hit = AUDIT.notTheirOwnSite.find(s => host === s.host || host.endsWith('.' + s.host));
  return hit ? hit.label : null;
}

/* ---------- scoring ---------- */

/* ---------- scoring ---------- */
function scoreSite(f) {
  /* A site we were never allowed to look at is unknown, not bad. It gets no
     score and no signals, so nothing about it can reach a letter. Only a
     site we did reach and that genuinely failed counts as dead. */
  if (f.skipped) {
    return { score: null, signals: [], whatsWrong: f.skipNote || 'not checked' };
  }

  const signals = [];
  let score = 0;
  const add = (key, signal) => { score += WEIGHTS[key]; signals.push(signal); };

  if (f.social) add('socialAsWebsite', { kind: 'social', text: "their website is " + f.social + ", not a site of their own" });

  if (!f.loads) {
    add('doesNotLoad', { kind: 'dead', text: 'the site does not load (' + f.problem + ')' });
    if (f.declaredScheme === 'http:') add('httpOnly', { kind: 'http', text: 'it is plain http, with no secure version' });
    return finish(score, signals);
  }

  /* Parked short-circuits: nothing else on the page means anything. */
  if (f.parked) {
    add('parkedDomain', { kind: 'parked', text: 'the domain is parked — there is no website on it, just a holding page' });
    return finish(score, signals);
  }

  if (f.finalScheme === 'http:') add('httpOnly', { kind: 'http', text: 'no https, so browsers warn visitors it is not secure' });
  if (!f.viewport) add('noViewport', { kind: 'viewport', text: 'it was never built for phones' });
  if (!f.phoneOnPage) add('noPhoneOnPage', { kind: 'phone', text: 'no phone number anywhere on the page' });

  if (f.newestYear === null) add('noYearAnywhere', { kind: 'noyear', text: 'no date anywhere, so no sign it is still looked after' });
  else if (THIS_YEAR - f.newestYear > AUDIT.staleYears) {
    add('staleContent', { kind: 'stale', text: 'nothing newer than ' + f.newestYear + ' on the page' });
  }

  if (f.deadTech.length) add('deadTech', { kind: 'deadtech', text: 'built with ' + f.deadTech.slice(0, 2).join(' and ') });
  if (f.bytes > AUDIT.heavyBytes) add('heavyPage', { kind: 'heavy', text: 'the page is ' + mb(f.bytes) + ' of HTML, slow on a phone' });

  return finish(score, signals);
}

function finish(score, signals) {
  return {
    score: Math.max(0, Math.min(WEIGHTS.maxScore, score)),
    signals: signals.map(s => s.kind),
    whatsWrong: sentence(signals)
  };
}

function sentence(signals) {
  if (!signals.length) return 'Nothing obviously wrong with it';
  const line = signals.map(s => s.text).join(', ');
  return line.charAt(0).toUpperCase() + line.slice(1);
}

const mb = b => (b / (1024 * 1024)).toFixed(1) + ' MB';

/* ---------- blocked checks ---------- */

/* A site that refuses an automated visitor has told us nothing about what a
   customer sees. A 401, 403 or 429, a "202 Accepted" homepage, or a
   bot-challenge page ("Just a moment…", "checking your browser") is a
   blocked check: the site is UNKNOWN, never broken. Recording it as "does
   not load" once put a live, working site into a letter as one that "comes
   back with an error". Only a real failure — the domain gone, the
   connection refused, a 5xx that is not a challenge, a missing homepage, a
   parked domain — counts as broken. */
const BLOCKED_STATUS = new Set([401, 403, 429]);
const BLOCKED_NOTE = 'unknown — the site blocked the check';
const BLOCKED_PROBLEM = "couldn't check — the site blocks automated visits";

/* Markers that only a challenge or bot wall puts on a page. */
const CHALLENGE_STRONG = [
  '/cdn-cgi/challenge-platform/', 'cf_chl_', 'cf-chl-', 'challenges.cloudflare.com',
  'captcha-delivery.com', '_incapsula_resource', 'px-captcha', 'sgcaptcha',
  'imunify360', 'bot-protection', '__ddg', 'ddos-guard'
];
/* Phrases a real page could conceivably contain, so they only count on a
   page with almost no other text — which is what a challenge page is. */
const CHALLENGE_WEAK = [
  'just a moment', 'checking your browser', 'attention required', 'verify you are human',
  'verifying you are human', 'are you a robot', 'enable javascript and cookies to continue',
  'please wait while your request is being verified', 'ddos protection by',
  'request unsuccessful', 'access denied', 'bot verification', 'security check'
];

function isBotChallenge(html, status, headers) {
  const h = headers && typeof headers.get === 'function' ? headers : { get: () => null };
  if (String(h.get('cf-mitigated') || '').toLowerCase() === 'challenge') return true;
  if (status === 202) return true;
  const lower = String(html || '').toLowerCase();
  if (CHALLENGE_STRONG.some(m => lower.includes(m))) return true;
  const text = stripTags(html).replace(/\s+/g, ' ').trim();
  return text.length < 600 && CHALLENGE_WEAK.some(m => text.toLowerCase().includes(m));
}

function blockedRecord(record, extra) {
  return Object.assign(record, {
    loads: null, skipped: true, blocked: true,
    problem: BLOCKED_PROBLEM, skipNote: BLOCKED_NOTE,
    title: '', viewport: false, phoneOnPage: false, newestYear: null, deadTech: [], bytes: 0
  }, extra);
}

/* ---------- one site ---------- */
const robotsCache = new Map();

async function robotsFor(origin) {
  if (robotsCache.has(origin)) return robotsCache.get(origin);
  const { res, error, code } = await get(origin + '/robots.txt', AUDIT.timeoutMs, AUDIT.userAgent);
  let verdict;
  /* RFC 9309 section 2.3.1:
     - 4xx, 404 included, means there are no rules, so the site is open.
     - 5xx and a timeout mean "unreachable", which the RFC says to treat as
       a complete disallow. We do not look, and the site stays unknown.
     - A host that does not resolve has nothing to fetch at all: the site is
       dead, and the page fetch would only tell us the same thing again. */
  if (code === 'ENOTFOUND') verdict = { groups: [], dnsFailure: true };
  else if (code === 'ETIMEDOUT_FETCH') verdict = { groups: [], serverError: true, timedOut: true };
  else if (error) verdict = { groups: [], reachable: false };  /* let the page fetch report the real trouble */
  else if (res.status >= 500) verdict = { groups: [], serverError: true };
  else if (res.status >= 400) verdict = { groups: [], reachable: true };
  else {
    const body = await readCapped(res, 512 * 1024);
    verdict = { groups: parseRobots(body.text), reachable: true };
  }
  robotsCache.set(origin, verdict);
  return verdict;
}

async function checkSite(row) {
  const record = {
    name: row.name,
    phone: row.phone,
    website: row.website,
    prospectScore: row.prospectScore,
    placeId: row.placeId,
    checkedAt: new Date().toISOString()
  };

  let url;
  try { url = new URL(row.website); }
  catch (e) {
    return Object.assign(record, {
      loads: false, problem: 'the address is not a valid web address',
      declaredScheme: '', finalScheme: '', social: null, skipped: false,
      status: null, title: '', viewport: false, phoneOnPage: false,
      newestYear: null, deadTech: [], bytes: 0
    });
  }

  record.declaredScheme = url.protocol;
  record.social = isNotTheirOwnSite(row.website);

  const robots = await robotsFor(url.origin);
  if (robots.dnsFailure) {
    return Object.assign(record, {
      loads: false, skipped: false, problem: 'domain not found',
      finalScheme: url.protocol, status: null, title: '', viewport: false,
      phoneOnPage: false, newestYear: null, deadTech: [], bytes: 0
    });
  }
  if (robots.serverError) {
    return Object.assign(record, {
      loads: null, skipped: true,
      problem: robots.timedOut
        ? 'robots.txt timed out, so we left the site alone'
        : 'robots.txt could not be read, so we left the site alone',
      skipNote: robots.timedOut
        ? 'not checked — robots.txt timed out'
        : 'not checked — robots.txt unreadable',
      finalScheme: url.protocol, status: null, title: '', viewport: false,
      phoneOnPage: false, newestYear: null, deadTech: [], bytes: 0
    });
  }
  const verdict = robotsVerdict(robots.groups, url.pathname || '/');
  if (!verdict.allowed) {
    return Object.assign(record, {
      loads: null, skipped: true, problem: 'robots.txt asks crawlers to stay away',
      skipNote: 'not checked — robots.txt asks crawlers to stay away',
      finalScheme: url.protocol, status: null, title: '', viewport: false,
      phoneOnPage: false, newestYear: null, deadTech: [], bytes: 0
    });
  }
  if (verdict.crawlDelay) await sleep(Math.min(verdict.crawlDelay, 30) * 1000);

  const { res, error } = await get(row.website, AUDIT.timeoutMs, AUDIT.userAgent);
  if (error) {
    return Object.assign(record, {
      loads: false, skipped: false, problem: error, finalScheme: url.protocol,
      status: null, title: '', viewport: false, phoneOnPage: false,
      newestYear: null, deadTech: [], bytes: 0
    });
  }

  const finalUrl = res.url || row.website;
  let finalScheme = url.protocol;
  try { finalScheme = new URL(finalUrl).protocol; } catch (e) { /* keep the declared one */ }

  if (!res.ok) {
    const body = await readCapped(res, 64 * 1024).catch(() => ({ bytes: 0 }));
    if (BLOCKED_STATUS.has(res.status) || isBotChallenge(body.text, res.status, res.headers)) {
      return blockedRecord(record, { finalUrl, finalScheme, status: res.status });
    }
    return Object.assign(record, {
      loads: false, skipped: false, problem: 'the server answered ' + res.status,
      finalUrl, finalScheme, status: res.status, title: '', viewport: false,
      phoneOnPage: false, newestYear: null, deadTech: [], bytes: body.bytes || 0
    });
  }

  const body = await readCapped(res, AUDIT.maxBytes);
  const html = body.text;
  const text = stripTags(html);

  /* A 200 or 202 can still be a wall, not the site. */
  if (isBotChallenge(html, res.status, res.headers)) {
    return blockedRecord(record, { finalUrl, finalScheme, status: res.status });
  }

  return Object.assign(record, {
    loads: true,
    skipped: false,
    parked: isParked(html, text),
    problem: '',
    finalUrl,
    finalScheme,
    status: res.status,
    contentType: (res.headers.get('content-type') || '').split(';')[0],
    title: pageTitle(html),
    viewport: hasViewport(html),
    phoneOnPage: findsPhone(html, text),
    newestYear: newestYear(text),
    deadTech: deadTech(html),
    bytes: body.bytes,
    truncated: body.truncated
  });
}

/* ---------- the run ---------- */

/* The homepage as plain text, for handing to the judgment. Same manners
   as the audit: robots.txt first, one request, no retries. */
async function fetchSiteText(website) {
  let url;
  try { url = new URL(website); } catch (e) { return { text: '', note: 'unreadable website address' }; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { text: '', note: 'not an http address' };
  }
  try {
    const robots = await getText(url.origin + '/robots.txt', AUDIT.timeoutMs, AUDIT.userAgent);
    if (robots.status === 200) {
      const verdict = robotsVerdict(parseRobots(robots.body), url.pathname || '/');
      if (!verdict.allowed) return { text: '', note: 'robots.txt asks crawlers to stay away' };
      if (verdict.crawlDelay) await sleep(Math.min(verdict.crawlDelay, 10) * 1000);
    }
  } catch (e) { /* no robots.txt we could read; carry on as check-sites does */ }

  try {
    const page = await getText(url.href, AUDIT.timeoutMs, AUDIT.userAgent);
    if (BLOCKED_STATUS.has(page.status) || isBotChallenge(page.body, page.status, null)) {
      return { text: '', note: BLOCKED_PROBLEM };
    }
    if (page.status >= 400) return { text: '', note: `the server answered ${page.status}` };
    const text = stripTags(page.body).replace(/\s+/g, ' ').trim();
    return { text: text.slice(0, SITE_TEXT_CHARS), note: text ? '' : 'the page had no readable text' };
  } catch (e) {
    return { text: '', note: 'could not be reached: ' + String(e && e.message || e).slice(0, 80) };
  }
}


module.exports = {
  AUDIT, WEIGHTS, SITE_TEXT_CHARS,
  parseRobots, robotsVerdict, matchesRobotsPath,
  stripTags, hasViewport, pageTitle, findsPhone, newestYear, deadTech, isParked,
  isNotTheirOwnSite, scoreSite, robotsFor, checkSite, fetchSiteText,
  isBotChallenge, BLOCKED_STATUS, BLOCKED_NOTE, BLOCKED_PROBLEM
};
