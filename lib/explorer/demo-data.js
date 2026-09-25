'use strict';

/* Invented demo data for Explorer. Every business, owner, address, email and
   phone number here is made up: emails are on example.com, phones are in the
   555-01XX range reserved for fiction, and the streets are generic. Nothing
   here is, or is based on, a real business.

   Built fresh on every call, so the in-memory store can be written to (notes,
   do-not-contact) without any change leaking between instances or tests. */

/* Town centres. Demo pins sit near these — the invented addresses do not
   exist, so there is nothing to geocode. */
const TOWNS = {
  'Bossier City': { lat: 32.5160, lng: -93.7321, zip: '71111', area: 'bossier-caddo' },
  Shreveport: { lat: 32.5252, lng: -93.7502, zip: '71105', area: 'bossier-caddo' },
  Youngsville: { lat: 30.0996, lng: -91.9901, zip: '70592', area: 'youngsville' }
};

const AREAS = [
  { id: 'bossier-caddo', name: 'Bossier / Caddo', hereIn: 'Bossier City' },
  { id: 'youngsville', name: 'Youngsville', hereIn: 'Louisiana' }
];

/* name, owner, trade, town, status, website state, first issued (months ago), licence types */
const R = 'Residential License Certificate';
const H = 'Home Improvement Registration';
const ROWS = [
  ['Marsh Lane Fencing', 'Dale Marsh', 'fence company', 'Bossier City', 'replied', 'not_found', 5, [R]],
  ['Pelican Point Roofing', 'Aaron Tuttle', 'roofer', 'Bossier City', 'letter_sent', 'poor', 9, [R]],
  ['Cypress Hollow Builders', 'Mara Quill', 'builder', 'Shreveport', 'not_contacted', 'fine', 40, [R, H]],
  ['Red River Gutter Co', 'Lonnie Beck', 'contractor', 'Shreveport', 'page_opened', 'broken', 3, [H]],
  ['Bayou Bend Painting', 'Tess Arden', 'painter', 'Bossier City', 'client', 'poor', 14, [H]],
  ['Oak Alley Electric', 'Ray Dunmore', 'electrician', 'Shreveport', 'not_contacted', 'blocked', 7, [R]],
  ['Pine Hollow Plumbing', 'Gus Farrow', 'plumber', 'Bossier City', 'letter_sent', 'not_found', 2, [R]],
  ['Magnolia Row Remodeling', 'Nell Sutter', 'contractor', 'Shreveport', 'closed', 'broken', 30, [H]],
  ['Sugarcane Lane Decks', 'Beau Lacoste', 'contractor', 'Youngsville', 'replied', 'unknown', 4, [R]],
  ['Heron Creek Fence & Gate', 'Paul Guidry', 'fence company', 'Youngsville', 'page_opened', 'not_found', 8, [R]],
  ['Crawfish Flats Roofing', 'Jolie Hebert', 'roofer', 'Youngsville', 'not_contacted', 'fine', 20, [R, H]],
  ['Live Oak Window Co', 'Remy Thibault', 'window company', 'Youngsville', 'letter_sent', 'broken', 6, [H]],
  ['Cane Field Concrete', 'Andre Leblanc', 'contractor', 'Youngsville', 'not_contacted', 'poor', 11, [R]],
  ['Pecan Grove Flooring', 'Celia Broussard', 'flooring company', 'Youngsville', 'replied', 'fine', 16, [H]],
  ['Egret Point HVAC', 'Luc Picard', 'HVAC company', 'Youngsville', 'not_contacted', 'not_found', 2, [R]],
  ['Twin Bayou Builders', 'Hank Oliver', 'builder', 'Bossier City', 'not_contacted', 'unknown', 26, [R]],
  ['Stonebridge Tile Works', 'Irene Pace', 'contractor', 'Shreveport', 'letter_sent', 'fine', 18, [H]],
  ['Longleaf Siding Co', 'Wes Carrow', 'contractor', 'Bossier City', 'page_opened', 'poor', 10, [R]],
  ['Driftwood Deck & Dock', 'Cal Mercer', 'contractor', 'Shreveport', 'not_contacted', 'not_found', 1, [R]],
  ['Bluebonnet Painting', 'June Hollis', 'painter', 'Bossier City', 'closed', 'blocked', 44, [H]],
  ['Willow Creek Plumbing', 'Otis Grady', 'plumber', 'Youngsville', 'letter_sent', 'not_found', 7, [R]],
  ['Foxglove Fencing', 'Dina Reyes', 'fence company', 'Shreveport', 'not_contacted', 'broken', 3, [R]],
  ['Riverbend Roof & Repair', 'Abe Castille', 'roofer', 'Youngsville', 'page_opened', 'unknown', 13, [R, H]],
  ['Sawgrass Electric', 'Kit Lanier', 'electrician', 'Bossier City', 'letter_sent', 'not_found', 9, [R]],
  ['Cedar Bluff Builders', 'Moe Fontenot', 'builder', 'Shreveport', 'not_contacted', 'fine', 60, [R]]
];

