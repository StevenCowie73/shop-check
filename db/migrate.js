'use strict';

/* Applies db/migrations/*.sql in order, skipping any already recorded in
   schema_migrations. Each file runs as one transaction.

     node db/migrate.js --confirm            over the Postgres protocol
     node db/migrate.js --https --confirm    over Neon's HTTPS endpoint

   The URL comes from COLDENJAMES_URL, COLDENJAMES_DATABASE_URL or
   DATABASE_URL, and is never printed. */

const fs = require('fs');
const path = require('path');
const { args, cliPool } = require('./importers/common.js');

const DIR = path.join(__dirname, 'migrations');

/* Our migrations are plain DDL: statements end with a semicolon at the end
   of a line, and BEGIN/COMMIT are supplied by the transaction itself. */
function statementsOf(sql) {
  return sql.replace(/--.*$/gm, '').split(/;\s*$/m).map(s => s.trim())
    .filter(s => s && !/^(BEGIN|COMMIT)$/i.test(s));
}

async function migrate(pool, log = console.log) {
  let done = new Set();
  try {
    done = new Set((await pool.query('SELECT version FROM schema_migrations')).rows.map(r => r.version));
  } catch (e) { /* first run: the table does not exist yet */ }
  for (const file of fs.readdirSync(DIR).filter(f => /^\d+_.*\.sql$/.test(f)).sort()) {
    const version = file.replace(/\.sql$/, '');
    if (done.has(version)) { log('already applied: ' + version); continue; }
    const stmts = statementsOf(fs.readFileSync(path.join(DIR, file), 'utf8'));
    if (pool.transaction) await pool.transaction(stmts);
    else {
      const c = await pool.connect();
      try { await c.query('BEGIN'); for (const s of stmts) await c.query(s); await c.query('COMMIT'); }
      catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
    }
    log('applied: ' + version + ' (' + stmts.length + ' statements)');
  }
}

module.exports = { migrate, statementsOf };

if (require.main === module) {
  migrate(cliPool(args(process.argv.slice(2)))).then(() => process.exit(0))
    .catch(e => { console.error(e.message); process.exit(1); });
}
