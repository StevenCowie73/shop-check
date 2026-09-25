'use strict';

/* A website check that the site refused is UNKNOWN, never broken.

   Runs the real audit (finder/lib/site-audit.js) against a local server in a
   child process with no proxy set, so every case below is exactly what the
   audit sees on the wire. Every business here is invented. */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

const SERVER = `
const http = require('http');
const page = (title, body) => '<!doctype html><html><head><title>' + title + '</title></head><body>' + body + '</body></html>';
const real = page('Invented Fencing Co', '<p>Fences built and repaired. Call 318-555-0142. ' + 'We have fenced yards across the parish for years. '.repeat(30) + '</p>');
http.createServer((req, res) => {
  const send = (status, body, headers) => { res.writeHead(status, Object.assign({ 'Content-Type': 'text/html' }, headers || {})); res.end(body); };
  switch (req.url) {
    case '/robots.txt': return send(404, 'no robots here');
    case '/forbidden': return send(403, page('403 Forbidden', '<h1>Forbidden</h1>'));
    case '/unauthorised': return send(401, page('401', 'Authorization Required'));
    case '/too-many': return send(429, page('Too Many Requests', 'Slow down'));
    case '/redirect-no-location': return send(307, page('Redirecting', ''));
    case '/challenge-202': return send(202, page('Just a moment...', '<p>Checking your browser before accessing the site.</p>'));
    case '/challenge-200': return send(200, page('Invented Fencing Co', '<script src="/cdn-cgi/challenge-platform/h/b/orchestrate/jsch/v1"></script>'));
    case '/challenge-header': return send(200, page('Hello', 'x'), { 'cf-mitigated': 'challenge' });
    case '/challenge-503': return send(503, page('Just a moment...', 'Enable JavaScript and cookies to continue'));
    case '/down': return send(503, page('503 Service Unavailable', '<h1>Service Unavailable</h1><p>The server is temporarily unable to service your request.</p>'));
    case '/missing': return send(404, page('Not Found', 'The page you requested was not found.'));
    case '/real-page-about-security': return send(200, page('Invented Alarm Co', '<p>Security check-ups for your home. Are you a robot? No, we are people. ' + 'We install alarms and cameras for families. '.repeat(40) + '</p>'));
    default: return send(200, real);
  }
}).listen(0, '127.0.0.1', function () { console.log(this.address().port); });
`;

const CLIENT = `
const { checkSite, scoreSite } = require(process.argv[1] + '/finder/lib/site-audit.js');
(async () => {
  const out = {};
  for (const url of JSON.parse(process.argv[2])) {
    const seen = await checkSite({ name: 'Invented', phone: '', website: url });
    const scored = scoreSite(seen);
    out[url] = { loads: seen.loads, skipped: seen.skipped, blocked: !!seen.blocked, problem: seen.problem,
                 status: seen.status, score: scored.score, whatsWrong: scored.whatsWrong, signals: scored.signals };
  }
  console.log(JSON.stringify(out));
})().catch(e => console.log(JSON.stringify({ crashed: String(e) })));
`;

const noProxy = () => {
  const env = { ...process.env };
  for (const k of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'NODE_USE_ENV_PROXY']) delete env[k];
  return env;
};

let results;
test.before(async () => {
  const server = spawn(process.execPath, ['-e', SERVER], { stdio: ['ignore', 'pipe', 'inherit'] });
  const port = await new Promise(r => server.stdout.once('data', d => r(String(d).trim())));
  const base = 'http://127.0.0.1:' + port;
  const paths = ['/forbidden', '/unauthorised', '/too-many', '/redirect-no-location', '/challenge-202', '/challenge-200', '/challenge-header',
                 '/challenge-503', '/down', '/missing', '/', '/real-page-about-security'];
  const urls = paths.map(p => base + p).concat(['http://no-such-business-anywhere.invalid/']);
  const r = spawnSync(process.execPath, ['-e', CLIENT, ROOT, JSON.stringify(urls)], { env: noProxy(), encoding: 'utf8', timeout: 90000 });
  server.kill();
  const raw = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.strictEqual(raw.crashed, undefined, raw.crashed);
  results = Object.fromEntries(Object.entries(raw).map(([u, v]) => [u.replace(base, '') || u, v]));
});

