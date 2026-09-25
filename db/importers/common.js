'use strict';

/* Shared by the importers. Each importer is a pure function over files the
   pipeline already writes, into a store (lib/explorer/demo-store.js or
   pg-store.js — the same sink methods on both).

   None of them has been run against real data. From the command line they
   refuse to start without a database URL and --confirm, so an importer
   cannot be run by accident against the wrong place. */

const fs = require('fs');

/* LSLBC dates are MM/DD/YYYY. */
function isoDate(s) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s || '').trim());
  return m ? m[3] + '-' + m[1] + '-' + m[2] : null;
}

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      out[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    } else out._.push(a);
  }
  return out;
}

/* The command-line door: a real database, and a deliberate --confirm. */
async function cliStore(opts) {
  const { databaseUrl, getStore } = require('../../lib/explorer/store.js');
  if (!databaseUrl()) throw new Error('Set COLDENJAMES_URL or DATABASE_URL first. Importers only write to a real database.');
  if (!opts.confirm) throw new Error('Add --confirm to write to ' + databaseUrl().replace(/\/\/[^@]*@/, '//…@') + '.');
  return getStore();
}

module.exports = { isoDate, readJson, args, cliStore };
