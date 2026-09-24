'use strict';

/* What happened to the forwarded call.

   Twilio posts here when the Dial ends. The parameters are still those of
   the original inbound call — From is the caller, To is the business
   number — with DialCallStatus describing the outcome.

   Anything other than "completed" means the caller did not get through, so
   they get one text. That is the whole product. */

const { authorize, twiml, sendSms, textedWithin, textingLive } = require('../../lib/twilio.js');
const { MISSED_CALL_TEXT } = require('../../lib/texting-copy.js');

const DEFAULT_TEXT = MISSED_CALL_TEXT;

/* Someone who rings three times in an afternoon should not get three texts.
   One a day is a reminder; three is a nuisance and a carrier complaint. */
const QUIET_HOURS = 24;

module.exports = async function handler(req, res) {
  const gate = await authorize(req, res);
  if (!gate) return;

  const { params, sid, token } = gate;
  const status = String(params.DialCallStatus || '').toLowerCase();

  if (status === 'completed') {
    twiml(res, '<Hangup/>');
    return;
  }

  /* With texting off the send would "succeed" and nothing would arrive, so
     telling the caller a text is on its way would be untrue. See
     textingLive in lib/twilio.js. */
  if (!textingLive()) {
    twiml(res, "<Say>Sorry I missed you. I'll call you back.</Say><Hangup/>");
    return;
  }

  /* The caller of this call, and nobody else. Not a request parameter we
     were handed to text — the From of the call Twilio just signed for us. */
  const caller = params.From;
  const businessNumber = params.To;
  const body = process.env.AUTO_TEXT || DEFAULT_TEXT;

  /* If we cannot find out whether we already texted them, send. A caller who
     gets a second text is mildly annoyed; a caller who gets none thinks they
     were ignored, which is the whole thing we are selling against. */
  let alreadyTexted = false;
  try {
    alreadyTexted = await textedWithin({
      sid, token, from: businessNumber, to: caller, hours: QUIET_HOURS
    });
  } catch (err) {
    console.error('could not check for a recent text, sending anyway: ' + (err && err.message));
  }

  if (alreadyTexted) {
    twiml(res, "<Say>Sorry I missed you. I'll call you back.</Say><Hangup/>");
    return;
  }

  try {
    await sendSms({ sid, token, from: businessNumber, to: caller, body });
  } catch (err) {
    /* Telling the caller a text is coming when it is not would be worse than
       saying nothing, so on a failure we hang up quietly and let the error
       show up in the function log. */
    console.error('missed-call text failed: ' + (err && err.message));
    twiml(res, '<Hangup/>');
    return;
  }

  twiml(res, "<Say>Sorry I missed you. I've just sent you a text.</Say><Hangup/>");
};
