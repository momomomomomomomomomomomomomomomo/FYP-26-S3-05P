'use strict';
/**
 * The natural-language model behind Story Chat.
 *
 * A full pipeline, run in-process so the app still works with the Wi-Fi off and
 * still needs no API key:
 *
 *   1. normalise   lower case, expand contractions, strip punctuation
 *   2. tokenise    words, keeping numbers (ages) and hyphenated forms
 *   3. stem        a light suffix stripper, so "dinosaurs" and "dinosaur" agree
 *   4. negate      find what the reader does NOT want ("nothing scary")
 *   5. expand      map stems onto the catalogue's own tag vocabulary
 *   6. classify    greet / help / thanks / recommend / find a title / off-topic
 *   7. rank        BM25 over a TF-IDF index of title, blurb, author and tags
 *
 * This module knows nothing about who is asking. It never reads the database
 * and never decides what a reader may see: it is handed a set of documents that
 * has *already* been filtered for the viewer, and ranks only those. Keeping the
 * model ignorant of permissions is deliberate - see utils/chat-guard.js, where
 * every decision about visibility is made and then checked a second time.
 */

// -----------------------------------------------------------------------------
// 1-3. Normalising, tokenising, stemming
// -----------------------------------------------------------------------------
const CONTRACTIONS = {
  "i'm": 'i am',
  "i've": 'i have',
  "i'd": 'i would',
  "don't": 'do not',
  "doesn't": 'does not',
  "didn't": 'did not',
  "won't": 'will not',
  "can't": 'can not',
  "cant": 'can not',
  "isn't": 'is not',
  "aren't": 'are not',
  "wasn't": 'was not',
  "haven't": 'have not',
  "hasn't": 'has not',
  "wouldn't": 'would not',
  "shouldn't": 'should not',
  "couldn't": 'could not',
  "let's": 'let us',
  "what's": 'what is',
  "that's": 'that is',
  "it's": 'it is',
};

const STOP_WORDS = new Set(
  ('a an the and or but if then than that this these those there here it its is are am was were be '
  + 'been being do does did doing have has had having i me my mine you your yours we us our ours he '
  + 'him his she her hers they them their to of in on at by for with about from into over under as '
  + 'so very just really quite please thanks thank hi hello hey ok okay yes no not any some more '
  + 'most other another else can could would should will shall may might must want wants wanted '
  + 'like likes liked love loves need needs got get give show tell find looking look search '
  + 'recommend recommendation recommendations suggest suggestion suggestions something anything '
  + 'what which who whom when where how why me know think feel feeling mood today tonight now')
    .split(/\s+/),
);

/**
 * A light suffix stripper. Not a full Porter stemmer - it only removes the
 * endings that actually collide in a children's catalogue - but it is applied
 * identically to the query and to the index, which is what matters for recall.
 */
function stem(word) {
  let w = word;
  if (w.length <= 3) return w;

  // Plurals and third person.
  if (/(ss|us|is)$/.test(w)) {
    // keep: "princess", "octopus"
  } else if (/ies$/.test(w) && w.length > 4) {
    w = `${w.slice(0, -3)}y`;
  } else if (/(ches|shes|xes|zes|ses)$/.test(w)) {
    w = w.slice(0, -2);
  } else if (/s$/.test(w)) {
    w = w.slice(0, -1);
  }

  // Common verb and adjective endings.
  if (/ing$/.test(w) && w.length > 5) w = w.slice(0, -3);
  else if (/ed$/.test(w) && w.length > 4) w = w.slice(0, -2);
  if (/ly$/.test(w) && w.length > 4) w = w.slice(0, -2);
  if (/(ier|iest)$/.test(w) && w.length > 5) w = `${w.replace(/(ier|iest)$/, '')}y`;

  // Collapse a doubled final consonant left behind by -ing / -ed.
  if (/([bdfglmnprt])\1$/.test(w)) w = w.slice(0, -1);
  return w;
}

function normalise(text) {
  let t = String(text || '').toLowerCase();
  // Curly apostrophes first, so the contraction table matches.
  t = t.replace(/[‘’]/g, "'");
  for (const [from, to] of Object.entries(CONTRACTIONS)) {
    t = t.split(from).join(to);
  }
  // Keep letters, digits, spaces and internal hyphens; everything else is noise.
  return t.replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim();
}

