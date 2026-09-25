'use strict';

/* The licence-register pipeline, run on invented records in a throwaway
   folder. Every business and person here is made up. */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PILOT = path.join(ROOT, 'finder', 'pilot');
const AREA = require('../finder/pilot/lib/area.js');

function tmpArea() { return fs.mkdtempSync(path.join(os.tmpdir(), 'shop-check-pilot-')); }
function step(script, dir, env = {}, args = []) {
  return spawnSync(process.execPath, [path.join(PILOT, script), ...args],
    { cwd: ROOT, encoding: 'utf8', env: { ...process.env, PILOT_OUT_DIR: dir, ...env } });
}
const recent = () => { const d = new Date(); d.setMonth(d.getMonth() - 3); return String(d.getMonth() + 1).padStart(2, '0') + '/' + String(d.getDate()).padStart(2, '0') + '/' + d.getFullYear(); };

function record(company, extra = {}) {
  return {
    company, searchCity: 'Youngsville', foundVia: ['Lafayette / Residential License Certificate'],
    mailingAddress: { street: '1 Invented Way', city: 'YOUNGSVILLE', state: 'LA', zip: '70592', raw: '' },
    email: 'owner@example.test', emailKind: 'free-provider',
    licenses: [{ number: 'X1', type: 'Residential License Certificate', status: 'Active', firstIssued: recent(), expires: '' }],
    classifications: [{ classification: 'RESIDENTIAL', qualifyingParty: 'Invented Person' }],
    qualifyingParties: ['Invented Person'],
    ...extra
  };
}

/* ---------- settings: parishes, towns, zips ---------- */

test('Caddo and Bossier stay the default area; any other area is a setting', () => {
  assert.deepStrictEqual(AREA.parishes({}), { 2098: 'Caddo', 1815: 'Bossier' });
  assert.deepStrictEqual(AREA.parishes({ PILOT_PARISHES: '1467:Lafayette' }), { 1467: 'Lafayette' });
  assert.deepStrictEqual(AREA.parishes({ PILOT_PARISHES: '2098:Caddo, 1467:Lafayette' }), { 2098: 'Caddo', 1467: 'Lafayette' });
  assert.throws(() => AREA.parishes({ PILOT_PARISHES: 'Lafayette' }), /PILOT_PARISHES/);
  assert.strictEqual(AREA.wantTown('YOUNGSVILLE', { PILOT_TOWNS: 'Youngsville,Broussard' }), true);
  assert.strictEqual(AREA.wantTown('Lafayette', { PILOT_TOWNS: 'Youngsville,Broussard' }), false);
  assert.strictEqual(AREA.wantTown('Anywhere', {}), true, 'no town list means every town');
  assert.strictEqual(AREA.wantZip('70592-1234', { PILOT_ZIPS: '70592' }), true);
  assert.strictEqual(AREA.wantZip('70518', { PILOT_ZIPS: '70592' }), false);
});

test('the walk reads its parishes from the settings and filters towns before fetching', () => {
  const src = fs.readFileSync(path.join(PILOT, '1-walk-lslbc.js'), 'utf8');
  assert.match(src, /const PARISHES = AREA\.parishes\(\);/);
  assert.strictEqual(/2098: 'Caddo'/.test(src), false, 'no hard-coded parishes left in the walk');
  assert.match(src, /everyone\.filter\(r => AREA\.wantTown\(r\.listCity\)\)/, 'town filter before the detail loop');
});

/* ---------- parse: zip filter, chain blocklist, the missing count ---------- */

const slug = key => crypto.createHash('sha1').update(key).digest('hex').slice(0, 16);
function detailHtml(name, cityLine) {
  const f = (l, v) => `<div class="display-label">${l}</div><div class="display-field">${v}</div>`;
  return `<fieldset><legend>Contractor Information</legend>${f('Name', name)}${f('Mailing Address', '1 Invented Way<br>' + cityLine)}${f('Phone Number', '')}${f('Email Address', 'owner@example.test')}</fieldset>` +
    `<fieldset><legend>Licenses</legend><div id="ContactDiv">${f('License', 'X1')}${f('Type', 'Residential License Certificate')}${f('Status', 'Active')}${f('First Issued', recent())}</div></fieldset>`;
}

