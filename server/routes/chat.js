'use strict';
const express = require('express');

const db = require('../db');
const v = require('../utils/validate');
const audit = require('../utils/audit');
const badges = require('../utils/badges');
const { ApiError, asyncHandler } = require('../utils/errors');
const { generateReply } = require('../utils/chatbot');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
// Story Chat needs an account: every message is stored against a user so a
// parent can review what their child asked.
router.use(requireAuth);

/** Loads a chat session the caller owns, or throws. */
async function loadOwnSession(userId, sessionId) {
  const session = await db.queryOne(
    'SELECT session_id, user_id, started_at, ended_at FROM chat_sessions WHERE session_id = ?',
    [sessionId],
  );
  if (!session) throw ApiError.notFound('That chat does not exist.');
  if (Number(session.user_id) !== Number(userId)) {
    throw ApiError.forbidden("That is somebody else's chat.");
  }
  return session;
}

/** Attaches the recommended titles to a list of messages. */
async function withRecommendations(messages) {
  if (!messages.length) return messages;
  const ids = messages.map((m) => Number(m.message_id));
  const rows = await db.query(
    `SELECT mr.message_id, c.content_id, c.title, c.content_type, c.age_rating,
            c.duration_minutes, c.cover_image_url
       FROM message_recommendations mr
       JOIN content c ON c.content_id = mr.content_id
      WHERE mr.message_id IN (${ids.map(() => '?').join(',')})`,
    ids,
  );
  const byMessage = new Map();
  for (const r of rows) {
    const key = Number(r.message_id);
    if (!byMessage.has(key)) byMessage.set(key, []);
    byMessage.get(key).push({
      content_id: Number(r.content_id),
      title: r.title,
      content_type: r.content_type,
      age_rating: r.age_rating === null ? null : Number(r.age_rating),
      duration_minutes: r.duration_minutes === null ? null : Number(r.duration_minutes),
      cover_image_url: r.cover_image_url,
    });
  }
  return messages.map((m) => ({
    ...m,
    message_id: Number(m.message_id),
    recommendations: byMessage.get(Number(m.message_id)) || [],
  }));
}

async function loadMessages(sessionId) {
  const rows = await db.query(
    `SELECT message_id, sender, message_text, feedback, created_at
       FROM chat_msgs WHERE session_id = ? ORDER BY created_at, message_id`,
    [sessionId],
  );
  return withRecommendations(rows);
}

// -----------------------------------------------------------------------------
// POST /api/chat/sessions  - open a chat (re-uses an open one if there is one)
// -----------------------------------------------------------------------------
router.post('/sessions', asyncHandler(async (req, res) => {
  const open = await db.queryOne(
    `SELECT session_id FROM chat_sessions
      WHERE user_id = ? AND ended_at IS NULL
      ORDER BY started_at DESC LIMIT 1`,
    [req.user.user_id],
  );
  if (open) {
    return res.json({
      session_id: Number(open.session_id),
      resumed: true,
      messages: await loadMessages(open.session_id),
    });
  }

  const result = await db.execute('INSERT INTO chat_sessions (user_id) VALUES (?)',
    [req.user.user_id]);
  const sessionId = result.insertId;

  const name = req.user.name.split(' ')[0];
  const greeting = `Hi ${name}! I am the StoryNest Story Chat. Tell me what you are in the mood for `
    + '- "something funny", "a short bedtime story", "videos about space" - and I will find '
    + 'titles from your library.';
  await db.execute(
    `INSERT INTO chat_msgs (session_id, sender, message_text) VALUES (?, 'CHATBOT', ?)`,
    [sessionId, greeting],
  );

  await audit.logFor(req, {
    activityType: 'CHAT_START',
    description: 'Started a Story Chat',
    targetTable: 'chat_sessions',
    targetId: sessionId,
  });

  return res.status(201).json({
    session_id: Number(sessionId),
    resumed: false,
    messages: await loadMessages(sessionId),
  });
}));

// -----------------------------------------------------------------------------
// GET /api/chat/sessions  - chat history
// -----------------------------------------------------------------------------
router.get('/sessions', asyncHandler(async (req, res) => {
  const rows = await db.query(
    `SELECT s.session_id, s.started_at, s.ended_at,
            (SELECT COUNT(*) FROM chat_msgs m WHERE m.session_id = s.session_id) AS message_count,
            (SELECT m.message_text FROM chat_msgs m
              WHERE m.session_id = s.session_id AND m.sender = 'USER'
              ORDER BY m.created_at LIMIT 1) AS first_question
       FROM chat_sessions s
      WHERE s.user_id = ?
      ORDER BY s.started_at DESC LIMIT 20`,
    [req.user.user_id],
  );
  res.json({
    items: rows.map((r) => ({
      ...r, session_id: Number(r.session_id), message_count: Number(r.message_count),
    })),
  });
}));

