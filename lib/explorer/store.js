'use strict';

/* Which backend Explorer reads: DEMO (invented, in memory) until a database
   URL is set, then POSTGRES. Nothing above this file changes either way. */

const { createDemoStore } = require('./demo-store.js');

let cached = null;

function databaseUrl(env = process.env) {
  return env.COLDENJAMES_URL || env.DATABASE_URL || '';
}

function getStore(env = process.env) {
  const url = databaseUrl(env);
  if (cached && cached.url === url) return cached.store;
  let store;
  if (url) {
    const { Pool } = require('pg');
    const { createPgStore } = require('./pg-store.js');
    store = createPgStore(new Pool({ connectionString: url, max: 3, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: true } }));
  } else {
    store = createDemoStore();
  }
  cached = { url, store };
  return store;
}

/* Tests start from a fresh demo each time. */
function resetStore() { cached = null; }

module.exports = { getStore, resetStore, databaseUrl };
