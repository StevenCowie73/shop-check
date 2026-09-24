'use strict';

/* Reading Steven's replies.

   Steven texts the business number from his own cell, and the text goes on
   to a customer as if it came from ColdenJames. He can say who it is for by
   starting with their number; otherwise it goes to whoever was last in
   touch. Nothing here sends anything — it only works out what he meant. */

/* A US number at the very start: optional +1 or 1, then ten digits in any
   of the usual groupings — 3185550142, 318-555-0142, (318) 555-0142,
   +1 318 555 0142. Area code and exchange cannot start with 0 or 1, which
   keeps a message starting "1 more thing" or a price from being read as a
   number. Anything after it (a space, colon, dash or comma) is separator. */
const LEADING_NUMBER =
  /^\s*(?:\+?1[\s.-]*)?\(?([2-9]\d{2})\)?[\s.-]*([2-9]\d{2})[\s.-]*(\d{4})(?!\d)[\s:,.-]*/;

/* Returns { to, message }. `to` is an E.164 number when the reply starts
   with one, otherwise null — meaning "whoever was last in touch". */
function parseReply(body) {
  const text = String(body || '');
  const m = LEADING_NUMBER.exec(text);
  if (!m) return { to: null, message: text.trim() };
  return { to: '+1' + m[1] + m[2] + m[3], message: text.slice(m[0].length).trim() };
}

/* +13185550142 -> +1 318-555-0142, the way the campaign sample shows it.
   Anything that is not a US number is left as it came. */
function formatUS(e164) {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(String(e164 || ''));
  return m ? `+1 ${m[1]}-${m[2]}-${m[3]}` : String(e164 || '');
}

/* Words Twilio acts on itself (opt-out, opt-in, help). If Steven sends one
   from his own cell, Twilio applies it to his cell — it must never be
   relayed to a customer as if he had typed a message to them. */
const TWILIO_KEYWORDS = new Set([
  'STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'REVOKE', 'OPTOUT',
  'START', 'UNSTOP', 'YES', 'HELP', 'INFO'
]);
const isKeyword = body => TWILIO_KEYWORDS.has(String(body || '').trim().toUpperCase());

module.exports = { parseReply, formatUS, isKeyword, LEADING_NUMBER };
