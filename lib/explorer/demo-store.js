'use strict';

/* The DEMO backend: invented data, held in memory. Notes and the
   do-not-contact flag are written here and last until the process ends —
   on Vercel, until the instance is recycled. Same interface as the Postgres
   store, so nothing above this file knows which one it is talking to. */

const { build } = require('./demo-data.js');
const { clean, matches } = require('./filters.js');
const { funnelOf, rowOf, timelineText } = require('./shape.js');

function createDemoStore(seed) {
  const db = seed || build();
  const now = () => new Date(db.now);
  const byId = id => db.prospects.find(p => p.id === id) || null;

  return {
    mode: 'demo',
    async areas() { return db.areas; },
    async funnel(areaId) {
      return funnelOf(db.prospects.filter(p => !areaId || p.areaId === areaId), db.events);
    },
    async feed(limit = 40) {
      return db.events.slice(0, limit).map(e => {
        const p = e.prospectId ? byId(e.prospectId) : null;
        return { at: e.at, kind: e.kind, prospectId: e.prospectId, company: p ? p.company : null,
                 text: timelineText(e, p), runId: e.detail && e.detail.runId || null };
      });
    },
    async list(input) {
      const f = clean(input, now());
      return db.prospects.filter(p => matches(p, f)).map(rowOf)
        .sort((a, b) => a.company.localeCompare(b.company));
    },
    async pins(areaId) {
      return db.prospects.filter(p => (!areaId || p.areaId === areaId) && p.lat != null)
        .map(p => ({ id: p.id, company: p.company, town: p.mailingCity, status: p.status, lat: p.lat, lng: p.lng,
                     website: p.audit ? p.audit.state : 'unknown' }));
    },
    async business(id) {
      const p = byId(id);
      if (!p) return null;
      const events = db.events.filter(e => e.prospectId === id).slice().sort((a, b) => a.at.localeCompare(b.at));
      return {
        ...p,
        timeline: events.map(e => ({ at: e.at, kind: e.kind, text: timelineText(e, p) })),
        notes: db.notes.filter(n => n.prospectId === id).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id)
      };
    },
    async placeIdOf(id) { const p = byId(id); return p ? p.placeId : null; },
    async letterSource(id) { return byId(id); },
    async addNote(id, body) {
      const p = byId(id);
      if (!p) return null;
      const note = { id: db.notes.length + 1, prospectId: id, body, createdAt: new Date().toISOString() };
      db.notes.push(note);
      return note;
    },
    async setDoNotContact(id, value) {
      const p = byId(id);
      if (!p) return null;
      p.doNotContact = !!value;
      return { id, doNotContact: p.doNotContact };
    },
    async runs() { return db.runs; },
    async run(id) {
      const r = db.runs.find(x => x.id === id);
      if (!r) return null;
      return { ...r, picked: db.prospects.filter(p => p.runId === id && p.selected).map(rowOf) };
    },
    async knownPhones() {
      const m = new Map();
      for (const p of db.prospects) if (p.phone) m.set(p.phone.replace(/\D/g, '').slice(-10), { id: p.id, company: p.company });
      return m;
    },
    /* For tests: the whole state, to prove nothing was written that should not be. */
    _snapshot() { return JSON.parse(JSON.stringify(db)); },
    /* The importers' side of the interface. */
    async upsertArea(a) { const i = db.areas.findIndex(x => x.id === a.id); if (i >= 0) db.areas[i] = a; else db.areas.push(a); },
    async upsertRun(r) { const i = db.runs.findIndex(x => x.id === r.id); if (i >= 0) db.runs[i] = r; else db.runs.push(r); },
    async upsertProspect(p) { const i = db.prospects.findIndex(x => x.id === p.id); if (i >= 0) db.prospects[i] = { ...db.prospects[i], ...p }; else db.prospects.push(p); },
    async addAudit(id, audit) { const p = byId(id); if (p) p.audit = audit; },
    async existingLetters(ids) { return new Map(ids.map(id => { const p = byId(id); return [id, p && p.letter && p.letter.state !== 'mock' ? [{ id, state: p.letter.state }] : []]; })); },
    async addLetter(id, letter) {
      const p = byId(id);
      if (!p) return;
      const replaced = letter.state === 'draft' && !!p.letter && p.letter.state === 'draft';
      if (letter.state === 'draft' && p.letter && !['draft', 'mock'].includes(p.letter.state)) throw new Error('letter for ' + id + ' is ' + p.letter.state + '; only a draft is replaced. Not importing.');
      p.letter = { state: letter.state, sentAt: letter.sentAt || null, html: letter.html };
      return { replaced };
    },
    async addEvent(e) { db.events.push({ id: db.events.length + 1, ...e }); db.events.sort((a, b) => b.at.localeCompare(a.at)); },
    async addMessage(m) { db.messages = db.messages || []; if (!db.messages.some(x => x.id === m.id)) db.messages.push(m); }
  };
}

module.exports = { createDemoStore };
