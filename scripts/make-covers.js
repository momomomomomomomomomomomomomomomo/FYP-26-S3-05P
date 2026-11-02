#!/usr/bin/env node
'use strict';
/**
 * Draws a cover for every book in database/books/ and writes it to
 * public/covers/<slug>.svg.
 *
 * The artwork is generated rather than downloaded for three reasons: it is
 * served from our own origin, which the Content-Security-Policy requires; it
 * works with no internet connection, like the rest of the app; and there is no
 * licensing question hanging over a picture we drew ourselves.
 *
 *   node scripts/make-covers.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'public', 'covers');

const { PALETTES, MOTIFS } = require('./cover-art');

// --- typography -------------------------------------------------------------
/** Greedy wrap by estimated width, so long titles do not run off the cover. */
function wrap(text, maxChars) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) { lines.push(line); line = word; } else { line = next; }
  }
  if (line) lines.push(line);
  return lines;
}

function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/**
 * Lays the title out so it always fits the panel.
 *
 * Titles here run from two words to nine, so the wrap width and the type size
 * are chosen from the length rather than fixed: the block is then built upwards
 * from a fixed baseline, which is what keeps it clear of the author line no
 * matter how many lines it needs.
 */
// Georgia bold capitals average close to this fraction of the font size per
// character. Good enough to lay out a cover without measuring real glyphs.
const CHAR_RATIO = 0.62;
const TITLE_WIDTH = 468;   // the 500px rule, less a margin for wide glyphs:
                           // CHAR_RATIO is an average, and a line of M and W
                           // runs several per cent over it.
const MAX_LINES = 4;

/**
 * Picks the largest type size at which the title fits the panel.
 *
 * Wrapping by character count alone is what pushed "THE MOUNTAIN THAT GREW
 * OVERNIGHT" off both edges: 17 characters of 62px Georgia is 630px wide. So
 * each candidate size is wrapped at the width it can actually afford, and the
 * first one that fits in four lines wins.
 */
function titleBlock(title) {
  const text = title.toUpperCase();
  let chosen = null;

  for (const size of [62, 56, 50, 44, 38, 33, 29]) {
    const maxChars = Math.max(8, Math.floor(TITLE_WIDTH / (size * CHAR_RATIO)));
    const lines = wrap(text, maxChars);
    const widest = Math.max(...lines.map((l) => l.length)) * size * CHAR_RATIO;
    if (lines.length <= MAX_LINES && widest <= TITLE_WIDTH) { chosen = { lines, size }; break; }
  }
  if (!chosen) chosen = { lines: wrap(text, 22), size: 29 };

  const leading = chosen.size * 1.1;
  // The last line sits on a fixed baseline; earlier lines stack above it, so
  // the block never grows down into the author line.
  const firstBaseline = 672 - (chosen.lines.length - 1) * leading;
  return { ...chosen, leading, firstBaseline };
}

/** Relative luminance, 0 (black) to 1 (white). */
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Lightens a colour until it reads on the dark scrim at the foot of a cover. */
function onScrim(hex) {
  if (luminance(hex) >= 0.3) return hex;
  const mix = (i) => {
    const c = parseInt(hex.slice(i, i + 2), 16);
    return Math.round(c + (255 - c) * 0.62).toString(16).padStart(2, '0');
  };
  return `#${mix(1)}${mix(3)}${mix(5)}`;
}

function cover(book) {
  const p = PALETTES[book.cover.palette] || PALETTES.dusk;
  const motif = (MOTIFS[book.cover.motif] || MOTIFS.moon)(p);
  const { lines, size, leading, firstBaseline } = titleBlock(book.title);
  const scrimAccent = onScrim(p.accent);
  // The rule sits above the title block rather than at a fixed height, or a
  // four-line title grows up through it.
  const ruleY = Math.round(firstBaseline - size - 20);

  const titleText = lines
    .map((l, i) => `<tspan x="300" dy="${i === 0 ? 0 : leading}">${escapeXml(l)}</tspan>`)
    .join('');

  // The panel is always a dark scrim and the lettering is always light. Some
  // palettes have a dark ink for their artwork, and dark-on-dark is unreadable.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 800" width="600" height="800" role="img" aria-label="${escapeXml(book.title)}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${p.top}"/><stop offset="1" stop-color="${p.bottom}"/>
    </linearGradient>
    <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0a1420" stop-opacity="0"/>
      <stop offset="0.22" stop-color="#0a1420" stop-opacity="0.82"/>
      <stop offset="1" stop-color="#0a1420" stop-opacity="0.92"/>
    </linearGradient>
  </defs>
  <rect width="600" height="800" fill="url(#bg)"/>
  ${motif}
  <rect x="0" y="440" width="600" height="360" fill="url(#scrim)"/>
  <rect x="50" y="${ruleY}" width="500" height="2" fill="${scrimAccent}" opacity=".9"/>
  <text x="300" y="${firstBaseline}" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif"
        font-size="${size}" font-weight="700" fill="#ffffff" letter-spacing="1.5">${titleText}</text>
  <text x="300" y="718" text-anchor="middle" font-family="Helvetica, Arial, sans-serif"
        font-size="23" fill="#ffffff" opacity=".82">${escapeXml(book.author)}</text>
  <text x="300" y="764" text-anchor="middle" font-family="Helvetica, Arial, sans-serif"
        font-size="16" letter-spacing="3.5" fill="${scrimAccent}">STORYNEST</text>
</svg>
`;
}

function run() {
  const books = require(path.join(ROOT, 'database', 'books'));
  const videos = require(path.join(ROOT, 'database', 'videos'));
  fs.mkdirSync(OUT, { recursive: true });

  let written = 0;
  // Videos carry no author of their own in the manifest, so the studio line is
  // left to the title alone.
  for (const item of [...books, ...videos.map((v) => ({ ...v, author: v.author || 'StoryNest' }))]) {
    fs.writeFileSync(path.join(OUT, `${item.slug}.svg`), cover(item));
    written += 1;
  }
  console.log(`Wrote ${written} covers to public/covers/ `
    + `(${books.length} books, ${videos.length} videos)`);
}

if (require.main === module) run();
module.exports = { cover, PALETTES, MOTIFS };
