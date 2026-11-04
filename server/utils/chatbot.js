'use strict';
const db = require('./../db');
const nlp = require('./nlp');
const guard = require('./chat-guard');
const { contentScopeClause } = require('./access');

/**
 * The Story Chat recommender.
 *
 * Three parts, kept apart on purpose:
 *
 *   utils/nlp.js         understands the sentence. Knows nothing about readers.
 *   utils/chat-guard.js  decides what this reader may see, and checks it twice.
 *   this file            joins them: retrieve, rank, verify, explain.
 *
 * It is still deterministic and still offline - no API key, no request leaves
 * the machine - but the matching is now a real retrieval pipeline: a TF-IDF
 * index of the catalogue scored with BM25, combined with the structured filters
 * the model reads out of the sentence (format, length, age, reading level) and
 * the tags it infers from the words.
 *
 * SECURITY, in one place so it cannot be lost in a refactor:
 *   - Candidates are fetched with contentScopeClause, so a title outside the
 *     reader's scope is never even ranked.
 *   - The ranked ids are then re-checked by guard.verifyVisible() in a separate
 *     query. Anything that fails is dropped and reported to the caller.
 *   - Requests that break the reader's own settings are refused before any
 *     search runs, and the refusal never names or counts what is hidden.
 *
 * To put a large language model behind this, replace rankCandidates() only.
 * Leave retrieve() and the guard where they are: the model must never be the
 * thing deciding what a child is allowed to see.
 */

const MAX_SUGGESTIONS = 4;
// The pool must be able to hold the whole catalogue. It used to be 60, which
// was fine for 24 titles and silently hid a third of them once there were 86:
// the query has no ORDER BY, so a LIMIT below the catalogue size drops an
// arbitrary slice before ranking ever sees it. Ranking happens in JS, so the
// only cost of a generous pool is memory. Revisit above a few thousand titles.
const CANDIDATE_POOL = 2000;
const INDEX_TTL_MS = 60 * 1000;

// -----------------------------------------------------------------------------
// The TF-IDF index, rebuilt lazily
// -----------------------------------------------------------------------------
let indexCache = null;

/**
 * The index covers the whole catalogue, because it is only a language model of
 * the text. It confers no access: every lookup is restricted to ids the
 * reader's scope has already allowed.
 */
async function getIndex() {
  if (indexCache && Date.now() - indexCache.builtAt < INDEX_TTL_MS) return indexCache;

  const rows = await db.query(
    `SELECT c.content_id, c.title, c.description, c.author_creator,
            GROUP_CONCAT(t.tag_name SEPARATOR ' ') AS tag_names
       FROM content c
       LEFT JOIN content_tags ct ON ct.content_id = c.content_id
       LEFT JOIN tags t ON t.tag_id = ct.tag_id
      GROUP BY c.content_id`,
  );

  indexCache = nlp.buildIndex(rows.map((r) => ({
    content_id: r.content_id,
    title: r.title,
    description: r.description,
    author_creator: r.author_creator,
    tags: r.tag_names ? r.tag_names.split(' ') : [],
  })));
  return indexCache;
}

/** Called when the catalogue changes, so the model sees new titles at once. */
function invalidateIndex() {
  indexCache = null;
}

/** The live category vocabulary, so words a librarian added today are understood. */
let tagCache = { names: [], at: 0 };
async function catalogueTags() {
  if (Date.now() - tagCache.at < INDEX_TTL_MS && tagCache.names.length) return tagCache.names;
  const rows = await db.query('SELECT tag_name FROM tags');
  tagCache = { names: rows.map((r) => r.tag_name), at: Date.now() };
  return tagCache.names;
}

// -----------------------------------------------------------------------------
// What this reader likes, and what the chat can offer them
// -----------------------------------------------------------------------------
/**
 * The topics a reader has chosen on their account page, kept to the ones their
 * library can actually answer.
 *
 * The EXISTS clause carries the viewer's scope, so an interest a parent has
 * since blocked, or one that is only on titles above a child's age limit,
 * quietly drops out instead of producing a promise the search cannot keep.
 */
