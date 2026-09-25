'use strict';

/* Which area a run covers, and what the letter says about where Steven is.

   Set by environment, so a new area needs no code change:

     PILOT_PARISHES  parish ids on the LSLBC register, with names:
                     "1467:Lafayette" or "2098:Caddo,1815:Bossier".
                     Default: Caddo and Bossier, as the pilot always was.
     PILOT_TOWNS     optional: only these towns from the result list get their
                     detail pages fetched ("Youngsville,Broussard"). Filtering
                     before fetching is what keeps a small area small — the
                     register is walked politely, three seconds a page.
     PILOT_ZIPS      optional: keep only records whose mailing address is in
                     one of these zips ("70592"). Applied when parsing.
     PILOT_OUT_DIR   where the run's files go (see lib/paths.js). Use a
                     folder per area under finder/pilot/out/.

   The parish ids are the register's own. Its Advanced search page lists them
   against each parish name. */

const DEFAULT_PARISHES = { 2098: 'Caddo', 1815: 'Bossier' };

function parishes(env = process.env) {
  const raw = String(env.PILOT_PARISHES || '').trim();
  if (!raw) return { ...DEFAULT_PARISHES };
  const out = {};
  for (const part of raw.split(',')) {
    const m = /^\s*(\d+)\s*:\s*([^,]+?)\s*$/.exec(part);
    if (!m) throw new Error('PILOT_PARISHES must look like "1467:Lafayette" — got "' + part + '"');
    out[m[1]] = m[2];
  }
  return out;
}

const list = v => String(v || '').split(',').map(s => s.trim()).filter(Boolean);
const towns = (env = process.env) => list(env.PILOT_TOWNS).map(s => s.toUpperCase());
const zips = (env = process.env) => list(env.PILOT_ZIPS).map(s => s.slice(0, 5));

const wantTown = (listCity, env) => {
  const t = towns(env);
  return !t.length || t.includes(String(listCity || '').trim().toUpperCase());
};
const wantZip = (zip, env) => {
  const z = zips(env);
  return !z.length || z.includes(String(zip || '').slice(0, 5));
};

/* Where the letter says Steven is. The pilot parishes are next door to
   him, so their letters keep exactly what they always said; anywhere else
   gets the plain, always-true "here in Louisiana". Decided per record, from
   the parish list it was found in, so a mixed run cannot mislabel anyone. */
const HOME_TOWN_BY_PARISH = { Caddo: 'Bossier City', Bossier: 'Bossier City' };
const FALLBACK_PLACE = 'Louisiana';

function parishesOf(rec) {
  return [...new Set((rec && rec.foundVia || []).map(s => String(s).split(' / ')[0].trim()).filter(Boolean))];
}

function hereIn(rec) {
  const ps = parishesOf(rec);
  const homes = new Set(ps.map(p => HOME_TOWN_BY_PARISH[p]));
  return ps.length && homes.size === 1 && !homes.has(undefined) ? [...homes][0] : FALLBACK_PLACE;
}

module.exports = {
  DEFAULT_PARISHES, parishes, towns, zips, wantTown, wantZip,
  HOME_TOWN_BY_PARISH, FALLBACK_PLACE, parishesOf, hereIn
};
