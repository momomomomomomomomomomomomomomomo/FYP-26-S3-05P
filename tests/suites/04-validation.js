'use strict';
/** Input the site should refuse, and refuse politely rather than by crashing. */
const { signedIn } = require('../helpers');

module.exports = {
  title: 'Validation - bad input is refused, not swallowed',
  async run({ base, t }) {
    const child = await signedIn(base, 'child');
    const librarian = await signedIn(base, 'librarian');
    const BIG = 'A'.repeat(20000);

    // --- identifiers ---------------------------------------------------------
    for (const id of ['abc', '-1', '0', 'null', '1 OR 1=1', '%00']) {
      const r = await child.get(`/api/content/${encodeURIComponent(id)}`);
      t.check(`id "${id}" is rejected or missing, never a server error`,
        r.status === 400 || r.status === 404, `HTTP ${r.status}`);
    }

    // --- numbers out of range -------------------------------------------------
    for (const [label, path, body] of [
      ['a rating of 99', '/api/content/81/feedback', { rating: 99, review: 'x' }],
      ['a rating of -5', '/api/content/81/feedback', { rating: -5, review: 'x' }],
      ['a rating of "five"', '/api/content/81/feedback', { rating: 'five', review: 'x' }],
      ['progress of 500%', '/api/content/81/progress', { percentage_completed: 500, last_position: 0 }],
    ]) {
      const method = path.endsWith('progress') ? 'put' : 'post';
      const r = await child[method](path, body);
      t.check(`${label} is refused`, r.status === 400, `HTTP ${r.status}`);
    }
    t.check('an impossible screen-time report is refused',
      (await child.post('/api/me/screen-time', { minutes: 1e9 })).status === 400);

    // --- oversized ------------------------------------------------------------
    t.check('a 20k review is refused',
      [400, 413].includes((await child.post('/api/content/81/feedback', { rating: 5, review: BIG })).status));
    t.check('a 20k title is refused',
      (await librarian.post('/api/catalog/content', { content_type: 'BOOK', title: BIG })).status === 400);

    // --- links ------------------------------------------------------------------
    // A link goes straight into an href, so only the web schemes are allowed.
    for (const link of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)', 'file:///etc/passwd']) {
      const r = await librarian.post('/api/catalog/content',
        { content_type: 'BOOK', title: `Link probe ${link.slice(0, 12)}`, external_link: link });
      t.check(`a ${link.split(':')[0]}: link is refused`, r.status === 400, `HTTP ${r.status}`);
    }
    const good = await librarian.post('/api/catalog/content',
      { content_type: 'BOOK', title: 'Link probe https', external_link: 'https://example.org/x' });
    t.check('an https link is accepted', good.status < 300, good.body);
    if (good.body && good.body.content_id) await librarian.del(`/api/catalog/content/${good.body.content_id}`);

    const csv = 'content_type,title,external_link\nBOOK,Bulk link probe,javascript:alert(1)';
    const imported = await librarian.post('/api/catalog/content/import', { csv });
    const refusedInImport = imported.body && Array.isArray(imported.body.failed)
      && imported.body.failed.length === 1 && imported.body.imported === 0;
    t.check('the bulk import refuses the same link', refusedInImport, imported.body);

    // --- shapes -------------------------------------------------------------------
    t.check('an empty review body is refused',
      (await child.post('/api/content/81/feedback', {})).status === 400);
    t.check('interests must be a list',
      (await child.put('/api/me/interests', { interests: 'notalist' })).status === 400);
    t.check('an unknown interest is refused',
      (await child.put('/api/me/interests', { interests: ['NotARealTopic'] })).status === 400);
    t.check('too many interests are refused',
      (await child.put('/api/me/interests', { interests: Array(999).fill('Space') })).status === 400);

    // A malformed payload must not quietly wipe what was saved.
    await child.put('/api/me/interests', { interests: ['Space', 'Dinosaurs'] });
    await child.put('/api/me/interests', { interests: 'notalist' });
    const after = await child.get('/api/me/interests');
    t.check('a malformed payload leaves saved interests alone',
      after.body.interests.length === 2, after.body.interests);
    t.check('an empty list still clears them',
      (await child.put('/api/me/interests', { interests: [] })).status === 200);

    // --- other people's things -------------------------------------------------------
    t.check('someone else’s chat is not readable',
      [403, 404].includes((await child.get('/api/chat/sessions/999999/messages')).status));

    // --- the 404 page ------------------------------------------------------------------
    const missing = await fetch(`${base}/this-page-does-not-exist`);
    t.check('an unknown page answers 404, not the home page', missing.status === 404,
      `HTTP ${missing.status}`);
    const api404 = await fetch(`${base}/api/nope`);
    t.check('an unknown endpoint answers 404 as JSON', api404.status === 404);
  },
};