async function interestsFor(user, scope) {
  if (!user || !user.user_id) return [];
  const scoped = contentScopeClause(scope, 'c');
  const rows = await db.query(
    `SELECT t.tag_name
       FROM user_interests ui
       JOIN tags t ON t.tag_id = ui.tag_id
      WHERE ui.user_id = ?
        AND EXISTS (SELECT 1
                      FROM content c
                      JOIN content_tags ct ON ct.content_id = c.content_id
                     WHERE ct.tag_id = t.tag_id${scoped.clause})
      ORDER BY ui.created_at`,
    [user.user_id, ...scoped.params],
  );
  return rows.map((r) => r.tag_name);
}

/**
 * Topics worth offering: ones with more than a couple of titles behind them in
 * this reader's library, so "fancy a mystery?" is never a dead end.
 */
async function offerableTags(scope) {
  const scoped = contentScopeClause(scope, 'c');
  const rows = await db.query(
    `SELECT t.tag_name, COUNT(*) AS n
       FROM tags t
       JOIN content_tags ct ON ct.tag_id = t.tag_id
       JOIN content c ON c.content_id = ct.content_id
      WHERE 1 = 1${scoped.clause}
      GROUP BY t.tag_name
     HAVING n >= 2
      ORDER BY n DESC
      LIMIT 24`,
    scoped.params,
  );
  return rows.map((r) => r.tag_name);
}

const pickOne = (list) => list[Math.floor(Math.random() * list.length)];

// Questions that do not need a topic to be offered. Keeping several shapes
// here matters: a reader who is asked the same thing every time stops reading
// the question and starts ignoring the chat.
const OPEN_QUESTIONS = [
  'What do you feel like reading today?',
  'What are you in the mood for?',
  'Tell me what sort of story you are after and I will go looking.',
  'What kind of thing are you after today - funny, exciting, gentle, true?',
  'Give me a word to go on - a place, an animal, a feeling - and I will find something.',
  'Shall I look for a book, or would a video suit you better?',
  'Have you got a long stretch to read, or only a few minutes?',
  'Do you want something that makes you laugh, or something that makes you wonder?',
  'Would you rather go somewhere real, or somewhere invented?',
  'Are you after something exciting, or something calm?',
  'Do you like stories about people, or about animals?',
  'Something easy to read today, or something that stretches you a bit?',
  'Shall I find something close to what you read last, or something completely different?',
  'Is this for right now, or for bedtime?',
  'Would you like something new, or something a lot of readers have liked?',
];

// Questions that name a topic. The answer can be a plain yes, so whatever is
// offered here is remembered against the session.
// Written to read correctly whatever the topic is. Tag names are a mix of
// singular and plural nouns - Space, Dinosaurs, Humour, Fairy Tale - so
// anything of the shape "a {topic} story" is avoided: "a dinosaurs story"
// does not work.
const TOPIC_QUESTIONS = [
  (t) => `Are you in the mood to experience ${t.toLowerCase()}?`,
  (t) => `Are you in the mood for ${t.toLowerCase()} today?`,
  (t) => `How about something to do with ${t.toLowerCase()}?`,
  (t) => `Shall I look for something about ${t.toLowerCase()}?`,
  (t) => `Fancy something about ${t.toLowerCase()} today?`,
  (t) => `Do you want to try ${t.toLowerCase()} today?`,
  (t) => `I could start you with ${t.toLowerCase()} - want me to?`,
  (t) => `Would you like something with ${t.toLowerCase()} in it?`,
  (t) => `Shall I find you stories about ${t.toLowerCase()}?`,
];

// Only used when the reader has told us what they like.
const INTEREST_QUESTIONS = [
  (t) => `You said you like ${t.toLowerCase()} - shall I find you one of those?`,
  (t) => `Want something about ${t.toLowerCase()}, like you usually go for?`,
  (t) => `${t} is on your list of interests. Shall I pull one out?`,
  (t) => `I know you are keen on ${t.toLowerCase()}. Shall we start there?`,
];

/**
 * One question to get a recommendation started.
 *
 * Returns the topic it named, if it named one, so a bare "yes please" can be
 * answered later without having to guess from the words.
 */
function leadingQuestion({ tags = [], interests = [], avoid = null } = {}) {
  const usable = (interests.length ? interests : tags).filter((t) => t !== avoid);

  // Name a topic most of the time - a question with something concrete in it
  // is easier to answer than an open one - but not always, or it never finds
  // out anything it did not already assume.
  if (usable.length && Math.random() < 0.7) {
    const topic = pickOne(usable);
    const ask = interests.includes(topic) && Math.random() < 0.6
      ? pickOne(INTEREST_QUESTIONS)
      : pickOne(TOPIC_QUESTIONS);
    return { text: ask(topic), pendingTag: topic };
  }
  return { text: pickOne(OPEN_QUESTIONS), pendingTag: null };
}

