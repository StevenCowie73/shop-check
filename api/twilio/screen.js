'use strict';

/* Whoever picks up the forwarded call on the owner's cell hears this before
   the caller is put through: "ColdenJames call. Press 1 to take it."

   Five seconds to press 1. Pressing 1 goes to screen-result, which lets the
   call through. Nothing pressed — which is what voicemail does — falls to
   the Hangup, the owner's leg ends without ever being connected, and the
   caller gets the missed-call path from dial-status. The caller hears
   ringing throughout and never hears any of this. */

const { authorize, twiml, escapeXml, requestUrl } = require('../../lib/twilio.js');
const { play } = require('../../lib/voice-audio.js');

const WAIT_SECONDS = 5;

module.exports = async function handler(req, res) {
  const gate = await authorize(req, res);
  if (!gate) return;

  const result = new URL('/api/twilio/screen-result', requestUrl(req)).toString();
  twiml(res,
    `<Gather numDigits="1" timeout="${WAIT_SECONDS}" action="${escapeXml(result)}" method="POST">` +
    play(req, 'screen') +
    `</Gather><Hangup/>`);
};

module.exports.WAIT_SECONDS = WAIT_SECONDS;
