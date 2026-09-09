'use strict';
const db = require('../db');

// Badge name -> which statistic decides it. required_count lives in the
// `badges` table so an admin can retune a badge without touching this file.
const METRICS = {
  'First Steps': 'completed',
  'Page Turner': 'completed',
  'Bookworm': 'completed',
  'Story Explorer': 'started',
  'Critic': 'reviews',
  'Curator': 'favourites',
  'Chatterbox': 'chatMessages',
};

async function collectStats(userId) {
  const [progress, reviews, favourites, chat] = await Promise.all([
    db.queryOne(
      `SELECT COUNT(*) AS started,
              SUM(percentage_completed >= 100) AS completed
         FROM progress WHERE user_id = ?`,
      [userId],
    ),
    db.queryOne('SELECT COUNT(*) AS n FROM feedback WHERE user_id = ?', [userId]),
    db.queryOne(
      `SELECT COUNT(*) AS n FROM saved_content WHERE user_id = ? AND list_type = 'FAVORITE'`,
      [userId],
    ),
    db.queryOne(
      `SELECT COUNT(*) AS n
         FROM chat_msgs m
         JOIN chat_sessions s ON s.session_id = m.session_id
        WHERE s.user_id = ? AND m.sender = 'USER'`,
      [userId],
    ),
  ]);
  return {
    started: Number(progress.started || 0),
    completed: Number(progress.completed || 0),
    reviews: Number(reviews.n || 0),
    favourites: Number(favourites.n || 0),
    chatMessages: Number(chat.n || 0),
  };
}

/**
 * Awards every badge the user now qualifies for and notifies them about each
 * one. Returns the badges newly awarded by this call (possibly none).
 */
async function checkAndAward(userId) {
  const [stats, allBadges, held] = await Promise.all([
    collectStats(userId),
    db.query('SELECT badge_id, badge_name, description, required_count FROM badges'),
    db.query('SELECT badge_id FROM user_badges WHERE user_id = ?', [userId]),
  ]);

  const heldIds = new Set(held.map((b) => Number(b.badge_id)));
  const awarded = [];

  for (const badge of allBadges) {
    if (heldIds.has(Number(badge.badge_id))) continue;
    const metric = METRICS[badge.badge_name];
    if (!metric) continue;
    if (stats[metric] < Number(badge.required_count)) continue;

    const result = await db.execute(
      'INSERT IGNORE INTO user_badges (user_id, badge_id) VALUES (?, ?)',
      [userId, badge.badge_id],
    );
    if (result.affectedRows > 0) {
      awarded.push(badge);
      await db.execute(
        'INSERT INTO notifications (user_id, title, message) VALUES (?, ?, ?)',
        [userId, 'New badge unlocked!', `You earned the "${badge.badge_name}" badge - ${badge.description}`],
      );
    }
  }
  return awarded;
}

module.exports = { checkAndAward, collectStats };
