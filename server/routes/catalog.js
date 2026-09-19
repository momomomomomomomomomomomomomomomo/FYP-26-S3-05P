'use strict';
/**
 * The catalogue: everything to do with titles and the category vocabulary.
 *
 * This is the Librarian's whole job, and it is deliberately the only thing they
 * can do - they cannot see accounts, reports or the audit trail. Administrators
 * cannot reach these routes either: cataloguing and account administration are
 * separate duties, so neither role can quietly do the other's work.
 */
const express = require('express');

const db = require('../db');
const v = require('../utils/validate');
const audit = require('../utils/audit');
const { ApiError, asyncHandler } = require('../utils/errors');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireRole('LIBRARIAN'));

// -----------------------------------------------------------------------------
// GET /api/catalog/stats  - the shelf at a glance
// -----------------------------------------------------------------------------
router.get('/stats', asyncHandler(async (req, res) => {
  const totals = await db.queryOne(
    `SELECT (SELECT COUNT(*) FROM content) AS titles,
            (SELECT COUNT(*) FROM content WHERE content_type = 'BOOK') AS books,
            (SELECT COUNT(*) FROM content WHERE content_type = 'VIDEO') AS videos,
            (SELECT COUNT(*) FROM tags) AS categories,
            (SELECT COUNT(*) FROM content WHERE age_rating IS NULL) AS unrated,
            (SELECT COUNT(*) FROM content c
              WHERE NOT EXISTS (SELECT 1 FROM content_tags ct WHERE ct.content_id = c.content_id))
              AS untagged`,
  );

  // Titles nobody has opened are the ones worth re-shelving or re-tagging.
  const neglected = await db.query(
    `SELECT c.content_id, c.title, c.content_type, c.created_at
       FROM content c
      WHERE NOT EXISTS (SELECT 1 FROM progress p WHERE p.content_id = c.content_id)
      ORDER BY c.created_at DESC
      LIMIT 5`,
  );

  const recent = await db.query(
    `SELECT content_id, title, content_type, created_at
       FROM content ORDER BY created_at DESC, content_id DESC LIMIT 5`,
  );

  res.json({
    totals: Object.fromEntries(Object.entries(totals).map(([k, n]) => [k, Number(n)])),
    neglected: neglected.map((r) => ({ ...r, content_id: Number(r.content_id) })),
    recent: recent.map((r) => ({ ...r, content_id: Number(r.content_id) })),
  });
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
  if (!partial || body.preview_url !== undefined) {
    out.preview_url = v.str(body.preview_url, 'Preview or trailer link', { required: false, max: 1000 });
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
          language, duration_minutes, cover_image_url, external_link, preview_url, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [data.content_type, data.title, data.description, data.author_creator, data.age_rating,
        data.reading_level, data.language, data.duration_minutes, data.cover_image_url,
        data.external_link, data.preview_url, req.user.user_id],
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
// POST /api/admin/content/import  - bulk import
// Takes either a CSV block or a ready-made array of titles. Rows are checked
// one at a time: a bad row is reported back with its line number and the rest
// of the file still loads, which is what you want when someone pastes 200
// lines from a spreadsheet.
// -----------------------------------------------------------------------------
const IMPORT_COLUMNS = [
  'content_type', 'title', 'description', 'author_creator', 'age_rating',
  'reading_level', 'language', 'duration_minutes', 'cover_image_url',
  'external_link', 'preview_url', 'tags',
];
const MAX_IMPORT_ROWS = 500;

/**
 * A small RFC-4180 CSV reader: handles quoted fields, embedded commas and
 * newlines, and "" as an escaped quote. Enough for a spreadsheet export, and
 * it avoids adding a dependency for one screen.
 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let i = 0;

  const endField = () => { row.push(field); field = ''; };
  const endRow = () => {
    endField();
    if (row.length > 1 || row[0] !== '') rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i += 1; continue;
      }
      field += ch; i += 1; continue;
    }
    if (ch === '"') { quoted = true; i += 1; continue; }
    if (ch === ',') { endField(); i += 1; continue; }
    if (ch === '\r') { i += 1; continue; }
    if (ch === '\n') { endRow(); i += 1; continue; }
    field += ch; i += 1;
  }
  if (field !== '' || row.length) endRow();
  return rows;
}

/** Turns parsed CSV rows into objects keyed by their header names. */
function csvToObjects(text) {
  const rows = parseCsv(text);
  if (!rows.length) throw ApiError.badRequest('That file has no rows in it.');

  const header = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  const unknown = header.filter((h) => h && !IMPORT_COLUMNS.includes(h));
  if (unknown.length) {
    throw ApiError.badRequest(
      `Unknown column${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}. `
      + `Use: ${IMPORT_COLUMNS.join(', ')}.`,
    );
  }
  if (!header.includes('title') || !header.includes('content_type')) {
    throw ApiError.badRequest('The file needs at least a content_type and a title column.');
  }

  return rows.slice(1).map((cells) => {
    const obj = {};
    header.forEach((key, idx) => {
      if (!key) return;
      const value = (cells[idx] === undefined ? '' : cells[idx]).trim();
      if (value !== '') obj[key] = value;
    });
    return obj;
  });
}

router.post('/content/import', asyncHandler(async (req, res) => {
  let rows;
  if (typeof req.body.csv === 'string' && req.body.csv.trim()) {
    rows = csvToObjects(req.body.csv);
  } else if (Array.isArray(req.body.items)) {
    rows = req.body.items;
  } else {
    throw ApiError.badRequest('Send either a `csv` block or an `items` array.');
  }

  if (!rows.length) throw ApiError.badRequest('There are no titles to import.');
  if (rows.length > MAX_IMPORT_ROWS) {
    throw ApiError.badRequest(`That is ${rows.length} titles. Import ${MAX_IMPORT_ROWS} or fewer at a time.`);
  }

  const dryRun = v.bool(req.body.dry_run, false);
  const skipDuplicates = v.bool(req.body.skip_duplicates, true);

  const created = [];
  const skipped = [];
  const failed = [];

  for (let i = 0; i < rows.length; i += 1) {
    const line = i + 2; // +1 for the header, +1 because people count from one
    const raw = rows[i];
    try {
      const data = readContentBody(raw);
      const tags = Array.isArray(raw.tags)
        ? raw.tags
        : String(raw.tags || '').split('|').map((t) => t.trim()).filter(Boolean);

      const clash = await db.queryOne(
        'SELECT content_id FROM content WHERE title = ? AND content_type = ?',
        [data.title, data.content_type],
      );
      if (clash && skipDuplicates) {
        skipped.push({ line, title: data.title, reason: 'Already in the library' });
        continue;
      }

      if (dryRun) {
        created.push({ line, title: data.title, content_id: null });
        continue;
      }

      const contentId = await db.transaction(async (conn) => {
        const [result] = await conn.execute(
          `INSERT INTO content
             (content_type, title, description, author_creator, age_rating, reading_level,
              language, duration_minutes, cover_image_url, external_link, preview_url, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [data.content_type, data.title, data.description, data.author_creator, data.age_rating,
            data.reading_level, data.language, data.duration_minutes, data.cover_image_url,
            data.external_link, data.preview_url, req.user.user_id],
        );
        await syncTags(conn, result.insertId, tags);
        return result.insertId;
      });

      created.push({ line, title: data.title, content_id: Number(contentId) });
    } catch (err) {
      failed.push({ line, title: raw.title || null, error: err.message });
    }
  }

  if (!dryRun && created.length) {
    await audit.logFor(req, {
      activityType: 'CONTENT_IMPORT',
      description: `Bulk imported ${created.length} title${created.length === 1 ? '' : 's'}`,
      targetTable: 'content',
    });
  }

  res.status(dryRun || !created.length ? 200 : 201).json({
    ok: true,
    dry_run: dryRun,
    imported: created.length,
    created,
    skipped,
    failed,
  });
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

router.patch('/tags/:id', asyncHandler(async (req, res) => {
  const tagId = v.int(req.params.id, 'Tag id', { min: 1 });
  const existing = await db.queryOne('SELECT tag_id FROM tags WHERE tag_id = ?', [tagId]);
  if (!existing) throw ApiError.notFound('That category does not exist.');

  const updates = [];
  const params = [];
  if (req.body.tag_name !== undefined) {
    const name = v.str(req.body.tag_name, 'Tag name', { min: 2, max: 100 });
    const clash = await db.queryOne('SELECT tag_id FROM tags WHERE tag_name = ? AND tag_id <> ?',
      [name, tagId]);
    if (clash) throw ApiError.conflict('Another category already uses that name.');
    updates.push('tag_name = ?');
    params.push(name);
  }
  if (req.body.category !== undefined) {
    updates.push('category = ?');
    params.push(v.oneOf(req.body.category, 'Category', ['GENRE', 'THEME', 'TOPIC']));
  }
  if (!updates.length) throw ApiError.badRequest('Nothing to change.');

  params.push(tagId);
  await db.execute(`UPDATE tags SET ${updates.join(', ')} WHERE tag_id = ?`, params);
  res.json({ ok: true });
}));

router.delete('/tags/:id', asyncHandler(async (req, res) => {
  const tagId = v.int(req.params.id, 'Tag id', { min: 1 });
  await db.execute('DELETE FROM tags WHERE tag_id = ?', [tagId]);
  res.json({ ok: true });
}));

module.exports = router;
