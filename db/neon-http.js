'use strict';

/* A pg-Pool-shaped client that talks to Neon over HTTPS (POST /sql on the
   database's own host) instead of the Postgres wire protocol on 5432.

   For machines where outbound 5432 is blocked, such as a cloud session
   behind an HTTPS-only proxy. Only query(sql, params) → { rows } is
   offered, which is all pg-store.js uses. Values still travel as bound
   parameters, never spliced into SQL. The connection string goes in a
   header to Neon's own host and nowhere else, and never into an error. */

function createNeonHttpPool(connectionString, { fetchImpl = null } = {}) {
  const fetch = fetchImpl || require('../finder/lib/http.js').fetch;
  const host = new URL(connectionString).hostname;
  const endpoint = 'https://' + host + '/sql';
  const scrub = s => String(s).split(connectionString).join('[connection string]');

  async function post(body) {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Neon-Connection-String': connectionString, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) { /* reported below */ }
    if (!res.ok || !json) throw new Error('Neon HTTP ' + res.status + ': ' + scrub(json && json.message || text.slice(0, 300)));
    return json;
  }

  const norm = params => (params || []).map(v => v === undefined ? null
    : Array.isArray(v) || v === null || typeof v !== 'object' ? v : JSON.stringify(v));

  return {
    async query(sql, params = []) {
      const r = await post({ query: sql, params: norm(params) });
      return { rows: r.rows || [], rowCount: r.rowCount };
    },
    /* Several statements in one transaction: all of them or none. */
    async transaction(statements) {
      const r = await post({ queries: statements.map(s => ({ query: s.query || s, params: norm(s.params) })) });
      return (r.results || []).map(x => ({ rows: x.rows || [], rowCount: x.rowCount }));
    },
    async end() {}
  };
}

module.exports = { createNeonHttpPool };
