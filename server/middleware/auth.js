'use strict';
const jwt = require('jsonwebtoken');
const db = require('../db');
const config = require('../config');
const { ApiError, asyncHandler } = require('../utils/errors');
const { buildViewerScope } = require('../utils/access');

function signToken(user) {
  return jwt.sign(
    { sub: String(user.user_id), role: user.role },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn },
  );
}

function setAuthCookie(res, token) {
  res.cookie(config.cookieName, token, {
    httpOnly: true,          // JavaScript on the page can never read the token
    sameSite: 'lax',         // blocks the usual cross-site request forgery route
    secure: config.env === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

function clearAuthCookie(res) {
  res.clearCookie(config.cookieName, { path: '/' });
}

/**
 * Reads the auth cookie on every request. Sets req.user to the account row
 * (plus parent_id for children) or leaves it null for Guests. Never rejects -
 * that is requireAuth's job - so public pages keep working.
 */
const attachUser = asyncHandler(async (req, res, next) => {
  req.user = null;
  const token = req.cookies ? req.cookies[config.cookieName] : null;
  if (!token) return next();

  let payload;
  try {
    payload = jwt.verify(token, config.jwt.secret);
  } catch {
    clearAuthCookie(res);
    return next();
  }

  const user = await db.queryOne(
    `SELECT u.user_id, u.role, u.name, u.email, u.dob, u.reading_level,
            u.parental_consent, u.account_status, u.created_at,
            pcr.parent_id
       FROM users u
       LEFT JOIN parent_child_relationships pcr
              ON pcr.child_id = u.user_id AND pcr.status = 'ACTIVE'
      WHERE u.user_id = ?`,
    [payload.sub],
  );

  if (!user || user.account_status !== 'ACTIVE') {
    clearAuthCookie(res);
    return next();
  }

  req.user = user;
  return next();
});

const requireAuth = (req, res, next) => {
  if (!req.user) return next(ApiError.unauthorized());
  return next();
};

/** requireRole('ADMIN') or requireRole('ADULT', 'ADMIN') */
const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return next(ApiError.unauthorized());
  if (!roles.includes(req.user.role)) {
    return next(ApiError.forbidden('Your account type cannot do that.'));
  }
  return next();
};

/**
 * Works out what this viewer is allowed to see and hangs it on req.scope.
 * Guests and signed-out visitors get an unrestricted, read-only scope.
 */
const attachScope = asyncHandler(async (req, res, next) => {
  req.scope = await buildViewerScope(req.user);
  return next();
});

module.exports = {
  signToken, setAuthCookie, clearAuthCookie,
  attachUser, requireAuth, requireRole, attachScope,
};
