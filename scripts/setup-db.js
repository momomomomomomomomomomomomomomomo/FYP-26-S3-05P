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
const { importBooks } = require('../database/import-books');
const { seedCommunity } = require('../database/seed-community');

const FORCE = process.argv.includes('--force') || process.argv.includes('-f');
// A managed database - Appwrite, RDS and the like - is provisioned for you and
// the account you are given usually cannot DROP or CREATE a database at all.
// With --managed the schema is loaded into the database that is already there
// and those two statements are left out. It still drops every table it owns,
// so it is every bit as destructive as the normal run.
const MANAGED = process.argv.includes('--managed');
const ROOT = path.join(__dirname, '..');

const DEMO_PASSWORDS = {
  admin: 'Admin123!',
  librarian: 'Librarian123!',
  adult: 'Parent123!',
  child: 'storynest1',
};

// One plain account per role, with no parental restrictions on the child. The
// demo family above is deliberately restricted to show the filtering off; these
// are the known-good logins to test each role against.
const TEST_PASSWORDS = {
  admin: 'TestAdmin123!',
  librarian: 'TestLibrarian123!',
  adult: 'TestParent123!',
  child: 'testkid1',
};

function say(msg) { console.log(msg); }

/**
 * A birthday that makes a demo child `years` old, counted from a fixed point
 * rather than from today.
 *
 * Counting from today would keep the ages looking right forever, but it also
 * means two installations built on different days hold different dates, and a
 * database exported from one machine no longer matches one built on another.
 * The ages here are pinned instead, and every demo child carries an explicit
 * age cap, so what each child can see does not depend on the calendar.
 */
const REFERENCE_YEAR = 2026;

/**
 * Reads one of the SQL files, pointing it at the configured database.
 *
 * The .sql files name `storynest` directly in their DROP/CREATE/USE lines so
 * that they can also be run by hand through the mysql client. That would
 * otherwise ignore DB_NAME: on a machine using a different name the schema
 * would build `storynest` and the rest of this script would then fail against
 * an empty one. Rewriting those three statements keeps both routes working.
 */
function sqlFile(name) {
  const sql = fs.readFileSync(path.join(ROOT, 'database', name), 'utf8');
  const db = config.db.database;
  if (!/^[A-Za-z0-9_$]+$/.test(db)) {
    throw new Error(`DB_NAME "${db}" is not a usable MySQL database name.`);
  }
  return sql
    .replace(/DROP\s+DATABASE\s+IF\s+EXISTS\s+`?[A-Za-z0-9_$]+`?\s*;/gi,
      MANAGED ? '' : `DROP DATABASE IF EXISTS \`${db}\`;`)
    .replace(/CREATE\s+DATABASE\s+`?[A-Za-z0-9_$]+`?[^;]*;/gi,
      MANAGED ? '' : `CREATE DATABASE \`${db}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`)
    .replace(/^\s*USE\s+`?[A-Za-z0-9_$]+`?\s*;/gim,
      `USE \`${db}\`;`);
}

