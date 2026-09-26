'use strict';

/* The POSTGRES backend, used when EXPLORER_DATA=postgres (store.js).
   Same interface as the demo store. Every value from a request reaches the
   database as a bound parameter, never as SQL text. Schema:
   db/migrations/001_explorer.sql. */

const { clean } = require('./filters.js');
const { funnelOf, rowOf, timelineText } = require('./shape.js');

const PROSPECT_COLS = `p.id, p.area_id, p.run_id, p.company, p.owner_name, p.trade, p.licence_types,
  p.licence_status, to_char(p.first_issued, 'YYYY-MM-DD') AS first_issued, p.email, p.phone,
  p.mailing_street, p.mailing_city, p.mailing_state, p.mailing_zip, p.lat, p.lng, p.geocode_source,
  p.place_id, p.status, p.selected, p.do_not_contact, p.rank,
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
    placeId: r.place_id, status: r.status, selected: r.selected, doNotContact: r.do_not_contact, rank: r.rank ?? null,
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

/* What a new render of a draft does to the letters already stored for that
   business in that run (mock letters aside, newest first): replace the one
   draft in place, add a first one, or refuse. A letter that has been
   approved or sent is never overwritten; un-approve it first
   (db/letters-unapprove.js) if it really should change. */
function draftReplacement(prospectId, existing) {
  const fixed = existing.find(l => l.state !== 'draft');
  if (fixed) return { refuse: 'letter ' + fixed.id + ' for ' + prospectId + ' is ' + fixed.state + '; only a draft is replaced. Not importing.' };
  if (existing.length > 1) return { refuse: prospectId + ' has ' + existing.length + ' drafts in this run (' + existing.map(l => l.id).join(', ') + '); not choosing one. Not importing.' };
  return existing.length ? { replace: existing[0].id } : {};
}

/* Why an approved letter cannot go back to draft, or null if it can. */
function whyNotUnapprove(l) {
  if (!l) return 'No such letter.';
  if (l.state === 'sent' || l.sentAt) return 'Letter ' + l.id + ' has been sent; it stays sent.';
  if (l.lobMode === 'live') return 'Letter ' + l.id + ' has a live Lob id' + (l.lobLetterId ? ' (' + l.lobLetterId + ')' : '') + '; it has been mailed and stays as it is.';
  if (l.state !== 'approved') return 'Letter ' + l.id + ' is not approved (state: ' + l.state + '); nothing to un-approve.';
  return null;
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
        startedAt: new Date(r.started_at).toISOString(), funnel: r.funnel, costUsd: Number(r.cost_usd), problems: r.problems,
        mock: !!r.mock }));
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
    /* ---- sending letters (lib/lob.js, db/lob-send.js) ---- */
    async letterForSending(letterId) {
      const r = await one(`SELECT l.id, l.prospect_id, l.run_id, l.state, l.html, l.approved_at, l.lob_letter_id, l.lob_mode,
          p.company, p.owner_name, p.mailing_street, p.mailing_city, p.mailing_state, p.mailing_zip, p.do_not_contact
        FROM letters l JOIN prospects p ON p.id = l.prospect_id WHERE l.id = $1`, [letterId]);
      if (!r) return null;
      return { id: r.id, prospectId: r.prospect_id, runId: r.run_id, state: r.state, html: r.html,
        approvedAt: r.approved_at, lobLetterId: r.lob_letter_id, lobMode: r.lob_mode, doNotContact: r.do_not_contact,
        prospect: { company: r.company, ownerName: r.owner_name, mailingStreet: r.mailing_street,
          mailingCity: r.mailing_city, mailingState: r.mailing_state, mailingZip: r.mailing_zip } };
    },
    /* A person read it and said yes. Only a draft can be approved. */
    async approveLetter(letterId) {
      return one(`UPDATE letters SET state = 'approved', approved_at = now() WHERE id = $1 AND state = 'draft'
        RETURNING id, state, approved_at`, [letterId]);
    },
    /* Back from approved to draft, so a letter can be read again or
       replaced by a new render. Never once it has gone to the post: a live
       Lob id or a sent date means it was mailed. A test Lob id stays on the
       letter, as the record of that test send. */
    async unapproveLetter(letterId) {
      const cur = await one(`SELECT id, state, sent_at, lob_letter_id, lob_mode FROM letters WHERE id = $1`, [letterId]);
      const why = whyNotUnapprove(cur && { id: cur.id, state: cur.state, sentAt: cur.sent_at, lobLetterId: cur.lob_letter_id, lobMode: cur.lob_mode });
      if (why) throw new Error(why);
      const row = await one(`UPDATE letters SET state = 'draft', approved_at = NULL
        WHERE id = $1 AND state = 'approved' AND sent_at IS NULL AND lob_mode IS DISTINCT FROM 'live'
        RETURNING id, state, lob_letter_id, lob_mode`, [letterId]);
      if (!row) throw new Error('Letter ' + letterId + ' changed while it was being un-approved; nothing changed.');
      return row;
    },
    async recordLobLetter(letterId, r) {
      const live = r.mode === 'live';
      const row = await one(`UPDATE letters SET lob_letter_id = $2, lob_mode = $3, expected_delivery_date = $4::date,
          lob_sent_at = $5::timestamptz, state = CASE WHEN $3 = 'live' THEN 'sent' ELSE state END,
          sent_at = CASE WHEN $3 = 'live' THEN $5::timestamptz ELSE sent_at END
        WHERE id = $1 AND state = 'approved' AND lob_mode IS DISTINCT FROM 'live' RETURNING prospect_id, run_id`,
        [letterId, r.lobLetterId, r.mode, r.expectedDeliveryDate, r.sentAt]);
      if (!row) throw new Error('letter ' + letterId + ' was not approved when Lob answered; Lob id ' + r.lobLetterId + ' not recorded');
      if (live) {
        await q(`UPDATE prospects SET status = 'letter_sent', updated_at = now() WHERE id = $1 AND status = 'not_contacted'`, [row.prospect_id]);
        await q(`INSERT INTO events(prospect_id, run_id, kind, at, detail, source) VALUES ($1,$2,'letter_sent',$3,$4,'lob')`,
          [row.prospect_id, row.run_id, r.sentAt, JSON.stringify({ lobLetterId: r.lobLetterId, expectedDeliveryDate: r.expectedDeliveryDate })]);
      }
      return row;
    },
    /* The importers' side. Google data never has a column to go into. */
    async upsertArea(a) {
      await q(`INSERT INTO areas(id, name, parishes, towns, zips, here_in) VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, parishes = EXCLUDED.parishes, towns = EXCLUDED.towns,
        zips = EXCLUDED.zips, here_in = EXCLUDED.here_in`,
        [a.id, a.name, JSON.stringify(a.parishes || {}), a.towns || [], a.zips || [], a.hereIn || 'Louisiana']);
    },
    async upsertRun(r) {
      await q(`INSERT INTO runs(id, area_id, label, started_at, funnel, cost_usd, problems, mock) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, funnel = EXCLUDED.funnel, cost_usd = EXCLUDED.cost_usd,
          problems = EXCLUDED.problems, mock = EXCLUDED.mock`,
        [r.id, r.areaId, r.label, r.startedAt, JSON.stringify(r.funnel || {}), r.costUsd || 0, r.problems || [], !!r.mock]);
    },
    async upsertProspect(p) {
      await q(`INSERT INTO prospects(id, area_id, run_id, company, owner_name, trade, licence_types, licence_status,
          first_issued, email, phone, mailing_street, mailing_city, mailing_state, mailing_zip, lat, lng, geocode_source,
          place_id, status, selected, rank)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,coalesce($20,'not_contacted'),coalesce($21,false),$22)
        ON CONFLICT (id) DO UPDATE SET company = EXCLUDED.company, owner_name = EXCLUDED.owner_name, trade = EXCLUDED.trade,
          licence_types = EXCLUDED.licence_types, licence_status = EXCLUDED.licence_status, first_issued = EXCLUDED.first_issued,
          email = EXCLUDED.email, phone = EXCLUDED.phone, mailing_street = EXCLUDED.mailing_street,
          mailing_city = EXCLUDED.mailing_city, mailing_state = EXCLUDED.mailing_state, mailing_zip = EXCLUDED.mailing_zip,
          lat = coalesce(EXCLUDED.lat, prospects.lat), lng = coalesce(EXCLUDED.lng, prospects.lng),
          geocode_source = coalesce(EXCLUDED.geocode_source, prospects.geocode_source),
          place_id = coalesce(EXCLUDED.place_id, prospects.place_id), selected = EXCLUDED.selected, rank = EXCLUDED.rank,
          run_id = coalesce(EXCLUDED.run_id, prospects.run_id), updated_at = now()`,
        [p.id, p.areaId, p.runId || null, p.company, p.ownerName || null, p.trade || null, p.licenceTypes || [],
         p.licenceStatus || null, p.firstIssued || null, p.email || null, p.phone || null, p.mailingStreet || null,
         p.mailingCity || null, p.mailingState || null, p.mailingZip || null, p.lat ?? null, p.lng ?? null,
         p.geocodeSource || null, p.placeId || null, p.status || null, p.selected ?? null, p.rank ?? null]);
    },
    async addAudit(id, a) {
      /* Importing the same audit twice (same business, same check time)
         adds nothing: a re-run of an importer is safe. */
      await q(`INSERT INTO audits(prospect_id, url, state, loads, https, viewport, phone_on_page, newest_year, status_code,
        whats_wrong, found_by, checked_at)
        SELECT $1::text, $2::text, $3::text, $4::boolean, $5::boolean, $6::boolean, $7::boolean, $8::int, $9::int, $10::text,
          $11::text, coalesce($12::timestamptz, now())
        WHERE NOT EXISTS (SELECT 1 FROM audits WHERE prospect_id = $1::text AND checked_at = $12::timestamptz)`,
        [id, a.url || null, a.state, a.loads ?? null, a.https ?? null, a.viewport ?? null, a.phoneOnPage ?? null,
         a.newestYear ?? null, a.statusCode ?? null, a.whatsWrong || null, a.foundBy || null, a.checkedAt || null]);
    },
    /* Every stored letter for these businesses in this run, mock aside,
       newest first: the importer checks them all before writing any. */
    async existingLetters(ids, runId) {
      const m = new Map(ids.map(id => [id, []]));
      for (const r of await q(`SELECT id, prospect_id, state FROM letters WHERE prospect_id = ANY($1::text[])
          AND run_id IS NOT DISTINCT FROM $2::text AND state <> 'mock' ORDER BY created_at DESC, id DESC`, [ids, runId || null])) {
        m.get(r.prospect_id).push({ id: r.id, state: r.state });
      }
      return m;
    },
    /* A new render of a draft replaces that draft's HTML in place: same
       row, same id, so the count of letters does not grow. Only a draft is
       ever replaced (draftReplacement). Sent and mock letters are added as
       before, and an identical one is not added twice. */
    async addLetter(id, l) {
      if (l.state === 'draft') {
        const existing = (await q(`SELECT id, state FROM letters WHERE prospect_id = $1::text
          AND run_id IS NOT DISTINCT FROM $2::text AND state <> 'mock' ORDER BY created_at DESC, id DESC`, [id, l.runId || null]))
          .map(r => ({ id: r.id, state: r.state }));
        const d = draftReplacement(id, existing);
        if (d.refuse) throw new Error(d.refuse);
        if (d.replace) {
          const row = await one(`UPDATE letters SET html = $2 WHERE id = $1 AND state = 'draft' RETURNING id`, [d.replace, l.html]);
          if (!row) throw new Error('letter ' + d.replace + ' stopped being a draft while it was being replaced; not replacing.');
          return { id: row.id, replaced: true };
        }
      }
      await q(`INSERT INTO letters(prospect_id, run_id, state, html, sent_at)
        SELECT $1::text, $2::text, $3::text, $4::text, $5::timestamptz
        WHERE NOT EXISTS (SELECT 1 FROM letters WHERE prospect_id = $1::text AND run_id IS NOT DISTINCT FROM $2::text
          AND state = $3::text AND html = $4::text)`,
        [id, l.runId || null, l.state, l.html, l.sentAt || null]);
    },
    async addEvent(e) {
      await q(`INSERT INTO events(prospect_id, run_id, kind, at, detail, source)
        SELECT $1::text, $2::text, $3::text, $4::timestamptz, $5::jsonb, $6::text
        WHERE NOT EXISTS (SELECT 1 FROM events WHERE prospect_id IS NOT DISTINCT FROM $1::text
          AND run_id IS NOT DISTINCT FROM $2::text AND kind = $3::text AND at = $4::timestamptz AND detail = $5::jsonb)`,
        [e.prospectId || null, e.runId || null, e.kind, e.at, JSON.stringify(e.detail || {}), e.source || null]);
    },
    async addMessage(m) {
      await q(`INSERT INTO messages(id, prospect_id, kind, direction, other_party, body, status, at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
        [m.id, m.prospectId || null, m.kind, m.direction, m.otherParty, m.body || null, m.status || null, m.at]);
    }
  };
}

module.exports = { createPgStore, whereFor, toProspect, draftReplacement, whyNotUnapprove };
