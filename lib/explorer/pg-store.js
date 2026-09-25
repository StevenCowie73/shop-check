'use strict';

/* The POSTGRES backend, used once COLDENJAMES_URL or DATABASE_URL is set.
   Same interface as the demo store. Every value from a request reaches the
   database as a bound parameter, never as SQL text. Schema:
   db/migrations/001_explorer.sql. */

const { clean } = require('./filters.js');
const { funnelOf, rowOf, timelineText } = require('./shape.js');

const PROSPECT_COLS = `p.id, p.area_id, p.run_id, p.company, p.owner_name, p.trade, p.licence_types,
  p.licence_status, to_char(p.first_issued, 'YYYY-MM-DD') AS first_issued, p.email, p.phone,
  p.mailing_street, p.mailing_city, p.mailing_state, p.mailing_zip, p.lat, p.lng, p.geocode_source,
  p.place_id, p.status, p.selected, p.do_not_contact,
  a.url AS a_url, a.state AS a_state, a.loads AS a_loads, a.https AS a_https, a.viewport AS a_viewport,
  a.phone_on_page AS a_phone, a.newest_year AS a_year, a.status_code AS a_code, a.whats_wrong AS a_wrong,
  a.found_by AS a_found_by, a.checked_at AS a_checked,
  l.state AS l_state, l.sent_at AS l_sent`;

const PROSPECT_FROM = `prospects p
  LEFT JOIN LATERAL (SELECT * FROM audits WHERE prospect_id = p.id ORDER BY checked_at DESC LIMIT 1) a ON true
  LEFT JOIN LATERAL (SELECT * FROM letters WHERE prospect_id = p.id ORDER BY created_at DESC LIMIT 1) l ON true`;

function toProspect(r) {
  return {
    id: r.id, areaId: r.area_id, runId: r.run_id, company: r.company, ownerName: r.owner_name, trade: r.trade,
    licenceTypes: r.licence_types || [], licenceStatus: r.licence_status, firstIssued: r.first_issued,
    email: r.email, phone: r.phone, mailingStreet: r.mailing_street, mailingCity: r.mailing_city,
    mailingState: r.mailing_state, mailingZip: r.mailing_zip, lat: r.lat, lng: r.lng, geocodeSource: r.geocode_source,
    placeId: r.place_id, status: r.status, selected: r.selected, doNotContact: r.do_not_contact,
    audit: r.a_state ? { url: r.a_url, state: r.a_state, loads: r.a_loads, https: r.a_https, viewport: r.a_viewport,
      phoneOnPage: r.a_phone, newestYear: r.a_year, statusCode: r.a_code, whatsWrong: r.a_wrong,
      foundBy: r.a_found_by, checkedAt: r.a_checked } : null,
    letter: r.l_state ? { state: r.l_state, sentAt: r.l_sent } : null
  };
}
const toEvent = r => ({ id: r.id, prospectId: r.prospect_id, runId: r.run_id, kind: r.kind,
  at: new Date(r.at).toISOString(), detail: r.detail || {}, source: r.source });

/* The filter object as SQL: returns the WHERE clause and its parameters. */
function whereFor(input) {
  const f = clean(input);
  const where = [], params = [];
  const p = v => { params.push(v); return '$' + params.length; };
  if (f.q) {
    for (const w of f.q.toLowerCase().split(/\s+/)) {
      const ph = p('%' + w + '%');
      where.push(`lower(concat_ws(' ', p.company, p.mailing_city, p.trade, p.owner_name)) LIKE ${ph}`);
    }
  }
  if (f.area) where.push(`p.area_id = ${p(f.area)}`);
  if (f.status) where.push(`p.status = ${p(f.status)}`);
  if (f.website) where.push(`coalesce(a.state, 'unknown') = ${p(f.website)}`);
  if (f.licenceAge === '12m') where.push(`p.first_issued >= now() - interval '12 months'`);
  if (f.licenceAge === '24m') where.push(`p.first_issued >= now() - interval '24 months'`);
  if (f.licenceAge === 'older') where.push(`p.first_issued < now() - interval '24 months'`);
  if (f.hasEmail === 'yes') where.push(`p.email IS NOT NULL AND p.email <> ''`);
  if (f.hasEmail === 'no') where.push(`(p.email IS NULL OR p.email = '')`);
  return { sql: where.length ? 'WHERE ' + where.join(' AND ') : '', params };
}

