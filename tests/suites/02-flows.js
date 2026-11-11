'use strict';
/** The things a user actually does, end to end. */
const { client, signedIn } = require('../helpers');

module.exports = {
  title: 'Flows - what each kind of user does',
  async run({ base, t }) {
    const guest = client(base);
    const child = await signedIn(base, 'child');
    const adult = await signedIn(base, 'adult');
    const librarian = await signedIn(base, 'librarian');
    const admin = await signedIn(base, 'admin');

    // --- browsing ----------------------------------------------------------
    let r = await guest.get('/api/content?limit=10');
    t.check('guest can browse the library', r.status === 200 && r.body.items.length > 0, r.status);

    r = await child.get('/api/content?q=dinosaur&limit=10');
    const matches = r.body.items.every((i) => /dinosaur/i
      .test(`${i.title} ${i.description || ''} ${(i.tags || []).join(' ')}`));
    t.check('search narrows to matches', r.status === 200 && r.body.items.length > 0 && matches,
      r.body && r.body.items && r.body.items.map((i) => i.title));

    r = await child.get('/api/content?q=zzzzznothinglikethis');
    t.check('a search with no matches returns nothing, not everything',
      r.status === 200 && r.body.items.length === 0, `${r.body && r.body.items && r.body.items.length} items`);

    r = await child.get('/api/content?type=VIDEO&limit=10');
    t.check('format filter works',
      r.status === 200 && r.body.items.every((i) => i.content_type === 'VIDEO'));

    r = await child.get('/api/content?tag=Space&limit=10');
    t.check('topic filter works',
      r.status === 200 && r.body.items.every((i) => (i.tags || []).includes('Space')));

    // --- guest preview ------------------------------------------------------
    r = await guest.get('/api/content/81/pages');
    t.check('a guest gets a capped preview, not the book',
      r.status === 200 && r.body.preview === true && r.body.pages.length === 4
      && r.body.total_pages > 4, r.body && { preview: r.body.preview, sent: r.body.pages.length });

    r = await child.get('/api/content/81/pages');
    t.check('a reader gets the whole book',
      r.status === 200 && r.body.preview === false
      && r.body.pages.length === r.body.total_pages, r.body && r.body.pages.length);

    // A librarian writes the pages, so a librarian can read them all. An
    // administrator has no cataloguing duty and stays on the preview.
    r = await librarian.get('/api/content/81/pages');
    t.check('a librarian gets the whole book, to check it',
      r.status === 200 && r.body.preview === false
      && r.body.pages.length === r.body.total_pages,
      r.body && { preview: r.body.preview, sent: r.body.pages.length });

    r = await admin.get('/api/content/81/pages');
    t.check('an administrator gets the preview only',
      r.status === 200 && r.body.preview === true && r.body.pages.length === 4,
      r.body && { preview: r.body.preview, sent: r.body.pages.length });

    // Reading the whole book buys a librarian none of the reading itself.
    t.check('a librarian still cannot open a title',
      (await librarian.post('/api/content/81/open')).status === 403);
    t.check('a librarian still cannot save a reading position',
      (await librarian.put('/api/content/81/progress',
        { percentage_completed: 100, last_position: 20 })).status === 403);
    t.check('a librarian still has no badges',
      (await librarian.get('/api/me/badges')).status === 403);

    // --- saving and reading -------------------------------------------------
    t.check('add a favourite', (await child.post('/api/me/saved',
      { content_id: 81, list_type: 'FAVORITE' })).status < 300);
    r = await child.get('/api/me/saved?list=FAVORITE');
    t.check('the favourite is listed',
      r.body.items.some((i) => Number(i.content_id) === 81));
    t.check('remove it again', (await child.del('/api/me/saved/81?list=FAVORITE')).status === 200);

    t.check('open a title', (await child.post('/api/content/81/open')).status === 200);
    t.check('save a reading position', (await child.put('/api/content/81/progress',
      { percentage_completed: 40, last_position: 4 })).status === 200);
    r = await child.get('/api/me/progress');
    t.check('the position comes back',
      r.body.items.some((i) => Number(i.content_id) === 81));

    // --- reviews and reactions ---------------------------------------------
    t.check('leave a review', (await child.post('/api/content/81/feedback',
      { rating: 5, review: 'Test review.' })).status < 300);
    t.check('leave a reaction', (await child.put('/api/content/81/reaction',
      { emoji: '\u{1F60D}' })).status === 200);
    t.check('withdraw the review', (await child.del('/api/content/81/feedback')).status === 200);

    // --- a child asks, a parent decides -------------------------------------
    const blockedId = 16; // Sci-Fi, which Ada is blocked from and Leo is too young for
    r = await child.post('/api/me/requests', { content_id: blockedId, note: 'please' });
    t.check('a child can ask for a title to be unlocked', r.status < 300, r.body);
    r = await adult.get('/api/children/requests');
    const request = r.body && r.body.items && r.body.items[0];
    t.check('the parent sees the request', r.status === 200 && !!request, r.body);
    if (request) {
      r = await adult.post(`/api/children/requests/${request.request_id}/decision`,
        { decision: 'APPROVED' });
      t.check('the parent can approve it', r.status === 200, r.body);
      r = await child.get(`/api/content/${blockedId}`);
      t.check('the child can now open it', r.status === 200, r.status);
    }

    // --- parental controls ---------------------------------------------------
    r = await adult.get('/api/children');
    const kid = r.body && r.body.items && r.body.items[0];
    t.check('the parent lists their children', r.status === 200 && !!kid);
    if (kid) {
      r = await adult.put(`/api/children/${kid.user_id}/controls`,
        { max_age: 10, daily_screen_limit: 45, allow_content: true, blocked_genres: ['Mystery'] });
      t.check('the parent can change the controls', r.status === 200, r.body);
      t.check('the activity feed loads', (await adult.get('/api/children/activity')).status === 200);
    }

    // --- the catalogue --------------------------------------------------------
    r = await librarian.post('/api/catalog/content',
      { content_type: 'BOOK', title: 'Test Suite Title', description: 'Temporary.', age_rating: 7, tags: ['Science'] });
    const newId = r.body && r.body.content_id;
    t.check('a librarian can add a title', r.status < 300 && !!newId, r.body);
    if (newId) {
      t.check('and edit it', (await librarian.put(`/api/catalog/content/${newId}`,
        { title: 'Test Suite Title (edited)' })).status === 200);
      t.check('and remove it', (await librarian.del(`/api/catalog/content/${newId}`)).status === 200);
    }
    t.check('catalogue statistics load', (await librarian.get('/api/catalog/stats')).status === 200);

    // The catalogue dashboard keeps books and videos on separate tabs, each
    // with its own search box, so it leans on type and q working together.
    const books = await librarian.get('/api/content?type=BOOK&limit=300&sort=title');
    const videos = await librarian.get('/api/content?type=VIDEO&limit=300&sort=title');
    t.check('the book shelf holds only books',
      books.status === 200 && books.body.items.length > 0
      && books.body.items.every((i) => i.content_type === 'BOOK'),
      books.body && books.body.items && books.body.items.length);
    t.check('the video shelf holds only videos',
      videos.status === 200 && videos.body.items.length > 0
      && videos.body.items.every((i) => i.content_type === 'VIDEO'),
      videos.body && videos.body.items && videos.body.items.length);
    t.check('the two shelves together are the whole catalogue',
      books.body.total + videos.body.total === (await librarian.get('/api/content?limit=1')).body.total,
      `${books.body.total} + ${videos.body.total}`);

    const byTitle = await librarian.get('/api/content?type=BOOK&q=dinosaur&limit=300');
    t.check('searching a shelf by title narrows it',
      byTitle.body.items.length > 0 && byTitle.body.items.length < books.body.total
      && byTitle.body.items.every((i) => i.content_type === 'BOOK'),
      byTitle.body.items.map((i) => i.title));

    const byCategory = await librarian.get('/api/content?type=BOOK&q=Pirates&limit=300');
    t.check('searching a shelf by category narrows it',
      byCategory.body.items.length > 0
      && byCategory.body.items.every((i) => (i.tags || []).some((x) => /pirate/i.test(x))),
      byCategory.body.items.map((i) => i.title));

    const byAuthor = await librarian.get('/api/content?type=BOOK&q=Tom Bridger&limit=300');
    t.check('searching a shelf by author narrows it',
      byAuthor.body.items.length > 0
      && byAuthor.body.items.every((i) => /bridger/i.test(i.author_creator || '')),
      byAuthor.body.items.length);

    // The Categories tab filters the loaded list by name and by kind, so both
    // have to be on every row it is given.
    const tagList = await librarian.get('/api/content/tags');
    t.check('every category carries a name and a kind to filter on',
      tagList.status === 200 && tagList.body.items.length > 0
      && tagList.body.items.every((x) => typeof x.tag_name === 'string' && x.tag_name
        && ['GENRE', 'THEME', 'TOPIC'].includes(x.category)),
      tagList.body && tagList.body.items && tagList.body.items[0]);
    t.check('and a count of what uses it',
      tagList.body.items.every((x) => Number.isFinite(Number(x.content_count))),
      tagList.body.items[0]);

    const noMatch = await librarian.get('/api/content?type=BOOK&q=zzzznothinghere&limit=300');
    t.check('a shelf search with no matches returns nothing',
      noMatch.status === 200 && noMatch.body.items.length === 0,
      noMatch.body && noMatch.body.items && noMatch.body.items.length);

    // --- administration --------------------------------------------------------
    t.check('the administrator lists accounts',
      (await admin.get('/api/admin/users?limit=5')).status === 200);
    t.check('and posts a notice', (await admin.post('/api/admin/announcements',
      { title: 'Test notice', message: 'From the test suite.' })).status < 300);
    t.check('and reads the audit log', (await admin.get('/api/admin/logs?limit=5')).status === 200);

    // --- story chat -------------------------------------------------------------
    r = await child.post('/api/chat/sessions');
    const sessionId = r.body && r.body.session_id;
    t.check('a chat session starts', r.status < 300 && !!sessionId, r.body);
    if (sessionId) {
      r = await child.post(`/api/chat/sessions/${sessionId}/messages`, { message: 'something funny' });
      t.check('the chat answers', r.status < 300 && JSON.stringify(r.body).length > 50, r.status);
      t.check('the chat session ends',
        (await child.post(`/api/chat/sessions/${sessionId}/end`)).status === 200);
    }
  },
};