function tokenise(normalised) {
  return normalised.split(' ').filter(Boolean);
}

// -----------------------------------------------------------------------------
// 4. Negation
// -----------------------------------------------------------------------------
const NEGATORS = new Set(['not', 'no', 'without', 'except', 'avoid', 'hate', 'dislike', 'nothing', 'never']);
// A negation reaches to the end of the clause, so punctuation and these words
// close it: "no mysteries but something funny" must not negate "funny".
const NEGATION_ENDERS = new Set(['but', 'however', 'though', 'instead', 'rather', 'and']);
const NEGATION_WINDOW = 4;

/**
 * Splits the tokens into what the reader wants and what they explicitly do not.
 * "a funny book but nothing scary" -> wanted: funny, book; negated: scary
 */
function splitNegation(tokens) {
  const wanted = [];
  const negated = [];
  let countdown = 0;

  for (const token of tokens) {
    if (NEGATORS.has(token)) {
      countdown = NEGATION_WINDOW;
      continue;
    }
    if (countdown > 0 && NEGATION_ENDERS.has(token)) {
      countdown = 0;
      continue;
    }
    if (countdown > 0) {
      negated.push(token);
      countdown -= 1;
    } else {
      wanted.push(token);
    }
  }
  return { wanted, negated };
}

// -----------------------------------------------------------------------------
// 5. Concept expansion - words a reader uses -> tags the catalogue uses
// -----------------------------------------------------------------------------
const TAG_SYNONYMS = {
  Fantasy: ['fantasy', 'magic', 'magical', 'dragon', 'wizard', 'witch', 'fairy', 'unicorn', 'spell', 'enchanted'],
  Adventure: ['adventure', 'quest', 'journey', 'explore', 'exploring', 'treasure', 'pirate', 'island', 'map'],
  'Sci-Fi': ['sci-fi', 'scifi', 'science fiction', 'robot', 'alien', 'future', 'spaceship', 'galaxy', 'time travel'],
  Mystery: ['mystery', 'detective', 'clue', 'spooky', 'secret', 'solve', 'puzzle', 'whodunnit',
    'crime', 'scary', 'creepy', 'frightening', 'ghost', 'haunted'],
  'Fairy Tale': ['fairy tale', 'fairytale', 'princess', 'prince', 'castle', 'once upon a time', 'knight'],
  Humour: ['funny', 'humour', 'humor', 'silly', 'laugh', 'joke', 'hilarious', 'giggle', 'comedy'],
  Poetry: ['poem', 'poetry', 'rhyme', 'verse', 'limerick'],
  'Non-Fiction': ['non-fiction', 'nonfiction', 'true story', 'fact', 'real', 'learn about', 'how does', 'how do'],
  Friendship: ['friend', 'friendship', 'best friend', 'together'],
  Courage: ['brave', 'bravery', 'courage', 'hero', 'scared', 'fear'],
  Family: ['family', 'mum', 'mom', 'dad', 'grandpa', 'grandma', 'sister', 'brother', 'cousin'],
  Kindness: ['kind', 'kindness', 'gentle', 'calm', 'bedtime', 'sleep', 'sleepy', 'cosy', 'quiet'],
  Animals: ['animal', 'fox', 'cat', 'dog', 'whale', 'duck', 'bird', 'horse', 'puppy', 'kitten', 'bear'],
  Space: ['space', 'planet', 'moon', 'mars', 'star', 'astronaut', 'rocket', 'orbit', 'solar system'],
  Nature: ['nature', 'rain', 'weather', 'forest', 'sea', 'ocean', 'plant', 'tree', 'garden', 'river'],
  History: ['history', 'historical', 'ancient', 'past', 'museum', 'castle', 'egypt', 'roman'],
  Science: ['science', 'experiment', 'volcano', 'chemistry', 'biology', 'physics', 'invention'],
  Dinosaurs: ['dinosaur', 't-rex', 'trex', 'triceratops', 'fossil', 'jurassic', 'prehistoric'],
};

/** Pre-stems the synonym table once, at load. */
const SYNONYM_STEMS = (() => {
  const map = new Map();
  for (const [tag, words] of Object.entries(TAG_SYNONYMS)) {
    for (const phrase of words) {
      const key = tokenise(normalise(phrase)).map(stem).join(' ');
      if (!map.has(key)) map.set(key, new Set());
      map.get(key).add(tag);
    }
  }
  return map;
})();

