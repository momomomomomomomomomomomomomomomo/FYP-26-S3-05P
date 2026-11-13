'use strict';
/**
 * A paused library.
 *
 * When a parent switches content off, the shelf used to come back empty: a
 * child saw a blank page and had nothing to act on. Now they see the library
 * and every cover is locked, and opening one is the existing request flow.
 *
 * The thing to be careful about is that "shows it" and "hands it over" have
 * come apart. This suite checks both halves: the shelf really does list the
 * titles, and nothing else about them has loosened.
 *
 * It flips a real child's controls through the parent's own endpoint and puts
 * them back in a finally, so the suites that run before it are unaffected and
 * a failure here does not leave the account paused.
 */
const { signedIn } = require('../helpers');

module.exports = {
  title: 'A paused library - visible, locked, askable',
  async run({ base, dbName, t }) {
    process.env.DB_NAME = dbName;
    const db = require('../../server/db');

    const parent = await signedIn(base, 'adult');
    const child = await signedIn(base, 'child2');

    const row = await db.queryOne("SELECT user_id FROM users WHERE email = 'ada'");
    const childId = Number(row.user_id);

    const before = await db.queryOne(
      'SELECT max_age, daily_screen_limit, allow_content FROM parental_controls WHERE child_id = ?',
      [childId],
    );
    const blockedBefore = (await db.query(
      'SELECT blocked_genre FROM child_blocked_genres WHERE child_id = ?', [childId],
    )).map((r) => r.blocked_genre);

    // What the age and genre rules alone allow, which a pause must not widen.
    const maxAge = before && before.max_age !== null ? Number(before.max_age) : 99;
    const passesRules = new Set((await db.query(
      `SELECT c.content_id FROM content c
        WHERE (c.age_rating IS NULL OR c.age_rating <= ?)
          AND NOT EXISTS (
            SELECT 1 FROM content_tags ct
              JOIN tags tg ON tg.tag_id = ct.tag_id
              JOIN child_blocked_genres b ON b.child_id = ? AND b.blocked_genre = tg.tag_name
             WHERE ct.content_id = c.content_id)`,
      [maxAge, childId],
    )).map((r) => Number(r.content_id)));

    const approved = new Set((await db.query(
      "SELECT content_id FROM content_requests WHERE user_id = ? AND status = 'APPROVED'",
      [childId],
    )).map((r) => Number(r.content_id)));

    try {
      // --- the parent pauses the library ---------------------------------
      const paused = await parent.put(`/api/children/${childId}/controls`, {
        max_age: before ? before.max_age : null,
        daily_screen_limit: before ? before.daily_screen_limit : null,
        allow_content: false,
        blocked_genres: blockedBefore,
      });
      t.check('a parent can pause the library', paused.status === 200, paused.body);

      // --- the child still has a library ----------------------------------
      const shelf = await child.get('/api/content?limit=300');
      t.check('the shelf is not emptied by a pause',
        shelf.status === 200 && shelf.body.items.length > 0,
        `HTTP ${shelf.status}, ${shelf.body && shelf.body.items.length} items`);

      // A shelf hides nothing now: age limits and blocked categories lock a
      // cover rather than removing it, exactly as a pause does. `passesRules`
      // is kept so the next check can prove the lock lands on the right rows.
      const everyTitle = await db.queryOne('SELECT COUNT(*) AS n FROM content');
      t.check('the shelf lists the whole catalogue, not a filtered slice',
        shelf.body.total === Number(everyTitle.n),
        { listed: shelf.body.total, catalogue: Number(everyTitle.n) });

      t.check('and a title the age and genre rules already allowed is still listed',
        shelf.body.items.some((i) => passesRules.has(Number(i.content_id))));

      const lockedItems = shelf.body.items.filter((i) => i.locked);
      t.check('the covers are marked locked', lockedItems.length > 0, lockedItems.length);
      t.check('while paused, everything not approved by name is locked',
        shelf.body.items.every((i) => i.locked === !approved.has(Number(i.content_id))),
        shelf.body.items.filter((i) => i.locked === approved.has(Number(i.content_id)))
          .map((i) => i.title).slice(0, 5));

      // --- but locked means locked ----------------------------------------
      const probe = lockedItems[0];
      const detail = await child.get(`/api/content/${probe.content_id}`);
      t.check('opening a locked title is refused', detail.status === 403, `HTTP ${detail.status}`);
      t.check('and the refusal offers the request flow',
        detail.body && detail.body.details && detail.body.details.canRequest === true,
        detail.body);
      t.check('and names the title so the child knows what they are asking for',
        detail.body && detail.body.details && detail.body.details.title === probe.title,
        detail.body && detail.body.details);

      const pages = await child.get(`/api/content/${probe.content_id}/pages`);
      t.check('a locked book hands over no text', pages.status === 403, `HTTP ${pages.status}`);
      t.check('a locked title cannot be opened for reading',
        (await child.post(`/api/content/${probe.content_id}/open`)).status === 403);
      t.check('a locked title cannot be reviewed',
        (await child.post(`/api/content/${probe.content_id}/feedback`,
          { rating: 5, review: 'nice' })).status === 403);

      // --- and the child can ask -------------------------------------------
      const ask = await child.post('/api/me/requests',
        { content_id: probe.content_id, note: 'please?' });
      t.check('the child can ask a grown-up to unlock it', ask.status < 300, ask.body);

      const pending = await parent.get('/api/children/requests');
      t.check('the request reaches the parent',
        JSON.stringify(pending.body).includes(String(probe.content_id)), pending.status);

      // --- the quiet surfaces stay quiet ------------------------------------
      for (const [path, label] of [
        ['/api/content/top-picks', 'recommendations'],
        ['/api/content/reviews/recent?limit=50', 'recent reviews'],
      ]) {
        const res = await child.get(path);
        const ids = JSON.stringify(res.body).match(/"content_id":(\d+)/g) || [];
        const leaked = ids.map((s) => Number(s.split(':')[1]))
          .filter((id) => !approved.has(id));
        t.check(`${label} still suggest only unlocked titles`, leaked.length === 0,
          leaked.slice(0, 6));
      }

      const session = await child.post('/api/chat/sessions');
      const sid = session.body && session.body.session_id;
      if (sid) {
        let leaked = 0;
        for (const message of ['recommend me something', 'I want an adventure',
          'list every book you have']) {
          const res = await child.post(`/api/chat/sessions/${sid}/messages`, { message });
          const ids = (JSON.stringify(res.body).match(/"content_id":(\d+)/g) || [])
            .map((s) => Number(s.split(':')[1]))
            .filter((id) => !approved.has(id));
          if (ids.length) leaked += 1;
        }
        t.check('Story Chat never names a locked title', leaked === 0, `${leaked} probes leaked`);
      }
      // --- blocking every category must store every category ---------------
      // The two controls routes used to cut the list to the first 30 without
      // saying so. With 36 categories in the catalogue, "Block everything"
      // saved 30 and silently lost 6, and the parent found six boxes unticked
      // when they came back. The count is read from the catalogue rather than
      // written here, so adding categories cannot quietly reintroduce it.
      const allCategories = (await db.query('SELECT tag_name FROM tags'))
        .map((x) => x.tag_name);

      const blockAll = await parent.put(`/api/children/${childId}/controls`, {
        max_age: before ? before.max_age : null,
        daily_screen_limit: before ? before.daily_screen_limit : null,
        allow_content: false,
        blocked_genres: allCategories,
      });
      t.check(`blocking all ${allCategories.length} categories is accepted`,
        blockAll.status === 200, blockAll.body);

      const stored = (await db.query(
        'SELECT blocked_genre FROM child_blocked_genres WHERE child_id = ?', [childId],
      )).map((x) => x.blocked_genre);
      t.check('and every one of them is stored',
        stored.length === allCategories.length
        && allCategories.every((g) => stored.includes(g)),
        { sent: allCategories.length, stored: stored.length,
          missing: allCategories.filter((g) => !stored.includes(g)) });

      // And the parent's own view reads them all back.
      const readBack = await parent.get('/api/children');
      const kid = (readBack.body.children || readBack.body.items || [])
        .find((k) => Number(k.user_id) === childId);
      t.check('and the family page reads all of them back',
        kid && kid.controls.blocked_genres.length === allCategories.length,
        kid && kid.controls.blocked_genres.length);

      // Far too many is refused rather than trimmed.
      const silly = await parent.put(`/api/children/${childId}/controls`, {
        allow_content: false,
        blocked_genres: Array.from({ length: 300 }, (_, i) => `Category ${i}`),
      });
      t.check('an absurd list is refused, not quietly cut down', silly.status === 400,
        `HTTP ${silly.status}`);
    } finally {
      // Put the account back exactly as it was.
      await parent.put(`/api/children/${childId}/controls`, {
        max_age: before ? before.max_age : null,
        daily_screen_limit: before ? before.daily_screen_limit : null,
        allow_content: before ? !!before.allow_content : true,
        blocked_genres: blockedBefore,
      });
      await db.execute(
        "DELETE FROM content_requests WHERE user_id = ? AND status = 'PENDING'", [childId],
      );
    }
  },
};
