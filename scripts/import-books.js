#!/usr/bin/env node
'use strict';
/**
 * Adds the books in database/books/ to a database that already exists, without
 * touching accounts, progress or anything else.
 *
 *   npm run books:import
 *
 * Safe to run repeatedly: a book already in the catalogue is refreshed in
 * place, and its pages are rewritten from the files.
 */
const db = require('../server/db');
const { importBooks } = require('../database/import-books');

(async () => {
  console.log('Importing books from database/books/\n');

  // Credit the catalogue to a librarian where there is one - it is their job.
  const owner = await db.queryOne(
    `SELECT user_id FROM users WHERE role = 'LIBRARIAN' AND account_status = 'ACTIVE'
      ORDER BY user_id LIMIT 1`,
  );

  const result = await importBooks(db.pool, {
    createdBy: owner ? owner.user_id : null,
    log: (line) => console.log(line),
  });

  console.log(`\n${result.inserted} added, ${result.updated} refreshed, `
    + `${result.pages} pages written, ${result.videos} videos given artwork.`);
  if (!owner) console.log('No librarian account found, so the books have no catalogued-by owner.');
  console.log('Covers: node scripts/make-covers.js\n');
  await db.pool.end();
})().catch(async (err) => {
  console.error('\nImport failed:', err.message);
  if (err.sql) console.error('While running:', String(err.sql).slice(0, 200));
  process.exit(1);
});
