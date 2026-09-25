'use strict';

/* Shapes shared by both stores: the funnel, a List row, a timeline line. */

const { STATUS_LABEL, WEBSITE_LABEL } = require('./filters.js');

const AFTER_LETTER = new Set(['letter_sent', 'page_opened', 'replied', 'client', 'closed']);

/* found → selected → letter sent → page opened → replied → client. Counts
   only: a percentage of a handful is noise, so none is shown until a
   denominator reaches 100 (the page decides; these are just the counts). */
function funnelOf(prospects, events) {
  const ids = new Set(prospects.map(p => p.id));
  const had = kind => new Set(events.filter(e => e.kind === kind && ids.has(e.prospectId)).map(e => e.prospectId));
  const opened = had('page_opened'), replied = new Set([...had('reply'), ...had('text_in')]);
  return {
    found: prospects.length,
    selected: prospects.filter(p => p.selected).length,
    letterSent: prospects.filter(p => (p.letter && p.letter.state === 'sent') || AFTER_LETTER.has(p.status)).length,
    pageOpened: prospects.filter(p => opened.has(p.id) || ['page_opened', 'replied', 'client'].includes(p.status)).length,
    replied: prospects.filter(p => replied.has(p.id) || ['replied', 'client'].includes(p.status)).length,
    client: prospects.filter(p => p.status === 'client').length
  };
}

function rowOf(p) {
  const website = p.audit ? p.audit.state : 'unknown';
  return {
    id: p.id, company: p.company, town: p.mailingCity, trade: p.trade, areaId: p.areaId,
    status: p.status, statusLabel: STATUS_LABEL[p.status] || p.status,
    website, websiteLabel: WEBSITE_LABEL[website] || website,
    doNotContact: !!p.doNotContact
  };
}

function timelineText(e, p) {
  const d = e.detail || {};
  switch (e.kind) {
    case 'selected': return 'Picked for a letter';
    case 'letter_sent': return 'Letter sent';
    case 'page_opened': return 'Opened their page' + (d.count > 1 ? ' (' + d.count + ' times)' : '') + (d.device ? ' on a ' + d.device : '');
    case 'call_in': return 'Called ColdenJames' + (d.status === 'no-answer' ? ' — missed' : d.seconds ? ' — ' + Math.round(d.seconds / 60) + ' min' : '');
    case 'text_in': return 'Texted: "' + String(d.body || '').slice(0, 80) + '"';
    case 'text_out': return 'Text sent: ' + String(d.body || '').slice(0, 80);
    case 'reply': return 'Steven replied: "' + String(d.body || '').slice(0, 80) + '"';
    case 'outcome': return 'Outcome: ' + (d.outcome === 'client' ? 'became a client' : d.outcome || '') + (d.why ? ' — ' + d.why : '');
    case 'run': return d.text || 'Search run';
    default: return e.kind;
  }
}

module.exports = { funnelOf, rowOf, timelineText };
