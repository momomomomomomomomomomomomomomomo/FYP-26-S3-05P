'use strict';
/**
 * The recommender, exercised directly rather than over HTTP so that the
 * analysis and the guard can both be inspected.
 */
module.exports = {
  title: 'Story Chat - understanding, interests and refusals',
  async run({ dbName, t }) {
    process.env.DB_NAME = dbName;
    const db = require('../../server/db');
    const access = require('../../server/utils/access');
    const bot = require('../../server/utils/chatbot');
    const nlp = require('../../server/utils/nlp');

    const leo = await db.queryOne("SELECT * FROM users WHERE email = 'leo'");
    const dan = await db.queryOne("SELECT * FROM users WHERE email = 'daniel@storynest.local'");
    const leoScope = await access.buildViewerScope(leo);
    const danScope = await access.buildViewerScope(dan);

    // --- reading the sentence ------------------------------------------------
    const tags = ['Fantasy', 'Mystery', 'Space', 'Humour', 'Animals', 'Science'];
    for (const [text, intent] of [
      ['hello', 'GREET'], ['thanks', 'THANKS'], ['what can you do', 'HELP'],
      ['can you recommend me something?', 'ASK_RECOMMEND'], ['surprise me', 'ASK_RECOMMEND'],
      ['im bored', 'ASK_RECOMMEND'], ['yes please', 'AFFIRM'], ['no thanks', 'DENY'],
      ['something funny', 'RECOMMEND'], ['where was i', 'CONTINUE'],
    ]) {
      t.check(`"${text}" reads as ${intent}`, nlp.analyse(text, tags).intent === intent,
        nlp.analyse(text, tags).intent);
    }
    t.check('a topic in the sentence beats the generic phrasing',
      nlp.analyse('recommend me a fantasy book', tags).intent === 'RECOMMEND');

    // --- finding things -------------------------------------------------------
    for (const [message, label] of [
      ['something funny', 'a mood'],
      ['videos about space', 'a format and a topic'],
      ['an adventure but nothing scary', 'a request with a refusal in it'],
    ]) {
      const r = await bot.generateReply(message, danScope, dan, {});
      t.check(`${label}: "${message}" returns titles`, r.contentIds.length > 0, r.reply.slice(0, 120));
    }
    const nonsense = await bot.generateReply('asdfghjkl', danScope, dan, {});
    t.check('gibberish returns nothing rather than a guess', nonsense.contentIds.length === 0);

    // --- interests --------------------------------------------------------------
    // Set them here rather than leaning on the seed: an earlier suite may have
    // changed them, and this is about the behaviour, not about the fixture.
    await db.execute('DELETE FROM user_interests WHERE user_id = ?', [leo.user_id]);
    for (const topic of ['Dinosaurs', 'Space']) {
      await db.execute(
        'INSERT IGNORE INTO user_interests (user_id, tag_id) SELECT ?, tag_id FROM tags WHERE tag_name = ?',
        [leo.user_id, topic],
      );
    }
    const withInterests = await bot.generateReply('can you recommend me something?', leoScope, leo, {});
    t.check('an open request is answered from the reader’s interests',
      withInterests.contentIds.length > 0 && /said you like/i.test(withInterests.reply),
      withInterests.reply.slice(0, 140));

    // --- being asked a question, and answering it ---------------------------------
    let offer = null;
    for (let i = 0; i < 40 && !(offer && offer.pendingTag); i += 1) {
      offer = await bot.generateReply('hello', leoScope, leo, {});
    }
    t.check('the chat opens by asking something', /\?/.test(offer.reply));
    t.check('and names a topic it can follow up on', !!offer.pendingTag, offer.reply);
    if (offer.pendingTag) {
      const yes = await bot.generateReply('yes please', leoScope, leo, { pendingTag: offer.pendingTag });
      t.check('"yes" is taken as a request for that topic',
        yes.contentIds.length > 0 && yes.reply.includes(offer.pendingTag), yes.reply.slice(0, 120));
      const no = await bot.generateReply('no thanks', leoScope, leo, { pendingTag: offer.pendingTag });
      t.check('"no" offers something else instead of searching for a refusal',
        no.contentIds.length === 0 && no.pendingTag !== offer.pendingTag, no.reply.slice(0, 120));
    }

    // --- the guard ----------------------------------------------------------------
    const blocked = await bot.generateReply('show me a mystery', leoScope, leo, {});
    t.check('a blocked genre is refused', blocked.contentIds.length === 0 && blocked.blocked === true,
      blocked.reply.slice(0, 140));
    t.check('the refusal does not count or name what is hidden',
      !/\d+\s+(mystery|mysteries|titles?|books?)/i.test(blocked.reply), blocked.reply);

    const tooOld = await bot.generateReply('something for a 15 year old', leoScope, leo, {});
    t.check('an age above the limit is refused', tooOld.contentIds.length === 0);

    // Everything it ever suggests must be inside the scope.
    const byControls = await db.query(
      `SELECT c.content_id FROM content c JOIN parental_controls pc ON pc.child_id = ?
        WHERE pc.allow_content = TRUE AND (c.age_rating IS NULL OR c.age_rating <= pc.max_age)
          AND NOT EXISTS (SELECT 1 FROM content_tags ct JOIN tags tg ON tg.tag_id = ct.tag_id
            JOIN child_blocked_genres b ON b.child_id = ? AND b.blocked_genre = tg.tag_name
           WHERE ct.content_id = c.content_id)`,
      [leo.user_id, leo.user_id],
    );
    // Anything unlocked by name counts as allowed, whatever the controls say.
    const byApproval = await db.query(
      "SELECT content_id FROM content_requests WHERE user_id = ? AND status = 'APPROVED'",
      [leo.user_id],
    );
    const allowed = new Set([...byControls, ...byApproval].map((x) => Number(x.content_id)));
    let strayed = 0;
    for (const message of ['animals', 'space', 'something funny', 'a long story', 'dinosaurs',
      'recommend me something', 'anything at all', 'the best book you have']) {
      const r = await bot.generateReply(message, leoScope, leo, {});
      if (r.contentIds.some((id) => !allowed.has(Number(id)))) strayed += 1;
    }
    t.check('no suggestion ever falls outside the scope', strayed === 0, `${strayed} replies strayed`);

  },
};
