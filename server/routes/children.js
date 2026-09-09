'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');

const db = require('../db');
const v = require('../utils/validate');
const audit = require('../utils/audit');
const { ApiError, asyncHandler } = require('../utils/errors');
const { ageFromDob, loadManagedChild, screenTimeUsedToday } = require('../utils/access');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireRole('ADULT', 'ADMIN'));

const MAX_CHILD_AGE = 17;

/** The ids of every child this caller manages (all of them, for an admin). */
async function managedChildIds(req) {
  if (req.user.role === 'ADMIN') {
    const rows = await db.query(`SELECT user_id FROM users WHERE role = 'CHILD'`);
    return rows.map((r) => Number(r.user_id));
  }
  const rows = await db.query(
    `SELECT child_id FROM parent_child_relationships
      WHERE parent_id = ? AND status = 'ACTIVE'`,
    [req.user.user_id],
  );
  return rows.map((r) => Number(r.child_id));
}

// -----------------------------------------------------------------------------
// GET /api/children  - the parent dashboard list
// -----------------------------------------------------------------------------
router.get('/', asyncHandler(async (req, res) => {
  const rows = req.user.role === 'ADMIN'
    ? await db.query(
      `SELECT u.user_id, u.name, u.email, u.dob, u.reading_level, u.account_status, u.created_at,
              pc.max_age, pc.daily_screen_limit, pc.allow_content
         FROM users u LEFT JOIN parental_controls pc ON pc.child_id = u.user_id
        WHERE u.role = 'CHILD' ORDER BY u.name`)
    : await db.query(
      `SELECT u.user_id, u.name, u.email, u.dob, u.reading_level, u.account_status, u.created_at,
              pc.max_age, pc.daily_screen_limit, pc.allow_content
         FROM parent_child_relationships r
         JOIN users u ON u.user_id = r.child_id
         LEFT JOIN parental_controls pc ON pc.child_id = u.user_id
        WHERE r.parent_id = ? AND r.status = 'ACTIVE'
        ORDER BY u.name`,
      [req.user.user_id]);

  const items = [];
  for (const child of rows) {
    const [stats, blocked, screenUsed] = await Promise.all([
      db.queryOne(
        `SELECT (SELECT COUNT(*) FROM progress WHERE user_id = ?) AS started,
                (SELECT COUNT(*) FROM progress WHERE user_id = ? AND percentage_completed >= 100) AS completed,
                (SELECT COUNT(*) FROM content_requests WHERE user_id = ? AND status = 'PENDING') AS pending_requests`,
        [child.user_id, child.user_id, child.user_id],
      ),
      db.query('SELECT blocked_genre FROM child_blocked_genres WHERE child_id = ?', [child.user_id]),
      screenTimeUsedToday(child.user_id),
    ]);
    items.push({
      user_id: Number(child.user_id),
      name: child.name,
      login_id: child.email,
      dob: child.dob,
      age: ageFromDob(child.dob),
      reading_level: child.reading_level,
      account_status: child.account_status,
      created_at: child.created_at,
      controls: {
        max_age: child.max_age === null ? null : Number(child.max_age),
        daily_screen_limit: child.daily_screen_limit === null ? null : Number(child.daily_screen_limit),
        allow_content: child.allow_content === null ? true : !!child.allow_content,
        blocked_genres: blocked.map((b) => b.blocked_genre),
      },
      stats: {
        started: Number(stats.started),
        completed: Number(stats.completed),
        pending_requests: Number(stats.pending_requests),
        screen_time_today: screenUsed,
      },
    });
  }
  res.json({ items });
}));