function thisYearMinus(years) {
  return `${REFERENCE_YEAR - years}-01-15`;
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
      // Carried over from config so that seeding a managed database works the
      // same way the app's own pool connects to it.
      ...(config.db.ssl ? { ssl: config.db.ssl } : {}),
      multipleStatements: true,
    });
  } catch (err) {
    console.error('Could not connect to MySQL.');
    console.error(`  ${err.message}\n`);
    console.error('Check that MySQL is running and that DB_USER / DB_PASSWORD in .env are right.');
    process.exit(1);
  }

  // On a managed database the schema goes into what is already provisioned, so
  // the connection has to be pointed at it before anything runs.
  if (MANAGED) await conn.changeUser({ database: config.db.database });

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

  say('1/5  Creating tables ...');
  await conn.query(sqlFile('schema.sql'));

  say('2/5  Loading the sample library ...');
  await conn.query(sqlFile('seed.sql'));

  say('3/5  Creating demo and test accounts ...');
  await conn.changeUser({ database: config.db.database });

  const [adminHash, librarianHash, adultHash, childHash] = await Promise.all([
    bcrypt.hash(DEMO_PASSWORDS.admin, 12),
    bcrypt.hash(DEMO_PASSWORDS.librarian, 12),
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
  const librarianId = await addUser('LIBRARIAN', 'Nora Bexley', 'librarian@storynest.local',
    librarianHash, '1987-09-04');
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

  // What each demo reader has said they like. Story Chat answers an open
  // request - "recommend me something" - from this list, so the demo accounts
  // need one for the feature to show itself. None of these crosses the age cap
  // or the blocked genre set just above: Leo has no Mystery, Ada no Sci-Fi.
  //
  // The assignments themselves happen after the books are in. Half of these
  // topics only exist as tags once database/books/ has been imported, and a
  // name with no tag behind it inserts nothing at all.
  async function setInterests(userId, tagNames) {
    for (const tagName of tagNames) {
      await conn.execute(
        `INSERT IGNORE INTO user_interests (user_id, tag_id)
         SELECT ?, tag_id FROM tags WHERE tag_name = ?`,
        [userId, tagName],
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Test accounts - ADMIN, ADULT and CHILD, one each.
  // ---------------------------------------------------------------------------
  const [testAdminHash, testLibrarianHash, testAdultHash, testChildHash] = await Promise.all([
    bcrypt.hash(TEST_PASSWORDS.admin, 12),
    bcrypt.hash(TEST_PASSWORDS.librarian, 12),
    bcrypt.hash(TEST_PASSWORDS.adult, 12),
    bcrypt.hash(TEST_PASSWORDS.child, 12),
  ]);

  await addUser('ADMIN', 'Test Admin', 'test.admin@storynest.local', testAdminHash, '1990-05-20');
  await addUser('LIBRARIAN', 'Test Librarian', 'test.librarian@storynest.local',
    testLibrarianHash, '1991-02-14');
  const testParentId = await addUser('ADULT', 'Test Parent', 'test.parent@storynest.local', testAdultHash, thisYearMinus(38));
  const testChildId = await addUser('CHILD', 'Test Kid', 'testkid', testChildHash, thisYearMinus(9), 'INTERMEDIATE');

  await conn.execute(
    'INSERT INTO parent_child_relationships (parent_id, child_id) VALUES (?, ?)',
    [testParentId, testChildId],
  );
  // No screen limit and nothing blocked, so this account is the uncluttered
  // one to demonstrate with. The age cap is written out as the child's own age
  // rather than left NULL: a NULL cap makes the app fall back to an age worked
  // out from the birthday against today's date, which would creep upward in an
  // exported copy. Stating it keeps the account's view the same on any date.
  await conn.execute(
    `INSERT INTO parental_controls (child_id, max_age, daily_screen_limit, allow_content)
     VALUES (?, 9, NULL, TRUE)`,
    [testChildId],
  );

  // The books that ship with their pages written: database/books/.
  say('4/5  Adding the full-text books ...');
  const imported = await importBooks(conn, { createdBy: librarianId });

  // The catalogue is the librarian's work, so the sample library is theirs.
  await conn.execute('UPDATE content SET created_by = ? WHERE created_by IS NULL', [librarianId]);

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

  // A couple of reactions so "How was it?" is not empty on a fresh install.
  await conn.execute(
    `INSERT INTO content_reactions (user_id, content_id, emoji)
     SELECT ?, content_id, '\u{1F602}' FROM content WHERE title = 'The Dinosaur Who Was Late'`,
    [leoId],
  );
  await conn.execute(
    `INSERT INTO content_reactions (user_id, content_id, emoji)
     SELECT ?, content_id, '\u{1F60D}' FROM content WHERE title = 'Moonboots'`,
    [leoId],
  );
  await conn.execute(
    `INSERT INTO content_reactions (user_id, content_id, emoji)
     SELECT ?, content_id, '\u{1F914}' FROM content WHERE title = 'The Keeper of Lost Kites'`,
    [adaId],
  );

  // The parent landing page reads audit_logs, and the history above was written
  // straight into the tables, so give it matching entries to show.
  const activity = [
    [leoId, parentId, 'CONTENT_COMPLETE', 'Finished a title', 'Moonboots'],
    [leoId, parentId, 'FEEDBACK', 'Reviewed a title (5/5)', 'The Dinosaur Who Was Late'],
    [leoId, parentId, 'CONTENT_REQUEST', 'Asked to unlock a title', 'Detective Duckling'],
    [adaId, parentId, 'CONTENT_OPEN', 'Opened a title', 'The Keeper of Lost Kites'],
    [samId, parent2Id, 'CONTENT_OPEN', 'Opened a title', 'Bedtime Lullabies'],
  ];
  for (const [childId, parentOf, type, description, title] of activity) {
    await conn.execute(
      `INSERT INTO audit_logs (user_id, parent_id, content_id, actor_role, activity_type, description)
       SELECT ?, ?, content_id, 'CHILD', ?, ? FROM content WHERE title = ?`,
      [childId, parentOf, type, description, title],
    );
  }

  await conn.execute(
    `INSERT INTO announcements (title, message, user_id)
     VALUES ('Welcome to StoryNest', 'New titles are added every week. Happy reading!', ?)`,
    [adminId],
  );

  // A library with no readers in it looks unfinished. This adds demo families,
  // reviews on every title, and the reading history behind those reviews.
  await setInterests(leoId, ['Dinosaurs', 'Space', 'Animals']);
  await setInterests(adaId, ['Fantasy', 'Mystery', 'Art']);
  await setInterests(samId, ['Animals', 'Food', 'Friendship']);
  await setInterests(parentId, ['Nature', 'History']);
  await setInterests(parent2Id, ['Humour', 'Ocean']);
  await setInterests(testChildId, ['Robots', 'Science']);
  await setInterests(testParentId, ['Adventure', 'Poetry']);

  say('5/5  Filling the library with readers ...');
  const community = await seedCommunity(conn);

  const [counts] = await conn.query(
    `SELECT (SELECT COUNT(*) FROM content) AS content,
            (SELECT COUNT(*) FROM tags) AS tags,
            (SELECT COUNT(*) FROM users) AS users`,
  );

  await conn.end();

  say('\nDone.');
  say(`  ${counts[0].users} accounts, ${counts[0].content} titles, ${counts[0].tags} tags.`);
  say(`  ${imported.total} of those titles are full books, with ${imported.pages} pages of text.`);
  say(`  ${community.reviews} reviews from ${community.adults} demo families `
    + `(${community.children} children).\n`);
  say('Demo sign-ins');
  say('-------------');
  say(`  Administrator  admin@storynest.local   /  ${DEMO_PASSWORDS.admin}`);
  say(`  Librarian      librarian@storynest.local  /  ${DEMO_PASSWORDS.librarian}  (the catalogue)`);
  say(`  Adult          parent@storynest.local  /  ${DEMO_PASSWORDS.adult}   (Leo + Ada)`);
  say(`  Adult          daniel@storynest.local  /  ${DEMO_PASSWORDS.adult}   (Sam)`);
  say(`  Child          leo                     /  ${DEMO_PASSWORDS.child}   (age 8, no mysteries)`);
  say(`  Child          ada                     /  ${DEMO_PASSWORDS.child}   (age 11, no sci-fi)`);
  say(`  Child          sam                     /  ${DEMO_PASSWORDS.child}   (age 6)`);
  say('\nTest accounts (one per role, no restrictions)');
  say('---------------------------------------------');
  say(`  Administrator  test.admin@storynest.local   /  ${TEST_PASSWORDS.admin}`);
  say(`  Librarian      test.librarian@storynest.local  /  ${TEST_PASSWORDS.librarian}`);
  say(`  Adult          test.parent@storynest.local  /  ${TEST_PASSWORDS.adult}   (Test Kid)`);
  say(`  Child          testkid                      /  ${TEST_PASSWORDS.child}         (age 9)`);
  say(`  Demo families      *.@example.com              /  Reader123!   (reviews only)`);
  say('\nChange these before showing the app to anyone outside your team.');
  say('Covers for the full books are generated separately, and are committed to the');
  say('repository already:  npm run books:covers\n');
  say('Start the server with:  npm start\n');
}

run().catch((err) => {
  console.error('\nSetup failed:', err.message);
  if (err.sql) console.error('While running:', String(err.sql).slice(0, 200));
  process.exit(1);
});
