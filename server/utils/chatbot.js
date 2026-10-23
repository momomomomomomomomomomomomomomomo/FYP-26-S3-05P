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
const CANDIDATE_POOL = 60;
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
    where.push(`EXISTS (SELECT 1 FROM content_tags ct JOIN tags t ON t.tag_id = ct.tag_id
                         WHERE ct.content_id = c.content_id AND t.tag_name IN (${
  analysis.tags.map(() => '?').join(',')}))`);
    params.push(...analysis.tags);
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
async function generateReply(message, scope, user) {
  const name = user && user.name ? user.name.split(' ')[0] : 'there';
  const tags = await catalogueTags();
  const analysis = nlp.analyse(message, tags);

  const nothing = (reply) => ({
    reply, contentIds: [], blocked: false, violations: [], intent: analysis.intent,
  });

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
    return nothing(`Hi ${name}! What are you in the mood for today - something funny, `
      + 'an adventure, a video, or a bedtime story?');
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
    };
  }

  if (analysis.intent === 'UNCLEAR') {
    return nothing(`I am not sure what to look for there, ${name}. Try naming a kind of story - `
      + '"funny", "animals", "space", "a bedtime book" - and I will find something.');
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
  } else if (delivered) {
    opener = `Here is what I found for ${delivered}:`;
  } else {
    opener = 'Here are a few you might enjoy:';
  }

  if (!(askedForSomething && (relaxed || gotNothingAskedFor))) {
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
  const closer = picks.length > 1
    ? '\n\nWant something different? Tell me more about what you like.'
    : '';

  return {
    reply: `${opener}\n${body}${closer}`,
    contentIds: picks.map((p) => Number(p.content_id)),
    blocked: false,
    violations: [],
    intent: analysis.intent,
  };
}

module.exports = {
  generateReply,
  invalidateIndex,
  // Kept for anything that imported these from the old recommender.
  pickTags: (text) => nlp.analyse(text).tags,
  pickType: (text) => nlp.analyse(text).type,
  pickAge: (text) => nlp.analyse(text).age,
};