test('parse keeps the zip it is asked for, drops chains, and counts only the wanted pages', () => {
  const dir = tmpArea();
  try {
    const details = path.join(dir, 'lslbc', 'details');
    fs.mkdirSync(details, { recursive: true });
    const rows = [
      { key: 'k1', listName: 'a', listCity: 'YOUNGSVILLE', sources: ['Lafayette / Residential License Certificate'] },
      { key: 'k2', listName: 'b', listCity: 'YOUNGSVILLE', sources: ['Lafayette / Residential License Certificate'] },
      { key: 'k3', listName: 'c', listCity: 'YOUNGSVILLE', sources: ['Lafayette / Residential License Certificate'] }
    ];
    fs.writeFileSync(path.join(details, slug('k1') + '.html'), detailHtml('Quokka Lagoon Fencing LLC', 'YOUNGSVILLE, LA 70592'));
    fs.writeFileSync(path.join(details, slug('k2') + '.html'), detailHtml('Bath Fitter of Nowhere', 'YOUNGSVILLE, LA 70592'));
    fs.writeFileSync(path.join(details, slug('k3') + '.html'), detailHtml('Pangolin Ridge Roofing Co', 'BROUSSARD, LA 70518'));
    /* the whole parish list is larger; only three were ever fetched */
    const all = rows.concat([{ key: 'k4', listCity: 'LAFAYETTE' }, { key: 'k5', listCity: 'LAFAYETTE' }]);
    fs.writeFileSync(path.join(dir, 'lslbc', 'index.json'), JSON.stringify({ all, wanted: rows }));
    const r = step('2-parse-records.js', dir, { PILOT_ZIPS: '70592' });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stdout, /parsed 1 records, 0 detail pages still missing, 1 outside 70592, 1 chains left out/);
    const recs = JSON.parse(fs.readFileSync(path.join(dir, 'records.json'), 'utf8'));
    assert.deepStrictEqual(recs.map(x => x.company), ['Quokka Lagoon Fencing LLC']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("step 3's printed next command is one that works", () => {
  const src = fs.readFileSync(path.join(PILOT, '3-website-candidates.js'), 'utf8');
  assert.match(src, /npm run pilot:audit/);
  assert.strictEqual(src.includes('node ../check-sites.js'), false);
});

/* ---------- no claim without a search; runnable from scratch ---------- */

const { websiteFinding } = require('../lib/website-finding.js');

function spineDir(records) {
  const dir = tmpArea();
  fs.writeFileSync(path.join(dir, 'spine.json'), JSON.stringify({ records }));
  return dir;
}

test('the shortlist runs with no Astra round yet, and never-searched stays unknown', () => {
  const dir = spineDir([record('Quokka Lagoon Fencing LLC'), record('Pangolin Ridge Roofing Co')]);
  try {
    const r = step('5-shortlist.js', dir);
    assert.strictEqual(r.status, 0, 'step 5 with no Astra round: ' + r.stderr);
    const rows = JSON.parse(fs.readFileSync(path.join(dir, 'spine.json'), 'utf8')).pilotShortlist.rows;
    assert.strictEqual(rows.length, 2);
    for (const row of rows) {
      assert.strictEqual(row.websiteState, 'unknown', 'nobody searched, so nothing is claimed');
      assert.strictEqual(websiteFinding(row.websiteState, null).text, '', 'and the letter has no website paragraph');
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('"not found" only when a search ran and came back empty; an errored lookup stays unknown', () => {
  const dir = spineDir([record('Quokka Lagoon Fencing LLC'), record('Pangolin Ridge Roofing Co'), record('Wombat Hollow Builders')]);
  try {
    fs.mkdirSync(path.join(dir, 'astra'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'astra', 'websites-round1.json'), JSON.stringify({ spent: 0.4, results: [
      { company: 'Quokka Lagoon Fencing LLC', city: 'Youngsville', website: 'not found', source: 'searched; nothing of theirs' },
      { company: 'Pangolin Ridge Roofing Co', city: 'Youngsville', website: 'not found', error: 'HTTP 500' }
    ] }));
    const r = step('5-shortlist.js', dir);
    assert.strictEqual(r.status, 0, r.stderr);
    const rows = JSON.parse(fs.readFileSync(path.join(dir, 'spine.json'), 'utf8')).pilotShortlist.rows;
    const by = Object.fromEntries(rows.map(x => [x.company, x.websiteState]));
    assert.strictEqual(by['Quokka Lagoon Fencing LLC'], 'not found', 'searched and empty');
    assert.strictEqual(by['Pangolin Ridge Roofing Co'], 'unknown', 'the lookup errored');
    assert.strictEqual(by['Wombat Hollow Builders'], 'unknown', 'never asked');
    assert.match(websiteFinding('not found', null).text, /couldn't find one/);
    assert.strictEqual(websiteFinding('unknown', null).text, '');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the merge runs with no round 2 yet and keeps unsearched companies unknown', () => {
  const dir = spineDir([record('Quokka Lagoon Fencing LLC'), record('Pangolin Ridge Roofing Co')]);
  try {
    assert.strictEqual(step('5-shortlist.js', dir).status, 0);
    const r = step('9-merge-astra.js', dir);
    assert.strictEqual(r.status, 0, 'step 9 with no round 2: ' + r.stderr);
    const rows = JSON.parse(fs.readFileSync(path.join(dir, 'spine.json'), 'utf8')).pilotShortlist.rows;
    assert.ok(rows.every(x => x.websiteState === 'unknown'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Astra targets: round 1 is the top 20 with no website of their own; round 2 is who is still unsearched', () => {
  const recs = [record('Quokka Lagoon Fencing LLC', { websiteCandidate: 'https://quokka.example.test/' }),
                record('Pangolin Ridge Roofing Co'), record('Wombat Hollow Builders')];
  const dir = spineDir(recs);
  try {
    let r = step('astra-targets.js', dir, {}, ['1']);
    assert.strictEqual(r.status, 0, r.stderr);
    const t1 = JSON.parse(fs.readFileSync(path.join(dir, 'astra', 'targets.json'), 'utf8'));
    assert.deepStrictEqual(t1.map(t => t.company).sort(), ['Pangolin Ridge Roofing Co', 'Wombat Hollow Builders']);
    assert.ok(t1.every(t => t.city === 'Youngsville' && Object.keys(t).length === 2), 'only name and town are sent');

    /* after round 1 asked Pangolin, round 2 wants only the one never asked */
    fs.writeFileSync(path.join(dir, 'astra', 'websites-round1.json'), JSON.stringify({ spent: 0.2, results: [
      { company: 'Pangolin Ridge Roofing Co', city: 'Youngsville', website: 'not found' }] }));
    assert.strictEqual(step('5-shortlist.js', dir).status, 0);
    r = step('astra-targets.js', dir, {}, ['2']);
    assert.strictEqual(r.status, 0, r.stderr);
    const t2 = JSON.parse(fs.readFileSync(path.join(dir, 'astra', 'targets.json'), 'utf8'));
    assert.deepStrictEqual(t2.map(t => t.company), ['Wombat Hollow Builders']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the audit wrapper skips a round with nothing to audit instead of failing', () => {
  const dir = tmpArea();
  try {
    const r = step('audit.js', dir, {}, ['astra', '2']);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stdout, /nothing to audit/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

/* ---------- the letter's location line ---------- */

test('a Bossier record says "here in Bossier City"; a Youngsville record says "here in Louisiana"', () => {
  const { letterHtml } = require('../finder/pilot/10-render-letters.js');
  const code = { ref: 'DEMO2026', url: 'https://coldenjames.com/p/DEMO2026?c=letter', printed: 'coldenjames.com/p/DEMO2026', image: 'data:image/png;base64,' };
  const row = { company: 'QUOKKA LAGOON FENCING LLC', rank: 1, websiteState: 'unknown', emailUsable: false };
  const bossier = letterHtml(row, record('Quokka Lagoon Fencing LLC', { foundVia: ['Bossier / Residential License Certificate'] }), code).html;
  const caddo = letterHtml(row, record('Quokka Lagoon Fencing LLC', { foundVia: ['Caddo / Home Improvement Registration'] }), code).html;
  const youngsville = letterHtml(row, record('Quokka Lagoon Fencing LLC'), code).html;
  assert.ok(bossier.includes("I'm Steven, here in Bossier City. I set up a simple fix for that."));
  assert.ok(caddo.includes("I'm Steven, here in Bossier City. I set up a simple fix for that."));
  assert.ok(youngsville.includes("I'm Steven, here in Louisiana. I set up a simple fix for that."));
  assert.strictEqual(youngsville.replace('here in Louisiana', 'here in Bossier City'), bossier,
    'nothing else in the letter differs');
  assert.strictEqual(AREA.hereIn({ foundVia: ['Caddo / x', 'Lafayette / y'] }), 'Louisiana', 'a mixed record is never mislabelled');
  assert.strictEqual(AREA.hereIn({}), 'Louisiana', 'no parish on record: the always-true line');
});
