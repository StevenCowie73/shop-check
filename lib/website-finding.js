'use strict';

/* What we are willing to say about somebody's website.

   The posted letter and the prospect page must say the same thing, because
   the prospect reads one and then the other. This is the one place that
   decides, so they cannot drift apart.

   Every branch describes something we actually observed. "fine" and
   "unknown" produce nothing at all: a site we looked at and found no fault
   with, or one whose robots.txt told us to stay away, gives us no honest
   complaint to make, and an empty string is the correct output. */

const showDomain = url => String(url || '')
  .replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '');

/* The letter puts this after the missed-call paragraph, so it says "I also
   looked…". On the prospect page it stands alone under its own heading,
   where "also" has nothing to follow, so the page asks for surface 'page'
   and gets the same sentence without it. One set of sentences, two
   openings: the facts still cannot drift apart. */
function forSurface(finding, surface) {
  if (surface !== 'page') return finding;
  return { ...finding, text: finding.text.replace(/^I also /, 'I ') };
}

/* state:   'fine' | 'poor' | 'dead' | 'unknown' | 'not found'
   audit:   { url, source: 'email' | 'astra', parked, whatsWrong, signals[] }
   surface: 'letter' (the default) | 'page' */
function websiteFinding(state, audit, { surface = 'letter' } = {}) {
  return forSurface(letterFinding(state, audit), surface);
}

function letterFinding(state, audit) {
  const a = audit || {};

  if (state === 'fine' || state === 'unknown') {
    return { text: '', which: 'omitted (' + state + ')' };
  }

  if (state === 'not found') {
    return {
      text: "I also looked for your website and couldn't find one, so people who search for you have nothing to click through to.",
      which: 'not found'
    };
  }

  const domain = showDomain(a.url);
  const fromEmail = a.source !== 'astra';
  const gone = a.parked || /domain not found/i.test(a.whatsWrong || '');

  if (state === 'dead') {
    if (gone) {
      return fromEmail
        ? { text: `I also tried ${domain}, the web address from your business email, and it doesn't lead to a website.`,
            which: 'gone (email)' }
        : { text: `I found ${domain} listed for you, but it doesn't lead to a website.`,
            which: 'gone (astra)' };
    }
    return fromEmail
      ? { text: `I also tried ${domain}, the web address from your business email, and it comes back with an error.`,
          which: 'error (email)' }
      : { text: `I found ${domain} listed for you, but it comes back with an error, so anyone who looks you up hits a dead end.`,
          which: 'error (astra)' };
  }

  if (state === 'poor' && (a.signals || []).includes('viewport')) {
    return {
      text: `I also looked at your website, ${domain}. It doesn't work well on a phone, which is where most people look you up.`,
      which: 'poor, not built for phones (' + (fromEmail ? 'email' : 'astra') + ')'
    };
  }

  return { text: '', which: 'omitted (no rule matched)' };
}

module.exports = { websiteFinding, showDomain };
