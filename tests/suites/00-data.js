'use strict';
/**
 * The shape of the data a fresh install produces.
 *
 * Numbered to run first, before any other suite has had a chance to change a
 * setting or approve a title: what it is checking is what `npm run db:setup`
 * leaves behind, not what the site looks like after it has been used.
 *
 * A broken reference or a child holding an interest they are not allowed to be
 * offered does not throw an error anywhere - it just quietly makes the site
 * wrong - so it is checked here instead.
 */
const fs = require('fs');
const path = require('path');

module.exports = {
  title: 'Data - a fresh install is coherent',
  async run({ dbName, t }) {
    process.env.DB_NAME = dbName;
    const db = require('../../server/db');
    const one = async (sql, params = []) => Number(Object.values((await db.queryOne(sql, params)))[0]);

    const none = async (label, sql, params) => {
      const n = await one(sql, params);
      t.check(label, n === 0, `${n} row(s)`);
    };

    await none('every title has at least one topic',
      'SELECT COUNT(*) n FROM content c WHERE NOT EXISTS (SELECT 1 FROM content_tags ct WHERE ct.content_id = c.content_id)');
    await none('every book has pages',
      "SELECT COUNT(*) n FROM content c WHERE c.content_type = 'BOOK' AND NOT EXISTS (SELECT 1 FROM content_pages p WHERE p.content_id = c.content_id)");
    await none('every title has cover art',
      "SELECT COUNT(*) n FROM content WHERE cover_image_url IS NULL OR cover_image_url = ''");
    await none('every title has an age rating', 'SELECT COUNT(*) n FROM content WHERE age_rating IS NULL');
    await none('no child is without a parent',
      "SELECT COUNT(*) n FROM users u WHERE u.role = 'CHILD' AND NOT EXISTS (SELECT 1 FROM parent_child_relationships r WHERE r.child_id = u.user_id)");
    await none('every child has a controls row',
      "SELECT COUNT(*) n FROM users u WHERE u.role = 'CHILD' AND NOT EXISTS (SELECT 1 FROM parental_controls p WHERE p.child_id = u.user_id)");
    await none('no review points at a missing title',
      'SELECT COUNT(*) n FROM feedback f WHERE NOT EXISTS (SELECT 1 FROM content c WHERE c.content_id = f.content_id)');
    await none('no review points at a missing account',
      'SELECT COUNT(*) n FROM feedback f WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.user_id = f.user_id)');
    await none('nobody has reviewed the same title twice',
      'SELECT COUNT(*) n FROM (SELECT user_id, content_id FROM feedback GROUP BY user_id, content_id HAVING COUNT(*) > 1) x');
    await none('every account has a password',
      "SELECT COUNT(*) n FROM users WHERE password IS NULL OR password = ''");
    await none('no email or login is used twice',
      'SELECT COUNT(*) n FROM (SELECT email FROM users WHERE email IS NOT NULL GROUP BY email HAVING COUNT(*) > 1) x');
    await none('staff hold no reading history',
      "SELECT COUNT(*) n FROM progress p JOIN users u ON u.user_id = p.user_id WHERE u.role IN ('ADMIN','LIBRARIAN')");
    await none('staff hold no interests',
      "SELECT COUNT(*) n FROM user_interests ui JOIN users u ON u.user_id = ui.user_id WHERE u.role IN ('ADMIN','LIBRARIAN')");
    await none('no child reviewed a title above their age cap',
      "SELECT COUNT(*) n FROM feedback f JOIN users u ON u.user_id = f.user_id JOIN parental_controls pc ON pc.child_id = u.user_id JOIN content c ON c.content_id = f.content_id WHERE u.role = 'CHILD' AND c.age_rating > pc.max_age");
    await none('no child holds an interest in a blocked genre',
      "SELECT COUNT(*) n FROM user_interests ui JOIN users u ON u.user_id = ui.user_id JOIN tags tg ON tg.tag_id = ui.tag_id JOIN child_blocked_genres b ON b.child_id = u.user_id AND b.blocked_genre = tg.tag_name");
    await none('no child holds an interest nothing in their library can answer',
      `SELECT COUNT(*) n FROM user_interests ui
         JOIN users u ON u.user_id = ui.user_id
         JOIN parental_controls pc ON pc.child_id = u.user_id
         JOIN tags tg ON tg.tag_id = ui.tag_id
        WHERE u.role = 'CHILD'
          AND NOT EXISTS (SELECT 1 FROM content c JOIN content_tags ct ON ct.content_id = c.content_id
                           WHERE ct.tag_id = tg.tag_id AND (c.age_rating IS NULL OR c.age_rating <= pc.max_age))`);
    await none('every title has been reviewed by somebody',
      'SELECT COUNT(*) n FROM content c WHERE NOT EXISTS (SELECT 1 FROM feedback f WHERE f.content_id = c.content_id)');

    // Cover art on disk, not only in the database.
    const covers = await db.query('SELECT cover_image_url FROM content');
    const missing = covers.filter((r) => {
      const u = r.cover_image_url || '';
      if (/^https?:/i.test(u)) return false;
      return !fs.existsSync(path.join(__dirname, '..', '..', 'public', u.replace(/^\//, '')));
    });
    t.check('every cover referenced exists on disk', missing.length === 0,
      missing.slice(0, 3).map((m) => m.cover_image_url));

  },
};
