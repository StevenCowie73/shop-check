'use strict';

/* Someone rings the business number.

   Ring the owner's cell for twenty seconds, showing the caller's own number
   so it looks like an ordinary call rather than a forward. However it ends —
   answered, ignored, engaged — Twilio then posts to the dial-status route,
   which is where the text-back decision is made. */

const { authorize, twiml, escapeXml, requestUrl } = require('../../lib/twilio.js');

const RING_SECONDS = 20;

module.exports = async function handler(req, res) {
  const gate = await authorize(req, res, { needOwnerCell: true });
  if (!gate) return;

  const { params, ownerCell } = gate;
  /* The action URL has to be absolute and has to match what Twilio will
     sign when it posts the result back. */
  const action = new URL('/api/twilio/dial-status', requestUrl(req)).toString();

  twiml(res,
    `<Dial timeout="${RING_SECONDS}"` +
    ` callerId="${escapeXml(params.From)}"` +
    ` action="${escapeXml(action)}" method="POST">` +
    `<Number>${escapeXml(ownerCell)}</Number>` +
    `</Dial>`);
};
