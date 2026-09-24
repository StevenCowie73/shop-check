'use strict';

/* What happened to the forwarded call.

   Twilio posts here when the Dial ends. The parameters are still those of
   the original inbound call — From is the caller, To is the business
   number — with DialCallStatus describing the outcome.

   Anything other than "completed" means the caller did not get through, so
   they get one text. That is the whole product. */

const { authorize, twiml, sendSms } = require('../../lib/twilio.js');

const DEFAULT_TEXT =
  "Hi, this is Steven. Sorry I missed your call. I'll get back to you today, " +
  "or just text me here. Reply STOP to opt out.";

module.exports = async function handler(req, res) {
  const gate = await authorize(req, res);
  if (!gate) return;

  const { params, sid, token } = gate;
  const status = String(params.DialCallStatus || '').toLowerCase();

  if (status === 'completed') {
    twiml(res, '<Hangup/>');
    return;
  }

  /* The caller of this call, and nobody else. Not a request parameter we
     were handed to text — the From of the call Twilio just signed for us. */
  const caller = params.From;
  const businessNumber = params.To;
  const body = process.env.AUTO_TEXT || DEFAULT_TEXT;

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
