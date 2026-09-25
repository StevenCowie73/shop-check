'use strict';

/* Someone rings the business number.

   Ring the owner's cell for fifteen seconds, showing the caller's own number
   so it looks like an ordinary call rather than a forward. When the cell is
   answered, whoever answered hears a short screen (api/twilio/screen.js)
   and the caller is put through only if they press 1 — so the owner's
   voicemail, which presses nothing, can never count as the call being
   taken. However it ends, Twilio then posts to the dial-status route, which
   is where the text-back decision is made.

   A call from the owner's own cell is a test: forwarding it would only ring
   the phone that is making the call. It goes straight from the greeting to
   the missed-call path, exactly as a real missed call would. */

const { authorize, twiml, escapeXml, requestUrl } = require('../../lib/twilio.js');
const { play } = require('../../lib/voice-audio.js');

const RING_SECONDS = 15;

const same = (a, b) => String(a || '').trim() === String(b || '').trim();

module.exports = async function handler(req, res) {
  const gate = await authorize(req, res, { needOwnerCell: true });
  if (!gate) return;

  const { params, ownerCell } = gate;
  /* The action URL has to be absolute and has to match what Twilio will
     sign when it posts the result back. */
  const action = new URL('/api/twilio/dial-status', requestUrl(req)).toString();
  const screen = new URL('/api/twilio/screen', requestUrl(req)).toString();

  /* Every caller hears the disclosure before anything rings, whatever
     TEXTING_LIVE says. It is the opt-in the carriers review the texting
     program on, so a reviewer's test call has to hear it even while the
     text itself is still switched off. It is a recording of the exact
     VOICE_DISCLOSURE wording in lib/texting-copy.js. */
  const disclosure = play(req, 'greeting');

  if (same(params.From, ownerCell)) {
    twiml(res, disclosure + `<Redirect method="POST">${escapeXml(action)}</Redirect>`);
    return;
  }

  /* answerOnBridge keeps the caller hearing ringing while the screen plays
     on the owner's end, rather than silence. */
  twiml(res,
    disclosure +
    `<Dial timeout="${RING_SECONDS}" answerOnBridge="true"` +
    ` callerId="${escapeXml(params.From)}"` +
    ` action="${escapeXml(action)}" method="POST">` +
    `<Number url="${escapeXml(screen)}" method="POST">${escapeXml(ownerCell)}</Number>` +
    `</Dial>`);
};
