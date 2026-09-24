#!/usr/bin/env node
'use strict';

/* The lookup, running locally, so a change can be seen before it is
   deployed. Same page and same handler Vercel serves.

   Run:  LOOKUP_PASSWORD=whatever node dev-server.js
   Then: http://localhost:3000

   It also answers as the ColdenJames site when the request carries that
   host, the same way middleware.js does on Vercel, so the public site can
   be checked without deploying:

     curl -H 'Host: coldenjames.com' http://localhost:3000/
*/

const http = require('http');
const fs = require('fs');
const path = require('path');
const { loadEnvFile } = require('./finder/lib/env.js');

loadEnvFile(path.join(__dirname, 'finder', '.env'));
const handler = require('./api/lookup.js');

const PORT = Number(process.env.PORT) || 3000;
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript' };

/* Kept in step with middleware.js by hand — it is five lines and importing
   an edge module into a plain http server is not worth the trouble. */
const SITE_HOSTS = new Set(['coldenjames.com', 'www.coldenjames.com']);
const SITE_PAGES = {
  '/': 'coldenjames/index.html',
  '/privacy': 'coldenjames/privacy.html',
  '/privacy/': 'coldenjames/privacy.html',
  '/terms': 'coldenjames/terms.html',
  '/terms/': 'coldenjames/terms.html'
};

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  /* The public site, when asked for by name. Every other host falls through
     to exactly what this server did before. */
  const host = String(req.headers.host || '').split(':')[0].toLowerCase();
  if (SITE_HOSTS.has(host) && !url.pathname.startsWith('/api/')) {
    if (host !== 'coldenjames.com') {
      res.writeHead(308, { Location: 'https://coldenjames.com' + req.url }).end();
      return;
    }
    const page = SITE_PAGES[url.pathname] || SITE_PAGES['/'];
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(path.join(__dirname, 'public', page)));
    return;
  }

  if (url.pathname === '/api/lookup') {
    res.status = code => { res.statusCode = code; return res; };
    res.json = obj => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj)); };
    return handler(req, res);
  }
  const file = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '');
  const full = path.join(__dirname, 'public', file);
  if (!full.startsWith(path.join(__dirname, 'public')) || !fs.existsSync(full)) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(full)] || 'application/octet-stream' });
  res.end(fs.readFileSync(full));
}).listen(PORT, () => console.log(`signal dev server on http://localhost:${PORT}`));
