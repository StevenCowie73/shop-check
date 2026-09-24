'use strict';

/* Where the recordings a caller hears are served from.

   They are static files in public/audio/, deployed with the routes, so
   Twilio fetches them from the same host it is already talking to. The
   file names come from public/audio/voice.json, written by
   scripts/make-voice-recordings.js; a name carries a hash of its wording,
   so new wording is always a new URL and Twilio's cache can never replay
   an old sentence. */

const { recordings } = require('../public/audio/voice.json');
const { requestUrl, escapeXml } = require('./twilio.js');

function audioUrl(req, name) {
  const rec = recordings[name];
  if (!rec) throw new Error('no recording called ' + name);
  return new URL('/audio/' + rec.file, requestUrl(req)).toString();
}

/* <Play> for one recording, absolute and escaped. */
const play = (req, name) => `<Play>${escapeXml(audioUrl(req, name))}</Play>`;

module.exports = { audioUrl, play, recordings };
