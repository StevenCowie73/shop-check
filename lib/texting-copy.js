'use strict';

/* The words a caller meets, in one place.

   The carriers approve the texting program on the strength of what a caller
   is told and what they are sent, and the /sms page shows that wording word
   for word. The voice route, the missed-call route, the website and the
   letter all read it from here, so what the page promises is what the phone
   actually says. Change it here and the page changes with it — and the
   approved campaign may then need updating too. */

/* Played before the call rings through, while texting is live. Staying on
   the line after it is how the caller agrees to the one text. */
const VOICE_DISCLOSURE =
  "Thanks for calling ColdenJames. If I miss your call, I'll text you back " +
  'at this number. Message and data rates may apply. Reply STOP to opt out.';

/* The one text a caller gets when the call is not answered. AUTO_TEXT can
   still replace it per deployment. */
const MISSED_CALL_TEXT =
  "Hi, this is Steven at ColdenJames. Sorry I missed your call. I'll get back " +
  'to you today, or just text me here. Reply STOP to opt out.';

/* Printed small under the phone number on the posted letter. */
const LETTER_SMS_LINE =
  "If I miss your call, you'll get one text back. Msg & data rates may apply. " +
  'Reply STOP to opt out, HELP for help.';

module.exports = { VOICE_DISCLOSURE, MISSED_CALL_TEXT, LETTER_SMS_LINE };
