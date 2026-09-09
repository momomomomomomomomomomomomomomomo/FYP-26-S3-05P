'use strict';
const db = require('../db');
const { contentScopeClause } = require('./access');

/**
 * The Story Chat recommender.
 *
 * This is a deterministic, offline recommender: it reads the child's message,
 * pulls out what it can (a genre, a topic, a format, a length, an age), then
 * ranks the library with SQL. Nothing leaves the machine and no API key is
 * needed, which keeps the app runnable on a laptop with the Wi-Fi off.
 *
 * Every suggestion is filtered through the same parental-control scope the
 * library uses, so the chatbot can never surface a title the child is not
 * allowed to open.
 *
 * If you later want a large language model behind this, replace
 * `generateReply()` - the routes only depend on its {reply, contentIds} shape.
 */

// Words a child is likely to type -> the tag they mean.
const TAG_SYNONYMS = {
  Fantasy: ['fantasy', 'magic', 'magical', 'dragon', 'dragons', 'wizard', 'witch', 'fairy', 'unicorn', 'spell'],
  Adventure: ['adventure', 'adventures', 'quest', 'journey', 'explore', 'exploring', 'treasure', 'pirate', 'pirates'],
  'Sci-Fi': ['sci-fi', 'scifi', 'science fiction', 'robot', 'robots', 'alien', 'aliens', 'future', 'spaceship'],
  Mystery: ['mystery', 'mysteries', 'detective', 'detectives', 'clue', 'clues', 'spooky', 'secret', 'solve'],
  'Fairy Tale': ['fairy tale', 'fairytale', 'princess', 'prince', 'castle', 'once upon a time'],
  Humour: ['funny', 'humour', 'humor', 'silly', 'laugh', 'joke', 'jokes', 'hilarious'],
  Poetry: ['poem', 'poems', 'poetry', 'rhyme', 'rhymes'],
  'Non-Fiction': ['non-fiction', 'nonfiction', 'true story', 'facts', 'learn about'],
  Friendship: ['friend', 'friends', 'friendship'],
  Courage: ['brave', 'bravery', 'courage', 'hero', 'heroes'],
  Family: ['family', 'mum', 'mom', 'dad', 'grandpa', 'grandma', 'sister', 'brother'],
  Kindness: ['kind', 'kindness', 'gentle', 'calm', 'bedtime', 'sleep', 'sleepy'],
  Animals: ['animal', 'animals', 'fox', 'cat', 'dog', 'whale', 'duck', 'bird'],
  Space: ['space', 'planet', 'planets', 'moon', 'mars', 'star', 'stars', 'astronaut', 'rocket'],
  Nature: ['nature', 'rain', 'weather', 'forest', 'sea', 'ocean', 'plants', 'trees'],
  History: ['history', 'historical', 'ancient', 'past', 'museum'],
  Science: ['science', 'experiment', 'experiments', 'volcano', 'volcanoes', 'how does', 'how do'],
  Dinosaurs: ['dinosaur', 'dinosaurs', 't-rex', 'trex', 'triceratops'],
};

const GREETINGS = ['hi', 'hello', 'hey', 'yo', 'hiya', 'good morning', 'good afternoon', 'good evening'];
const HELP_WORDS = ['what can you do', 'help', 'how does this work', 'who are you', 'what are you'];
const THANKS = ['thanks', 'thank you', 'ty', 'cheers'];

function pickTags(text) {
  const found = [];
  for (const [tag, words] of Object.entries(TAG_SYNONYMS)) {
    if (words.some((w) => text.includes(w))) found.push(tag);
  }
  return found;
}

function pickType(text) {
  if (/\b(video|videos|watch|watching|show|shows|movie|clip)\b/.test(text)) return 'VIDEO';
  if (/\b(book|books|read|reading|story|stories|novel)\b/.test(text)) return 'BOOK';
  return null;
}

function pickLength(text) {
  if (/\b(short|quick|fast|little|small|before bed)\b/.test(text)) return 'SHORT';
  if (/\b(long|longer|big|chapter book|thick)\b/.test(text)) return 'LONG';
  return null;
}

