'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');

const db = require('../db');
const v = require('../utils/validate');
const audit = require('../utils/audit');
const { ApiError, asyncHandler } = require('../utils/errors');
const { ageFromDob, buildViewerScope, screenTimeUsedToday } = require('../utils/access');
const {
  signToken, setAuthCookie, clearAuthCookie, requireAuth,
} = require('../middleware/auth');

const router = express.Router();

// Slows down password guessing without getting in a real user's way.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait a few minutes and try again.' },
});

const MIN_ADULT_AGE = 18;

/** The shape of a user the front end is allowed to see. */
function publicUser(user) {
  return {
    user_id: Number(user.user_id),
    role: user.role,
    name: user.name,
    email: user.email,
    dob: user.dob,
    age: ageFromDob(user.dob),
    reading_level: user.reading_level,
    account_status: user.account_status,
    created_at: user.created_at,
    parent_id: user.parent_id ? Number(user.parent_id) : null,
  };
}

// -----------------------------------------------------------------------------
// POST /api/auth/register  - an adult creating their own account
// -----------------------------------------------------------------------------
router.post('/register', authLimiter, asyncHandler(async (req, res) => {
  const name = v.str(req.body.name, 'Name', { min: 2, max: 100 });
  const email = v.email(req.body.email);
  const password = v.password(req.body.password);
  const dob = v.dateOfBirth(req.body.dob);

  if (ageFromDob(dob) < MIN_ADULT_AGE) {
    throw ApiError.badRequest(
      `You must be at least ${MIN_ADULT_AGE} to open an adult account. `
      + 'Ask a parent or guardian to create an account and add you as a child.',
    );
  }

  const existing = await db.queryOne('SELECT user_id FROM users WHERE email = ?', [email]);
  if (existing) throw ApiError.conflict('An account with that email already exists.');

  const hash = await bcrypt.hash(password, 12);
  const result = await db.execute(
    `INSERT INTO users (role, name, email, password, dob, parental_consent, account_status)
     VALUES ('ADULT', ?, ?, ?, ?, TRUE, 'ACTIVE')`,
    [name, email, hash, dob],
  );

  const user = await db.queryOne('SELECT * FROM users WHERE user_id = ?', [result.insertId]);
  await audit.log({
    userId: user.user_id,
    actorRole: 'ADULT',
    activityType: 'REGISTER',
    description: `Adult account created for ${email}`,
    targetTable: 'users',
    targetId: user.user_id,
  });

  setAuthCookie(res, signToken(user));
  res.status(201).json({ user: publicUser(user) });
}));

// -----------------------------------------------------------------------------
// POST /api/auth/login
// `identifier` is an email for adults and admins, or a login id for children.
// -----------------------------------------------------------------------------
router.post('/login', authLimiter, asyncHandler(async (req, res) => {
  const identifier = v.str(req.body.identifier, 'Email or login ID', { max: 255 }).toLowerCase();
  const password = v.str(req.body.password, 'Password', { max: 100 });

  const user = await db.queryOne('SELECT * FROM users WHERE email = ?', [identifier]);

  // One message for both branches so the form cannot be used to discover which
  // email addresses are registered.
  const invalid = ApiError.unauthorized('That email/login ID and password do not match.');
  if (!user || !user.password) throw invalid;

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) throw invalid;

  if (user.account_status !== 'ACTIVE') {
    throw ApiError.forbidden(
      user.account_status === 'SUSPENDED'
        ? 'This account has been suspended. Please contact an administrator.'
        : 'This account is not active.',
    );
  }

  setAuthCookie(res, signToken(user));
  const rel = await db.queryOne(
    `SELECT parent_id FROM parent_child_relationships WHERE child_id = ? AND status = 'ACTIVE'`,
    [user.user_id],
  );

  await audit.log({
    userId: user.user_id,
    actorRole: user.role,
    parentId: rel ? rel.parent_id : null,
    activityType: 'LOGIN',
    description: `${user.role} signed in`,
  });

  res.json({ user: publicUser({ ...user, parent_id: rel ? rel.parent_id : null }) });
}));

