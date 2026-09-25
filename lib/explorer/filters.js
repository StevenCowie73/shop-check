'use strict';

/* What the List can be filtered by, and the Home screen's quick chips.
   The demo store applies these in memory; the Postgres store turns the same
   filter object into SQL. One definition, two backends. */

const STATUSES = ['not_contacted', 'letter_sent', 'page_opened', 'replied', 'client', 'closed'];
const STATUS_LABEL = {
  not_contacted: 'Not contacted', letter_sent: 'Letter sent', page_opened: 'Page opened',
  replied: 'Replied', client: 'Client', closed: 'Closed'
};
const WEBSITE_STATES = ['fine', 'poor', 'broken', 'not_found', 'unknown', 'blocked'];
const WEBSITE_LABEL = {
  fine: 'Fine', poor: 'Poor', broken: 'Broken', not_found: 'None found',
  unknown: 'Unknown', blocked: "Blocked — couldn't check"
};
const LICENCE_AGES = { '12m': 'Within 12 months', '24m': 'Within 24 months', older: 'Older than 24 months' };

/* The Home screen's chips, each a ready-made filter for the List. */
const CHIPS = {
  'no-website': { label: 'No website', filter: { website: 'not_found' } },
  broken: { label: 'Broken site', filter: { website: 'broken' } },
  'new-licence': { label: 'New licence (12 months)', filter: { licenceAge: '12m' } },
  'not-contacted': { label: 'Not contacted', filter: { status: 'not_contacted' } },
  replied: { label: 'Replied', filter: { status: 'replied' } }
};

/* Accept only known values; anything else is dropped, never passed on. */
function clean(input, now = new Date()) {
  const f = {};
  const q = String((input && input.q) || '').trim().slice(0, 80);
  if (q) f.q = q;
  if (input && input.chip && CHIPS[input.chip]) Object.assign(f, CHIPS[input.chip].filter);
  if (input && /^[a-z0-9-]{1,40}$/.test(String(input.area || ''))) f.area = String(input.area);
  if (input && STATUSES.includes(input.status)) f.status = input.status;
  if (input && WEBSITE_STATES.includes(input.website)) f.website = input.website;
  if (input && LICENCE_AGES[input.licenceAge]) f.licenceAge = input.licenceAge;
  if (input && (input.hasEmail === 'yes' || input.hasEmail === 'no')) f.hasEmail = input.hasEmail;
  f.now = now;
  return f;
}

function monthsBefore(now, m) { const d = new Date(now); d.setUTCMonth(d.getUTCMonth() - m); return d.toISOString().slice(0, 10); }

function matches(p, f) {
  if (f.q) {
    const hay = [p.company, p.mailingCity, p.trade, p.ownerName].join(' ').toLowerCase();
    if (!f.q.toLowerCase().split(/\s+/).every(w => hay.includes(w))) return false;
  }
  if (f.area && p.areaId !== f.area) return false;
  if (f.status && p.status !== f.status) return false;
  if (f.website && (p.audit ? p.audit.state : 'unknown') !== f.website) return false;
  if (f.licenceAge) {
    const d = p.firstIssued || '';
    const c12 = monthsBefore(f.now, 12), c24 = monthsBefore(f.now, 24);
    if (f.licenceAge === '12m' && !(d >= c12)) return false;
    if (f.licenceAge === '24m' && !(d >= c24)) return false;
    if (f.licenceAge === 'older' && !(d && d < c24)) return false;
  }
  if (f.hasEmail === 'yes' && !p.email) return false;
  if (f.hasEmail === 'no' && p.email) return false;
  return true;
}

module.exports = {
  STATUSES, STATUS_LABEL, WEBSITE_STATES, WEBSITE_LABEL, LICENCE_AGES, CHIPS,
  clean, matches, monthsBefore
};
