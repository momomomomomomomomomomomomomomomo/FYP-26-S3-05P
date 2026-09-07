'use strict';
const db = require('../db');

/**
 * Write one row to audit_logs. Never throws: a failed log must not fail the
 * request that triggered it, so problems are reported on the console instead.
 *
 * parent_id is filled in for children so a parent can read
 * "everything my kids did" with a single indexed lookup.
 */
async function log({
  userId,
  actorRole,
  activityType,
  description = null,
  parentId = null,
  contentId = null,
  targetTable = null,
  targetId = null,
}) {
  try {
    await db.execute(
      `INSERT INTO audit_logs
         (user_id, parent_id, content_id, actor_role, activity_type, description, target_table, target_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, parentId, contentId, actorRole, activityType, description, targetTable, targetId],
    );
  } catch (err) {
    console.error('[audit] failed to write log:', err.message);
  }
}

/** Convenience wrapper that reads the actor straight off req.user. */
function logFor(req, entry) {
  if (!req.user) return Promise.resolve();
  return log({
    userId: req.user.user_id,
    actorRole: req.user.role,
    parentId: req.user.parent_id || null,
    ...entry,
  });
}

module.exports = { log, logFor };
