#!/usr/bin/env node
'use strict';
/**
 * The test runner.
 *
 *   npm test                 build a throwaway database, run every suite, tidy up
 *   npm test -- permissions  run one suite
 *   npm test -- --keep       leave the database and server up afterwards
 *
 * It never touches the database named in .env. It builds its own, named by
 * TEST_DB_NAME (default `storynest_test`), runs the suites against a server of
 * its own on TEST_PORT (default 3999), and drops the database at the end -
 * which is what makes it safe to run destructive checks like "can a librarian
 * actually delete a title".
 */
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

require('dotenv').config();

const ROOT = path.join(__dirname, '..');
const DB_NAME = process.env.TEST_DB_NAME || 'storynest_test';
const PORT = Number(process.env.TEST_PORT || 3999);
const BASE = `http://127.0.0.1:${PORT}`;
const KEEP = process.argv.includes('--keep');
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));

const env = { ...process.env, DB_NAME, PORT: String(PORT), NODE_ENV: 'test' };
// Suites that talk to the database directly share one pool, opened against the
// throwaway database and closed once, here, when everything has finished.
process.env.DB_NAME = DB_NAME;

function run(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: ROOT, env, stdio: 'pipe', ...options });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(out))));
  });
}

async function waitForServer(ms = 20000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('server did not start');
}

(async () => {
  let server = null;
  let failed = 0;
  let passed = 0;

  const cleanup = async () => {
    if (server && !server.killed) server.kill();
    if (!KEEP) {
      const db = require('../server/db');
      try {
        await db.pool.query(`DROP DATABASE IF EXISTS \`${DB_NAME}\``);
      } catch { /* nothing to drop */ }
      await db.pool.end().catch(() => {});
    }
  };

  try {
    process.stdout.write(`Building ${DB_NAME} ... `);
    await run(process.execPath, [path.join('scripts', 'setup-db.js'), '--force']);
    process.stdout.write('done\n');

    server = spawn(process.execPath, [path.join('server', 'index.js')],
      { cwd: ROOT, env, stdio: 'ignore' });
    await waitForServer();
    process.stdout.write(`Server on ${BASE}\n\n`);

    const dir = path.join(__dirname, 'suites');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort();
    for (const file of files) {
      const name = file.replace(/\.js$/, '');
      // Files are numbered so they run in a fixed order; `npm test -- scope`
      // should still find 03-scope without anyone having to type the number.
      const shortName = name.replace(/^\d+-/, '');
      if (only.length && !only.includes(name) && !only.includes(shortName)) continue;
      const suite = require(path.join(dir, file));
      process.stdout.write(`${suite.title || name}\n`);
      const results = [];
      const t = {
        check(label, ok, detail) {
          results.push({ label, ok: !!ok, detail });
          if (ok) { passed += 1; process.stdout.write(`  ok   ${label}\n`); }
          else {
            failed += 1;
            process.stdout.write(`  FAIL ${label}\n`);
            if (detail !== undefined) {
              const d = typeof detail === 'string' ? detail : JSON.stringify(detail);
              process.stdout.write(`       ${String(d).slice(0, 300)}\n`);
            }
          }
        },
      };
      try {
        await suite.run({ base: BASE, dbName: DB_NAME, t });
      } catch (err) {
        failed += 1;
        process.stdout.write(`  FAIL suite threw: ${err.message}\n`);
      }
      process.stdout.write('\n');
    }
  } catch (err) {
    process.stdout.write(`\nCould not run the tests: ${err.message}\n`);
    await cleanup();
    process.exit(1);
  }

  await cleanup();
  process.stdout.write(`${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})();
