'use strict';

/* Which backend Explorer reads is chosen by EXPLORER_DATA alone:

     EXPLORER_DATA=demo       invented data, in memory (the default)
     EXPLORER_DATA=postgres   the database at COLDENJAMES_URL,
                              COLDENJAMES_DATABASE_URL or DATABASE_URL

   A database URL being present never switches the backend by itself: the
   Neon integration sets one on the project the moment it is connected,
   long before the database has anything in it. Nothing above this file
   changes either way. */

const { createDemoStore } = require('./demo-store.js');

let cached = null;

function databaseUrl(env = process.env) {
  return env.COLDENJAMES_URL || env.COLDENJAMES_DATABASE_URL || env.DATABASE_URL || '';
}

/* 'postgres' only when asked for by name; anything else is demo. */
function dataMode(env = process.env) {
  return String(env.EXPLORER_DATA || '').trim().toLowerCase() === 'postgres' ? 'postgres' : 'demo';
}

function getStore(env = process.env) {
  const mode = dataMode(env);
  const url = mode === 'postgres' ? databaseUrl(env) : '';
  if (mode === 'postgres' && !url) throw new Error('EXPLORER_DATA=postgres but no database URL is set.');
  if (cached && cached.mode === mode && cached.url === url) return cached.store;
  let store;
  if (mode === 'postgres') {
    const { Pool } = require('pg');
    const { createPgStore } = require('./pg-store.js');
    store = createPgStore(new Pool({ connectionString: url, max: 3, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: true } }));
  } else {
    store = createDemoStore();
  }
  cached = { mode, url, store };
  return store;
}

/* Tests start from a fresh demo each time. */
function resetStore() { cached = null; }

module.exports = { getStore, resetStore, databaseUrl, dataMode };