const STREETS = ['Oak St', 'Pine Ave', 'Elm Dr', 'Maple Ln', 'Cedar Ct', 'Main St', 'Park Ave', 'Lake Rd', 'Hill St', 'River Rd'];
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

const slug = s => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');
const pad = n => String(n).padStart(2, '0');

/* A fixed "today" so the demo reads the same on every screenshot and test. */
const NOW = new Date('2026-09-24T17:00:00Z');
const daysAgo = (d, h = 0) => new Date(NOW.getTime() - (d * 24 + h) * 3600 * 1000).toISOString();
const monthsAgo = m => { const d = new Date(NOW); d.setUTCMonth(d.getUTCMonth() - m); return d.toISOString().slice(0, 10); };

function refFor(i) {
  let n = (i + 7) * 7919, s = '';
  for (let k = 0; k < 8; k++) { s += ALPHABET[n % ALPHABET.length]; n = Math.floor(n / ALPHABET.length) + k * 13 + i; }
  return 'DM' + s.slice(0, 6);
}

function auditFor(name, state, i) {
  const url = state === 'not_found' ? null : 'https://' + slug(name) + '.example.com/';
  const base = { url, state, foundBy: i % 3 ? 'email' : 'astra', checkedAt: daysAgo(12) };
  switch (state) {
    case 'fine': return { ...base, loads: true, https: true, viewport: true, phoneOnPage: true, newestYear: 2026, statusCode: 200, whatsWrong: 'Nothing obviously wrong with it' };
    case 'poor': return { ...base, loads: true, https: i % 2 === 0, viewport: false, phoneOnPage: i % 2 === 1, newestYear: 2017, statusCode: 200, whatsWrong: 'It was never built for phones, nothing newer than 2017 on the page' };
    case 'broken': return { ...base, loads: false, https: null, viewport: null, phoneOnPage: null, newestYear: null, statusCode: i % 2 ? 503 : null, whatsWrong: i % 2 ? 'The site does not load (the server answered 503)' : 'The site does not load (domain not found)' };
    case 'blocked': return { ...base, loads: null, https: null, viewport: null, phoneOnPage: null, newestYear: null, statusCode: 403, whatsWrong: "couldn't check — the site blocks automated visits" };
    case 'unknown': return { ...base, loads: null, https: null, viewport: null, phoneOnPage: null, newestYear: null, statusCode: null, whatsWrong: 'not checked — robots.txt asks crawlers to stay away' };
    default: return { ...base, url: null, loads: null, https: null, viewport: null, phoneOnPage: null, newestYear: null, statusCode: null, whatsWrong: 'No website found: searched, nothing of their own' };
  }
}

