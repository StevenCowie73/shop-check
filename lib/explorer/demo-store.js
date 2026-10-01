'use strict';

/* The DEMO backend: invented data, held in memory. Notes and the
   do-not-contact flag are written here and last until the process ends —
   on Vercel, until the instance is recycled. Same interface as the Postgres
   store, so nothing above this file knows which one it is talking to. */

const { build } = require('./demo-data.js');
const { clean, matches } = require('./filters.js');
const { funnelOf, rowOf, timelineText } = require('./shape.js');
const { phoneKey, addressKey, entryMatches } = require('../suppression.js');

function createDemoStore(seed) {
  const db = seed || build();
  const now = () => new Date(db.now);
  const byId = id => db.prospects.find(p => p.id === id) || null;
  db.suppressions = db.suppressions || [];
  const keysOf = p => ({ phoneKey: phoneKey(p.phone), addressKey: addressKey(p.mailingStreet, p.mailingZip) });
  const listed = p => db.suppressions.some(e => entryMatches(e, keysOf(p)));
  const event = (prospectId, kind, detail, source, at) =>
    { db.events.push({ id: db.events.length + 1, prospectId, kind, at: at || new Date().toISOString(), detail, source });
      db.events.sort((a, b) => b.at.localeCompare(a.at)); };

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
    /* The same rules as the Postgres store: on puts the phone and address
       on the list; off needs confirm and never undoes a STOP text or a
       deletion request. */
    async setDoNotContact(id, value, { confirm = false, source = 'explorer' } = {}) {
      const p = byId(id);
      if (!p) return null;
      const keys = keysOf(p);
      if (value) {
        if (keys.phoneKey || keys.addressKey) await this.suppress({ ...keys, reason: 'by_hand', prospectId: id, detail: { source } });
        if (!p.doNotContact) { p.doNotContact = true; event(id, 'do_not_contact', { reason: 'by_hand', source }, 'manual'); }
        return { id, doNotContact: true };
      }
      if (confirm !== true) return { id, refused: 'Taking a business off the do-not-contact list needs an explicit confirm.' };
      const live = db.suppressions.filter(e => entryMatches(e, keys));
      const held = live.filter(e => e.reason !== 'by_hand');
      if (held.length) {
        return { id, refused: held.some(h => h.reason === 'stop_text')
          ? 'This number texted STOP. That is their own word, and it is not undone here.'
          : 'This business asked for its data to be deleted. That is not undone here.' };
      }
      live.forEach(e => { e.revokedAt = new Date().toISOString(); });
      p.doNotContact = false;
      event(id, 'do_not_contact_undone', { source }, 'manual');
      return { id, doNotContact: false };
    },
    async suppress({ phoneKey: pk = null, addressKey: ak = null, reason, sourceRef = null, prospectId = null, detail = {}, at = null, announce = true }) {
      if (!pk && !ak) throw new Error('A do-not-contact entry needs a phone number or a mailing address.');
      if (sourceRef && db.suppressions.some(e => e.sourceRef === sourceRef)) return { added: false, marked: [] };
      if (!sourceRef && db.suppressions.some(e => !e.revokedAt && !e.sourceRef && e.reason === reason && e.phoneKey === pk && e.addressKey === ak)) return { added: false, marked: [] };
      const entry = { id: db.suppressions.length + 1, phoneKey: pk, addressKey: ak, reason, sourceRef, prospectId, detail, createdAt: at || new Date().toISOString(), revokedAt: null };
      db.suppressions.push(entry);
      const marked = db.prospects.filter(p => !p.doNotContact && (p.id === prospectId || entryMatches(entry, keysOf(p)))).map(p => { p.doNotContact = true; return p.id; });
      for (const pid of new Set([...marked, ...(announce && reason === 'stop_text' && prospectId ? [prospectId] : [])])) {
        event(pid, 'do_not_contact', { reason, ...detail }, reason === 'stop_text' ? 'twilio' : 'manual', at);
      }
      return { added: true, id: entry.id, marked };
    },
    async recordOptOut({ from, word, messageSid = null, at = null }) {
      const pk = phoneKey(from);
      if (!pk) return { recorded: false, why: 'not a US phone number' };
      const matches = db.prospects.filter(p => keysOf(p).phoneKey === pk).sort((a, b) => a.id.localeCompare(b.id));
      const detail = { word };
      const first = await this.suppress({ phoneKey: pk, reason: 'stop_text', sourceRef: messageSid, prospectId: matches[0] ? matches[0].id : null, detail, at });
      if (!first.added) return { recorded: true, already: true, matched: matches.map(m => m.id) };
      const marked = new Set(first.marked);
      const told = new Set([...first.marked, ...(matches[0] ? [matches[0].id] : [])]);
      for (const m of matches) {
        if (!told.has(m.id)) event(m.id, 'do_not_contact', { reason: 'stop_text', ...detail }, 'twilio', at);
        const ak = keysOf(m).addressKey;
        if (ak) (await this.suppress({ addressKey: ak, reason: 'stop_text', prospectId: m.id, detail: { ...detail, via: 'phone match' }, at, announce: false })).marked.forEach(id => marked.add(id));
      }
      return { recorded: true, already: false, matched: matches.map(m => m.id), marked: [...marked] };
    },
    async doNotContactAmong(ids) { return ids.filter(id => { const p = byId(id); return p && (p.doNotContact || listed(p)); }); },
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
    /* A re-import never clears the flag, and anyone on the list arrives
       already do not contact. */
    async upsertProspect(p) {
      const i = db.prospects.findIndex(x => x.id === p.id);
      const next = i >= 0 ? { ...db.prospects[i], ...p } : { ...p };
      next.doNotContact = !!((i >= 0 && db.prospects[i].doNotContact) || listed(next));
      if (i >= 0) db.prospects[i] = next; else db.prospects.push(next);
    },
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
