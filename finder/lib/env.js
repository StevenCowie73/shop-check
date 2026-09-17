'use strict';

/* Reading finder/.env, and keeping the keys out of anything we print.
   Shared by every script and by the lookup endpoint. */

const fs = require('fs');

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

/* Never let the key reach a log line, whatever went wrong. */

/* Both keys, not just the Google one: an error from any of them must not
   carry a key into a log, a console, or an HTTP response. */
function scrub(text) {
  let s = String(text);
  for (const key of [process.env.GOOGLE_PLACES_API_KEY, process.env.ANTHROPIC_API_KEY]) {
    if (key) s = s.split(key).join('[REDACTED_KEY]');
  }
  return s;
}

/* kept under its old name because find-prospects.js reads as it always did */
const redact = scrub;

const sleep = ms => new Promise(r => setTimeout(r, ms));

module.exports = { loadEnvFile, scrub, redact, sleep };
