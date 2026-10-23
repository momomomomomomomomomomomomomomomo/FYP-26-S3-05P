'use strict';
const db = require('../db');
const { contentScopeClause } = require('./access');

/**
 * Story Chat's guard rails.
 *
 * The recommender and the language model are not trusted to police themselves.
 * Every reply passes three independent checks, in this order:
 *
 *   1. BEFORE   assess()        - is the reader even allowed to ask for this?
 *   2. DURING   the SQL itself  - candidates come only from contentScopeClause
 *   3. AFTER    verifyVisible() - every id in the answer is re-checked, in a
 *                                 separate query, against the same rules
 *
 * Step 3 looks redundant and is the point: it is the check that still holds if
 * someone later edits a ranking query and forgets the scope clause, or swaps
 * this recommender for a language model that invents a title. Anything that
 * survives ranking but fails the recheck is dropped and recorded.
 *
 * Nothing here ever names, counts or hints at a title the reader may not see.
 * A refusal that leaks "there are 4 mysteries you cannot read" is still a leak.
 */

/**
 * Subjects a children's library should not serve on request, whatever the tags
 * happen to say. These sit on top of the parental controls, not instead of
 * them: a parent choosing not to block "Mystery" is not consenting to horror.
 */
const UNSAFE_TOPICS = [
  { label: 'frightening', words: ['horror', 'gore', 'gory', 'nightmare', 'terrifying', 'blood', 'bloody', 'zombie', 'demon', 'satan'] },
  { label: 'violent', words: ['kill', 'killing', 'murder', 'shoot', 'shooting', 'gun', 'guns', 'weapon', 'stab', 'torture', 'war crime'] },
  { label: 'grown-up', words: ['sex', 'sexy', 'porn', 'nude', 'naked', 'erotic', 'dating', 'kissing scene'] },
  { label: 'harmful', words: ['drug', 'drugs', 'alcohol', 'beer', 'vodka', 'smoking', 'cigarette', 'suicide', 'self-harm'] },
];

/** Adults and staff are not shielded from ordinary grown-up subjects. */
function unsafeTopicsFor(analysis, scope) {
  if (!scope.restricted) return [];
  const haystack = ` ${analysis.normalised} `;
  return UNSAFE_TOPICS
    .filter((topic) => topic.words.some((w) => haystack.includes(` ${w} `) || haystack.includes(`${w} `)))
    .map((topic) => topic.label);
}

/**
 * Decides whether a request may be answered at all.
 *
 * Returns the reasons it may not. An empty list means "go ahead"; it never
 * means "this reader is unrestricted".
 */
function assess(analysis, scope) {
  const violations = [];
  if (!scope.restricted) return violations;

  if (!scope.allowContent) {
    violations.push({
      code: 'LIBRARY_PAUSED',
      detail: null,
    });
  }

  // A genre their grown-up has switched off for them.
  const blocked = (scope.blockedGenres || []);
  const asked = (analysis.tags || []).filter((tag) => blocked.includes(tag));
  if (asked.length) {
    violations.push({ code: 'BLOCKED_GENRE', detail: asked });
  }

  // Asking, in words, for something older than their limit.
  if (analysis.age !== null && scope.maxAge !== null && scope.maxAge !== undefined
      && analysis.age > scope.maxAge) {
    violations.push({ code: 'AGE_ABOVE_LIMIT', detail: { asked: analysis.age, limit: scope.maxAge } });
  }

  const unsafe = unsafeTopicsFor(analysis, scope);
  if (unsafe.length) {
    violations.push({ code: 'UNSAFE_TOPIC', detail: unsafe });
  }

  return violations;
}

/**
 * The last line of defence: re-checks a list of content ids against the
 * viewer's scope in a query of its own.
 *
 * @returns {Promise<{visible: number[], blocked: number[]}>}
 */
async function verifyVisible(contentIds, scope) {
  const ids = Array.from(new Set((contentIds || []).map(Number).filter(Number.isInteger)));
  if (!ids.length) return { visible: [], blocked: [] };

  const scoped = contentScopeClause(scope, 'c');
  const rows = await db.query(
    `SELECT c.content_id FROM content c
      WHERE c.content_id IN (${ids.map(() => '?').join(',')})${scoped.clause}`,
    [...ids, ...scoped.params],
  );

  const visible = new Set(rows.map((r) => Number(r.content_id)));
  return {
    // Preserve the ranking order rather than the order the database returned.
    visible: ids.filter((id) => visible.has(id)),
    blocked: ids.filter((id) => !visible.has(id)),
  };
}

/** "mysteries and spooky ones" */
function listOf(parts) {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/**
 * Says no kindly, and says what to do next.
 *
 * Deliberately vague about what exists: the reader learns that the subject is
 * off limits for them, never how much of it the library holds.
 */
function refusalReply(violations, name) {
  const who = name || 'there';
  const paused = violations.find((v) => v.code === 'LIBRARY_PAUSED');
  const genre = violations.find((v) => v.code === 'BLOCKED_GENRE');
  const age = violations.find((v) => v.code === 'AGE_ABOVE_LIMIT');
  const unsafe = violations.find((v) => v.code === 'UNSAFE_TOPIC');

  if (paused) {
    return `Sorry ${who} - a grown-up has paused your library for now, so I cannot suggest `
      + 'anything just yet. Anything they unlock for you will still show up in your library, '
      + 'and I will be right here when it is switched back on.';
  }

  if (unsafe) {
    return `That is not something I can look for, ${who} - StoryNest only has stories meant for `
      + 'young readers. Tell me a kind of story instead, like "something funny", "an adventure" '
      + 'or "a book about animals", and I will find you something good.';
  }

  if (genre) {
    const names = listOf(genre.detail.map((g) => g.toLowerCase()));
    return `I cannot show you ${names} stories, ${who} - a grown-up has turned that kind off for `
      + 'your library. If you would really like one, ask them and they can unlock it for you. '
      + 'In the meantime, tell me another kind of story and I will go looking.';
  }

  if (age) {
    return `Those are for older readers, ${who} - your library is set to ages ${age.detail.limit} `
      + 'and under, so I cannot suggest them. Ask a grown-up if you would like something older, '
      + 'or tell me what you are in the mood for and I will find something you can open today.';
  }

  return `I cannot help with that one, ${who}. Tell me a kind of story instead and I will look.`;
}

module.exports = {
  assess,
  verifyVisible,
  refusalReply,
  UNSAFE_TOPICS,
};