// -----------------------------------------------------------------------------
// POST /api/children  - create a child account
// Children sign in with a short login id instead of an email address, so a
// parent does not need to give their child an inbox.
// -----------------------------------------------------------------------------
router.post('/', asyncHandler(async (req, res) => {
  const name = v.str(req.body.name, 'Name', { min: 2, max: 100 });
  const loginId = v.loginId(req.body.login_id);
  const password = v.childPassword(req.body.password);
  const dob = v.dateOfBirth(req.body.dob);
  const readingLevel = v.oneOf(req.body.reading_level, 'Reading level',
    ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'], { required: false });

  const age = ageFromDob(dob);
  if (age > MAX_CHILD_AGE) {
    throw ApiError.badRequest(`A child account is for under-${MAX_CHILD_AGE + 1}s. `
      + 'Someone this age should register their own adult account.');
  }

  const clash = await db.queryOne('SELECT user_id FROM users WHERE email = ?', [loginId]);
  if (clash) throw ApiError.conflict('That login ID is already taken. Try another one.');

  const maxAge = v.int(req.body.max_age, 'Maximum age rating', { min: 0, max: 18, required: false });
  const screenLimit = v.int(req.body.daily_screen_limit, 'Daily screen limit',
    { min: 0, max: 1440, required: false });
  const allowContent = v.bool(req.body.allow_content, true);
  const blockedGenres = (Array.isArray(req.body.blocked_genres) ? req.body.blocked_genres : [])
    .map((g) => v.str(g, 'Genre', { max: 100 })).slice(0, 30);

  const hash = await bcrypt.hash(password, 12);

  const childId = await db.transaction(async (conn) => {
    const [created] = await conn.execute(
      `INSERT INTO users (role, name, email, password, dob, reading_level, parental_consent, account_status)
       VALUES ('CHILD', ?, ?, ?, ?, ?, TRUE, 'ACTIVE')`,
      [name, loginId, hash, dob, readingLevel],
    );
    const id = created.insertId;

    await conn.execute(
      'INSERT INTO parent_child_relationships (parent_id, child_id) VALUES (?, ?)',
      [req.user.user_id, id],
    );
    await conn.execute(
      `INSERT INTO parental_controls (child_id, max_age, daily_screen_limit, allow_content)
       VALUES (?, ?, ?, ?)`,
      [id, maxAge, screenLimit, allowContent],
    );
    for (const genre of blockedGenres) {
      await conn.execute(
        'INSERT IGNORE INTO child_blocked_genres (child_id, blocked_genre) VALUES (?, ?)',
        [id, genre],
      );
    }
    return id;
  });

  await audit.logFor(req, {
    activityType: 'CHILD_CREATE',
    description: `Created child account "${name}" (login ${loginId})`,
    targetTable: 'users',
    targetId: childId,
  });

  res.status(201).json({ ok: true, child_id: Number(childId), login_id: loginId });
}));

// -----------------------------------------------------------------------------
// GET /api/children/requests  - everything waiting on this parent
// (declared before /:id so "requests" is not read as an id)
// -----------------------------------------------------------------------------
router.get('/requests', asyncHandler(async (req, res) => {
  const ids = await managedChildIds(req);
  if (!ids.length) return res.json({ items: [] });

  const status = v.oneOf(req.query.status, 'Status',
    ['PENDING', 'APPROVED', 'DENIED'], { required: false });
  const params = [...ids];
  let clause = '';
  if (status) {
    clause = ' AND r.status = ?';
    params.push(status);
  }

  const rows = await db.query(
    `SELECT r.request_id, r.status, r.request_date, r.decision_date,
            u.user_id AS child_id, u.name AS child_name,
            c.content_id, c.title, c.content_type, c.age_rating, c.description
       FROM content_requests r
       JOIN users u ON u.user_id = r.user_id
       JOIN content c ON c.content_id = r.content_id
      WHERE r.user_id IN (${ids.map(() => '?').join(',')})${clause}
      ORDER BY FIELD(r.status, 'PENDING', 'APPROVED', 'DENIED'), r.request_date DESC`,
    params,
  );

  return res.json({
    items: rows.map((r) => ({
      ...r,
      request_id: Number(r.request_id),
      child_id: Number(r.child_id),
      content_id: Number(r.content_id),
    })),
  });
}));

// -----------------------------------------------------------------------------
// POST /api/children/requests/:id/decision  - approve or deny
// -----------------------------------------------------------------------------
router.post('/requests/:id/decision', asyncHandler(async (req, res) => {
  const requestId = v.int(req.params.id, 'Request id', { min: 1 });
  const decision = v.oneOf(req.body.decision, 'Decision', ['APPROVED', 'DENIED']);

  const request = await db.queryOne(
    `SELECT r.request_id, r.user_id, r.status, c.title, c.content_id
       FROM content_requests r JOIN content c ON c.content_id = r.content_id
      WHERE r.request_id = ?`,
    [requestId],
  );
  if (!request) throw ApiError.notFound('That request does not exist.');

  await loadManagedChild(req, request.user_id);
  if (request.status !== 'PENDING') throw ApiError.conflict('That request has already been decided.');

  await db.execute(
    `UPDATE content_requests
        SET status = ?, decision_by = ?, decision_date = NOW()
      WHERE request_id = ?`,
    [decision, req.user.user_id, requestId],
  );

  await db.execute(
    'INSERT INTO notifications (user_id, title, message) VALUES (?, ?, ?)',
    [
      request.user_id,
      decision === 'APPROVED' ? 'Request approved!' : 'Request not approved',
      decision === 'APPROVED'
        ? `"${request.title}" is unlocked - it is waiting for you in the library.`
        : `"${request.title}" stays locked for now. Ask your grown-up if you want to know why.`,
    ],
  );

  await audit.logFor(req, {
    activityType: decision === 'APPROVED' ? 'REQUEST_APPROVE' : 'REQUEST_DENY',
    description: `${decision === 'APPROVED' ? 'Approved' : 'Denied'} access to "${request.title}"`,
    contentId: request.content_id,
    targetTable: 'content_requests',
    targetId: requestId,
  });

  res.json({ ok: true, status: decision });
}));

// -----------------------------------------------------------------------------
// GET /api/children/:id  - one child, in full
// -----------------------------------------------------------------------------
router.get('/:id', asyncHandler(async (req, res) => {
  const childId = v.int(req.params.id, 'Child id', { min: 1 });
  const child = await loadManagedChild(req, childId);

  const [controls, blocked, badgeRows, stats, screenUsed] = await Promise.all([
    db.queryOne(
      'SELECT max_age, daily_screen_limit, allow_content FROM parental_controls WHERE child_id = ?',
      [childId],
    ),
    db.query('SELECT blocked_genre FROM child_blocked_genres WHERE child_id = ?', [childId]),
    db.query(
      `SELECT b.badge_name, b.description, ub.awarded_at
         FROM user_badges ub JOIN badges b ON b.badge_id = ub.badge_id
        WHERE ub.user_id = ? ORDER BY ub.awarded_at DESC`,
      [childId],
    ),
    db.queryOne(
      `SELECT (SELECT COUNT(*) FROM progress WHERE user_id = ?) AS started,
              (SELECT COUNT(*) FROM progress WHERE user_id = ? AND percentage_completed >= 100) AS completed,
              (SELECT COUNT(*) FROM feedback WHERE user_id = ?) AS reviews,
              (SELECT COUNT(*) FROM saved_content WHERE user_id = ?) AS saved,
              (SELECT COUNT(*) FROM content_requests WHERE user_id = ? AND status = 'PENDING') AS pending_requests`,
      [childId, childId, childId, childId, childId],
    ),
    screenTimeUsedToday(childId),
  ]);

  const recent = await db.query(
    `SELECT c.content_id, c.title, c.content_type, c.age_rating, c.cover_image_url,
            p.percentage_completed, p.updated_at
       FROM progress p JOIN content c ON c.content_id = p.content_id
      WHERE p.user_id = ?
      ORDER BY p.updated_at DESC LIMIT 10`,
    [childId],
  );

  res.json({
    child: {
      user_id: Number(child.user_id),
      name: child.name,
      login_id: child.email,
      dob: child.dob,
      age: ageFromDob(child.dob),
      reading_level: child.reading_level,
      account_status: child.account_status,
      created_at: child.created_at,
    },
    controls: {
      max_age: controls && controls.max_age !== null ? Number(controls.max_age) : null,
      daily_screen_limit: controls && controls.daily_screen_limit !== null
        ? Number(controls.daily_screen_limit) : null,
      allow_content: controls ? !!controls.allow_content : true,
      blocked_genres: blocked.map((b) => b.blocked_genre),
    },
    badges: badgeRows,
    stats: {
      started: Number(stats.started),
      completed: Number(stats.completed),
      reviews: Number(stats.reviews),
      saved: Number(stats.saved),
      pending_requests: Number(stats.pending_requests),
      screen_time_today: screenUsed,
    },
    recent: recent.map((r) => ({
      ...r,
      content_id: Number(r.content_id),
      percentage_completed: Number(r.percentage_completed),
    })),
  });
}));

// -----------------------------------------------------------------------------
// PATCH /api/children/:id  - name, reading level, status, password reset
// -----------------------------------------------------------------------------
router.patch('/:id', asyncHandler(async (req, res) => {
  const childId = v.int(req.params.id, 'Child id', { min: 1 });
  const child = await loadManagedChild(req, childId);

  const updates = [];
  const params = [];

  if (req.body.name !== undefined) {
    updates.push('name = ?');
    params.push(v.str(req.body.name, 'Name', { min: 2, max: 100 }));
  }
  if (req.body.reading_level !== undefined) {
    updates.push('reading_level = ?');
    params.push(v.oneOf(req.body.reading_level, 'Reading level',
      ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'], { required: false }));
  }
  if (req.body.account_status !== undefined) {
    updates.push('account_status = ?');
    params.push(v.oneOf(req.body.account_status, 'Account status', ['ACTIVE', 'SUSPENDED']));
  }
  if (req.body.login_id !== undefined) {
    const loginId = v.loginId(req.body.login_id);
    const clash = await db.queryOne(
      'SELECT user_id FROM users WHERE email = ? AND user_id <> ?', [loginId, childId],
    );
    if (clash) throw ApiError.conflict('That login ID is already taken.');
    updates.push('email = ?');
    params.push(loginId);
  }
  if (req.body.password !== undefined) {
    // A parent can reset a child's password without knowing the old one.
    updates.push('password = ?');
    params.push(await bcrypt.hash(v.childPassword(req.body.password), 12));
  }

  if (!updates.length) throw ApiError.badRequest('There is nothing to update.');

  params.push(childId);
  await db.execute(`UPDATE users SET ${updates.join(', ')} WHERE user_id = ?`, params);

  await audit.logFor(req, {
    activityType: 'CHILD_UPDATE',
    description: `Updated child account "${child.name}"`,
    targetTable: 'users',
    targetId: childId,
  });

  res.json({ ok: true });
}));

// -----------------------------------------------------------------------------
// DELETE /api/children/:id
// -----------------------------------------------------------------------------
router.delete('/:id', asyncHandler(async (req, res) => {
  const childId = v.int(req.params.id, 'Child id', { min: 1 });
  const child = await loadManagedChild(req, childId);

  await db.execute('DELETE FROM users WHERE user_id = ? AND role = ?', [childId, 'CHILD']);
  await audit.logFor(req, {
    activityType: 'CHILD_DELETE',
    description: `Deleted child account "${child.name}"`,
    targetTable: 'users',
    targetId: childId,
  });
  res.json({ ok: true });
}));

// -----------------------------------------------------------------------------
// PUT /api/children/:id/controls  - the parental controls panel
// -----------------------------------------------------------------------------
router.put('/:id/controls', asyncHandler(async (req, res) => {
  const childId = v.int(req.params.id, 'Child id', { min: 1 });
  const child = await loadManagedChild(req, childId);

  const maxAge = v.int(req.body.max_age, 'Maximum age rating', { min: 0, max: 18, required: false });
  const screenLimit = v.int(req.body.daily_screen_limit, 'Daily screen limit',
    { min: 0, max: 1440, required: false });
  const allowContent = v.bool(req.body.allow_content, true);
  const blockedGenres = Array.isArray(req.body.blocked_genres) ? req.body.blocked_genres : null;

  await db.transaction(async (conn) => {
    await conn.execute(
      `INSERT INTO parental_controls (child_id, max_age, daily_screen_limit, allow_content)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         max_age = VALUES(max_age),
         daily_screen_limit = VALUES(daily_screen_limit),
         allow_content = VALUES(allow_content)`,
      [childId, maxAge, screenLimit, allowContent],
    );

    if (blockedGenres) {
      await conn.execute('DELETE FROM child_blocked_genres WHERE child_id = ?', [childId]);
      for (const genre of blockedGenres.slice(0, 30)) {
        await conn.execute(
          'INSERT IGNORE INTO child_blocked_genres (child_id, blocked_genre) VALUES (?, ?)',
          [childId, v.str(genre, 'Genre', { max: 100 })],
        );
      }
    }
  });

  await db.execute(
    'INSERT INTO notifications (user_id, title, message) VALUES (?, ?, ?)',
    [childId, 'Your library settings changed',
      'A grown-up updated what you can see in StoryNest. Some titles may have appeared or disappeared.'],
  );

  await audit.logFor(req, {
    activityType: 'CONTROLS_UPDATE',
    description: `Updated parental controls for "${child.name}"`,
    targetTable: 'parental_controls',
    targetId: childId,
  });

  res.json({ ok: true });
}));

// -----------------------------------------------------------------------------
// GET /api/children/:id/activity  - what this child has been doing
// -----------------------------------------------------------------------------
router.get('/:id/activity', asyncHandler(async (req, res) => {
  const childId = v.int(req.params.id, 'Child id', { min: 1 });
  await loadManagedChild(req, childId);
  const limit = v.limit(req.query.limit, 50, 200);

  const rows = await db.query(
    `SELECT l.log_id, l.activity_type, l.description, l.created_at,
            c.title AS content_title, c.content_id
       FROM audit_logs l
       LEFT JOIN content c ON c.content_id = l.content_id
      WHERE l.user_id = ? AND l.activity_type <> 'SCREEN_TIME'
      ORDER BY l.created_at DESC
      LIMIT ${limit}`,
    [childId],
  );

  const daily = await db.query(
    `SELECT DATE(created_at) AS day, COALESCE(SUM(target_id), 0) AS minutes
       FROM audit_logs
      WHERE user_id = ? AND activity_type = 'SCREEN_TIME'
        AND created_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
      GROUP BY DATE(created_at) ORDER BY day`,
    [childId],
  );

  res.json({
    items: rows.map((r) => ({ ...r, log_id: Number(r.log_id) })),
    screen_time_week: daily.map((d) => ({ day: d.day, minutes: Number(d.minutes) })),
  });
}));

module.exports = router;
