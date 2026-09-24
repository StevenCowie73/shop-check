#!/usr/bin/env node
'use strict';

/* Points git at hooks/ so the pre-commit check is version controlled rather
   than living in .git/hooks where nobody can see it and a fresh clone would
   never get it. */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const hooks = path.join(ROOT, 'hooks');
if (!fs.existsSync(path.join(hooks, 'pre-commit'))) {
  console.error('no hooks/pre-commit to install');
  process.exit(1);
}
fs.chmodSync(path.join(hooks, 'pre-commit'), 0o755);
execSync('git config core.hooksPath hooks', { cwd: ROOT, stdio: 'inherit' });
console.log('git hooks installed: core.hooksPath = hooks');
console.log('pre-commit now refuses any commit containing a real prospect name.');
console.log('check it yourself any time:  node scripts/check-private-names.js --all');