// -----------------------------------------------------------------------------
// Retrieval - the only place candidates come from
// -----------------------------------------------------------------------------
/**
 * Everything this reader is allowed to open, narrowed by any hard filters they
 * named. The scope clause is not optional and has no bypass.
 */
async function retrieve(analysis, scope, { strict }) {
  const where = [];
  const params = [];

  if (strict && analysis.type) {
    where.push('c.content_type = ?');
    params.push(analysis.type);
  }
  if (strict && analysis.tags.length) {
    // A tag inferred from one word is a requirement, but not one that may
    // exclude a title the reader has half-named. "The girl with the loudest
    // laugh" infers Humour from "laugh"; the book itself is not tagged Humour,
    // and gating on the tag alone made its own title unsearchable.
    const titleAlternatives = analysis.stems.map(() => 'c.title LIKE ?');
    const tagClause = `EXISTS (SELECT 1 FROM content_tags ct JOIN tags t ON t.tag_id = ct.tag_id
                               WHERE ct.content_id = c.content_id AND t.tag_name IN (${
  analysis.tags.map(() => '?').join(',')}))`;
    where.push(titleAlternatives.length
      ? `(${tagClause} OR ${titleAlternatives.join(' OR ')})`
      : tagClause);
    params.push(...analysis.tags, ...analysis.stems.map((w) => `%${w}%`));
  }
  // A genre they have explicitly refused is excluded outright, not just ranked down.
  if (analysis.negatedTags.length) {
    where.push(`NOT EXISTS (SELECT 1 FROM content_tags ct JOIN tags t ON t.tag_id = ct.tag_id
                             WHERE ct.content_id = c.content_id AND t.tag_name IN (${
  analysis.negatedTags.map(() => '?').join(',')}))`);
    params.push(...analysis.negatedTags);
  }
  // An age named in the sentence narrows further; it can never widen, because
  // the scope clause below has already capped what this reader may see.
  if (analysis.age !== null) {
    where.push('(c.age_rating IS NULL OR c.age_rating <= ?)');
    params.push(analysis.age);
  }

  const scoped = contentScopeClause(scope, 'c');
  const whereSql = where.length ? ` AND ${where.join(' AND ')}` : '';

  return db.query(
    `SELECT c.content_id, c.title, c.content_type, c.age_rating, c.duration_minutes,
            c.description, c.author_creator, c.reading_level, c.cover_image_url,
            (SELECT COALESCE(AVG(f.rating), 0) FROM feedback f
              WHERE f.content_id = c.content_id AND f.status = 'ACTIVE') AS avg_rating
       FROM content c
      WHERE 1 = 1${whereSql}${scoped.clause}
      LIMIT ${CANDIDATE_POOL}`,
    [...params, ...scoped.params],
  );
}

// -----------------------------------------------------------------------------
// Ranking - BM25 plus the structured preferences
// -----------------------------------------------------------------------------
async function rankCandidates(candidates, analysis) {
  const index = await getIndex();
  const queryStems = Array.from(new Set([
    ...analysis.stems,
    // Tag names are strong query terms in their own right.
    ...analysis.tags.flatMap((t) => nlp.tokenise(nlp.normalise(t)).map(nlp.stem)),
  ]));

  return candidates
    .map((row) => {
      const relevance = nlp.scoreDoc(index, row.content_id, queryStems, analysis.negatedStems);
      let score = relevance;

      // A query that repeats most of a title is a lookup, not a browse.
      const titleStems = nlp.tokenise(nlp.normalise(row.title)).map(nlp.stem);
      const named = analysis.stems.filter((w) => titleStems.includes(w)).length;
      if (named >= 2) score += 3 * named;

      if (analysis.type && row.content_type === analysis.type) score += 2.5;
      if (analysis.readingLevel && row.reading_level === analysis.readingLevel) score += 1.5;
      if (analysis.length === 'SHORT' && row.duration_minutes && row.duration_minutes <= 20) score += 1.5;
      if (analysis.length === 'LONG' && row.duration_minutes && row.duration_minutes >= 40) score += 1.5;
      if (analysis.age !== null && row.age_rating !== null) {
        // Closest to the age asked for, without going over.
        score += Math.max(0, 1.5 - Math.abs(analysis.age - row.age_rating) * 0.3);
      }
      // A gentle nudge, never enough to beat a real match.
      score += Math.min(Number(row.avg_rating) || 0, 5) * 0.12;

      return { ...row, score, relevance };
    })
    .sort((a, b) => b.score - a.score || b.avg_rating - a.avg_rating);
}

