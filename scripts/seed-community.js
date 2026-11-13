#!/usr/bin/env node
'use strict';
/**
 * Populates the library with demo families, reviews, reading progress,
 * reactions and favourites, so the site looks like somewhere people already
 * use rather than an empty shell.
 *
 *   npm run seed:community            rebuild the community
 *   npm run seed:community -- --reset remove it and stop
 *
 * Safe to run repeatedly: it clears any previous demo community first, and the
 * whole thing runs in one transaction, so a failure part-way leaves the
 * database exactly as it was rather than half-populated.
 */
const db = require('../server/db');
const { seedCommunity, clearCommunity } = require('../database/seed-community');

const RESET_ONLY = process.argv.includes('--reset');

(async () => {
  const conn = await db.pool.getConnection();
  try {
    await conn.beginTransaction();

    if (RESET_ONLY) {
      const cleared = await clearCommunity(conn);
      await conn.commit();
      console.log(`Removed ${cleared.adults} demo famil${cleared.adults === 1 ? 'y' : 'ies'} `
        + `and ${cleared.children} children, with everything they wrote.\n`);
      return;
    }

    console.log('Seeding the community ...');
    const r = await seedCommunity(conn, { log: (l) => console.log(l) });
    await conn.commit();

    console.log(`\n  ${r.reviews} reviews across ${r.titles} titles`);
    console.log(`  ${r.progress} reading-progress rows, ${r.reactions} reactions, `
      + `${r.favourites} favourites`);
    console.log('\nDemo families share the password Reader123! and exist only to make the library');
    console.log('look lived in. Remove them with:  npm run seed:community -- --reset\n');
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
})().then(() => db.pool.end()).catch(async (err) => {
  console.error('\nSeeding failed, nothing was changed:', err.message);
  if (err.sql) console.error('While running:', String(err.sql).slice(0, 160));
  await db.pool.end();
  process.exit(1);
});