function pickAge(text) {
  const m = text.match(/\b(?:i(?:'m| am)|aged?|for a)\s*(\d{1,2})\b/)
    || text.match(/\b(\d{1,2})\s*(?:years? old|yo)\b/);
  if (!m) return null;
  const age = Number(m[1]);
  return age >= 2 && age <= 18 ? age : null;
}

function pickReadingLevel(text) {
  if (/\b(easy|easier|beginner|simple|just starting)\b/.test(text)) return 'BEGINNER';
  if (/\b(hard|harder|advanced|challenging|difficult)\b/.test(text)) return 'ADVANCED';
  return null;
}

/** Words worth searching titles and descriptions for, once the noise is gone. */
const STOP_WORDS = new Set(
  ('a an the i im me my you your we us is are am was were do does did can could would should '
    + 'want wants wanted like likes liked love loves find show tell give get got some any about '
    + 'for with and or but of to in on at please thanks thank hi hello hey something anything '
    + 'good great nice book books story stories video videos read watch recommend recommendation '
    + 'suggest suggestion have has had what which who when where how why more another else new')
    .split(' '),
);

function keywords(text) {
  return text
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w))
    .slice(0, 4);
}

/**
 * Scores the library against one intent.
 *
 * `strict` makes any genre or format the child named a hard requirement.
 * match_score counts only what was actually asked for; the average rating is a
 * separate tie-breaker, so a popular book can never masquerade as a match.
 */
async function runSearch(intent, scope, { strict, limit }) {
  const scoreParts = [];
  const scoreParams = [];
  const where = [];
  const whereParams = [];

  if (intent.tags.length) {
    const placeholders = intent.tags.map(() => '?').join(',');
    const tagMatch = `(SELECT COUNT(*) FROM content_tags ct JOIN tags t ON t.tag_id = ct.tag_id
                        WHERE ct.content_id = c.content_id AND t.tag_name IN (${placeholders}))`;
    scoreParts.push(`${tagMatch} * 5`);
    scoreParams.push(...intent.tags);
    if (strict) {
      where.push(`${tagMatch} > 0`);
      whereParams.push(...intent.tags);
    }
  }
  if (intent.type) {
    scoreParts.push('IF(c.content_type = ?, 4, 0)');
    scoreParams.push(intent.type);
    if (strict) {
      where.push('c.content_type = ?');
      whereParams.push(intent.type);
    }
  }
  if (intent.readingLevel) {
    scoreParts.push('IF(c.reading_level = ?, 3, 0)');
    scoreParams.push(intent.readingLevel);
  }
  if (intent.age !== null) {
    // Prefer titles aimed at roughly this age, and never above it.
    scoreParts.push('IF(c.age_rating <= ?, 3 - LEAST(3, ? - c.age_rating), -20)');
    scoreParams.push(intent.age, intent.age);
  }
  if (intent.length === 'SHORT') {
    scoreParts.push('IF(c.duration_minutes <= 20, 3, 0)');
  } else if (intent.length === 'LONG') {
    scoreParts.push('IF(c.duration_minutes >= 40, 3, 0)');
  }
  for (const word of intent.keywords) {
    scoreParts.push('IF(c.title LIKE ?, 4, 0) + IF(c.description LIKE ?, 2, 0)');
    scoreParams.push(`%${word}%`, `%${word}%`);
  }

  const matchScore = scoreParts.length ? scoreParts.join(' + ') : '0';
  const tieBreak = `(SELECT COALESCE(AVG(f.rating), 0) FROM feedback f
                      WHERE f.content_id = c.content_id AND f.status = 'ACTIVE')`;

  const scoped = contentScopeClause(scope, 'c');
  const whereSql = where.length ? ` AND ${where.join(' AND ')}` : '';
  const having = intent.hasSignal ? 'HAVING match_score > 0' : '';

  const sql = `
    SELECT c.content_id, c.title, c.content_type, c.age_rating, c.duration_minutes,
           c.description, c.author_creator, c.cover_image_url, c.reading_level,
           (${matchScore}) AS match_score,
           (${tieBreak}) AS tie_break
      FROM content c
     WHERE 1 = 1${whereSql}${scoped.clause}
     ${having}
     ORDER BY match_score DESC, tie_break DESC, c.created_at DESC
     LIMIT ${Number(limit)}`;

  return db.query(sql, [...scoreParams, ...whereParams, ...scoped.params]);
}

/**
 * Two passes, because a wrong answer is worse than no answer: the strict pass
 * treats a named genre or format as a requirement, and only if it comes back
 * empty does the soft pass relax it. The caller then says out loud that these
 * are not what was asked for.
 */
async function findMatches(intent, scope, limit = 4) {
  const constrained = intent.tags.length > 0 || intent.type !== null;
  if (constrained) {
    const strict = await runSearch(intent, scope, { strict: true, limit });
    if (strict.length) return { matches: strict };
  }
  return { matches: await runSearch(intent, scope, { strict: false, limit }) };
}

function describe(item) {
  const kind = item.content_type === 'VIDEO' ? 'video' : 'book';
  const age = item.age_rating ? `ages ${item.age_rating}+` : 'all ages';
  const mins = item.duration_minutes ? `, about ${item.duration_minutes} min` : '';
  return `**${item.title}** - ${kind}, ${age}${mins}. ${item.description || ''}`.trim();
}

/** "a and b" / "a, b and c" - so replies read like a sentence. */
function formatList(parts) {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

function typeNoun(type) {
  if (type === 'VIDEO') return 'videos';
  if (type === 'BOOK') return 'books';
  return null;
}

/**
 * Puts a request into words: "space videos", "humour books, nice and short".
 * Called twice - once with everything the child asked for, and once with only
 * the parts the suggestions actually deliver.
 */
function describeWanted({ tags = [], type = null, length = null, age = null }) {
  const noun = typeNoun(type);
  const tagText = tags.length ? formatList(tags.map((t) => t.toLowerCase())) : null;
  const core = tagText && noun ? `${tagText} ${noun}` : (tagText || noun);

  const qualifiers = [];
  if (length === 'SHORT') qualifiers.push('nice and short');
  if (length === 'LONG') qualifiers.push('a longer read');
  if (age !== null) qualifiers.push(`good for age ${age}`);

  return [core, ...qualifiers].filter(Boolean).join(', ');
}

/** Which of the requested tags the suggested titles genuinely carry. */
async function matchedTagsFor(intent, matches) {
  if (!intent.tags.length || !matches.length) return [];
  const ids = matches.map((m) => Number(m.content_id));
  const rows = await db.query(
    `SELECT DISTINCT t.tag_name
       FROM content_tags ct JOIN tags t ON t.tag_id = ct.tag_id
      WHERE ct.content_id IN (${ids.map(() => '?').join(',')})
        AND t.tag_name IN (${intent.tags.map(() => '?').join(',')})`,
    [...ids, ...intent.tags],
  );
  const present = new Set(rows.map((r) => r.tag_name));
  return intent.tags.filter((t) => present.has(t));
}

/**
 * Turns a child's message into a reply plus the titles it recommends.
 * @returns {Promise<{reply: string, contentIds: number[]}>}
 */
async function generateReply(message, scope, user) {
  const text = String(message || '').toLowerCase().trim();
  const name = user && user.name ? user.name.split(' ')[0] : 'there';

  if (!text) {
    return { reply: 'Tell me what you feel like reading and I will go looking!', contentIds: [] };
  }
  if (HELP_WORDS.some((w) => text.includes(w))) {
    return {
      reply: `I am the StoryNest Story Chat, ${name}. Tell me a kind of story - "something funny", `
        + '"a short bedtime book", "videos about space", "a mystery for a 9 year old" - and I will '
        + 'find titles from the library that you are allowed to read.',
      contentIds: [],
    };
  }
  if (THANKS.some((w) => text === w || text.startsWith(w))) {
    return { reply: 'Any time! Ask me again whenever you need something new to read.', contentIds: [] };
  }
  if (GREETINGS.some((w) => text === w || text.startsWith(`${w} `) || text.startsWith(`${w},`))) {
    return {
      reply: `Hi ${name}! What are you in the mood for today - something funny, something spooky, `
        + 'a video, or a bedtime story?',
      contentIds: [],
    };
  }

  const intent = {
    tags: pickTags(text),
    type: pickType(text),
    length: pickLength(text),
    age: pickAge(text),
    readingLevel: pickReadingLevel(text),
    keywords: keywords(text),
  };
  intent.hasSignal = Boolean(
    intent.tags.length || intent.type || intent.length || intent.age
    || intent.readingLevel || intent.keywords.length,
  );

  const { matches } = await findMatches(intent, scope);
  const asked = describeWanted(intent);

  if (!matches.length) {
    return {
      reply: `I could not find anything${asked ? ` for ${asked}` : ''} in your library. `
        + 'Try another idea - "animals", "space", "something funny" - or ask a grown-up to '
        + 'unlock more of the library for you.',
      contentIds: [],
    };
  }

  // Only claim what the suggestions actually are. A child whose parent blocked
  // mysteries should hear that their library has none, not be handed four
  // books and told they are mysteries.
  const matchedTags = await matchedTagsFor(intent, matches);
  const missedTags = intent.tags.filter((t) => !matchedTags.includes(t));

  // Claim the format only if every suggestion is that format; report it missing
  // only if none of them are.
  const typeDelivered = intent.type ? matches.every((m) => m.content_type === intent.type) : false;
  const typeAbsent = intent.type ? !matches.some((m) => m.content_type === intent.type) : false;

  const delivered = describeWanted({
    tags: matchedTags,
    type: typeDelivered ? intent.type : null,
    length: intent.length,
    age: intent.age,
  });

  const askedForSomething = intent.tags.length > 0 || intent.type !== null;
  // Nothing the child asked for came back: no requested genre, and either no
  // format was requested or none of the results are that format.
  const gotNothingAskedFor = !matchedTags.length && (intent.type === null || typeAbsent);

  let opener;
  if (askedForSomething && gotNothingAskedFor) {
    opener = `I could not find any ${asked} in your library, but here are some others you might enjoy:`;
  } else if (delivered) {
    opener = `Here is what I found for ${delivered}:`;
  } else {
    opener = 'Here are a few you might enjoy:';
  }

  if (!(askedForSomething && gotNothingAskedFor)) {
    const missing = [
      missedTags.length ? `${formatList(missedTags.map((t) => t.toLowerCase()))} ones` : null,
      typeAbsent ? typeNoun(intent.type) : null,
    ].filter(Boolean);
    if (missing.length) opener += ` (No ${formatList(missing)} in your library, sorry!)`;
  }

  const body = matches.map((m) => `- ${describe(m)}`).join('\n');
  const closer = matches.length > 1
    ? '\n\nWant something different? Tell me more about what you like.'
    : '';

  return {
    reply: `${opener}\n${body}${closer}`,
    contentIds: matches.map((m) => Number(m.content_id)),
  };
}

module.exports = { generateReply, pickTags, pickType, pickAge };
