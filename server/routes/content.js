'use strict';
const express = require('express');

const db = require('../db');
const v = require('../utils/validate');
const audit = require('../utils/audit');
const badges = require('../utils/badges');
const { ApiError, asyncHandler } = require('../utils/errors');
const { contentScopeClause, assertScreenTimeRemaining, ageFromDob } = require('../utils/access');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const SORTS = {
  popular: 'rating_avg DESC, rating_count DESC, c.created_at DESC',
  newest: 'c.created_at DESC',
  title: 'c.title ASC',
  age: 'c.age_rating ASC, c.title ASC',
  shortest: 'c.duration_minutes ASC',
};

/** Attaches tags to a list of content rows in one extra query. */
async function withTags(rows) {
  if (!rows.length) return rows;
  const ids = rows.map((r) => Number(r.content_id));
  const tagRows = await db.query(
    `SELECT ct.content_id, t.tag_name, t.category
       FROM content_tags ct JOIN tags t ON t.tag_id = ct.tag_id
      WHERE ct.content_id IN (${ids.map(() => '?').join(',')})
      ORDER BY t.category, t.tag_name`,
    ids,
  );
  const byContent = new Map();
  for (const t of tagRows) {
    const key = Number(t.content_id);
    if (!byContent.has(key)) byContent.set(key, []);
    byContent.get(key).push(t.tag_name);
  }
  return rows.map((r) => ({ ...r, tags: byContent.get(Number(r.content_id)) || [] }));
}

/** Adds this viewer's own saved/progress state to a list of content rows. */
async function withPersonalState(rows, userId) {
  if (!rows.length || !userId) return rows;
  const ids = rows.map((r) => Number(r.content_id));
  const placeholders = ids.map(() => '?').join(',');

  const [saved, progress] = await Promise.all([
    db.query(
      `SELECT content_id, list_type FROM saved_content
        WHERE user_id = ? AND content_id IN (${placeholders})`,
      [userId, ...ids],
    ),
    db.query(
      `SELECT content_id, percentage_completed, last_position FROM progress
        WHERE user_id = ? AND content_id IN (${placeholders})`,
      [userId, ...ids],
    ),
  ]);

  const savedMap = new Map();
  for (const s of saved) {
    const key = Number(s.content_id);
    if (!savedMap.has(key)) savedMap.set(key, []);
    savedMap.get(key).push(s.list_type);
  }
  const progressMap = new Map(progress.map((p) => [Number(p.content_id), p]));

  return rows.map((r) => {
    const key = Number(r.content_id);
    const lists = savedMap.get(key) || [];
    const p = progressMap.get(key);
    return {
      ...r,
      is_favorite: lists.includes('FAVORITE'),
      in_watchlist: lists.includes('WATCHLIST'),
      progress: p ? Number(p.percentage_completed) : 0,
      last_position: p ? Number(p.last_position) : 0,
    };
  });
}

function normaliseRow(row) {
  return {
    ...row,
    content_id: Number(row.content_id),
    age_rating: row.age_rating === null ? null : Number(row.age_rating),
    duration_minutes: row.duration_minutes === null ? null : Number(row.duration_minutes),
    rating_avg: row.rating_avg === null || row.rating_avg === undefined
      ? null : Number(Number(row.rating_avg).toFixed(2)),
    rating_count: Number(row.rating_count || 0),
  };
}

