'use strict';

/* Runs the website audit (finder/check-sites.js) on this run's own files,
   wherever PILOT_OUT_DIR points:

     node finder/pilot/audit.js            the company-domain candidates (step 3)
     node finder/pilot/audit.js astra 1    the websites Astra found in round 1
     node finder/pilot/audit.js astra 2    ... and in round 2

   A round whose Astra step found nothing, or has not run, is skipped with a
   note rather than failing: nothing to audit is not an error. */

const fs = require('fs');
const path = require('path');
const P = require('./lib/paths.js');

const [what, round] = process.argv.slice(2);
const dir = what === 'astra' ? P.astraAuditDir(round || '1') : P.auditIn;
const csv = path.join(dir, 'prospects.csv');
if (!fs.existsSync(csv)) {
  console.log('nothing to audit: no ' + path.relative(process.cwd(), csv) + ' yet');
  process.exit(0);
}
process.env.SHOP_CHECK_OUT_DIR = dir;
require('../check-sites.js').main().catch(err => {
  console.error('\nFailed: ' + (err && err.message ? err.message : err));
  process.exit(1);
});
