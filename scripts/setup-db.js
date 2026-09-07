#!/usr/bin/env node
'use strict';
/**
 * Creates the StoryNest database, loads the sample library, and creates the
 * demo accounts and the per-role test accounts described in INSTALLATION.md.
 *
 *   npm run db:setup    - refuses to run if the database already has accounts
 *   npm run db:reset    - drops and rebuilds it anyway
 *
 * Passwords are hashed here rather than being written into seed.sql, so no
 * plaintext-to-hash mapping is ever committed to the repository.
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

const config = require('../server/config');

const FORCE = process.argv.includes('--force') || process.argv.includes('-f');
const ROOT = path.join(__dirname, '..');

const DEMO_PASSWORDS = {
  admin: 'Admin123!',
  adult: 'Parent123!',
  child: 'storynest1',
};

// One plain account per role, with no parental restrictions on the child. The
// demo family above is deliberately restricted to show the filtering off; these
// are the known-good logins to test each role against.
const TEST_PASSWORDS = {
  admin: 'TestAdmin123!',
  adult: 'TestParent123!',
  child: 'testkid1',
};

function say(msg) { console.log(msg); }

/** A birthday `years` ago, as YYYY-MM-DD, so demo ages stay correct over time. */
function thisYearMinus(years) {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  d.setUTCMonth(0, 15);
  return d.toISOString().slice(0, 10);
}

