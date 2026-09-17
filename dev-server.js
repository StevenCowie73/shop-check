#!/usr/bin/env node
'use strict';

/* The lookup, running locally, so a change can be seen before it is
   deployed. Same page and same handler Vercel serves.

   Run:  LOOKUP_PASSWORD=whatever node dev-server.js
   Then: http://localhost:3000
*/

const http = require('http');
const fs = require('fs');
const path = require('path');
const { loadEnvFile } = require('./finder/lib/env.js');

loadEnvFile(path.join(__dirname, 'finder', '.env'));
const handler = require('./api/lookup.js');

const PORT = Number(process.env.PORT) || 3000;
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
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