/**
 * Finds the tags a set of tokens refers to.
 *
 * `catalogueTags` is the live tag vocabulary, so a category a librarian adds
 * today is understood today - without it, the model would only ever know the
 * words hard-coded above.
 */
function conceptsFor(tokens, catalogueTags = []) {
  const stems = tokens.map(stem);
  const joined = stems.join(' ');
  const found = new Set();

  for (const [phraseStem, tags] of SYNONYM_STEMS) {
    const multiWord = phraseStem.includes(' ');
    const hit = multiWord
      ? joined.includes(phraseStem)
      : stems.includes(phraseStem);
    if (hit) tags.forEach((t) => found.add(t));
  }

  for (const tag of catalogueTags) {
    const tagStems = tokenise(normalise(tag)).map(stem);
    if (!tagStems.length) continue;
    const hit = tagStems.length > 1
      ? joined.includes(tagStems.join(' '))
      : stems.includes(tagStems[0]);
    if (hit) found.add(tag);
  }
  return Array.from(found);
}

// -----------------------------------------------------------------------------
// 6. Intent and slots
// -----------------------------------------------------------------------------
const INTENT_PATTERNS = {
  GREET: /^(hi|hello|hey|yo|hiya|sup|good (morning|afternoon|evening))\b/,
  THANKS: /^(thanks|thank you|ty|cheers|nice one|great)\b/,
  HELP: /(what can you do|how does this work|who are you|what are you|^help\b|how do i use)/,
  CONTINUE: /(carry on|continue|where was i|what was i reading|my progress|finish(ing)? (my|the) book)/,
};

/** Format, length, age and reading level, read straight off the sentence. */
function extractSlots(normalisedText, wantedTokens) {
  const slots = {
    type: null, length: null, age: null, readingLevel: null, titleQuery: null,
  };

  if (/\b(video|videos|watch|watching|show|shows|movie|movies|clip|clips|film)\b/.test(normalisedText)) {
    slots.type = 'VIDEO';
  } else if (/\b(book|books|read|reading|story|stories|novel|chapter)\b/.test(normalisedText)) {
    slots.type = 'BOOK';
  }

  if (/\b(short|quick|fast|little|small|brief|before bed|five minutes|10 minutes)\b/.test(normalisedText)) {
    slots.length = 'SHORT';
  } else if (/\b(long|longer|big|thick|chapter book|all afternoon)\b/.test(normalisedText)) {
    slots.length = 'LONG';
  }

  const ageMatch = normalisedText.match(/\b(?:i am|im|aged?|for a|suitable for)\s*(\d{1,2})\b/)
    || normalisedText.match(/\b(\d{1,2})\s*(?:years? old|yo|year-old)\b/)
    || normalisedText.match(/\bage\s*(\d{1,2})\b/);
  if (ageMatch) {
    const age = Number(ageMatch[1]);
    if (age >= 2 && age <= 18) slots.age = age;
  }

  if (/\b(easy|easier|beginner|simple|just starting|starting to read)\b/.test(normalisedText)) {
    slots.readingLevel = 'BEGINNER';
  } else if (/\b(hard|harder|advanced|challenging|difficult|tricky)\b/.test(normalisedText)) {
    slots.readingLevel = 'ADVANCED';
  }

  // "do you have moonboots" / "looking for the quiet museum"
  const titleMatch = normalisedText.match(/(?:do you have|got|looking for|find me|is there)\s+(.{3,60})$/);
  if (titleMatch) slots.titleQuery = titleMatch[1].trim();

  slots.keywords = wantedTokens.filter((t) => !STOP_WORDS.has(t) && t.length >= 3);
  return slots;
}

/**
 * Reads one message and returns everything the rest of the system needs.
 * Pure: same input, same output, no I/O.
 */
