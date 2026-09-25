'use strict';

/* The website audit behind a proxy.

   A real audit recorded two live websites as "the server answered 301":
   through an HTTPS proxy, Node's own fetch driven by the npm undici
   dispatcher got HTTP/2 responses back with no headers, so no redirect was
   ever followed. This rebuilds that exact path on this machine — an HTTPS,
   HTTP/2 site answering 301 then 200, behind a CONNECT proxy — and runs
   finder/lib/http.js and the site audit through it.

   The site's certificate comes from a throwaway CA made for this test and
   trusted only by the child process that uses it (NODE_EXTRA_CA_CERTS).
   Verification stays on. Needs openssl; skipped without it. */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const hasOpenssl = spawnSync('openssl', ['version']).status === 0;

function makeCerts(dir) {
  const run = args => execFileSync('openssl', args, { cwd: dir, stdio: 'ignore' });
  run(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.crt',
       '-days', '1', '-subj', '/CN=shop-check test CA']);
  run(['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'site.key', '-out', 'site.csr', '-subj', '/CN=127.0.0.1']);
  fs.writeFileSync(path.join(dir, 'san.ext'), 'subjectAltName=IP:127.0.0.1,DNS:localhost\n');
  run(['x509', '-req', '-in', 'site.csr', '-CA', 'ca.crt', '-CAkey', 'ca.key', '-CAcreateserial',
       '-out', 'site.crt', '-days', '1', '-extfile', 'san.ext']);
}

const RIG = `
const http = require('http'), http2 = require('http2'), net = require('net'), fs = require('fs');
const dir = process.argv[1];
const site = http2.createSecureServer({ key: fs.readFileSync(dir + '/site.key'), cert: fs.readFileSync(dir + '/site.crt'), allowHTTP1: true }, (req, res) => {
  if (req.url === '/') { res.writeHead(301, { Location: '/home' }); return res.end(); }
  if (req.url === '/robots.txt') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('User-agent: *\\nAllow: /\\n'); }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Invented Fencing Co</title></head><body><p>We build fences. Call us.</p></body></html>');
});
const proxy = http.createServer();
proxy.on('connect', (req, sock, head) => {
  const [h, p] = req.url.split(':');
  const up = net.connect(+p, h, () => { sock.write('HTTP/1.1 200 Connection Established\\r\\n\\r\\n'); up.write(head); up.pipe(sock); sock.pipe(up); });
  up.on('error', () => sock.destroy()); sock.on('error', () => up.destroy());
});
site.listen(0, '127.0.0.1', () => proxy.listen(0, '127.0.0.1', () =>
  console.log(JSON.stringify({ site: site.address().port, proxy: proxy.address().port }))));
`;

const CLIENT = `
const { get } = require(process.argv[1] + '/finder/lib/http.js');
const { checkSite } = require(process.argv[1] + '/finder/lib/site-audit.js');
(async () => {
  const url = 'https://127.0.0.1:' + process.argv[2] + '/';
  const r = await get(url, 8000, 'shop-check-test');
  const seen = await checkSite({ name: 'Invented Fencing Co', phone: '', website: url });
  console.log(JSON.stringify({
    status: r.res && r.res.status, redirected: r.res && r.res.redirected,
    contentType: r.res && r.res.headers.get('content-type'), error: r.error || null,
    loads: seen.loads, skipped: seen.skipped, problem: seen.problem || null
  }));
})().catch(e => { console.log(JSON.stringify({ crashed: String(e) })); });
`;

test('behind an HTTPS proxy, a 301 -> 200 website audits as loading', { skip: !hasOpenssl && 'openssl not available' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shop-check-proxy-'));
  makeCerts(dir);
  const rig = spawn(process.execPath, ['-e', RIG, dir], { stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    const ports = await new Promise((resolve, reject) => {
      rig.stdout.once('data', d => resolve(JSON.parse(String(d))));
      rig.once('exit', code => reject(new Error('rig exited ' + code)));
    });
    const env = { ...process.env, HTTPS_PROXY: 'http://127.0.0.1:' + ports.proxy, NODE_EXTRA_CA_CERTS: path.join(dir, 'ca.crt') };
    for (const k of ['https_proxy', 'HTTP_PROXY', 'http_proxy', 'NO_PROXY', 'no_proxy', 'NODE_USE_ENV_PROXY']) delete env[k];
    const out = spawnSync(process.execPath, ['-e', CLIENT, ROOT, String(ports.site)], { env, encoding: 'utf8', timeout: 30000 });
    const r = JSON.parse(out.stdout.trim().split('\n').pop());
    assert.strictEqual(r.crashed, undefined, r.crashed);
    assert.strictEqual(r.status, 200, 'the 301 was followed: ' + JSON.stringify(r));
    assert.strictEqual(r.redirected, true);
    assert.match(String(r.contentType), /text\/html/, 'response headers survive the proxy');
    assert.strictEqual(r.skipped, false, 'robots.txt was read, so the site was checked');
    assert.strictEqual(r.loads, true, 'the audit records the site as loading: ' + JSON.stringify(r));
  } finally {
    rig.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('every outbound request in finder/ goes through lib/http.js', () => {
  for (const f of ['finder/lib/places.js', 'finder/pilot/1-walk-lslbc.js', 'finder/pilot/8-astra-websites.mjs']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.match(src, /const \{ fetch \} = require\('\.\.?\/(lib\/)?http\.js'\)/, f + ' takes fetch from lib/http.js');
  }
});