function build() {
  const prospects = ROWS.map(([company, owner, trade, town, status, web, months, types], i) => {
    const t = TOWNS[town];
    /* a small, deterministic scatter around the town centre */
    const angle = (i * 137.5) * Math.PI / 180, r = 0.012 + (i % 5) * 0.006;
    const letterSent = ['letter_sent', 'page_opened', 'replied', 'client', 'closed'].includes(status);
    return {
      id: refFor(i),
      areaId: t.area,
      runId: t.area === 'youngsville' ? 'run-youngsville' : 'run-bossier-caddo',
      company,
      ownerName: owner,
      trade,
      licenceTypes: types,
      licenceStatus: 'Active',
      firstIssued: monthsAgo(months),
      email: i % 6 === 5 ? null : owner.split(' ')[0].toLowerCase() + '@' + slug(company) + '.example.com',
      phone: '318-555-01' + pad(10 + i),
      mailingStreet: (100 + i * 37) + ' ' + STREETS[i % STREETS.length],
      mailingCity: town,
      mailingState: 'LA',
      mailingZip: t.zip,
      lat: t.lat + r * Math.sin(angle),
      lng: t.lng + r * Math.cos(angle),
      geocodeSource: 'demo',
      placeId: null,
      status,
      selected: status !== 'not_contacted' || i % 4 === 0,
      doNotContact: false,
      audit: auditFor(company, web, i),
      letter: letterSent ? { state: 'sent', sentAt: daysAgo(20 - (i % 7)) } : (i % 4 === 0 ? { state: 'draft', sentAt: null } : null)
    };
  });

  const byName = Object.fromEntries(prospects.map(p => [p.company, p]));
  const events = [];
  const ev = (company, kind, at, detail = {}) => events.push({
    id: events.length + 1, prospectId: company ? byName[company].id : null, kind, at, detail, source: 'demo'
  });

  for (const p of prospects) {
    if (p.selected) ev(p.company, 'selected', daysAgo(30));
    if (p.letter && p.letter.state === 'sent') ev(p.company, 'letter_sent', p.letter.sentAt);
  }
  ev('Marsh Lane Fencing', 'page_opened', daysAgo(9, 3), { channel: 'letter', device: 'phone', count: 3 });
  ev('Marsh Lane Fencing', 'text_in', daysAgo(8, 2), { body: 'Saw your letter. What does the text thing cost?' });
  ev('Marsh Lane Fencing', 'reply', daysAgo(8, 1), { body: 'It is $79 a month, first month free. Happy to set it up.' });
  ev('Red River Gutter Co', 'page_opened', daysAgo(4, 5), { channel: 'letter', device: 'phone', count: 1 });
  ev('Bayou Bend Painting', 'page_opened', daysAgo(15), { channel: 'letter', device: 'desktop', count: 2 });
  ev('Bayou Bend Painting', 'call_in', daysAgo(14), { status: 'completed', seconds: 312 });
  ev('Bayou Bend Painting', 'outcome', daysAgo(10), { outcome: 'client' });
  ev('Sugarcane Lane Decks', 'page_opened', daysAgo(3, 2), { channel: 'letter', device: 'phone', count: 2 });
  ev('Sugarcane Lane Decks', 'call_in', daysAgo(2, 6), { status: 'no-answer' });
  ev('Sugarcane Lane Decks', 'text_out', daysAgo(2, 6), { body: 'Missed-call text sent' });
  ev('Pecan Grove Flooring', 'text_in', daysAgo(1, 4), { body: 'Is the website really in my name?' });
  ev('Heron Creek Fence & Gate', 'page_opened', daysAgo(1, 1), { channel: 'letter', device: 'phone', count: 1 });
  ev('Longleaf Siding Co', 'page_opened', daysAgo(0, 5), { channel: 'letter', device: 'phone', count: 4 });
  ev('Riverbend Roof & Repair', 'page_opened', daysAgo(0, 2), { channel: 'email', device: 'desktop', count: 1 });
  ev('Magnolia Row Remodeling', 'outcome', daysAgo(6), { outcome: 'closed', why: 'retired, business closing' });
  ev(null, 'run', daysAgo(21), { runId: 'run-bossier-caddo', text: 'Bossier / Caddo pilot: 382 active, 20 picked' });
  ev(null, 'run', daysAgo(0, 8), { runId: 'run-youngsville', text: 'Youngsville test: 43 active, 20 picked' });
  ev(null, 'call_in', daysAgo(0, 3), { status: 'no-answer', from: '+13185550199' });
  events.sort((a, b) => b.at.localeCompare(a.at));

  const notes = [
    { id: 1, prospectId: byName['Marsh Lane Fencing'].id, body: 'Drove past the yard — busy, three trucks out.', createdAt: daysAgo(7) },
    { id: 2, prospectId: byName['Cedar Bluff Builders'].id, body: 'Skip — family friend.', createdAt: daysAgo(5) }
  ];
  byName['Cedar Bluff Builders'].doNotContact = true;

  const runs = [
    { id: 'run-bossier-caddo', areaId: 'bossier-caddo', label: 'Bossier / Caddo pilot', startedAt: daysAgo(21),
      funnel: { licences: 650, active: 382, picked: 20 }, costUsd: 5.49,
      problems: ['Astra targets built by hand', 'robots.txt timed out on 3 sites'] },
    { id: 'run-youngsville', areaId: 'youngsville', label: 'Youngsville test', startedAt: daysAgo(0, 8),
      funnel: { licences: 641, inArea: 76, active: 43, picked: 20 }, costUsd: 2.97,
      problems: ['a 403 from a bot wall read as a broken site (fixed)', '2 robots.txt timeouts through the proxy'] }
  ];

  return { now: NOW.toISOString(), areas: AREAS.map(a => ({ ...a })), runs, prospects, events, notes };
}

module.exports = { build, TOWNS, NOW };
