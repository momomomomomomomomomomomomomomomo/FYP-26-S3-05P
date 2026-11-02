'use strict';
const books = require('./books');
const videos = require('./videos');

/**
 * Inserts (or refreshes) every book in this folder, with its pages, tags and
 * cover.
 *
 * Written against a plain mysql2 connection or pool, because it is used from
 * two places: `npm run db:setup`, which builds a database from nothing, and
 * `npm run books:import`, which adds the books to a database that already has
 * people and reading history in it.
 *
 * Matching is by title and type, and pages are replaced wholesale, so running
 * it twice is safe and a second run picks up any edits to the text.
 */
async function importBooks(conn, { createdBy = null, log = () => {} } = {}) {
  let inserted = 0;
  let updated = 0;
  let pageCount = 0;

  for (const book of books) {
    const [existingRows] = await conn.execute(
      'SELECT content_id FROM content WHERE title = ? AND content_type = ?',
      [book.title, 'BOOK'],
    );

    const fields = [
      book.description,
      book.author,
      book.age_rating,
      book.reading_level,
      book.language || 'English',
      book.duration_minutes,
      `/covers/${book.slug}.svg`,
    ];

    let contentId;
    if (existingRows.length) {
      contentId = Number(existingRows[0].content_id);
      await conn.execute(
        `UPDATE content SET description = ?, author_creator = ?, age_rating = ?, reading_level = ?,
                            language = ?, duration_minutes = ?, cover_image_url = ?
          WHERE content_id = ?`,
        [...fields, contentId],
      );
      updated += 1;
    } else {
      const [res] = await conn.execute(
        `INSERT INTO content (content_type, title, description, author_creator, age_rating,
                              reading_level, language, duration_minutes, cover_image_url, created_by)
         VALUES ('BOOK', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [book.title, ...fields, createdBy],
      );
      contentId = Number(res.insertId);
      inserted += 1;
    }

    // Tags, creating any the catalogue does not have yet.
    await conn.execute('DELETE FROM content_tags WHERE content_id = ?', [contentId]);
    for (const tagName of book.tags || []) {
      const [tagRows] = await conn.execute('SELECT tag_id FROM tags WHERE tag_name = ?', [tagName]);
      let tagId;
      if (tagRows.length) {
        tagId = tagRows[0].tag_id;
      } else {
        const [created] = await conn.execute('INSERT INTO tags (tag_name) VALUES (?)', [tagName]);
        tagId = created.insertId;
      }
      await conn.execute(
        'INSERT IGNORE INTO content_tags (content_id, tag_id) VALUES (?, ?)', [contentId, tagId],
      );
    }

    // Pages are replaced rather than merged, so an edit upstream always wins.
    await conn.execute('DELETE FROM content_pages WHERE content_id = ?', [contentId]);
    for (let i = 0; i < book.pages.length; i += 1) {
      const page = book.pages[i];
      await conn.execute(
        `INSERT INTO content_pages (content_id, page_number, heading, body, illustration)
         VALUES (?, ?, ?, ?, ?)`,
        [contentId, i + 1, page.heading || null, page.body, page.illustration || null],
      );
      pageCount += 1;
    }

    log(`  ${book.title} - ${book.pages.length} pages`);
  }

  // Videos: artwork and categories only. They have no pages by definition, and
  // a video without a cover leaves a hole in an otherwise illustrated shelf.
  let videosUpdated = 0;
  for (const video of videos) {
    const [rows] = await conn.execute(
      'SELECT content_id FROM content WHERE title = ? AND content_type = ?',
      [video.title, 'VIDEO'],
    );
    if (!rows.length) continue;
    const contentId = Number(rows[0].content_id);

    await conn.execute('UPDATE content SET cover_image_url = ? WHERE content_id = ?',
      [`/covers/${video.slug}.svg`, contentId]);

    for (const tagName of video.tags || []) {
      const [tagRows] = await conn.execute('SELECT tag_id FROM tags WHERE tag_name = ?', [tagName]);
      let tagId;
      if (tagRows.length) {
        tagId = tagRows[0].tag_id;
      } else {
        const [created] = await conn.execute('INSERT INTO tags (tag_name) VALUES (?)', [tagName]);
        tagId = created.insertId;
      }
      await conn.execute(
        'INSERT IGNORE INTO content_tags (content_id, tag_id) VALUES (?, ?)', [contentId, tagId],
      );
    }
    videosUpdated += 1;
    log(`  ${video.title} - cover and categories`);
  }

  return {
    inserted, updated, pages: pageCount, total: books.length, videos: videosUpdated,
  };
}

module.exports = { importBooks, books };
