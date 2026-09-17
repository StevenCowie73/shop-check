'use strict';

/* One CSV writer. There were three, one per script, and they had already
   started to drift. Each script still owns its own column list. */

function csvCell(value) {
  let s = value === null || value === undefined ? '' : String(value);
  /* stop a spreadsheet treating a cell as a formula */
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}


/* columns is [[header, row => value], ...] */
function toCsv(columns, rows) {
  const lines = [columns.map(c => csvCell(c[0])).join(',')];
  for (const r of rows) lines.push(columns.map(c => csvCell(c[1](r))).join(','));
  return '\ufeff' + lines.join('\r\n') + '\r\n';   /* BOM keeps Excel happy */
}

module.exports = { csvCell, toCsv };