// -----------------------------------------------------------------------------
// Putting the answer into words
// -----------------------------------------------------------------------------
function describe(item) {
  const kind = item.content_type === 'VIDEO' ? 'video' : 'book';
  const age = item.age_rating ? `ages ${item.age_rating}+` : 'all ages';
  const mins = item.duration_minutes ? `, about ${item.duration_minutes} min` : '';
  return `**${item.title}** - ${kind}, ${age}${mins}. ${item.description || ''}`.trim();
}

function listOf(parts) {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

function typeNoun(type) {
  if (type === 'VIDEO') return 'videos';
  if (type === 'BOOK') return 'books';
  return null;
}

/** "space videos, nice and short" - what was asked for, in plain words. */
function describeWanted({ tags = [], type = null, length = null, age = null }) {
  const noun = typeNoun(type);
  const tagText = tags.length ? listOf(tags.map((t) => t.toLowerCase())) : null;
  const core = tagText && noun ? `${tagText} ${noun}` : (tagText || noun);

  const qualifiers = [];
  if (length === 'SHORT') qualifiers.push('nice and short');
  if (length === 'LONG') qualifiers.push('a longer read');
  if (age !== null) qualifiers.push(`good for age ${age}`);
  return [core, ...qualifiers].filter(Boolean).join(', ');
}

/** Which of the requested tags the suggestions genuinely carry. */
async function matchedTagsFor(tags, picks) {
  if (!tags.length || !picks.length) return [];
  const ids = picks.map((p) => Number(p.content_id));
  const rows = await db.query(
    `SELECT DISTINCT t.tag_name
       FROM content_tags ct JOIN tags t ON t.tag_id = ct.tag_id
      WHERE ct.content_id IN (${ids.map(() => '?').join(',')})
        AND t.tag_name IN (${tags.map(() => '?').join(',')})`,
    [...ids, ...tags],
  );
  const present = new Set(rows.map((r) => r.tag_name));
  return tags.filter((t) => present.has(t));
}

// -----------------------------------------------------------------------------
// The one entry point the routes use
// -----------------------------------------------------------------------------
/**
 * Turns a message into a reply and the titles behind it.
 *
 * @returns {Promise<{reply, contentIds, blocked, violations, intent}>}
 *   `blocked` is true when the request was refused on policy grounds, so the
 *   caller can record it for the parent to see.
 */
async function generateReply(message, scope, user, options = {}) {
  const name = user && user.name ? user.name.split(' ')[0] : 'there';
  const tags = await catalogueTags();
  const analysis = nlp.analyse(message, tags);
  // The topic this chat offered in its previous message, if any.
  const pendingTag = options.pendingTag || null;

  // `pendingTag` on the way out is what the chat is leaving on the table for
  // the next message. Anything that is not a question clears it.
  const nothing = (reply, nextPending = null) => ({
    reply,
    contentIds: [],
    blocked: false,
    violations: [],
    intent: analysis.intent,
    pendingTag: nextPending,
  });

  /** Asks something, and remembers the topic it put forward. */
  const ask = (prefix, opts) => {
    const q = leadingQuestion(opts);
    return nothing(prefix ? `${prefix} ${q.text}` : q.text, q.pendingTag);
  };

  if (analysis.intent === 'EMPTY') {
    return nothing('Tell me what you feel like reading and I will go looking!');
  }
  if (analysis.intent === 'HELP') {
    return nothing(`I am the StoryNest Story Chat, ${name}. Tell me a kind of story - `
      + '"something funny", "a short bedtime book", "videos about space", "a mystery for a '
      + '9 year old" - and I will find titles from the library you are allowed to open. '
      + 'You can tell me what you do not want, too: "an adventure, but nothing scary".');
  }
  if (analysis.intent === 'THANKS') {
    return nothing('Any time! Ask me again whenever you need something new to read.');
  }
  if (analysis.intent === 'GREET') {
    const interests = await interestsFor(user, scope);
    const offerable = await offerableTags(scope);
    return ask(`Hi ${name}!`, { interests, tags: offerable });
  }
  if (analysis.intent === 'CONTINUE') {
    return nothing('Your place is saved on your account page, under Reading - open it there and '
      + 'you will carry on exactly where you stopped. Shall I find you something new as well?');
  }

  // ---- guard, before anything is searched ----------------------------------
  const violations = guard.assess(analysis, scope);
  if (violations.length) {
    return {
      reply: guard.refusalReply(violations, name),
      contentIds: [],
      blocked: true,
      violations,
      intent: analysis.intent,
      pendingTag: null,
    };
  }

  if (analysis.intent === 'UNCLEAR') {
    return nothing(`I am not sure what to look for there, ${name}. Try naming a kind of story - `
      + '"funny", "animals", "space", "a bedtime book" - and I will find something.');
  }

  // ---- a request with no topic in it ---------------------------------------
  // "Recommend me something", or a plain yes to a question this chat asked a
  // moment ago. Neither carries anything to search on, so what the reader has
  // said they like stands in for it.
  let interestsUsed = [];
  let answeredOffer = null;

  const wantsSuggestion = analysis.intent === 'ASK_RECOMMEND'
    || analysis.intent === 'AFFIRM'
    || analysis.intent === 'DENY'
    || (analysis.intent === 'RECOMMEND' && !analysis.hasSignal);

  if (wantsSuggestion) {
    const interests = await interestsFor(user, scope);
    const offerable = await offerableTags(scope);

    if (analysis.intent === 'DENY') {
      // Not that one. Offer something else rather than searching for a refusal.
      return ask(pendingTag ? 'No problem.' : 'Fair enough.',
        { interests, tags: offerable, avoid: pendingTag });
    }

    if (analysis.intent === 'AFFIRM' && pendingTag) {
      // They said yes to a topic this chat named, so that is the request.
      analysis.tags = [pendingTag];
      answeredOffer = pendingTag;
    } else if (interests.length) {
      // Their own list, newest interest first, kept short so the search stays
      // pointed rather than matching half the library.
      analysis.tags = interests.slice(0, 3);
      interestsUsed = analysis.tags;
    } else if (analysis.intent === 'AFFIRM') {
      // A yes to nothing in particular.
      return ask('Good!', { tags: offerable });
    } else {
      // Nothing to go on and nothing on file: ask rather than guess.
      return ask(
        `I can suggest something, ${name} - it helps if I know what you are after.`,
        { tags: offerable },
      );
    }
  }

  // ---- retrieve, rank, then verify -----------------------------------------
  const constrained = analysis.tags.length > 0 || analysis.type !== null;
  let candidates = constrained ? await retrieve(analysis, scope, { strict: true }) : [];
  let relaxed = false;
  if (!candidates.length) {
    candidates = await retrieve(analysis, scope, { strict: false });
    relaxed = constrained;
  }

  const ranked = await rankCandidates(candidates, analysis);

  // When the only thing to go on is the words themselves, a title has to
  // actually match them. Without this, the small popularity nudge is enough to
  // push unrelated titles over zero and "asdfgh" comes back looking like a
  // recommendation.
  const structured = Boolean(analysis.tags.length || analysis.type || analysis.age !== null
    || analysis.length || analysis.readingLevel);
  const wordsOnly = !structured && analysis.stems.length > 0;

  const shortlist = ranked
    .filter((r) => {
      if (wordsOnly) return r.relevance > 0;
      if (analysis.hasSignal) return r.score > 0;
      return true;
    })
    .slice(0, MAX_SUGGESTIONS);

  // The second, independent check. Nothing reaches the reader without it.
  const { visible, blocked } = await guard.verifyVisible(
    shortlist.map((r) => r.content_id), scope,
  );
  if (blocked.length) {
    // Retrieval and the recheck disagreed, which should be impossible. Keep the
    // reader safe, and leave a trail for whoever has to explain it later.
    console.error('[chat-guard] dropped %d out-of-scope suggestion(s) for user %s',
      blocked.length, user ? user.user_id : '?');
  }
  const allowed = new Set(visible);
  const picks = shortlist.filter((r) => allowed.has(Number(r.content_id)));

  const asked = describeWanted(analysis);

  if (!picks.length && wordsOnly) {
    return {
      reply: `I could not find anything about "${analysis.stems.join(' ')}" in your library, `
        + `${name}. Try naming a kind of story - "funny", "animals", "space", "a bedtime book" - `
        + 'and I will have another go.',
      contentIds: [],
      blocked: false,
      violations: [],
      intent: analysis.intent,
      pendingTag: null,
    };
  }

  if (!picks.length) {
    const extra = scope.restricted
      ? ' Your library only shows what a grown-up has allowed, so there may be nothing like that '
        + 'in it yet - you can always ask them to unlock more.'
      : '';
    return {
      reply: `I could not find anything${asked ? ` for ${asked}` : ''} in your library.${extra} `
        + 'Try another idea - "animals", "space", "something funny".',
      contentIds: [],
      blocked: false,
      violations: [],
      intent: analysis.intent,
      pendingTag: null,
    };
  }

  // Only claim what the suggestions actually are.
  const matchedTags = await matchedTagsFor(analysis.tags, picks);
  const missedTags = analysis.tags.filter((t) => !matchedTags.includes(t));
  const typeDelivered = analysis.type ? picks.every((p) => p.content_type === analysis.type) : false;
  const typeAbsent = analysis.type ? !picks.some((p) => p.content_type === analysis.type) : false;

  const delivered = describeWanted({
    tags: matchedTags,
    type: typeDelivered ? analysis.type : null,
    length: analysis.length,
    age: analysis.age,
  });

  const askedForSomething = analysis.tags.length > 0 || analysis.type !== null;
  const gotNothingAskedFor = !matchedTags.length && (analysis.type === null || typeAbsent);

  let opener;
  if (askedForSomething && (relaxed || gotNothingAskedFor)) {
    opener = `I could not find any ${asked} in your library, but here are some others you `
      + 'might enjoy:';
  } else if (answeredOffer) {
    // They accepted a topic this chat put forward.
    opener = `${answeredOffer} it is! Here is what I found:`;
  } else if (interestsUsed.length) {
    // Say plainly that this came off their interests, so it is clear why these
    // titles and not others, and that the list is theirs to change.
    opener = `Going on what you have said you like - ${listOf(interestsUsed)} - here is `
      + 'what I found:';
  } else if (delivered) {
    opener = `Here is what I found for ${delivered}:`;
  } else {
    opener = 'Here are a few you might enjoy:';
  }

  // Only apologise for a topic the reader actually named. When the topics came
  // off their interests, covering two of three is a normal answer, and "no
  // humour ones in your library" would be both unasked for and untrue - it
  // means none reached the top four, not that none exist.
  if (!interestsUsed.length && !(askedForSomething && (relaxed || gotNothingAskedFor))) {
    const missing = [
      missedTags.length ? `${listOf(missedTags.map((t) => t.toLowerCase()))} ones` : null,
      typeAbsent ? typeNoun(analysis.type) : null,
    ].filter(Boolean);
    if (missing.length) opener += ` (No ${listOf(missing)} in your library, sorry!)`;
  }

  if (analysis.negatedTags.length) {
    opener += ` I left out the ${listOf(analysis.negatedTags.map((t) => t.toLowerCase()))} ones.`;
  }

  const body = picks.map((p) => `- ${describe(p)}`).join('\n');
  let closer = picks.length > 1
    ? '\n\nWant something different? Tell me more about what you like.'
    : '';
  if (interestsUsed.length) {
    closer = '\n\nYou can change what you are interested in on your account page, '
      + 'under Profile.';
  }

  return {
    reply: `${opener}\n${body}${closer}`,
    contentIds: picks.map((p) => Number(p.content_id)),
    blocked: false,
    violations: [],
    intent: analysis.intent,
    pendingTag: null,
  };
}

module.exports = {
  generateReply,
  invalidateIndex,
  interestsFor,
  offerableTags,
  leadingQuestion,
  // Kept for anything that imported these from the old recommender.
  pickTags: (text) => nlp.analyse(text).tags,
  pickType: (text) => nlp.analyse(text).type,
  pickAge: (text) => nlp.analyse(text).age,
};
