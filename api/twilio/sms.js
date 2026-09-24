'use strict';

/* Someone texts the business number.

   Forward it to the owner's cell and say nothing back. STOP, START and HELP
   are handled by Twilio before they ever reach here, and replying to them
   ourselves would both duplicate Twilio's answer and risk texting someone
   who has just asked us to stop. */

const { authorize, twiml, sendSms } = require('../../lib/twilio.js');

module.exports = async function handler(req, res) {
  const gate = await authorize(req, res, { needOwnerCell: true });
  if (!gate) return;

  const { params, sid, token, ownerCell } = gate;
  const from = params.From;
  const businessNumber = params.To;
  const message = String(params.Body || '');

  try {
    await sendSms({
      sid, token,
      from: businessNumber,
      to: ownerCell,
      body: 'From ' + from + ': ' + message
    });
  } catch (err) {
    console.error('forwarding a text failed: ' + (err && err.message));
  }

  /* Empty on purpose: the sender gets no automatic reply. */
  twiml(res, '');
};
