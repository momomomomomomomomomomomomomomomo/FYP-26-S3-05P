'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');

const db = require('../db');
const v = require('../utils/validate');
const audit = require('../utils/audit');
const { ApiError, asyncHandler } = require('../utils/errors');
const { ageFromDob } = require('../utils/access');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireRole('ADMIN'));

// -----------------------------------------------------------------------------
// GET /api/admin/stats  - the numbers across the top of the admin dashboard
// -----------------------------------------------------------------------------
router.get('/stats', asyncHandler(async (req, res) => {
  const totals = await db.queryOne(`
    SELECT
      (SELECT COUNT(*) FROM users WHERE role = 'ADULT')  AS adults,
      (SELECT COUNT(*) FROM users WHERE role = 'CHILD')  AS children,
      (SELECT COUNT(*) FROM users WHERE role = 'ADMIN')  AS admins,
      (SELECT COUNT(*) FROM users WHERE account_status = 'SUSPENDED') AS suspended,
      (SELECT COUNT(*) FROM content WHERE content_type = 'BOOK')  AS books,
      (SELECT COUNT(*) FROM content WHERE content_type = 'VIDEO') AS videos,
      (SELECT COUNT(*) FROM feedback) AS reviews,
      (SELECT COUNT(*) FROM reports WHERE status = 'OPEN') AS open_reports,
      (SELECT COUNT(*) FROM chat_sessions) AS chat_sessions,
      (SELECT COUNT(*) FROM content_requests WHERE status = 'PENDING') AS pending_requests`);

  const activity = await db.query(
    `SELECT DATE(created_at) AS day, COUNT(*) AS events
       FROM audit_logs
      WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 13 DAY)
      GROUP BY DATE(created_at) ORDER BY day`,
  );

  const popular = await db.query(
    `SELECT c.content_id, c.title, c.content_type,
            COUNT(p.progress_id) AS readers,
            COALESCE(AVG(f.rating), 0) AS avg_rating
       FROM content c
       LEFT JOIN progress p ON p.content_id = c.content_id
       LEFT JOIN feedback f ON f.content_id = c.content_id AND f.status = 'ACTIVE'
      GROUP BY c.content_id, c.title, c.content_type
      ORDER BY readers DESC, avg_rating DESC
      LIMIT 8`,
  );

  res.json({
    totals: Object.fromEntries(Object.entries(totals).map(([k, val]) => [k, Number(val)])),
    activity: activity.map((a) => ({ day: a.day, events: Number(a.events) })),
    popular: popular.map((p) => ({
      ...p,
      content_id: Number(p.content_id),
      readers: Number(p.readers),
      avg_rating: Number(Number(p.avg_rating).toFixed(2)),
    })),
  });
}));

