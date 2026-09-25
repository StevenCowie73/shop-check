'use strict';

/* The digit pressed on the owner's cell after the screen.

   1 takes the call: an empty response ends the screen and Twilio connects
   the caller. Any other digit hangs up the owner's leg unconnected, and the
   call is handled as missed. Only a pressed 1 ever counts as answered. */

const { authorize, twiml } = require('../../lib/twilio.js');

module.exports = async function handler(req, res) {
  const gate = await authorize(req, res);
  if (!gate) return;

  const digit = String(gate.params.Digits || '').trim();
  twiml(res, digit === '1' ? '' : '<Hangup/>');
};
