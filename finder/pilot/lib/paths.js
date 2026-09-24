'use strict';

/* Every path the pilot reads or writes, in one place.

   Everything lives under finder/pilot/out/, which is git-ignored. Nothing
   this pipeline produces belongs in the repository: it is all real business
   names, addresses, phone numbers and email addresses taken from a public
   licence register, and the repository is public. */

const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = process.env.PILOT_OUT_DIR || path.join(ROOT, 'out');
const at = (...parts) => path.join(OUT, ...parts);

module.exports = {
  ROOT,
  OUT,
  at,

  /* 1-2  the licence register walk */
  lslbcIndex: at('lslbc', 'index.json'),
  lslbcDetails: at('lslbc', 'details'),
  crawlLog: at('lslbc', 'crawl.log'),
  records: at('records.json'),

  /* 3-4  website candidates, their audit, and the spine built from both */
  candidates: at('records-with-candidates.json'),
  auditIn: at('audit'),
  auditCsv: at('audit', 'prospects.csv'),
  auditJson: at('audit', 'site-audit.json'),
  spine: at('spine.json'),
  exclusions: at('exclusions.json'),

  /* 5-9  the shortlist and the Astra rounds */
  astraTargets: at('astra', 'targets.json'),
  astraRaw: round => at('astra', 'raw-round' + round),
  astraWebsites: round => at('astra', 'websites-round' + round + '.json'),
  astraAuditDir: round => at('astra', 'audit-round' + round),
  astraAuditCsv: round => at('astra', 'audit-round' + round, 'prospects.csv'),
  astraAuditJson: round => at('astra', 'audit-round' + round, 'site-audit.json'),

  /* the reference codes printed on the letters — append-only, never reissued */
  refs: at('refs.json'),

  /* 10  the letters */
  fontsDir: at('letters', 'fonts'),
  fontCss: at('letters', 'plex.css'),
  lettersHtml: at('letters', 'letters.html'),
  lettersPdf: at('pilot-letters.pdf'),
  lettersTable: at('letters', 'table.json')
};