// -----------------------------------------------------------------------------
// POST /api/auth/logout
// -----------------------------------------------------------------------------
router.post('/logout', asyncHandler(async (req, res) => {
  if (req.user) {
    await audit.logFor(req, { activityType: 'LOGOUT', description: 'Signed out' });
    // Close any chat session that was left hanging.
    await db.execute(
      `UPDATE chat_sessions SET ended_at = NOW()
        WHERE user_id = ? AND ended_at IS NULL`,
      [req.user.user_id],
    );
  }
  clearAuthCookie(res);
  res.json({ ok: true });
}));

// -----------------------------------------------------------------------------
// GET /api/auth/me  - who am I, and what am I allowed to do?
// Guests get {user: null}, which is what the front end uses to render the
// signed-out navigation.
// -----------------------------------------------------------------------------
router.get('/me', asyncHandler(async (req, res) => {
  if (!req.user) return res.json({ user: null, scope: { role: 'GUEST', restricted: false } });

  const scope = await buildViewerScope(req.user);
  const unread = await db.queryOne(
    'SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_status = FALSE',
    [req.user.user_id],
  );

  const summary = {
    role: scope.role,
    restricted: scope.restricted,
    allowContent: scope.restricted ? scope.allowContent : true,
    maxAge: scope.restricted ? scope.maxAge : null,
    blockedGenres: scope.restricted ? scope.blockedGenres : [],
    dailyScreenLimit: scope.restricted ? scope.dailyScreenLimit : null,
  };
  if (scope.restricted && scope.dailyScreenLimit !== null) {
    summary.screenTimeUsed = await screenTimeUsedToday(req.user.user_id);
    summary.screenTimeLeft = Math.max(0, scope.dailyScreenLimit - summary.screenTimeUsed);
  }

  return res.json({
    user: publicUser(req.user),
    scope: summary,
    unreadNotifications: Number(unread.n || 0),
  });
}));

// -----------------------------------------------------------------------------
// PATCH /api/auth/me  - edit your own profile
// -----------------------------------------------------------------------------
router.patch('/me', requireAuth, asyncHandler(async (req, res) => {
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
  // Children cannot change their own login id; their parent owns it.
  if (req.body.email !== undefined && req.user.role !== 'CHILD') {
    const email = v.email(req.body.email);
    const clash = await db.queryOne(
      'SELECT user_id FROM users WHERE email = ? AND user_id <> ?',
      [email, req.user.user_id],
    );
    if (clash) throw ApiError.conflict('Another account already uses that email.');
    updates.push('email = ?');
    params.push(email);
  }

  if (updates.length) {
    params.push(req.user.user_id);
    await db.execute(`UPDATE users SET ${updates.join(', ')} WHERE user_id = ?`, params);
    await audit.logFor(req, {
      activityType: 'PROFILE_UPDATE',
      description: 'Updated own profile',
      targetTable: 'users',
      targetId: req.user.user_id,
    });
  }

  const fresh = await db.queryOne('SELECT * FROM users WHERE user_id = ?', [req.user.user_id]);
  res.json({ user: publicUser({ ...fresh, parent_id: req.user.parent_id }) });
}));

// -----------------------------------------------------------------------------
// POST /api/auth/change-password
// -----------------------------------------------------------------------------
router.post('/change-password', requireAuth, authLimiter, asyncHandler(async (req, res) => {
  const current = v.str(req.body.current_password, 'Current password', { max: 100 });
  const next = req.user.role === 'CHILD'
    ? v.childPassword(req.body.new_password, 'New password')
    : v.password(req.body.new_password, 'New password');

  const row = await db.queryOne('SELECT password FROM users WHERE user_id = ?', [req.user.user_id]);
  if (!row.password || !(await bcrypt.compare(current, row.password))) {
    throw ApiError.badRequest('Your current password is not correct.');
  }

  await db.execute('UPDATE users SET password = ? WHERE user_id = ?',
    [await bcrypt.hash(next, 12), req.user.user_id]);
  await audit.logFor(req, {
    activityType: 'PASSWORD_CHANGE',
    description: 'Changed own password',
    targetTable: 'users',
    targetId: req.user.user_id,
  });

  res.json({ ok: true });
}));

module.exports = router;
module.exports.publicUser = publicUser;