function analyse(text, catalogueTags = []) {
  const normalised = normalise(text);
  const tokens = tokenise(normalised);
  const { wanted, negated } = splitNegation(tokens);

  const contentTokens = wanted.filter((t) => !STOP_WORDS.has(t));
  const slots = extractSlots(normalised, wanted);

  const concepts = conceptsFor(wanted, catalogueTags);
  const negatedConcepts = conceptsFor(negated, catalogueTags);

  // A concept on both sides is being refused, not requested: the negation wins.
  const tags = concepts.filter((t) => !negatedConcepts.includes(t));

  let intent = 'RECOMMEND';
  if (!normalised) intent = 'EMPTY';
  else if (INTENT_PATTERNS.HELP.test(normalised)) intent = 'HELP';
  else if (INTENT_PATTERNS.THANKS.test(normalised)) intent = 'THANKS';
  else if (INTENT_PATTERNS.GREET.test(normalised) && tokens.length <= 4) intent = 'GREET';
  else if (INTENT_PATTERNS.CONTINUE.test(normalised)) intent = 'CONTINUE';

  const hasSignal = Boolean(
    tags.length || slots.type || slots.length || slots.age
    || slots.readingLevel || slots.keywords.length,
  );
  // Someone chatting about something that is not a story at all.
  if (intent === 'RECOMMEND' && !hasSignal && contentTokens.length > 0) intent = 'UNCLEAR';

  return {
    raw: String(text || ''),
    normalised,
    tokens,
    stems: contentTokens.map(stem),
    negatedTokens: negated,
    negatedStems: negated.filter((t) => !STOP_WORDS.has(t)).map(stem),
    intent,
    tags,
    negatedTags: negatedConcepts,
    ...slots,
    hasSignal,
  };
}

// -----------------------------------------------------------------------------
// 7. TF-IDF / BM25 ranking
// -----------------------------------------------------------------------------
const BM25_K1 = 1.5;   // term-frequency saturation
const BM25_B = 0.75;   // length normalisation

/**
 * Builds a searchable index from catalogue rows.
 *
 * Fields are weighted by how strongly they identify a title: a word in the
 * title says far more than the same word buried in a blurb.
 */
function buildIndex(rows) {
  const FIELD_WEIGHT = { title: 3, tags: 3, author: 2, description: 1 };
  const docs = new Map();
  const docFreq = new Map();
  let totalLength = 0;

  for (const row of rows) {
    const fields = {
      title: row.title || '',
      tags: (row.tags || []).join(' '),
      author: row.author_creator || '',
      description: row.description || '',
    };

    const termFreq = new Map();
    let length = 0;
    for (const [field, weight] of Object.entries(FIELD_WEIGHT)) {
      const terms = tokenise(normalise(fields[field]))
        .filter((t) => !STOP_WORDS.has(t))
        .map(stem);
      for (const term of terms) {
        termFreq.set(term, (termFreq.get(term) || 0) + weight);
        length += weight;
      }
    }

    for (const term of termFreq.keys()) {
      docFreq.set(term, (docFreq.get(term) || 0) + 1);
    }
    totalLength += length;
    docs.set(Number(row.content_id), { termFreq, length, row });
  }

  return {
    docs,
    docFreq,
    docCount: rows.length,
    avgLength: rows.length ? totalLength / rows.length : 0,
    builtAt: Date.now(),
  };
}

/** Inverse document frequency, floored so a term in every document is not negative. */
function idf(index, term) {
  const n = index.docFreq.get(term) || 0;
  return Math.max(0.05, Math.log(1 + (index.docCount - n + 0.5) / (n + 0.5)));
}

/**
 * BM25 relevance of one document to a set of query stems, with the negated
 * stems subtracted - asking for "nothing scary" should actively push scary
 * things down, not merely fail to pull them up.
 */
function scoreDoc(index, contentId, queryStems, negatedStems = []) {
  const doc = index.docs.get(Number(contentId));
  if (!doc) return 0;

  const run = (stems, sign) => stems.reduce((total, term) => {
    const tf = doc.termFreq.get(term) || 0;
    if (!tf) return total;
    const denominator = tf + BM25_K1 * (1 - BM25_B + BM25_B * (doc.length / (index.avgLength || 1)));
    return total + sign * idf(index, term) * ((tf * (BM25_K1 + 1)) / denominator);
  }, 0);

  return run(queryStems, 1) + run(negatedStems, -1.5);
}

module.exports = {
  normalise,
  tokenise,
  stem,
  splitNegation,
  conceptsFor,
  analyse,
  buildIndex,
  scoreDoc,
  TAG_SYNONYMS,
  STOP_WORDS,
};
