'use strict';
/**
 * Cover art and categories for the video titles.
 *
 * Videos have no pages — there is nothing to read — but everything else that
 * applies to a book applies to them: they need artwork so the shelf looks like
 * one shelf, and they need enough categories to be findable.
 *
 * Matched by title, like the books. `tags` is added to whatever the title
 * already has rather than replacing it.
 */
module.exports = [
  {
    title: 'Storytime: The Lantern of Little Hollow',
    slug: 'video-storytime-lantern',
    cover: { palette: 'fern', motif: 'lantern' },
    tags: ['Fantasy', 'Courage', 'Animals', 'Kindness'],
  },
  {
    title: 'How Do Volcanoes Work?',
    slug: 'video-how-do-volcanoes-work',
    cover: { palette: 'coral', motif: 'mountains' },
    tags: ['Non-Fiction', 'Science', 'Nature'],
  },
  {
    title: 'Meet the Deep Sea',
    slug: 'video-meet-the-deep-sea',
    cover: { palette: 'ink', motif: 'fish' },
    tags: ['Nature', 'Ocean', 'Science', 'Animals'],
  },
  {
    title: 'Draw a Dragon in 10 Minutes',
    slug: 'video-draw-a-dragon',
    cover: { palette: 'violet', motif: 'feather' },
    tags: ['Art', 'Fantasy', 'Humour'],
  },
  {
    title: 'The History of the Alphabet',
    slug: 'video-history-of-the-alphabet',
    cover: { palette: 'cocoa', motif: 'book' },
    tags: ['History', 'Non-Fiction', 'Art'],
  },
  {
    title: 'Space Station Tour',
    slug: 'video-space-station-tour',
    cover: { palette: 'dusk', motif: 'rocket' },
    tags: ['Space', 'Science', 'Non-Fiction'],
  },
  {
    title: 'Five Experiments With Water',
    slug: 'video-five-experiments-with-water',
    cover: { palette: 'mint', motif: 'teacup' },
    tags: ['Science', 'Non-Fiction', 'Nature'],
  },
  {
    title: 'Bedtime Lullabies',
    slug: 'video-bedtime-lullabies',
    cover: { palette: 'plum', motif: 'moon' },
    tags: ['Kindness', 'Music', 'Night'],
  },
];
