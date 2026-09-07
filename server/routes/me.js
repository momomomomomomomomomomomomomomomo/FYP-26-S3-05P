'use strict';
const express = require('express');

const db = require('../db');
const v = require('../utils/validate');
const audit = require('../utils/audit');
const badges = require('../utils/badges');
const { ApiError, asyncHandler } = require('../utils/errors');
const { contentScopeClause, screenTimeUsedToday } = require('../utils/access');
const { requireAuth } = require('../middleware/auth');
const contentRoutes = require('./content');

const { withTags, normaliseRow, loadVisibleContent } = contentRoutes;

const router = express.Router();
router.use(requireAuth);

const CARD_COLUMNS = `c.content_id, c.content_type, c.title, c.description, c.author_creator,
  c.age_rating, c.reading_level, c.duration_minutes, c.cover_image_url, c.created_at,
  NULL AS rating_avg, 0 AS rating_count`;

// -----------------------------------------------------------------------------
// Saved lists (favourites and watchlist)
// -----------------------------------------------------------------------------
router.get('/saved', asyncHandler(async (req, res) => {
  const listType = v.oneOf(req.query.list_type, 'List type',
    ['FAVORITE', 'WATCHLIST'], { required: false });
  const scoped = contentScopeClause(req.scope, 'c');
  const params = [req.user.user_id];
  let clause = '';
  if (listType) {
    clause = ' AND s.list_type = ?';
    params.push(listType);
  }

  const rows = await db.query(
    `SELECT ${CARD_COLUMNS}, s.list_type, s.saved_at
       FROM saved_content s JOIN content c ON c.content_id = s.content_id
      WHERE s.user_id = ?${clause}${scoped.clause}
      ORDER BY s.saved_at DESC`,
    [...params, ...scoped.params],
  );
  res.json({ items: (await withTags(rows)).map(normaliseRow) });
}));

router.post('/saved', asyncHandler(async (req, res) => {
  const contentId = v.int(req.body.content_id, 'Content id', { min: 1 });
  const listType = v.oneOf(req.body.list_type, 'List type', ['FAVORITE', 'WATCHLIST']);

  // Re-uses the library's visibility check so a child cannot bookmark a title
  // their parent has blocked.
  await loadVisibleContent(req, contentId);

  await db.execute(
    'INSERT IGNORE INTO saved_content (user_id, content_id, list_type) VALUES (?, ?, ?)',
    [req.user.user_id, contentId, listType],
  );
  await audit.logFor(req, {
    activityType: 'SAVE_CONTENT',
    description: `Added a title to ${listType === 'FAVORITE' ? 'favourites' : 'the watchlist'}`,
    contentId,
    targetTable: 'saved_content',
    targetId: contentId,
  });

  const awarded = await badges.checkAndAward(req.user.user_id);
  res.status(201).json({ ok: true, badges_awarded: awarded.map((b) => b.badge_name) });
}));

router.delete('/saved/:contentId', asyncHandler(async (req, res) => {
  const contentId = v.int(req.params.contentId, 'Content id', { min: 1 });
  const listType = v.oneOf(req.query.list_type, 'List type',
    ['FAVORITE', 'WATCHLIST'], { required: false });
  const params = [req.user.user_id, contentId];
  let clause = '';
  if (listType) {
    clause = ' AND list_type = ?';
    params.push(listType);
  }
  await db.execute(`DELETE FROM saved_content WHERE user_id = ? AND content_id = ?${clause}`, params);
  res.json({ ok: true });
}));

// -----------------------------------------------------------------------------
// Continue reading
// -----------------------------------------------------------------------------
router.get('/progress', asyncHandler(async (req, res) => {
  const scoped = contentScopeClause(req.scope, 'c');
  const rows = await db.query(
    `SELECT ${CARD_COLUMNS}, p.percentage_completed, p.last_position, p.updated_at
       FROM progress p JOIN content c ON c.content_id = p.content_id
      WHERE p.user_id = ?${scoped.clause}
      ORDER BY p.updated_at DESC
      LIMIT 30`,
    [req.user.user_id, ...scoped.params],
  );
  res.json({
    items: (await withTags(rows)).map((r) => ({
      ...normaliseRow(r),
      percentage_completed: Number(r.percentage_completed),
      last_position: Number(r.last_position),
    })),
  });
}));

// -----------------------------------------------------------------------------
// Badges
// -----------------------------------------------------------------------------
router.get('/badges', asyncHandler(async (req, res) => {
  const [all, stats] = await Promise.all([
    db.query(
      `SELECT b.badge_id, b.badge_name, b.description, b.required_count, ub.awarded_at
         FROM badges b
         LEFT JOIN user_badges ub ON ub.badge_id = b.badge_id AND ub.user_id = ?
        ORDER BY b.required_count, b.badge_name`,
      [req.user.user_id],
    ),
    badges.collectStats(req.user.user_id),
  ]);
  res.json({
    items: all.map((b) => ({
      ...b,
      badge_id: Number(b.badge_id),
      required_count: Number(b.required_count),
      earned: !!b.awarded_at,
    })),
    stats,
  });
}));

// -----------------------------------------------------------------------------
// Notifications
// -----------------------------------------------------------------------------
router.get('/notifications', asyncHandler(async (req, res) => {
  const rows = await db.query(
    `SELECT notif_id, title, message, read_status, created_at
       FROM notifications WHERE user_id = ?
      ORDER BY created_at DESC LIMIT 50`,
    [req.user.user_id],
  );
  res.json({
    items: rows.map((r) => ({ ...r, notif_id: Number(r.notif_id), read_status: !!r.read_status })),
  });
}));