// -----------------------------------------------------------------------------
// GET /api/chat/sessions/:id/messages
// -----------------------------------------------------------------------------
router.get('/sessions/:id/messages', asyncHandler(async (req, res) => {
  const sessionId = v.int(req.params.id, 'Session id', { min: 1 });
  await loadOwnSession(req.user.user_id, sessionId);
  res.json({ session_id: sessionId, messages: await loadMessages(sessionId) });
}));

// -----------------------------------------------------------------------------
// POST /api/chat/sessions/:id/messages  - say something, get a reply
// -----------------------------------------------------------------------------
router.post('/sessions/:id/messages', asyncHandler(async (req, res) => {
  const sessionId = v.int(req.params.id, 'Session id', { min: 1 });
  const text = v.str(req.body.message, 'Message', { min: 1, max: 500 });

  const session = await loadOwnSession(req.user.user_id, sessionId);
  if (session.ended_at) throw ApiError.conflict('That chat has ended. Start a new one.');

  const userMsg = await db.execute(
    `INSERT INTO chat_msgs (session_id, sender, message_text) VALUES (?, 'USER', ?)`,
    [sessionId, text],
  );

  // The recommender only ever sees titles this viewer is allowed to open.
  const { reply, contentIds } = await generateReply(text, req.scope, req.user);

  const botMsg = await db.execute(
    `INSERT INTO chat_msgs (session_id, sender, message_text) VALUES (?, 'CHATBOT', ?)`,
    [sessionId, reply],
  );

  for (const contentId of contentIds) {
    await db.execute(
      'INSERT IGNORE INTO message_recommendations (message_id, content_id) VALUES (?, ?)',
      [botMsg.insertId, contentId],
    );
  }

  await audit.logFor(req, {
    activityType: 'CHAT_MESSAGE',
    description: `Asked Story Chat: "${text.slice(0, 120)}"`,
    targetTable: 'chat_msgs',
    targetId: userMsg.insertId,
  });

  const awarded = await badges.checkAndAward(req.user.user_id);
  const messages = await withRecommendations([
    {
      message_id: userMsg.insertId,
      sender: 'USER',
      message_text: text,
      feedback: null,
      created_at: new Date(),
    },
    {
      message_id: botMsg.insertId,
      sender: 'CHATBOT',
      message_text: reply,
      feedback: null,
      created_at: new Date(),
    },
  ]);

  res.status(201).json({ messages, badges_awarded: awarded.map((b) => b.badge_name) });
}));

// -----------------------------------------------------------------------------
// POST /api/chat/messages/:id/feedback  - thumbs up / thumbs down on a reply
// -----------------------------------------------------------------------------
router.post('/messages/:id/feedback', asyncHandler(async (req, res) => {
  const messageId = v.int(req.params.id, 'Message id', { min: 1 });
  const feedback = v.oneOf(req.body.feedback, 'Feedback', ['LIKE', 'DISLIKE']);

  const owned = await db.queryOne(
    `SELECT m.message_id FROM chat_msgs m
       JOIN chat_sessions s ON s.session_id = m.session_id
      WHERE m.message_id = ? AND s.user_id = ? AND m.sender = 'CHATBOT'`,
    [messageId, req.user.user_id],
  );
  if (!owned) throw ApiError.notFound('That message does not exist.');

  await db.execute('UPDATE chat_msgs SET feedback = ? WHERE message_id = ?', [feedback, messageId]);
  res.json({ ok: true });
}));

// -----------------------------------------------------------------------------
// POST /api/chat/sessions/:id/end
// -----------------------------------------------------------------------------
router.post('/sessions/:id/end', asyncHandler(async (req, res) => {
  const sessionId = v.int(req.params.id, 'Session id', { min: 1 });
  await loadOwnSession(req.user.user_id, sessionId);
  await db.execute(
    'UPDATE chat_sessions SET ended_at = NOW() WHERE session_id = ? AND ended_at IS NULL',
    [sessionId],
  );
  res.json({ ok: true });
}));

module.exports = router;