function isBlocked(r, label) {
  assert.strictEqual(r.skipped, true, label + ' is unknown, not checked: ' + JSON.stringify(r));
  assert.strictEqual(r.blocked, true, label);
  assert.strictEqual(r.loads, null, label + ' is not "does not load"');
  assert.strictEqual(r.score, null, label + ' gets no score, so nothing about it can reach a letter');
  assert.deepStrictEqual(r.signals, []);
  assert.strictEqual(r.whatsWrong, 'unknown — the site blocked the check');
  assert.strictEqual(r.problem, "couldn't check — the site blocks automated visits");
}
function isBroken(r, label, problem) {
  assert.strictEqual(r.skipped, false, label + ' was checked: ' + JSON.stringify(r));
  assert.strictEqual(r.blocked, false, label);
  assert.strictEqual(r.loads, false, label + ' is broken');
  if (problem) assert.match(String(r.problem), problem, label);
  assert.ok(r.signals.includes('dead'), label + ' is scored as dead');
}

test('403 is unknown — the site blocked the check', () => isBlocked(results['/forbidden'], '403'));
test('401 is unknown', () => isBlocked(results['/unauthorised'], '401'));
test('429 is unknown', () => isBlocked(results['/too-many'], '429'));
test('a redirect with nowhere to go (a firewall challenge) is unknown, not broken', () => isBlocked(results['/redirect-no-location'], '307 with no Location'));
test('a challenge page is unknown whether it comes back 202, 200 or 503', () => {
  isBlocked(results['/challenge-202'], '202 "Just a moment"');
  isBlocked(results['/challenge-200'], '200 with a Cloudflare challenge script');
  isBlocked(results['/challenge-header'], '200 with cf-mitigated: challenge');
  isBlocked(results['/challenge-503'], '503 challenge');
});
test('503 is broken', () => isBroken(results['/down'], '503', /answered 503/));
test('a missing homepage (404) is broken', () => isBroken(results['/missing'], '404', /answered 404/));
test('a domain that does not resolve is broken', () => isBroken(results['http://no-such-business-anywhere.invalid/'], 'DNS failure'));
test('200 loads', () => {
  const r = results['/'];
  assert.strictEqual(r.loads, true, JSON.stringify(r));
  assert.strictEqual(r.skipped, false);
  assert.strictEqual(r.blocked, false);
  assert.strictEqual(r.status, 200);
});
test('a real page that merely mentions "security check" or "robot" still loads', () => {
  const r = results['/real-page-about-security'];
  assert.strictEqual(r.loads, true, JSON.stringify(r));
  assert.strictEqual(r.blocked, false);
});

/* ---------- what a blocked check says downstream ---------- */

test('a blocked site becomes "unknown" in the pilot, and the letter says nothing about it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shop-check-blocked-'));
  try {
    fs.mkdirSync(path.join(dir, 'audit'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'records-with-candidates.json'), JSON.stringify([{
      company: 'Quokka Lagoon Fencing LLC', emailDomain: 'quokka.example.test', emailKind: 'company-domain',
      websiteCandidate: 'https://quokka.example.test/', mailingAddress: { city: 'NOWHERE', zip: '' },
      licenses: [], classifications: [], qualifyingParties: []
    }]));
    fs.writeFileSync(path.join(dir, 'audit', 'site-audit.json'), JSON.stringify({ sites: [{
      placeId: 'quokka.example.test', website: 'https://quokka.example.test/', loads: null, skipped: true, blocked: true,
      skipNote: 'unknown — the site blocked the check', problem: "couldn't check — the site blocks automated visits",
      siteScore: null, signals: [], whatsWrong: 'unknown — the site blocked the check', status: 403
    }] }));
    const r = spawnSync(process.execPath, [path.join(ROOT, 'finder', 'pilot', '4-build-spine.js')],
      { cwd: ROOT, encoding: 'utf8', env: { ...process.env, PILOT_OUT_DIR: dir } });
    assert.strictEqual(r.status, 0, r.stderr);
    const rec = JSON.parse(fs.readFileSync(path.join(dir, 'spine.json'), 'utf8')).records[0];
    assert.strictEqual(rec.websiteState, 'unknown');
    const { websiteFinding } = require('../lib/website-finding.js');
    assert.strictEqual(websiteFinding(rec.websiteState, rec.websiteAudit).text, '', 'no website paragraph in the letter');
    assert.strictEqual(websiteFinding(rec.websiteState, rec.websiteAudit, { surface: 'page' }).text, '', 'and no claim on the prospect page');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("Signal's card says it couldn't check, instead of showing an error", () => {
  const lookup = fs.readFileSync(path.join(ROOT, 'finder', 'lib', 'lookup.js'), 'utf8');
  assert.match(lookup, /blocked: !!audit\.blocked/, 'the lookup passes the blocked flag to the card');
  const page = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  assert.ok(page.includes(`a.blocked
        ? "couldn't check — the site blocks automated visits"`), 'the card shows the plain line for a blocked site');
});
