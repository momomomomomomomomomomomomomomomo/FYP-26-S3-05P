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

    for (const [path, label] of [
      ['/api/content?limit=300', 'the library listing'],
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
