'use strict';
/**
 * The pages of a book: the librarian writes them, the reader reads them, and
 * nobody else touches them.
 *
 * This suite creates its own book and removes it again at the end, so it does
 * not leave a textless title behind for the data suite to object to.
 */
const { signedIn, client } = require('../helpers');

module.exports = {
  title: 'Book pages - writing the text of a book',
  async run({ base, t }) {
    const librarian = await signedIn(base, 'librarian');
    const adult = await signedIn(base, 'adult');
    const admin = await signedIn(base, 'admin');
    const guest = client(base);

    const made = await librarian.post('/api/catalog/content', {
      content_type: 'BOOK',
      title: 'A Suite Of Pages',
      description: 'Added by the test suite to check the page editor.',
      age_rating: 5,
      reading_level: 'BEGINNER',
      tags: [],
    });
    t.check('a librarian can add a book', made.status === 201, made.body);
    const id = made.body && made.body.content_id;
    if (!id) return;

    try {
      // --- a new book has no text yet -------------------------------------
      let r = await librarian.get(`/api/catalog/content/${id}/pages`);
      t.check('a book arrives with no pages', r.status === 200 && r.body.pages.length === 0,
        r.body);
      t.check('the editor is told the limits it has to work within',
        r.body.max_pages > 0 && r.body.max_body > 0, r.body);

      r = await librarian.get('/api/catalog/page-counts');
      const counts = new Map((r.body.counts || []).map((c) => [c.content_id, c.pages]));
      t.check('the shelf summary shows the new book at zero pages', counts.get(id) === 0,
        counts.get(id));

      r = await librarian.get('/api/catalog/stats');
      t.check('the overview counts a book with no text', r.body.totals.textless >= 1,
        r.body.totals);

      // --- writing the text ------------------------------------------------
      r = await librarian.put(`/api/catalog/content/${id}/pages`, {
        pages: [
          { heading: 'The beginning', body: 'One paragraph.\n\nAnd a second.', illustration: '🦊' },
          { body: 'A page with no heading and no picture.' },
          { heading: 'The end', body: 'Last page.', illustration: '🌙' },
        ],
      });
      t.check('three pages are saved', r.status === 200 && r.body.pages === 3, r.body);

      r = await librarian.get(`/api/catalog/content/${id}/pages`);
      t.check('they come back numbered 1, 2, 3',
        r.body.pages.map((p) => p.page_number).join(',') === '1,2,3', r.body.pages);
      t.check('a heading is kept', r.body.pages[0].heading === 'The beginning', r.body.pages[0]);
      t.check('an illustration is kept', r.body.pages[0].illustration === '🦊', r.body.pages[0]);
      t.check('the blank line between paragraphs survives the round trip',
        r.body.pages[0].body === 'One paragraph.\n\nAnd a second.', r.body.pages[0].body);
      t.check('a page left without a heading stays without one',
        r.body.pages[1].heading === null, r.body.pages[1]);

      // Removing the middle page must renumber, not leave a hole: the table
      // has a unique key on (content_id, page_number).
      r = await librarian.put(`/api/catalog/content/${id}/pages`, {
        pages: [
          { heading: 'The beginning', body: 'One paragraph.', illustration: '🦊' },
          { heading: 'The end', body: 'Last page.', illustration: '🌙' },
        ],
      });
      t.check('a page can be removed', r.status === 200 && r.body.pages === 2, r.body);
      r = await librarian.get(`/api/catalog/content/${id}/pages`);
      t.check('and what is left is renumbered 1, 2',
        r.body.pages.map((p) => p.page_number).join(',') === '1,2', r.body.pages);

      r = await librarian.get('/api/catalog/page-counts');
      const after = new Map((r.body.counts || []).map((c) => [c.content_id, c.pages]));
      t.check('the shelf summary follows the edit', after.get(id) === 2, after.get(id));

      // --- the reader now has a book to read --------------------------------
      r = await adult.get(`/api/content/${id}/pages`);
      t.check('a reader is served the text', r.status === 200 && r.body.has_text === true, r.body);
      t.check('a reader gets every page', r.body.pages.length === 2, r.body.pages);
      t.check('and gets paragraphs rather than raw text',
        Array.isArray(r.body.pages[0].paragraphs) && r.body.pages[0].paragraphs.length === 1,
        r.body.pages[0]);

      // --- only a librarian may write them ----------------------------------
      for (const [who, c] of [['a reader', adult], ['an administrator', admin],
        ['a visitor', guest]]) {
        const res = await c.put(`/api/catalog/content/${id}/pages`, { pages: [] });
        t.check(`${who} may not rewrite a book`, res.status === 401 || res.status === 403,
          `HTTP ${res.status}`);
      }
      for (const [who, c] of [['a reader', adult], ['an administrator', admin],
        ['a visitor', guest]]) {
        const res = await c.get(`/api/catalog/content/${id}/pages`);
        t.check(`${who} cannot read the editor's copy`,
          res.status === 401 || res.status === 403, `HTTP ${res.status}`);
      }

      // --- bad input ---------------------------------------------------------
      r = await librarian.put(`/api/catalog/content/${id}/pages`, { pages: [{ body: '   ' }] });
      t.check('a page with nothing on it is refused', r.status === 400, r.body);
      t.check('and the refusal says which page', /Page 1/.test(JSON.stringify(r.body)), r.body);

      for (const [label, payload] of [
        ['a payload that is not a list', { pages: 'nope' }],
        ['a missing payload', {}],
        ['a page that is not an object', { pages: ['just a string'] }],
      ]) {
        const res = await librarian.put(`/api/catalog/content/${id}/pages`, payload);
        t.check(`${label} is refused`, res.status === 400, `HTTP ${res.status}`);
      }

      r = await librarian.put(`/api/catalog/content/${id}/pages`,
        { pages: [{ body: 'fine' }, { body: 'x'.repeat(9000) }] });
      t.check('an over-long page is refused', r.status === 400, r.body);
      r = await librarian.get(`/api/catalog/content/${id}/pages`);
      t.check('and a rejected save writes nothing at all, not even the good page',
        r.body.pages.length === 2, r.body.pages);

      r = await librarian.put(`/api/catalog/content/${id}/pages`,
        { pages: Array.from({ length: 400 }, () => ({ body: 'x' })) });
      t.check('far too many pages is refused', r.status === 400, r.body);

      t.check('pages for a title that does not exist is a 404',
        (await librarian.put('/api/catalog/content/999999/pages', { pages: [] })).status === 404);

      // --- a video is not a book --------------------------------------------
      const video = await librarian.post('/api/catalog/content',
        { content_type: 'VIDEO', title: 'A Suite Of Frames', tags: [] });
      const videoId = video.body && video.body.content_id;
      if (videoId) {
        r = await librarian.put(`/api/catalog/content/${videoId}/pages`,
          { pages: [{ body: 'a video has no pages' }] });
        t.check('a video cannot be given pages', r.status === 400, r.body);
        r = await librarian.get('/api/catalog/page-counts');
        t.check('and the shelf summary counts books only',
          !(r.body.counts || []).some((c) => c.content_id === videoId), videoId);
        await librarian.del(`/api/catalog/content/${videoId}`);
      }

      // --- clearing the text is a decision, not an accident ------------------
      r = await librarian.put(`/api/catalog/content/${id}/pages`, { pages: [] });
      t.check('the text can be taken off a book', r.status === 200 && r.body.pages === 0, r.body);
      r = await librarian.get(`/api/catalog/content/${id}/pages`);
      t.check('and it really is gone', r.body.pages.length === 0, r.body.pages);

      // --- it is on the record ----------------------------------------------
      r = await admin.get('/api/admin/logs?limit=80');
      const types = (r.body.items || r.body.logs || []).map((i) => i.activity_type);
      t.check('rewriting a book is written to the audit trail',
        types.includes('CONTENT_PAGES_UPDATE'), types.slice(0, 10));
    } finally {
      // The data suite checks that every book has pages, so this one must not
      // leave an empty book on the shelf.
      await librarian.del(`/api/catalog/content/${id}`);
    }
  },
};