function createPgStore(pool) {
  const q = (sql, params = []) => pool.query(sql, params).then(r => r.rows);
  const one = async (sql, params) => (await q(sql, params))[0] || null;

  return {
    mode: 'postgres',
    async areas() {
      return (await q(`SELECT id, name, here_in FROM areas ORDER BY name`)).map(a => ({ id: a.id, name: a.name, hereIn: a.here_in }));
    },
    async funnel(areaId) {
      const ps = (await q(`SELECT ${PROSPECT_COLS} FROM ${PROSPECT_FROM} ${areaId ? 'WHERE p.area_id = $1' : ''}`, areaId ? [areaId] : [])).map(toProspect);
      const evs = (await q(`SELECT prospect_id, kind FROM events WHERE kind IN ('page_opened','reply','text_in')`)).map(r => ({ prospectId: r.prospect_id, kind: r.kind }));
      return funnelOf(ps, evs);
    },
    async feed(limit = 40) {
      const rows = await q(`SELECT e.*, p.company FROM events e LEFT JOIN prospects p ON p.id = e.prospect_id ORDER BY e.at DESC LIMIT $1`, [Math.min(200, limit)]);
      return rows.map(r => { const e = toEvent(r); return { at: e.at, kind: e.kind, prospectId: e.prospectId, company: r.company,
        text: timelineText(e, null), runId: e.runId || (e.detail && e.detail.runId) || null }; });
    },
    async list(input) {
      const w = whereFor(input);
      return (await q(`SELECT ${PROSPECT_COLS} FROM ${PROSPECT_FROM} ${w.sql} ORDER BY p.company LIMIT 500`, w.params)).map(r => rowOf(toProspect(r)));
    },
    async pins(areaId) {
      const rows = await q(`SELECT ${PROSPECT_COLS} FROM ${PROSPECT_FROM} WHERE p.lat IS NOT NULL ${areaId ? 'AND p.area_id = $1' : ''}`, areaId ? [areaId] : []);
      return rows.map(toProspect).map(p => ({ id: p.id, company: p.company, town: p.mailingCity, status: p.status,
        lat: p.lat, lng: p.lng, website: p.audit ? p.audit.state : 'unknown' }));
    },
    async business(id) {
      const r = await one(`SELECT ${PROSPECT_COLS} FROM ${PROSPECT_FROM} WHERE p.id = $1`, [id]);
      if (!r) return null;
      const p = toProspect(r);
      const evs = (await q(`SELECT * FROM events WHERE prospect_id = $1 ORDER BY at`, [id])).map(toEvent);
      const notes = await q(`SELECT id, body, created_at FROM notes WHERE prospect_id = $1 ORDER BY created_at DESC, id DESC`, [id]);
      return { ...p, timeline: evs.map(e => ({ at: e.at, kind: e.kind, text: timelineText(e, p) })),
        notes: notes.map(n => ({ id: n.id, prospectId: id, body: n.body, createdAt: new Date(n.created_at).toISOString() })) };
    },
    async placeIdOf(id) { const r = await one(`SELECT place_id FROM prospects WHERE id = $1`, [id]); return r ? r.place_id : null; },
    async letterSource(id) {
      const r = await one(`SELECT ${PROSPECT_COLS}, (SELECT html FROM letters WHERE prospect_id = p.id ORDER BY created_at DESC LIMIT 1) AS l_html FROM ${PROSPECT_FROM} WHERE p.id = $1`, [id]);
      if (!r) return null;
      const p = toProspect(r);
      if (p.letter) p.letter.html = r.l_html;
      return p;
    },
    async addNote(id, body) {
      const r = await one(`INSERT INTO notes(prospect_id, body) SELECT id, $2 FROM prospects WHERE id = $1 RETURNING id, created_at`, [id, body]);
      return r ? { id: r.id, prospectId: id, body, createdAt: new Date(r.created_at).toISOString() } : null;
    },
    async setDoNotContact(id, value) {
      const r = await one(`UPDATE prospects SET do_not_contact = $2, updated_at = now() WHERE id = $1 RETURNING id, do_not_contact`, [id, !!value]);
      return r ? { id: r.id, doNotContact: r.do_not_contact } : null;
    },
    async runs() {
      return (await q(`SELECT * FROM runs ORDER BY started_at DESC`)).map(r => ({ id: r.id, areaId: r.area_id, label: r.label,
        startedAt: new Date(r.started_at).toISOString(), funnel: r.funnel, costUsd: Number(r.cost_usd), problems: r.problems }));
    },
    async run(id) {
      const r = (await this.runs()).find(x => x.id === id);
      if (!r) return null;
      const picked = (await q(`SELECT ${PROSPECT_COLS} FROM ${PROSPECT_FROM} WHERE p.run_id = $1 AND p.selected ORDER BY p.company`, [id])).map(x => rowOf(toProspect(x)));
      return { ...r, picked };
    },
    async knownPhones() {
      const m = new Map();
      for (const r of await q(`SELECT id, company, phone FROM prospects WHERE phone IS NOT NULL`)) {
        m.set(String(r.phone).replace(/\D/g, '').slice(-10), { id: r.id, company: r.company });
      }
      return m;
    },
    /* The importers' side. Google data never has a column to go into. */
    async upsertArea(a) {
      await q(`INSERT INTO areas(id, name, parishes, towns, zips, here_in) VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, parishes = EXCLUDED.parishes, towns = EXCLUDED.towns,
        zips = EXCLUDED.zips, here_in = EXCLUDED.here_in`,
        [a.id, a.name, JSON.stringify(a.parishes || {}), a.towns || [], a.zips || [], a.hereIn || 'Louisiana']);
    },
    async upsertRun(r) {
      await q(`INSERT INTO runs(id, area_id, label, started_at, funnel, cost_usd, problems) VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (id) DO UPDATE SET funnel = EXCLUDED.funnel, cost_usd = EXCLUDED.cost_usd, problems = EXCLUDED.problems`,
        [r.id, r.areaId, r.label, r.startedAt, JSON.stringify(r.funnel || {}), r.costUsd || 0, r.problems || []]);
    },
    async upsertProspect(p) {
      await q(`INSERT INTO prospects(id, area_id, run_id, company, owner_name, trade, licence_types, licence_status,
          first_issued, email, phone, mailing_street, mailing_city, mailing_state, mailing_zip, lat, lng, geocode_source,
          place_id, status, selected)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,coalesce($20,'not_contacted'),coalesce($21,false))
        ON CONFLICT (id) DO UPDATE SET company = EXCLUDED.company, owner_name = EXCLUDED.owner_name, trade = EXCLUDED.trade,
          licence_types = EXCLUDED.licence_types, licence_status = EXCLUDED.licence_status, first_issued = EXCLUDED.first_issued,
          email = EXCLUDED.email, phone = EXCLUDED.phone, mailing_street = EXCLUDED.mailing_street,
          mailing_city = EXCLUDED.mailing_city, mailing_state = EXCLUDED.mailing_state, mailing_zip = EXCLUDED.mailing_zip,
          lat = coalesce(EXCLUDED.lat, prospects.lat), lng = coalesce(EXCLUDED.lng, prospects.lng),
          geocode_source = coalesce(EXCLUDED.geocode_source, prospects.geocode_source),
          place_id = coalesce(EXCLUDED.place_id, prospects.place_id), selected = EXCLUDED.selected, updated_at = now()`,
        [p.id, p.areaId, p.runId || null, p.company, p.ownerName || null, p.trade || null, p.licenceTypes || [],
         p.licenceStatus || null, p.firstIssued || null, p.email || null, p.phone || null, p.mailingStreet || null,
         p.mailingCity || null, p.mailingState || null, p.mailingZip || null, p.lat ?? null, p.lng ?? null,
         p.geocodeSource || null, p.placeId || null, p.status || null, p.selected ?? null]);
    },
    async addAudit(id, a) {
      await q(`INSERT INTO audits(prospect_id, url, state, loads, https, viewport, phone_on_page, newest_year, status_code,
        whats_wrong, found_by, checked_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,coalesce($12, now()))`,
        [id, a.url || null, a.state, a.loads ?? null, a.https ?? null, a.viewport ?? null, a.phoneOnPage ?? null,
         a.newestYear ?? null, a.statusCode ?? null, a.whatsWrong || null, a.foundBy || null, a.checkedAt || null]);
    },
    async addLetter(id, l) {
      await q(`INSERT INTO letters(prospect_id, run_id, state, html, sent_at) VALUES ($1,$2,$3,$4,$5)`,
        [id, l.runId || null, l.state, l.html, l.sentAt || null]);
    },
    async addEvent(e) {
      await q(`INSERT INTO events(prospect_id, run_id, kind, at, detail, source) VALUES ($1,$2,$3,$4,$5,$6)`,
        [e.prospectId || null, e.runId || null, e.kind, e.at, JSON.stringify(e.detail || {}), e.source || null]);
    },
    async addMessage(m) {
      await q(`INSERT INTO messages(id, prospect_id, kind, direction, other_party, body, status, at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
        [m.id, m.prospectId || null, m.kind, m.direction, m.otherParty, m.body || null, m.status || null, m.at]);
    }
  };
}

module.exports = { createPgStore, whereFor, toProspect };
