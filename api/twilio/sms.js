'use strict';

/* Someone texts the business number.

   From anyone but the owner: pass it on to the owner's cell, in the shape
   the approved texting campaign shows, and say nothing back.

   From the owner's own cell: it is a reply. Send it on from the business
   number, so the customer only ever sees ColdenJames, to the number it
   starts with or else to whoever was last in touch. Only ever to someone
   the call and text log shows contacted the business first. If it does
   not go, tell the owner in one line; if it does, say nothing.

   STOP, START and HELP are Twilio's: it answers them before and regardless
   of this route. Nothing here replies to a sender, so we can never text
   somebody who has just asked us to stop, and a keyword the owner sends is
   never relayed to anybody. */

const {
  authorize, twiml, sendSms, isE164, hasContacted, lastContact
} = require('../../lib/twilio.js');
const { forwardedText, NOT_SENT } = require('../../lib/texting-copy.js');
const { parseReply, formatUS, isKeyword } = require('../../lib/reply-through.js');

const same = (a, b) => String(a || '').trim() === String(b || '').trim();

async function forwardToOwner({ sid, token, businessNumber, ownerCell, from, message }) {
  try {
    await sendSms({
      sid, token, from: businessNumber, to: ownerCell,
      body: forwardedText(formatUS(from), message)
    });
  } catch (err) {
    console.error('forwarding a text failed: ' + (err && err.message));
  }
}

/* Returns null when the reply went out, or the line to send the owner. */
async function relayReply({ sid, token, businessNumber, ownerCell, body }) {
  const { to: named, message } = parseReply(body);
  if (!message) return NOT_SENT.empty;

  let to;
  try {
    if (named) {
      if (same(named, ownerCell) || same(named, businessNumber) ||
          !(await hasContacted({ sid, token, business: businessNumber, number: named }))) {
        return NOT_SENT.notAllowed;
      }
      to = named;
    } else {
      to = await lastContact({ sid, token, business: businessNumber, owner: ownerCell });
      if (!to) return NOT_SENT.nobody;
    }
  } catch (err) {
    console.error('could not read the call and text log: ' + (err && err.message));
    return NOT_SENT.unknown;
  }

  try {
    await sendSms({ sid, token, from: businessNumber, to, body: message });
    return null;
  } catch (err) {
    console.error('reply-through refused: ' + (err && err.message));
    return err && err.twilioCode === 21610 ? NOT_SENT.optedOut : NOT_SENT.refused;
  }
}

module.exports = async function handler(req, res) {
  const gate = await authorize(req, res, { needOwnerCell: true });
  if (!gate) return;

  const { params, sid, token, ownerCell } = gate;
  const from = params.From;
  const businessNumber = params.To;
  const body = String(params.Body || '');

  if (!same(from, ownerCell)) {
    const media = Number(params.NumMedia || 0);
    const message = body || (media > 0 ? '(picture or attachment)' : '');
    await forwardToOwner({ sid, token, businessNumber, ownerCell, from, message });
  } else if (!isKeyword(body) && isE164(businessNumber)) {
    const problem = await relayReply({ sid, token, businessNumber, ownerCell, body });
    if (problem) {
      try {
        await sendSms({ sid, token, from: businessNumber, to: ownerCell, body: problem });
      } catch (err) {
        console.error('could not tell the owner a reply failed: ' + (err && err.message));
      }
    }
  }

  /* Empty on purpose: the sender never gets an automatic reply. */
  twiml(res, '');
};
