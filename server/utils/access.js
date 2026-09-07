'use strict';
const db = require('../db');
const { ApiError } = require('./errors');

/** Whole years between a date of birth and today. */
function ageFromDob(dob) {
  if (!dob) return null;
  const birth = new Date(typeof dob === 'string' ? `${dob}T00:00:00Z` : dob);
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - birth.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < birth.getUTCDate())) age -= 1;
  return Math.max(age, 0);
}

/** The parental controls row for a child, with defaults if none exists yet. */
async function getControls(childId) {
  const row = await db.queryOne(
    `SELECT max_age, daily_screen_limit, allow_content
       FROM parental_controls WHERE child_id = ?`,
    [childId],
  );
  return row || { max_age: null, daily_screen_limit: null, allow_content: 1 };
}

async function getBlockedGenres(childId) {
  const rows = await db.query(
    'SELECT blocked_genre FROM child_blocked_genres WHERE child_id = ?',
    [childId],
  );
  return rows.map((r) => r.blocked_genre);
}

/** Ids of titles a parent has explicitly approved for this child. */
async function getApprovedContentIds(childId) {
  const rows = await db.query(
    `SELECT content_id FROM content_requests
      WHERE user_id = ? AND status = 'APPROVED'`,
    [childId],
  );
  return rows.map((r) => Number(r.content_id));
}

/**
 * Everything needed to decide what one viewer may see.
 *
 *   ADMIN / ADULT  - the whole library.
 *   GUEST          - the whole library, read-only (no saving, progress or chat).
 *   CHILD          - filtered by parental controls:
 *                      * allow_content = false  -> only approved titles
 *                      * age_rating <= max_age (falling back to the child's age)
 *                      * nothing tagged with one of their blocked genres
 *                    ...unless the parent approved that specific title.
 */
async function buildViewerScope(user) {
  if (!user || user.role !== 'CHILD') {
    return { restricted: false, role: user ? user.role : 'GUEST' };
  }
  const [controls, blockedGenres, approvedIds] = await Promise.all([
    getControls(user.user_id),
    getBlockedGenres(user.user_id),
    getApprovedContentIds(user.user_id),
  ]);
  const childAge = ageFromDob(user.dob);
  const maxAge = controls.max_age !== null && controls.max_age !== undefined
    ? Number(controls.max_age)
    : childAge;

  return {
    restricted: true,
    role: 'CHILD',
    childAge,
    maxAge,
    allowContent: !!controls.allow_content,
    dailyScreenLimit: controls.daily_screen_limit === null ? null : Number(controls.daily_screen_limit),
    blockedGenres,
    approvedIds,
  };
}

/**
 * Builds the WHERE fragment + params that restrict a `content c` query to what
 * `scope` allows. Returns an empty clause for unrestricted viewers.
 */
function contentScopeClause(scope, alias = 'c') {
  if (!scope.restricted) return { clause: '', params: [] };

  const approvedParams = scope.approvedIds;
  const approvedSql = approvedParams.length
    ? `${alias}.content_id IN (${approvedParams.map(() => '?').join(',')})`
    : 'FALSE';

  const conditions = [];
  const params = [];

  if (!scope.allowContent) {
    // Content is switched off entirely: approved titles only.
    return { clause: ` AND (${approvedSql})`, params: [...approvedParams] };
  }

  conditions.push(`(${alias}.age_rating IS NULL OR ${alias}.age_rating <= ?)`);
  params.push(scope.maxAge === null || scope.maxAge === undefined ? 99 : scope.maxAge);

  if (scope.blockedGenres.length) {
    conditions.push(`NOT EXISTS (
      SELECT 1 FROM content_tags ct
        JOIN tags t ON t.tag_id = ct.tag_id
       WHERE ct.content_id = ${alias}.content_id
         AND t.tag_name IN (${scope.blockedGenres.map(() => '?').join(',')})
    )`);
    params.push(...scope.blockedGenres);
  }

  // A title is visible if it passes every control, OR it was approved by name.
  const passes = conditions.join(' AND ');
  return {
    clause: ` AND ((${passes}) OR (${approvedSql}))`,
    params: [...params, ...approvedParams],
  };
}

/** Minutes of screen time a child has logged today. */
async function screenTimeUsedToday(childId) {
  const row = await db.queryOne(
    `SELECT COALESCE(SUM(target_id), 0) AS minutes
       FROM audit_logs
      WHERE user_id = ?
        AND activity_type = 'SCREEN_TIME'
        AND created_at >= CURDATE()`,
    [childId],
  );
  return Number(row.minutes || 0);
}

/**
 * Throws if a child has used up the daily screen-time allowance their parent
 * set. No-op for every other role.
 */
async function assertScreenTimeRemaining(user, scope) {
  if (!scope.restricted || scope.dailyScreenLimit === null) return;
  const used = await screenTimeUsedToday(user.user_id);
  if (used >= scope.dailyScreenLimit) {
    throw ApiError.forbidden(
      `You have used all ${scope.dailyScreenLimit} minutes of screen time for today. Come back tomorrow!`,
    );
  }
}

/** True when this adult is the registered parent of this child. */
async function isParentOf(parentId, childId) {
  const row = await db.queryOne(
    `SELECT 1 AS ok FROM parent_child_relationships
      WHERE parent_id = ? AND child_id = ? AND status = 'ACTIVE'`,
    [parentId, childId],
  );
  return !!row;
}

/** Loads a child the caller is allowed to manage, or throws 403/404. */
async function loadManagedChild(req, childId) {
  const child = await db.queryOne(
    `SELECT user_id, role, name, email, dob, reading_level, account_status, created_at
       FROM users WHERE user_id = ? AND role = 'CHILD'`,
    [childId],
  );
  if (!child) throw ApiError.notFound('That child account does not exist.');
  if (req.user.role === 'ADMIN') return child;
  if (req.user.role === 'ADULT' && (await isParentOf(req.user.user_id, childId))) return child;
  throw ApiError.forbidden('That is not one of your children.');
}

module.exports = {
  ageFromDob,
  getControls,
  getBlockedGenres,
  getApprovedContentIds,
  buildViewerScope,
  contentScopeClause,
  screenTimeUsedToday,
  assertScreenTimeRemaining,
  isParentOf,
  loadManagedChild,
};
