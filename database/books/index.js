'use strict';
/**
 * Every book whose pages live in this repository.
 *
 * One module per book, loaded by filename so adding a story is a matter of
 * dropping a file in beside the others. `npm run db:setup` inserts them and
 * `node scripts/make-covers.js` draws their covers.
 */
const fs = require('fs');
const path = require('path');

const books = fs.readdirSync(__dirname)
  .filter((f) => f.endsWith('.js') && f !== 'index.js')
  .sort()
  .map((f) => require(path.join(__dirname, f)));

// Fail loudly at load rather than half-way through a database build.
for (const b of books) {
  const where = `database/books/${b.slug}.js`;
  if (!b.slug || !b.title || !b.author) throw new Error(`${where}: slug, title and author are required`);
  if (!Array.isArray(b.pages) || b.pages.length < 20) {
    throw new Error(`${where}: a book needs at least 20 pages, found ${(b.pages || []).length}`);
  }
  if (b.pages.some((p) => !p.body || !p.body.trim())) throw new Error(`${where}: a page has no body`);
  if (!b.cover || !b.cover.palette || !b.cover.motif) throw new Error(`${where}: cover palette and motif are required`);
}

module.exports = books;