// -----------------------------------------------------------------------------
// GET /api/content  - the library, already filtered for whoever is asking
// -----------------------------------------------------------------------------
router.get('/', asyncHandler(async (req, res) => {
  const scoped = contentScopeClause(req.scope, 'c');
  const where = [];
  const params = [];

  const q = v.str(req.query.q, 'Search', { required: false, max: 100 });
  if (q) {
    where.push('(c.title LIKE ? OR c.description LIKE ? OR c.author_creator LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }

  const type = v.oneOf(req.query.type, 'Type', ['BOOK', 'VIDEO'], { required: false });
  if (type) {
    where.push('c.content_type = ?');
    params.push(type);
  }

  const level = v.oneOf(req.query.reading_level, 'Reading level',
    ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'], { required: false });
  if (level) {
    where.push('c.reading_level = ?');
    params.push(level);
  }

  const ageMax = v.int(req.query.age_max, 'Max age', { min: 0, max: 18, required: false });
  if (ageMax !== null) {
    where.push('(c.age_rating IS NULL OR c.age_rating <= ?)');
    params.push(ageMax);
  }

  const tags = [].concat(req.query.tag || [])
    .map((t) => v.str(t, 'Tag', { max: 100 }))
    .slice(0, 5);
  for (const tag of tags) {
    where.push(`EXISTS (SELECT 1 FROM content_tags ct JOIN tags t ON t.tag_id = ct.tag_id
                         WHERE ct.content_id = c.content_id AND t.tag_name = ?)`);
    params.push(tag);
  }

  const sort = SORTS[String(req.query.sort || 'popular')] || SORTS.popular;
  const limit = v.limit(req.query.limit, 24, 60);
  const offset = v.offset(req.query.offset);

  const whereSql = where.length ? ` AND ${where.join(' AND ')}` : '';
  const ratingSelect = `
    (SELECT AVG(f.rating) FROM feedback f
      WHERE f.content_id = c.content_id AND f.status = 'ACTIVE' AND f.rating IS NOT NULL) AS rating_avg,
    (SELECT COUNT(*) FROM feedback f
      WHERE f.content_id = c.content_id AND f.status = 'ACTIVE') AS rating_count`;

  const rows = await db.query(
    `SELECT c.content_id, c.content_type, c.title, c.description, c.author_creator,
            c.age_rating, c.reading_level, c.language, c.duration_minutes,
            c.cover_image_url, c.created_at, ${ratingSelect}
       FROM content c
      WHERE 1 = 1${whereSql}${scoped.clause}
      ORDER BY ${sort}
      LIMIT ${limit} OFFSET ${offset}`,
    [...params, ...scoped.params],
  );

  const totalRow = await db.queryOne(
    `SELECT COUNT(*) AS n FROM content c WHERE 1 = 1${whereSql}${scoped.clause}`,
    [...params, ...scoped.params],
  );

  let items = (await withTags(rows)).map(normaliseRow);
  items = await withPersonalState(items, req.user ? req.user.user_id : null);

  res.json({ items, total: Number(totalRow.n || 0), limit, offset });
}));

// -----------------------------------------------------------------------------
// GET /api/content/tags  - the filter list, minus anything blocked for a child
// -----------------------------------------------------------------------------
router.get('/tags', asyncHandler(async (req, res) => {
  const blocked = req.scope.restricted ? req.scope.blockedGenres : [];
  const clause = blocked.length
    ? ` WHERE t.tag_name NOT IN (${blocked.map(() => '?').join(',')})`
    : '';
  const rows = await db.query(
    `SELECT t.tag_id, t.tag_name, t.category,
            (SELECT COUNT(*) FROM content_tags ct WHERE ct.tag_id = t.tag_id) AS content_count
       FROM tags t${clause}
      ORDER BY t.category, t.tag_name`,
    blocked,
  );
  res.json({
    items: rows.map((r) => ({
      ...r, tag_id: Number(r.tag_id), content_count: Number(r.content_count),
    })),
  });
}));

// -----------------------------------------------------------------------------
// GET /api/content/top-picks  - the home page shelf
// -----------------------------------------------------------------------------
router.get('/top-picks', asyncHandler(async (req, res) => {
  const scoped = contentScopeClause(req.scope, 'c');
  const limit = v.limit(req.query.limit, 8, 20);

  // For a signed-in reader, lean towards their reading level and age.
  const personalBoost = [];
  const boostParams = [];
  if (req.user) {
    if (req.user.reading_level) {
      personalBoost.push('IF(c.reading_level = ?, 2, 0)');
      boostParams.push(req.user.reading_level);
    }
    const age = ageFromDob(req.user.dob);
    if (age !== null && req.user.role === 'CHILD') {
      personalBoost.push('IF(c.age_rating <= ?, 2 - LEAST(2, ? - c.age_rating), 0)');
      boostParams.push(age, age);
    }
  }
  const boost = personalBoost.length ? `${personalBoost.join(' + ')} + ` : '';

  const rows = await db.query(
    `SELECT c.content_id, c.content_type, c.title, c.description, c.author_creator,
            c.age_rating, c.reading_level, c.duration_minutes, c.cover_image_url, c.created_at,
            (SELECT AVG(f.rating) FROM feedback f
              WHERE f.content_id = c.content_id AND f.status = 'ACTIVE' AND f.rating IS NOT NULL) AS rating_avg,
            (SELECT COUNT(*) FROM feedback f
              WHERE f.content_id = c.content_id AND f.status = 'ACTIVE') AS rating_count,
            (${boost}COALESCE((SELECT AVG(f.rating) FROM feedback f
              WHERE f.content_id = c.content_id AND f.status = 'ACTIVE'), 3)
             + (SELECT COUNT(*) * 0.2 FROM saved_content s WHERE s.content_id = c.content_id)) AS pick_score
       FROM content c
      WHERE 1 = 1${scoped.clause}
      ORDER BY pick_score DESC, c.created_at DESC
      LIMIT ${limit}`,
    [...boostParams, ...scoped.params],
  );

  let items = (await withTags(rows)).map(normaliseRow);
  items = await withPersonalState(items, req.user ? req.user.user_id : null);
  res.json({ items });
}));

/** Loads one title, enforcing the viewer's scope. Throws 403 if out of scope. */
async function loadVisibleContent(req, contentId) {
  const item = await db.queryOne('SELECT * FROM content WHERE content_id = ?', [contentId]);
  if (!item) throw ApiError.notFound('That title is not in the library.');

  if (req.scope.restricted) {
    const scoped = contentScopeClause(req.scope, 'c');
    const visible = await db.queryOne(
      `SELECT 1 AS ok FROM content c WHERE c.content_id = ?${scoped.clause}`,
      [contentId, ...scoped.params],
    );
    if (!visible) {
      throw new ApiError(403, 'A grown-up needs to unlock this one for you.', {
        canRequest: true,
        content_id: Number(contentId),
        title: item.title,
      });
    }
  }
  return item;
}

// -----------------------------------------------------------------------------
// GET /api/content/:id
// -----------------------------------------------------------------------------
router.get('/:id', asyncHandler(async (req, res) => {
  const id = v.int(req.params.id, 'Content id', { min: 1 });
  const item = await loadVisibleContent(req, id);

  const [tagged] = await withTags([{ ...item, rating_avg: null, rating_count: 0 }]);
  const ratings = await db.queryOne(
    `SELECT AVG(rating) AS rating_avg, COUNT(*) AS rating_count
       FROM feedback WHERE content_id = ? AND status = 'ACTIVE'`,
    [id],
  );

  const reviews = await db.query(
    `SELECT f.feedback_id, f.rating, f.review, f.created_at, f.user_id,
            u.name AS author, u.role AS author_role
       FROM feedback f JOIN users u ON u.user_id = f.user_id
      WHERE f.content_id = ? AND f.status = 'ACTIVE'
      ORDER BY f.created_at DESC
      LIMIT 20`,
    [id],
  );

  let payload = normaliseRow({ ...tagged, ...ratings });
  [payload] = await withPersonalState([payload], req.user ? req.user.user_id : null);

  // "More like this": shares at least one tag, still inside the viewer's scope.
  const scoped = contentScopeClause(req.scope, 'c');
  const related = await db.query(
    `SELECT c.content_id, c.title, c.content_type, c.age_rating, c.cover_image_url,
            c.duration_minutes, NULL AS rating_avg, 0 AS rating_count
       FROM content c
      WHERE c.content_id <> ?
        AND EXISTS (SELECT 1 FROM content_tags a
                      JOIN content_tags b ON b.tag_id = a.tag_id
                     WHERE a.content_id = c.content_id AND b.content_id = ?)
        ${scoped.clause}
      ORDER BY RAND() LIMIT 4`,
    [id, id, ...scoped.params],
  );

  res.json({
    item: payload,
    reviews: reviews.map((r) => ({
      ...r, feedback_id: Number(r.feedback_id), user_id: Number(r.user_id),
    })),
    related: related.map(normaliseRow),
  });
}));

// -----------------------------------------------------------------------------
// POST /api/content/:id/open  - the reader/player opened a title
// Enforces the daily screen-time limit and starts a progress row.
// -----------------------------------------------------------------------------
router.post('/:id/open', requireAuth, asyncHandler(async (req, res) => {
  const id = v.int(req.params.id, 'Content id', { min: 1 });
  await assertScreenTimeRemaining(req.user, req.scope);
  const item = await loadVisibleContent(req, id);

  await db.execute(
    `INSERT INTO progress (user_id, content_id, percentage_completed, last_position)
     VALUES (?, ?, 0, 0)
     ON DUPLICATE KEY UPDATE updated_at = NOW()`,
    [req.user.user_id, id],
  );

  await audit.logFor(req, {
    activityType: 'CONTENT_OPEN',
    description: `Opened "${item.title}"`,
    contentId: id,
    targetTable: 'content',
    targetId: id,
  });

  await badges.checkAndAward(req.user.user_id);
  res.json({ ok: true, content_id: id, external_link: item.external_link });
}));

// -----------------------------------------------------------------------------
// PUT /api/content/:id/progress  - reading position, 0-100%
// -----------------------------------------------------------------------------
router.put('/:id/progress', requireAuth, asyncHandler(async (req, res) => {
  const id = v.int(req.params.id, 'Content id', { min: 1 });
  const percentage = v.int(req.body.percentage_completed, 'Progress', { min: 0, max: 100 });
  const position = v.int(req.body.last_position, 'Position',
    { min: 0, max: 100000, required: false }) || 0;

  await loadVisibleContent(req, id);

  await db.execute(
    `INSERT INTO progress (user_id, content_id, percentage_completed, last_position)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       percentage_completed = GREATEST(percentage_completed, VALUES(percentage_completed)),
       last_position = VALUES(last_position)`,
    [req.user.user_id, id, percentage, position],
  );

  if (percentage >= 100) {
    await audit.logFor(req, {
      activityType: 'CONTENT_COMPLETE',
      description: 'Finished a title',
      contentId: id,
      targetTable: 'content',
      targetId: id,
    });
  }

  const awarded = await badges.checkAndAward(req.user.user_id);
  res.json({ ok: true, badges_awarded: awarded.map((b) => b.badge_name) });
}));

// -----------------------------------------------------------------------------
// POST /api/content/:id/feedback  - leave a review
// -----------------------------------------------------------------------------
router.post('/:id/feedback', requireAuth, asyncHandler(async (req, res) => {
  const id = v.int(req.params.id, 'Content id', { min: 1 });
  const rating = v.int(req.body.rating, 'Rating', { min: 1, max: 5 });
  const review = v.str(req.body.review, 'Review', { min: 3, max: 2000 });

  await loadVisibleContent(req, id);

  const existing = await db.queryOne(
    'SELECT feedback_id FROM feedback WHERE user_id = ? AND content_id = ?',
    [req.user.user_id, id],
  );
  if (existing) {
    await db.execute(
      'UPDATE feedback SET rating = ?, review = ?, status = ? WHERE feedback_id = ?',
      [rating, review, 'ACTIVE', existing.feedback_id],
    );
  } else {
    await db.execute(
      'INSERT INTO feedback (user_id, content_id, rating, review) VALUES (?, ?, ?, ?)',
      [req.user.user_id, id, rating, review],
    );
  }

  await audit.logFor(req, {
    activityType: 'FEEDBACK',
    description: `Reviewed a title (${rating}/5)`,
    contentId: id,
    targetTable: 'feedback',
    targetId: existing ? existing.feedback_id : null,
  });

  const awarded = await badges.checkAndAward(req.user.user_id);
  res.status(existing ? 200 : 201).json({ ok: true, badges_awarded: awarded.map((b) => b.badge_name) });
}));

// -----------------------------------------------------------------------------
// DELETE /api/content/:id/feedback  - remove your own review
// -----------------------------------------------------------------------------
router.delete('/:id/feedback', requireAuth, asyncHandler(async (req, res) => {
  const id = v.int(req.params.id, 'Content id', { min: 1 });
  await db.execute('DELETE FROM feedback WHERE user_id = ? AND content_id = ?',
    [req.user.user_id, id]);
  res.json({ ok: true });
}));

module.exports = router;
module.exports.loadVisibleContent = loadVisibleContent;
module.exports.withTags = withTags;
module.exports.normaliseRow = normaliseRow;
