#!/usr/bin/env node
'use strict';

/* The single-business lookup, from a terminal. Same code path as the web
   endpoint — this is how you test a change without deploying.

   Run:  node lookup-cli.js "Greenfield Tiling Haughton LA"
         node lookup-cli.js "Marsh Lane Fencing" --json
*/

const path = require('path');
const { loadEnvFile, scrub } = require('./lib/env.js');
const { lookupOne } = require('./lib/lookup.js');
const { formatPlain } = require('./lib/format.js');

async function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const query = args.filter(a => !a.startsWith('--')).join(' ').trim();
  if (!query) {
    console.error('Usage: node lookup-cli.js "business name, town"');
    process.exit(1);
  }
  loadEnvFile(path.join(__dirname, '.env'));
  const placesKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!placesKey) {
    console.error('No GOOGLE_PLACES_API_KEY in finder/.env');
    process.exit(1);
  }

  const started = Date.now();
  const result = await lookupOne(query, {
    placesKey,
    anthropicKey: process.env.ANTHROPIC_API_KEY,
    onProgress: p => { if (!asJson) console.error('  ... ' + p.label); }
  });
  const secs = ((Date.now() - started) / 1000).toFixed(1);

  if (asJson) { console.log(JSON.stringify(result, null, 2)); return; }
  console.log('');
  console.log(formatPlain(result));
  console.log('');
  console.log(`took ${secs}s · this lookup cost $${result.cost.usd.toFixed(4)}`);
}

if (require.main === module) {
  main().catch(err => {
    console.error('\nFailed: ' + scrub((err && err.message) || err));
    process.exit(1);
  });
}