// -----------------------------------------------------------------------------
// GET /api/admin/users  - every account, with a filter bar
// -----------------------------------------------------------------------------
router.get('/users', asyncHandler(async (req, res) => {
  const where = [];
  const params = [];

  const role = v.oneOf(req.query.role, 'Role', ['ADMIN', 'ADULT', 'CHILD'], { required: false });
  if (role) {
    where.push('u.role = ?');
    params.push(role);
  }
  const status = v.oneOf(req.query.status, 'Status', ['ACTIVE', 'SUSPENDED'], { required: false });
  if (status) {
    where.push('u.account_status = ?');
    params.push(status);
  }
  const q = v.str(req.query.q, 'Search', { required: false, max: 100 });
  if (q) {
    where.push('(u.name LIKE ? OR u.email LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = v.limit(req.query.limit, 50, 200);
  const offset = v.offset(req.query.offset);

  const rows = await db.query(
    `SELECT u.user_id, u.role, u.name, u.email, u.dob, u.reading_level,
            u.account_status, u.created_at,
            (SELECT GROUP_CONCAT(p.name SEPARATOR ', ')
               FROM parent_child_relationships r JOIN users p ON p.user_id = r.parent_id
              WHERE r.child_id = u.user_id) AS parents,
            (SELECT COUNT(*) FROM parent_child_relationships r WHERE r.parent_id = u.user_id) AS child_count
       FROM users u
       ${whereSql}
      ORDER BY u.created_at DESC
      LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  const total = await db.queryOne(`SELECT COUNT(*) AS n FROM users u ${whereSql}`, params);

  res.json({
    items: rows.map((u) => ({
      ...u,
      user_id: Number(u.user_id),
      age: ageFromDob(u.dob),
      child_count: Number(u.child_count),
    })),
    total: Number(total.n),
    limit,
    offset,
  });
}));

// -----------------------------------------------------------------------------
// PATCH /api/admin/users/:id  - suspend, rename, change role, reset password
// -----------------------------------------------------------------------------
router.patch('/users/:id', asyncHandler(async (req, res) => {
  const userId = v.int(req.params.id, 'User id', { min: 1 });
  const target = await db.queryOne('SELECT user_id, role, name FROM users WHERE user_id = ?', [userId]);
  if (!target) throw ApiError.notFound('That account does not exist.');

  // Guard rails so an administrator cannot lock themselves out.
  if (Number(userId) === Number(req.user.user_id)
      && (req.body.account_status === 'SUSPENDED' || (req.body.role && req.body.role !== 'ADMIN'))) {
    throw ApiError.badRequest('You cannot suspend or demote your own administrator account.');
  }

  const updates = [];
  const params = [];

  if (req.body.name !== undefined) {
    updates.push('name = ?');
    params.push(v.str(req.body.name, 'Name', { min: 2, max: 100 }));
  }
  if (req.body.account_status !== undefined) {
    updates.push('account_status = ?');
    params.push(v.oneOf(req.body.account_status, 'Account status', ['ACTIVE', 'SUSPENDED']));
  }
  if (req.body.role !== undefined) {
    const role = v.oneOf(req.body.role, 'Role', ['ADMIN', 'ADULT', 'CHILD']);
    if (target.role === 'CHILD' && role !== 'CHILD') {
      throw ApiError.badRequest('Promote a child account by creating a new adult account instead.');
    }
    updates.push('role = ?');
    params.push(role);
  }
  if (req.body.password !== undefined) {
    updates.push('password = ?');
    params.push(await bcrypt.hash(
      target.role === 'CHILD' ? v.childPassword(req.body.password) : v.password(req.body.password), 12,
    ));
  }

  if (!updates.length) throw ApiError.badRequest('There is nothing to update.');
  params.push(userId);
  await db.execute(`UPDATE users SET ${updates.join(', ')} WHERE user_id = ?`, params);

  await audit.logFor(req, {
    activityType: 'ADMIN_USER_UPDATE',
    description: `Updated account "${target.name}" (#${userId})`,
    targetTable: 'users',
    targetId: userId,
  });
  res.json({ ok: true });
}));

// -----------------------------------------------------------------------------
// DELETE /api/admin/users/:id
// -----------------------------------------------------------------------------
router.delete('/users/:id', asyncHandler(async (req, res) => {
  const userId = v.int(req.params.id, 'User id', { min: 1 });
  if (Number(userId) === Number(req.user.user_id)) {
    throw ApiError.badRequest('You cannot delete your own account.');
  }
  const target = await db.queryOne('SELECT name FROM users WHERE user_id = ?', [userId]);
  if (!target) throw ApiError.notFound('That account does not exist.');

  await db.execute('DELETE FROM users WHERE user_id = ?', [userId]);
  await audit.logFor(req, {
    activityType: 'ADMIN_USER_DELETE',
    description: `Deleted account "${target.name}" (#${userId})`,
    targetTable: 'users',
    targetId: userId,
  });
  res.json({ ok: true });
}));

// -----------------------------------------------------------------------------
// Content management
// -----------------------------------------------------------------------------
function readContentBody(body, { partial = false } = {}) {
  const required = !partial;
  const out = {};
  if (!partial || body.content_type !== undefined) {
    out.content_type = v.oneOf(body.content_type, 'Type', ['BOOK', 'VIDEO'], { required });
  }
  if (!partial || body.title !== undefined) {
    out.title = v.str(body.title, 'Title', { min: 2, max: 255, required });
  }
  if (!partial || body.description !== undefined) {
    out.description = v.str(body.description, 'Description', { required: false, max: 4000 });
  }
  if (!partial || body.author_creator !== undefined) {
    out.author_creator = v.str(body.author_creator, 'Author or creator', { required: false, max: 255 });
  }
  if (!partial || body.age_rating !== undefined) {
    out.age_rating = v.int(body.age_rating, 'Age rating', { min: 0, max: 18, required: false });
  }
  if (!partial || body.reading_level !== undefined) {
    out.reading_level = v.oneOf(body.reading_level, 'Reading level',
      ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'], { required: false });
  }
  if (!partial || body.language !== undefined) {
    out.language = v.str(body.language, 'Language', { required: false, max: 50 }) || 'English';
  }
  if (!partial || body.duration_minutes !== undefined) {
    out.duration_minutes = v.int(body.duration_minutes, 'Duration', { min: 0, max: 1000, required: false });
  }
  if (!partial || body.cover_image_url !== undefined) {
    out.cover_image_url = v.str(body.cover_image_url, 'Cover image URL', { required: false, max: 1000 });
  }
  if (!partial || body.external_link !== undefined) {
    out.external_link = v.str(body.external_link, 'External link', { required: false, max: 1000 });
  }
  return out;
}

/** Replaces a title's tags, creating any tag that does not exist yet. */
async function syncTags(conn, contentId, tagNames) {
  await conn.execute('DELETE FROM content_tags WHERE content_id = ?', [contentId]);
  for (const raw of tagNames.slice(0, 12)) {
    const name = v.str(raw, 'Tag', { max: 100 });
    const [existing] = await conn.execute('SELECT tag_id FROM tags WHERE tag_name = ?', [name]);
    let tagId;
    if (existing.length) {
      tagId = existing[0].tag_id;
    } else {
      const [created] = await conn.execute('INSERT INTO tags (tag_name) VALUES (?)', [name]);
      tagId = created.insertId;
    }
    await conn.execute('INSERT IGNORE INTO content_tags (content_id, tag_id) VALUES (?, ?)',
      [contentId, tagId]);
  }
}

router.post('/content', asyncHandler(async (req, res) => {
  const data = readContentBody(req.body);
  const tags = Array.isArray(req.body.tags) ? req.body.tags : [];

  const contentId = await db.transaction(async (conn) => {
    const [result] = await conn.execute(
      `INSERT INTO content
         (content_type, title, description, author_creator, age_rating, reading_level,
          language, duration_minutes, cover_image_url, external_link, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [data.content_type, data.title, data.description, data.author_creator, data.age_rating,
        data.reading_level, data.language, data.duration_minutes, data.cover_image_url,
        data.external_link, req.user.user_id],
    );
    await syncTags(conn, result.insertId, tags);
    return result.insertId;
  });

  await audit.logFor(req, {
    activityType: 'CONTENT_CREATE',
    description: `Added "${data.title}" to the library`,
    contentId,
    targetTable: 'content',
    targetId: contentId,
  });
  res.status(201).json({ ok: true, content_id: Number(contentId) });
}));

router.put('/content/:id', asyncHandler(async (req, res) => {
  const contentId = v.int(req.params.id, 'Content id', { min: 1 });
  const existing = await db.queryOne('SELECT content_id, title FROM content WHERE content_id = ?',
    [contentId]);
  if (!existing) throw ApiError.notFound('That title is not in the library.');

  const data = readContentBody(req.body, { partial: true });
  const tags = Array.isArray(req.body.tags) ? req.body.tags : null;

  await db.transaction(async (conn) => {
    const fields = Object.keys(data);
    if (fields.length) {
      await conn.execute(
        `UPDATE content SET ${fields.map((f) => `${f} = ?`).join(', ')} WHERE content_id = ?`,
        [...fields.map((f) => data[f]), contentId],
      );
    }
    if (tags) await syncTags(conn, contentId, tags);
  });

  await audit.logFor(req, {
    activityType: 'CONTENT_UPDATE',
    description: `Edited "${data.title || existing.title}"`,
    contentId,
    targetTable: 'content',
    targetId: contentId,
  });
  res.json({ ok: true });
}));

router.delete('/content/:id', asyncHandler(async (req, res) => {
  const contentId = v.int(req.params.id, 'Content id', { min: 1 });
  const existing = await db.queryOne('SELECT title FROM content WHERE content_id = ?', [contentId]);
  if (!existing) throw ApiError.notFound('That title is not in the library.');

  await db.execute('DELETE FROM content WHERE content_id = ?', [contentId]);
  await audit.logFor(req, {
    activityType: 'CONTENT_DELETE',
    description: `Removed "${existing.title}" from the library`,
    targetTable: 'content',
    targetId: contentId,
  });
  res.json({ ok: true });
}));

// -----------------------------------------------------------------------------
// Tags
// -----------------------------------------------------------------------------
router.post('/tags', asyncHandler(async (req, res) => {
  const name = v.str(req.body.tag_name, 'Tag name', { min: 2, max: 100 });
  const category = v.oneOf(req.body.category, 'Category',
    ['GENRE', 'THEME', 'TOPIC'], { required: false }) || 'GENRE';
  const result = await db.execute('INSERT INTO tags (tag_name, category) VALUES (?, ?)',
    [name, category]);
  res.status(201).json({ ok: true, tag_id: Number(result.insertId) });
}));

router.delete('/tags/:id', asyncHandler(async (req, res) => {
  const tagId = v.int(req.params.id, 'Tag id', { min: 1 });
  await db.execute('DELETE FROM tags WHERE tag_id = ?', [tagId]);
  res.json({ ok: true });
}));

// -----------------------------------------------------------------------------
// Reports and moderation
// -----------------------------------------------------------------------------
router.get('/reports', asyncHandler(async (req, res) => {
  const status = v.oneOf(req.query.status, 'Status',
    ['OPEN', 'RESOLVED', 'DISMISSED'], { required: false });
  const params = [];
  let clause = '';
  if (status) {
    clause = 'WHERE r.status = ?';
    params.push(status);
  }
  const rows = await db.query(
    `SELECT r.report_id, r.reason, r.status, r.created_at,
            u.user_id AS reporter_id, u.name AS reporter, u.role AS reporter_role,
            c.content_id, c.title AS content_title,
            f.feedback_id, f.review AS reported_review, f.status AS review_status,
            fu.name AS review_author
       FROM reports r
       JOIN users u ON u.user_id = r.user_id
       LEFT JOIN content c ON c.content_id = r.content_id
       LEFT JOIN feedback f ON f.feedback_id = r.feedback_id
       LEFT JOIN users fu ON fu.user_id = f.user_id
       ${clause}
      ORDER BY FIELD(r.status, 'OPEN', 'RESOLVED', 'DISMISSED'), r.created_at DESC
      LIMIT 100`,
    params,
  );
  res.json({ items: rows.map((r) => ({ ...r, report_id: Number(r.report_id) })) });
}));

router.patch('/reports/:id', asyncHandler(async (req, res) => {
  const reportId = v.int(req.params.id, 'Report id', { min: 1 });
  const status = v.oneOf(req.body.status, 'Status', ['OPEN', 'RESOLVED', 'DISMISSED']);
  // Optionally hide the review that was reported, in the same step.
  const hideReview = v.bool(req.body.hide_review, false);

  const report = await db.queryOne('SELECT feedback_id FROM reports WHERE report_id = ?', [reportId]);
  if (!report) throw ApiError.notFound('That report does not exist.');

  await db.execute('UPDATE reports SET status = ? WHERE report_id = ?', [status, reportId]);
  if (hideReview && report.feedback_id) {
    await db.execute(`UPDATE feedback SET status = 'HIDDEN' WHERE feedback_id = ?`,
      [report.feedback_id]);
  }

  await audit.logFor(req, {
    activityType: 'REPORT_DECISION',
    description: `Marked report #${reportId} as ${status}${hideReview ? ' and hid the review' : ''}`,
    targetTable: 'reports',
    targetId: reportId,
  });
  res.json({ ok: true });
}));

// -----------------------------------------------------------------------------
// Announcements  - posting one notifies every active account
// -----------------------------------------------------------------------------
router.get('/announcements', asyncHandler(async (req, res) => {
  const rows = await db.query(
    `SELECT a.announcement_id, a.title, a.message, a.created_at, u.name AS posted_by
       FROM announcements a JOIN users u ON u.user_id = a.user_id
      ORDER BY a.created_at DESC LIMIT 50`,
  );
  res.json({ items: rows.map((r) => ({ ...r, announcement_id: Number(r.announcement_id) })) });
}));

router.post('/announcements', asyncHandler(async (req, res) => {
  const title = v.str(req.body.title, 'Title', { min: 3, max: 255 });
  const message = v.str(req.body.message, 'Message', { min: 3, max: 4000 });

  const result = await db.execute(
    'INSERT INTO announcements (title, message, user_id) VALUES (?, ?, ?)',
    [title, message, req.user.user_id],
  );

  // Fan the announcement out to everyone's notification list.
  await db.execute(
    `INSERT INTO notifications (user_id, title, message)
     SELECT user_id, ?, ? FROM users WHERE account_status = 'ACTIVE'`,
    [title, message],
  );

  await audit.logFor(req, {
    activityType: 'ANNOUNCEMENT',
    description: `Posted announcement "${title}"`,
    targetTable: 'announcements',
    targetId: result.insertId,
  });
  res.status(201).json({ ok: true, announcement_id: Number(result.insertId) });
}));

router.delete('/announcements/:id', asyncHandler(async (req, res) => {
  const id = v.int(req.params.id, 'Announcement id', { min: 1 });
  await db.execute('DELETE FROM announcements WHERE announcement_id = ?', [id]);
  res.json({ ok: true });
}));

// -----------------------------------------------------------------------------
// GET /api/admin/logs  - the full audit trail
// -----------------------------------------------------------------------------
router.get('/logs', asyncHandler(async (req, res) => {
  const where = [];
  const params = [];

  const userId = v.int(req.query.user_id, 'User id', { min: 1, required: false });
  if (userId) {
    where.push('l.user_id = ?');
    params.push(userId);
  }
  const activity = v.str(req.query.activity_type, 'Activity type', { required: false, max: 50 });
  if (activity) {
    where.push('l.activity_type = ?');
    params.push(activity);
  }
  const role = v.oneOf(req.query.actor_role, 'Role', ['ADMIN', 'ADULT', 'CHILD'], { required: false });
  if (role) {
    where.push('l.actor_role = ?');
    params.push(role);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = v.limit(req.query.limit, 100, 500);
  const offset = v.offset(req.query.offset);

  const rows = await db.query(
    `SELECT l.log_id, l.activity_type, l.description, l.actor_role, l.created_at,
            l.target_table, l.target_id,
            u.name AS actor_name, u.user_id AS actor_id,
            c.title AS content_title
       FROM audit_logs l
       JOIN users u ON u.user_id = l.user_id
       LEFT JOIN content c ON c.content_id = l.content_id
       ${whereSql}
      ORDER BY l.created_at DESC, l.log_id DESC
      LIMIT ${limit} OFFSET ${offset}`,
    params,
  );

  const types = await db.query('SELECT DISTINCT activity_type FROM audit_logs ORDER BY activity_type');

  res.json({
    items: rows.map((r) => ({ ...r, log_id: Number(r.log_id), actor_id: Number(r.actor_id) })),
    activity_types: types.map((t) => t.activity_type),
    limit,
    offset,
  });
}));

module.exports = router;
