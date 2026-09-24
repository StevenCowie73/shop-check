'use strict';

/* The code printed on a letter: coldenjames.com/p/H7KQ4XMR

   It is read off paper by someone standing in a yard, so the alphabet leaves
   out every pair that gets misread: no 0 or O, no 1 or I or L. Twenty-three
   letters and eight digits, thirty-one characters, eight long. That is
   31^8 ~= 852 billion codes, so a code is not something you arrive at by
   trying; the rate limit in lib/ratelimit.js is a second lock on a door that
   is already the wrong shape to pick.

   Uppercase always. A ref is never lowercased anywhere: it is generated
   uppercase, printed uppercase and compared uppercase.

   Never reused. allocate() is given every ref already handed out and will
   not return one of them, and DEMO2026 is reserved for the one invented
   record in site/prospects.js. That ref could not be generated anyway — it
   has a zero in it, and zero is not in the alphabet. */

const crypto = require('crypto');

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const LENGTH = 8;

/* Refs that must never be issued to a real company. */
const RESERVED = new Set(['DEMO2026']);

/* A ref is generated, never typed by us, so this is strict: exactly eight
   characters, all from the alphabet. site/prospects.js keeps its own looser
   check because a person retyping a code off paper is a different problem. */
function isRef(value) {
  const s = String(value == null ? '' : value);
  if (s.length !== LENGTH) return false;
  for (const ch of s) if (!ALPHABET.includes(ch)) return false;
  return true;
}

/* crypto.randomInt, not Math.random: these end up in a public URL, and a
   predictable sequence would let one letter's code suggest the next. */
function randomRef() {
  let out = '';
  for (let i = 0; i < LENGTH; i++) out += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return out;
}

/* One ref that is not in `taken` and not reserved. `taken` is anything with
   a .has — a Set, or a Map of ref to record. */
function newRef(taken) {
  const used = taken && typeof taken.has === 'function' ? taken : new Set();
  for (let tries = 0; tries < 1000; tries++) {
    const ref = randomRef();
    if (!used.has(ref) && !RESERVED.has(ref)) return ref;
  }
  /* Only reachable if the space is genuinely exhausted, which it will not be
     in this lifetime. Throwing beats returning a duplicate. */
  throw new Error('could not find an unused reference code');
}

/* `count` refs, all distinct from each other and from `taken`. */
function allocate(count, taken) {
  const used = new Set(taken && typeof taken[Symbol.iterator] === 'function' ? taken : []);
  const out = [];
  for (let i = 0; i < count; i++) {
    const ref = newRef(used);
    used.add(ref);
    out.push(ref);
  }
  return out;
}

const SITE = 'https://coldenjames.com';

/* The same ref, reached two ways. The channel is how it was sent, so that
   "opened the letter" and "clicked the email" are countable apart without
   two codes per company — one code per company is what makes the letter and
   the follow-up email add up to one story. */
const CHANNELS = { letter: 'letter', email: 'email', direct: null };

function prospectUrl(ref, channel) {
  if (!isRef(ref) && !RESERVED.has(String(ref))) {
    throw new Error('not a reference code: ' + JSON.stringify(ref));
  }
  const tag = Object.prototype.hasOwnProperty.call(CHANNELS, channel) ? CHANNELS[channel] : null;
  return SITE + '/p/' + ref + (tag ? '?c=' + tag : '');
}

module.exports = { ALPHABET, LENGTH, RESERVED, SITE, isRef, randomRef, newRef, allocate, prospectUrl };
