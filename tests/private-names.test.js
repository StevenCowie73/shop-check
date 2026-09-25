'use strict';

/* The name check has to see prospect data wherever a pilot run for any area
   put it — not only the pilot's original eight files. Every name here is
   invented. */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'check-private-names.js');
const INVENTED = 'Quokka Lagoon Fencing LLC';
const PERSON = 'Barnaby Wexcombe';

function fakeArea(dir) {
  fs.mkdirSync(path.join(dir, 'astra'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'records.json'), JSON.stringify([
    { company: INVENTED, qualifyingParties: [PERSON], classifications: [{ qualifyingParty: PERSON }] }
  ]));
  fs.writeFileSync(path.join(dir, 'astra', 'targets.json'), JSON.stringify([{ company: 'Pangolin Ridge Roofing Co', city: 'Nowhere' }]));
}

function run(args, env) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...env } });
}

test('a name from a pilot run in PILOT_OUT_DIR is caught in a file being checked', () => {
  const area = fs.mkdtempSync(path.join(os.tmpdir(), 'shop-check-area-'));
  const code = fs.mkdtempSync(path.join(os.tmpdir(), 'shop-check-code-'));
  try {
    fakeArea(area);
    const leaky = path.join(code, 'leaky.js');
    const clean = path.join(code, 'clean.js');
    const asked = path.join(code, 'asked.md');
    fs.writeFileSync(leaky, '// for example, Quokka Lagoon Fencing wants a website\n');
    fs.writeFileSync(clean, '// for example, an invented fence company wants a website\n');
    fs.writeFileSync(asked, 'We asked about Pangolin Ridge Roofing.\n');

    const bad = run(['--files', leaky], { PILOT_OUT_DIR: area });
    assert.strictEqual(bad.status, 1, 'refused: ' + bad.stdout + bad.stderr);
    assert.match(bad.stderr, /COMMIT REFUSED/);
    assert.match(bad.stderr, /Quokka Lagoon Fencing/);

    const alsoBad = run(['--files', asked], { PILOT_OUT_DIR: area });
    assert.strictEqual(alsoBad.status, 1, 'names in astra/targets.json count too');

    const good = run(['--files', clean], { PILOT_OUT_DIR: area });
    assert.strictEqual(good.status, 0, good.stderr);
    assert.match(good.stdout, /private names checked against the named files/);
  } finally {
    fs.rmSync(area, { recursive: true, force: true });
    fs.rmSync(code, { recursive: true, force: true });
  }
});

test('any area folder under finder/pilot/out/ is read, with no setting at all', () => {
  const area = path.join(ROOT, 'finder', 'pilot', 'out', '__name-check-test-area__');
  const code = fs.mkdtempSync(path.join(os.tmpdir(), 'shop-check-code-'));
  try {
    fakeArea(area);
    const leaky = path.join(code, 'leaky.js');
    fs.writeFileSync(leaky, 'const example = "Barnaby Wexcombe";\n');
    const r = run(['--files', leaky], { PILOT_OUT_DIR: '' });
    assert.strictEqual(r.status, 1, 'a qualifying party found in a nested area folder is refused');
    assert.match(r.stderr, /Barnaby Wexcombe/);
  } finally {
    fs.rmSync(area, { recursive: true, force: true });
    fs.rmSync(code, { recursive: true, force: true });
  }
});