async function run() {
  say('StoryNest database setup');
  say('------------------------');
  say(`Target: mysql://${config.db.user}@${config.db.host}:${config.db.port}/${config.db.database}\n`);

  let conn;
  try {
    conn = await mysql.createConnection({
      host: config.db.host,
      port: config.db.port,
      user: config.db.user,
      password: config.db.password,
      multipleStatements: true,
    });
  } catch (err) {
    console.error('Could not connect to MySQL.');
    console.error(`  ${err.message}\n`);
    console.error('Check that MySQL is running and that DB_USER / DB_PASSWORD in .env are right.');
    process.exit(1);
  }

  // Refuse to wipe a database that already has accounts, unless asked twice.
  const [dbs] = await conn.query('SHOW DATABASES LIKE ?', [config.db.database]);
  if (dbs.length && !FORCE) {
    const [tables] = await conn.query(
      `SELECT COUNT(*) AS n FROM information_schema.tables
        WHERE table_schema = ? AND table_name = 'users'`,
      [config.db.database],
    );
    if (tables[0].n > 0) {
      const [users] = await conn.query(`SELECT COUNT(*) AS n FROM \`${config.db.database}\`.users`);
      if (users[0].n > 0) {
        console.error(`Database "${config.db.database}" already exists and has ${users[0].n} account(s).`);
        console.error('Run `npm run db:reset` if you really want to drop it and start again.');
        await conn.end();
        process.exit(1);
      }
    }
  }

  say('1/3  Creating tables ...');
  await conn.query(fs.readFileSync(path.join(ROOT, 'database', 'schema.sql'), 'utf8'));

  say('2/3  Loading the sample library ...');
  await conn.query(fs.readFileSync(path.join(ROOT, 'database', 'seed.sql'), 'utf8'));

  say('3/3  Creating demo and test accounts ...');
  await conn.changeUser({ database: config.db.database });

  const [adminHash, adultHash, childHash] = await Promise.all([
    bcrypt.hash(DEMO_PASSWORDS.admin, 12),
    bcrypt.hash(DEMO_PASSWORDS.adult, 12),
    bcrypt.hash(DEMO_PASSWORDS.child, 12),
  ]);

  async function addUser(role, name, login, hash, dob, readingLevel = null) {
    const [res] = await conn.execute(
      `INSERT INTO users (role, name, email, password, dob, reading_level, parental_consent, account_status)
       VALUES (?, ?, ?, ?, ?, ?, TRUE, 'ACTIVE')`,
      [role, name, login, hash, dob, readingLevel],
    );
    return res.insertId;
  }

  const adminId = await addUser('ADMIN', 'Site Administrator', 'admin@storynest.local', adminHash, '1985-03-12');
  const parentId = await addUser('ADULT', 'Maya Tan', 'parent@storynest.local', adultHash, '1990-07-02');
  const parent2Id = await addUser('ADULT', 'Daniel Ortiz', 'daniel@storynest.local', adultHash, '1988-11-23');

  // Three children with deliberately different controls, so the parental-control
  // filtering is visible the moment you sign in as each of them.
  const leoId = await addUser('CHILD', 'Leo Tan', 'leo', childHash, thisYearMinus(8), 'BEGINNER');
  const adaId = await addUser('CHILD', 'Ada Tan', 'ada', childHash, thisYearMinus(11), 'INTERMEDIATE');
  const samId = await addUser('CHILD', 'Sam Ortiz', 'sam', childHash, thisYearMinus(6), 'BEGINNER');

  for (const [parent, child] of [[parentId, leoId], [parentId, adaId], [parent2Id, samId]]) {
    await conn.execute(
      'INSERT INTO parent_child_relationships (parent_id, child_id) VALUES (?, ?)', [parent, child],
    );
  }

  await conn.execute(
    `INSERT INTO parental_controls (child_id, max_age, daily_screen_limit, allow_content) VALUES
       (?, 8,  60, TRUE),
       (?, 12, 90, TRUE),
       (?, 6,  45, TRUE)`,
    [leoId, adaId, samId],
  );

  // Leo may not see mysteries; Ada may not see anything tagged Sci-Fi.
  await conn.execute(
    `INSERT INTO child_blocked_genres (child_id, blocked_genre) VALUES (?, 'Mystery'), (?, 'Sci-Fi')`,
    [leoId, adaId],
  );

  // ---------------------------------------------------------------------------
  // Test accounts - ADMIN, ADULT and CHILD, one each.
  // ---------------------------------------------------------------------------
  const [testAdminHash, testAdultHash, testChildHash] = await Promise.all([
    bcrypt.hash(TEST_PASSWORDS.admin, 12),
    bcrypt.hash(TEST_PASSWORDS.adult, 12),
    bcrypt.hash(TEST_PASSWORDS.child, 12),
  ]);

  await addUser('ADMIN', 'Test Admin', 'test.admin@storynest.local', testAdminHash, '1990-05-20');
  const testParentId = await addUser('ADULT', 'Test Parent', 'test.parent@storynest.local', testAdultHash, thisYearMinus(38));
  const testChildId = await addUser('CHILD', 'Test Kid', 'testkid', testChildHash, thisYearMinus(9), 'INTERMEDIATE');

  await conn.execute(
    'INSERT INTO parent_child_relationships (parent_id, child_id) VALUES (?, ?)',
    [testParentId, testChildId],
  );
  // A controls row with everything left open: the child is still filtered by
  // its own age, but nothing else is in the way.
  await conn.execute(
    `INSERT INTO parental_controls (child_id, max_age, daily_screen_limit, allow_content)
     VALUES (?, NULL, NULL, TRUE)`,
    [testChildId],
  );

  // Everything in the sample library was catalogued by the administrator.
  await conn.execute('UPDATE content SET created_by = ? WHERE created_by IS NULL', [adminId]);

  // A little history so the home page shelf and the ratings are not empty.
  await conn.execute(
    `INSERT INTO feedback (user_id, content_id, rating, review)
     SELECT ?, content_id, 5, 'We read this twice in one night. A keeper.'
       FROM content WHERE title = 'The Lantern of Little Hollow'`,
    [parentId],
  );
  await conn.execute(
    `INSERT INTO feedback (user_id, content_id, rating, review)
     SELECT ?, content_id, 4, 'Funny and short - good for a school night.'
       FROM content WHERE title = 'Pip and the Paper Dragon'`,
    [parent2Id],
  );
  await conn.execute(
    `INSERT INTO feedback (user_id, content_id, rating, review)
     SELECT ?, content_id, 5, 'I liked the robin best!'
       FROM content WHERE title = 'The Dinosaur Who Was Late'`,
    [leoId],
  );
  await conn.execute(
    `INSERT INTO progress (user_id, content_id, percentage_completed, last_position)
     SELECT ?, content_id, 100, 0 FROM content WHERE title IN
       ('The Lantern of Little Hollow', 'The Dinosaur Who Was Late', 'Moonboots')`,
    [leoId],
  );
  await conn.execute(
    `INSERT INTO progress (user_id, content_id, percentage_completed, last_position)
     SELECT ?, content_id, 45, 12 FROM content WHERE title = 'The Keeper of Lost Kites'`,
    [adaId],
  );
  await conn.execute(
    `INSERT INTO saved_content (user_id, content_id, list_type)
     SELECT ?, content_id, 'FAVORITE' FROM content WHERE title = 'Moonboots'`,
    [leoId],
  );

  // A pending request so the parent dashboard has something to approve.
  await conn.execute(
    `INSERT INTO content_requests (user_id, content_id)
     SELECT ?, content_id FROM content WHERE title = 'Detective Duckling'`,
    [leoId],
  );
  await conn.execute(
    `INSERT INTO notifications (user_id, title, message)
     VALUES (?, 'New content request', 'Leo Tan asked to unlock "Detective Duckling".')`,
    [parentId],
  );

  await conn.execute(
    `INSERT INTO announcements (title, message, user_id)
     VALUES ('Welcome to StoryNest', 'New titles are added every week. Happy reading!', ?)`,
    [adminId],
  );

  const [counts] = await conn.query(
    `SELECT (SELECT COUNT(*) FROM content) AS content,
            (SELECT COUNT(*) FROM tags) AS tags,
            (SELECT COUNT(*) FROM users) AS users`,
  );

  await conn.end();

  say('\nDone.');
  say(`  ${counts[0].users} accounts, ${counts[0].content} titles, ${counts[0].tags} tags.\n`);
  say('Demo sign-ins');
  say('-------------');
  say(`  Administrator  admin@storynest.local   /  ${DEMO_PASSWORDS.admin}`);
  say(`  Adult          parent@storynest.local  /  ${DEMO_PASSWORDS.adult}   (Leo + Ada)`);
  say(`  Adult          daniel@storynest.local  /  ${DEMO_PASSWORDS.adult}   (Sam)`);
  say(`  Child          leo                     /  ${DEMO_PASSWORDS.child}   (age 8, no mysteries)`);
  say(`  Child          ada                     /  ${DEMO_PASSWORDS.child}   (age 11, no sci-fi)`);
  say(`  Child          sam                     /  ${DEMO_PASSWORDS.child}   (age 6)`);
  say('\nTest accounts (one per role, no restrictions)');
  say('---------------------------------------------');
  say(`  Administrator  test.admin@storynest.local   /  ${TEST_PASSWORDS.admin}`);
  say(`  Adult          test.parent@storynest.local  /  ${TEST_PASSWORDS.adult}   (Test Kid)`);
  say(`  Child          testkid                      /  ${TEST_PASSWORDS.child}         (age 9)`);
  say('\nChange these before showing the app to anyone outside your team.');
  say('Start the server with:  npm start\n');
}

run().catch((err) => {
  console.error('\nSetup failed:', err.message);
  if (err.sql) console.error('While running:', String(err.sql).slice(0, 200));
  process.exit(1);
});