router.post('/notifications/read', asyncHandler(async (req, res) => {
  if (req.body.notif_id) {
    const id = v.int(req.body.notif_id, 'Notification id', { min: 1 });
    await db.execute(
      'UPDATE notifications SET read_status = TRUE WHERE notif_id = ? AND user_id = ?',
      [id, req.user.user_id],
    );
  } else {
    await db.execute('UPDATE notifications SET read_status = TRUE WHERE user_id = ?',
      [req.user.user_id]);
  }
  res.json({ ok: true });
}));

// -----------------------------------------------------------------------------
// Screen time
// The reader/player posts a minute at a time while a title is open. Summing
// these rows is what enforces parental_controls.daily_screen_limit.
// -----------------------------------------------------------------------------
router.post('/screen-time', asyncHandler(async (req, res) => {
  const minutes = v.int(req.body.minutes, 'Minutes', { min: 1, max: 10 });

  if (req.user.role === 'CHILD') {
    await audit.logFor(req, {
      activityType: 'SCREEN_TIME',
      description: `${minutes} minute(s) of viewing`,
      contentId: v.int(req.body.content_id, 'Content id', { min: 1, required: false }),
      targetTable: 'progress',
      targetId: minutes,
    });
  }

  if (!req.scope.restricted || req.scope.dailyScreenLimit === null) {
    return res.json({ ok: true, limit: null });
  }
  const used = await screenTimeUsedToday(req.user.user_id);
  return res.json({
    ok: true,
    limit: req.scope.dailyScreenLimit,
    used,
    remaining: Math.max(0, req.scope.dailyScreenLimit - used),
  });
}));

// -----------------------------------------------------------------------------
// Content requests  - a child asking to unlock a blocked title
// -----------------------------------------------------------------------------
router.get('/requests', asyncHandler(async (req, res) => {
  const rows = await db.query(
    `SELECT r.request_id, r.status, r.request_date, r.decision_date,
            c.content_id, c.title, c.content_type, c.age_rating,
            d.name AS decided_by
       FROM content_requests r
       JOIN content c ON c.content_id = r.content_id
       LEFT JOIN users d ON d.user_id = r.decision_by
      WHERE r.user_id = ?
      ORDER BY r.request_date DESC`,
    [req.user.user_id],
  );
  res.json({
    items: rows.map((r) => ({
      ...r, request_id: Number(r.request_id), content_id: Number(r.content_id),
    })),
  });
}));

router.post('/requests', asyncHandler(async (req, res) => {
  if (req.user.role !== 'CHILD') {
    throw ApiError.badRequest('Only a child account needs to request access to a title.');
  }
  const contentId = v.int(req.body.content_id, 'Content id', { min: 1 });
  const note = v.str(req.body.note, 'Note', { required: false, max: 300 });

  const item = await db.queryOne('SELECT content_id, title FROM content WHERE content_id = ?',
    [contentId]);
  if (!item) throw ApiError.notFound('That title is not in the library.');

  const pending = await db.queryOne(
    `SELECT request_id FROM content_requests
      WHERE user_id = ? AND content_id = ? AND status = 'PENDING'`,
    [req.user.user_id, contentId],
  );
  if (pending) throw ApiError.conflict('You already asked for this one. Give your grown-up a moment!');

  const result = await db.execute(
    'INSERT INTO content_requests (user_id, content_id) VALUES (?, ?)',
    [req.user.user_id, contentId],
  );

  // Tell every parent linked to this child.
  const parents = await db.query(
    `SELECT parent_id FROM parent_child_relationships WHERE child_id = ? AND status = 'ACTIVE'`,
    [req.user.user_id],
  );
  for (const p of parents) {
    await db.execute(
      'INSERT INTO notifications (user_id, title, message) VALUES (?, ?, ?)',
      [
        p.parent_id,
        'New content request',
        `${req.user.name} asked to unlock "${item.title}".${note ? ` They said: "${note}"` : ''}`,
      ],
    );
  }

  await audit.logFor(req, {
    activityType: 'CONTENT_REQUEST',
    description: `Requested access to "${item.title}"`,
    contentId,
    targetTable: 'content_requests',
    targetId: result.insertId,
  });

  res.status(201).json({ ok: true, request_id: Number(result.insertId) });
}));

// -----------------------------------------------------------------------------
// Reports  - flag a title or a review for the administrators
// -----------------------------------------------------------------------------
router.post('/reports', asyncHandler(async (req, res) => {
  const reason = v.str(req.body.reason, 'Reason', { min: 5, max: 1000 });
  const contentId = v.int(req.body.content_id, 'Content id', { min: 1, required: false });
  const feedbackId = v.int(req.body.feedback_id, 'Review id', { min: 1, required: false });
  if (!contentId && !feedbackId) {
    throw ApiError.badRequest('Say which title or review you are reporting.');
  }

  const result = await db.execute(
    'INSERT INTO reports (user_id, content_id, feedback_id, reason) VALUES (?, ?, ?, ?)',
    [req.user.user_id, contentId, feedbackId, reason],
  );
  await audit.logFor(req, {
    activityType: 'REPORT',
    description: 'Reported something to the administrators',
    contentId,
    targetTable: 'reports',
    targetId: result.insertId,
  });
  res.status(201).json({ ok: true, report_id: Number(result.insertId) });
}));

// -----------------------------------------------------------------------------
// Announcements  - shown to everyone who is signed in
// -----------------------------------------------------------------------------
router.get('/announcements', asyncHandler(async (req, res) => {
  const rows = await db.query(
    `SELECT a.announcement_id, a.title, a.message, a.created_at, u.name AS posted_by
       FROM announcements a JOIN users u ON u.user_id = a.user_id
      ORDER BY a.created_at DESC LIMIT 10`,
  );
  res.json({ items: rows.map((r) => ({ ...r, announcement_id: Number(r.announcement_id) })) });
}));

module.exports = router;
