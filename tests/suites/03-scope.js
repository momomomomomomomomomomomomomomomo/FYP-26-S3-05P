'use strict';
/**
 * What a restricted child can see.
 *
 * This is the suite that matters most: everything else is about the site
 * working, this is about it not showing a child something their grown-up has
 * ruled out. It computes the allowed set straight from the rules and then
 * checks every endpoint that returns titles against it.
 */
const { client, signedIn } = require('../helpers');

module.exports = {
  title: 'Scope - what a restricted child may see',
  async run({ base, dbName, t }) {
    process.env.DB_NAME = dbName;
    const db = require('../../server/db');

    const child = await signedIn(base, 'child');
    const row = await db.queryOne("SELECT user_id FROM users WHERE email = 'leo'");
    const childId = row.user_id;

    const allowedRows = await db.query(
      `SELECT c.content_id
         FROM content c
         JOIN parental_controls pc ON pc.child_id = ?
        WHERE pc.allow_content = TRUE
          AND (c.age_rating IS NULL OR c.age_rating <= pc.max_age)
          AND NOT EXISTS (
            SELECT 1 FROM content_tags ct
              JOIN tags tg ON tg.tag_id = ct.tag_id
              JOIN child_blocked_genres b ON b.child_id = ? AND b.blocked_genre = tg.tag_name
             WHERE ct.content_id = c.content_id)`,
      [childId, childId],
    );
    // A title a parent has unlocked by name is visible whatever the controls
    // say, so it belongs in the allowed set too.
    const approvedRows = await db.query(
      "SELECT content_id FROM content_requests WHERE user_id = ? AND status = 'APPROVED'",
      [childId],
    );
    const allowed = new Set([
      ...allowedRows.map((x) => Number(x.content_id)),
      ...approvedRows.map((x) => Number(x.content_id)),
    ]);
    const every = (await db.query('SELECT content_id FROM content')).map((x) => Number(x.content_id));
    const forbidden = every.filter((id) => !allowed.has(id));

    t.check(`the rules allow ${allowed.size} of ${every.length} titles, so there is something to hide`,
      forbidden.length > 0);

    const idsIn = (value) => {
      const found = [];
      const walk = (v) => {
        if (Array.isArray(v)) return v.forEach(walk);
        if (v && typeof v === 'object') {
          if (v.content_id !== undefined) found.push(Number(v.content_id));
          Object.values(v).forEach(walk);
        }
        return undefined;
      };
      walk(value);
      return [...new Set(found)];
    };

    // Everything that *suggests* a title must stay inside the scope. The
    // library grid is the one exception and is checked separately below: it
    // lists the whole catalogue so a child can ask for what they cannot open.
    for (const [path, label] of [
      ['/api/content/top-picks', 'the recommendations'],
      ['/api/content/reviews/recent?limit=50', 'the recent reviews'],
      ['/api/me/saved', 'their saved list'],
      ['/api/me/progress', 'their reading list'],
    ]) {
      const res = await child.get(path);
      const out = idsIn(res.body).filter((id) => !allowed.has(id));
      t.check(`${label} shows nothing out of scope`, res.status === 200 && out.length === 0,
        out.length ? `out of scope: ${out.slice(0, 6).join(', ')}` : `HTTP ${res.status}`);
    }

    // --- the shelf lists everything, and locks what it may not open ---------
    // Seeing a title and being handed it are different things now. The shelf
    // is allowed to show a forbidden title; what it must never do is show it
    // unlocked, or let the child open it.
    const shelf = await child.get('/api/content?limit=300');
    t.check('the library listing shows the whole catalogue',
      shelf.status === 200 && shelf.body.total === every.length,
      { total: shelf.body && shelf.body.total, catalogue: every.length });

    const mislabelled = shelf.body.items.filter(
      (i) => i.locked === allowed.has(Number(i.content_id)));
    t.check('every title on it is locked exactly when the gate would refuse it',
      mislabelled.length === 0,
      mislabelled.slice(0, 5).map((i) => `${i.title} locked=${i.locked}`));

    t.check('and there is something locked to prove the flag is doing work',
      shelf.body.items.some((i) => i.locked) && shelf.body.items.some((i) => !i.locked));

    // Unlocked first, in one list. A child should not have to scroll past what
    // their grown-up locked to reach their own books.
    const order = shelf.body.items.map((i) => (i.locked ? 1 : 0));
    const firstLocked = order.indexOf(1);
    t.check('the shelf puts everything unlocked before everything locked',
      firstLocked === -1 || !order.slice(firstLocked).includes(0),
      { firstLockedAt: firstLocked, strayUnlockedAfter: order.slice(firstLocked).indexOf(0) });

    for (const by of ['title', 'newest', 'age', 'shortest']) {
      const sorted = await child.get(`/api/content?limit=300&sort=${by}`);
      const flags = sorted.body.items.map((i) => (i.locked ? 1 : 0));
      const at = flags.indexOf(1);
      t.check(`sorting by ${by} still keeps the unlocked ones first`,
        at === -1 || !flags.slice(at).includes(0), `stray unlocked after index ${at}`);
    }

    // The flag is a label, not the enforcement. Try to open what it marked.
    const lockedOnShelf = shelf.body.items.filter((i) => i.locked).slice(0, 10);
    let opened = 0;
    for (const item of lockedOnShelf) {
      const detail = await child.get(`/api/content/${item.content_id}`);
      const pages = await child.get(`/api/content/${item.content_id}/pages`);
      if (detail.status === 200 || pages.status === 200) opened += 1;
    }
    t.check('nothing the shelf marked locked can actually be opened', opened === 0,
      `${opened} of ${lockedOnShelf.length} opened`);

    // --- the filter shows every category, and names none of them as blocked --
    // A child can work out what is blocked by looking at a locked cover. What
    // the site must not do is tell them: not by shortening their filter, and
    // not by handing the page a list of their parent's choices.
    const blocked = (await db.query(
      'SELECT blocked_genre FROM child_blocked_genres WHERE child_id = ?', [childId],
    )).map((r) => r.blocked_genre);
    t.check(`${blocked.length} categor${blocked.length === 1 ? 'y is' : 'ies are'} blocked, `
      + 'so there is something to not say', blocked.length > 0);

    const everyTag = await db.query('SELECT tag_name FROM tags');
    const theirTags = await child.get('/api/content/tags');
    const names = (theirTags.body.items || []).map((x) => x.tag_name);
    t.check('a child is offered every category in the catalogue',
      theirTags.status === 200 && everyTag.every((x) => names.includes(x.tag_name)),
      everyTag.filter((x) => !names.includes(x.tag_name)).map((x) => x.tag_name));
    t.check('including the ones blocked for them',
      blocked.every((g) => names.includes(g)),
      blocked.filter((g) => !names.includes(g)));
    t.check('and nothing in the list says which those are',
      !/block|lock|denied|forbidden|restricted/i.test(JSON.stringify(theirTags.body)));

    // The scope the page is handed must not carry the list either.
    const me = await child.get('/api/auth/me');
    const scopeJson = JSON.stringify(me.body.scope || {});
    t.check('the scope sent to a child does not list their blocked categories',
      !('blockedGenres' in (me.body.scope || {})), Object.keys(me.body.scope || {}));
    t.check('and no blocked category name appears anywhere in it',
      blocked.every((g) => !scopeJson.includes(g)), scopeJson.slice(0, 160));

    // Filtering by a blocked category is allowed, and simply turns up locked
    // titles - which is the honest answer, not a refusal that confirms it.
    const byBlocked = await child.get(
      `/api/content?tag=${encodeURIComponent(blocked[0])}&limit=50`);
    t.check(`filtering by "${blocked[0]}" is answered normally`, byBlocked.status === 200,
      `HTTP ${byBlocked.status}`);
    // Locked, except where a parent unlocked that exact title by name, which
    // overrides the category the same way it overrides every other rule.
    const approvedIds = new Set(approvedRows.map((x) => Number(x.content_id)));
    const wronglyOpen = byBlocked.body.items
      .filter((i) => !i.locked && !approvedIds.has(Number(i.content_id)));
    t.check('and everything it returns is locked, bar titles unlocked by name',
      byBlocked.body.items.length > 0 && wronglyOpen.length === 0,
      wronglyOpen.map((i) => i.title).slice(0, 4));
    t.check('a title unlocked by name stays open even in a blocked category',
      byBlocked.body.items.some((i) => !i.locked && approvedIds.has(Number(i.content_id)))
      || ![...approvedIds].length,
      [...approvedIds]);

    // Asking for a forbidden title directly, by id.
    let reachable = 0;
    for (const id of forbidden.slice(0, 15)) {
      const detail = await child.get(`/api/content/${id}`);
      const pages = await child.get(`/api/content/${id}/pages`);
      if (detail.status === 200 || pages.status === 200) reachable += 1;
    }
    t.check('a forbidden title cannot be opened by guessing its id', reachable === 0,
      `${reachable} of ${Math.min(15, forbidden.length)} were reachable`);

    // The chat must not name one either.
    const session = await child.post('/api/chat/sessions');
    const sid = session.body && session.body.session_id;
    if (sid) {
      const probes = ['show me a mystery', 'anything for grown ups', 'list every book you have',
        'I want something scary', 'recommend me something'];
      let leaked = 0;
      for (const message of probes) {
        const res = await child.post(`/api/chat/sessions/${sid}/messages`, { message });
        const ids = idsIn(res.body).filter((id) => every.includes(id) && !allowed.has(id));
        if (ids.length) leaked += 1;
      }
      t.check('Story Chat never returns a title outside the scope', leaked === 0,
        `${leaked} of ${probes.length} probes leaked`);
    }

    // A guest sees the public catalogue but not the text of a whole book.
    const guest = client(base);
    const g = await guest.get('/api/content/81/pages');
    t.check('a guest cannot pull a whole book',
      g.status === 200 && g.body.pages.length < g.body.total_pages);

  },
};
