/* The librarian's desk: the catalogue and the category vocabulary.
 *
 * This is deliberately the whole job. A librarian has no route to accounts,
 * reports or the audit trail - those belong to an administrator - so nothing
 * on this page reaches outside /api/catalog. */
(function librarian(global) {
  'use strict';
  const {
    el, $, $$, clear, fmt, modal, confirmDialog, showError, toast,
  } = global.SN;

  let allTags = [];

  function panel(name) { return $(`#panel-${name}`); }
  function field(labelText, control, hint) {
    return el('div', { class: 'field' }, [
      el('label', { text: labelText }), control,
      hint ? el('span', { class: 'hint', text: hint }) : null,
    ]);
  }
  function table(headers, rows) {
    return el('div', { class: 'table-scroll' }, el('table', {}, [
      el('thead', {}, el('tr', {}, headers.map((h) => el('th', { text: h })))),
      el('tbody', {}, rows),
    ]));
  }

  // --- shelf overview -------------------------------------------------------
  function stat(value, label) {
    return el('div', { class: 'stat' }, [
      el('div', { class: 'stat-value', text: String(value) }),
      el('div', { class: 'stat-label', text: label }),
    ]);
  }

  async function loadOverview() {
    const host = panel('overview');
    clear(host);

    const data = await global.api.get('/api/catalog/stats');
    const t = data.totals;

    host.appendChild(el('div', { class: 'stat-row' }, [
      stat(t.titles, 'Titles'),
      stat(t.books, 'Books'),
      stat(t.videos, 'Videos'),
      stat(t.categories, 'Categories'),
    ]));

    // The two numbers a librarian can actually act on.
    const gaps = el('div', { class: 'row', style: { marginBottom: '18px' } }, [
      t.untagged
        ? el('div', { class: 'alert alert-warn', style: { margin: 0, flex: '1' } },
          [`${t.untagged} title${t.untagged === 1 ? ' has' : 's have'} no category yet — `
            + 'they will not show up under any genre filter.'])
        : null,
      t.unrated
        ? el('div', { class: 'alert alert-warn', style: { margin: 0, flex: '1' } },
          [`${t.unrated} title${t.unrated === 1 ? ' has' : 's have'} no age rating — `
            + 'children see them whatever their limit.'])
        : null,
      t.textless
        ? el('div', { class: 'alert alert-warn', style: { margin: 0, flex: '1' } },
          [`${t.textless} book${t.textless === 1 ? ' has' : 's have'} no pages yet — `
            + 'the reader can only show a sample built from the description.'])
        : null,
    ].filter(Boolean));
    if (gaps.childNodes.length) host.appendChild(gaps);

    const listPanel = (heading, note, rows) => el('div', { class: 'panel' }, [
      el('div', { class: 'panel-head' }, [el('h3', { style: { fontSize: '.95rem' } }, [heading])]),
      el('p', { class: 'tiny muted', style: { marginTop: '-8px' }, text: note }),
      rows.length
        ? el('div', { class: 'stack' }, rows.map((r) => el('div', { class: 'activity-row' }, [
          el('span', { class: 'activity-glyph', text: r.content_type === 'VIDEO' ? '🎬' : '📗' }),
          el('div', { class: 'grow' }, [
            el('a', { class: 'small', href: `/content?id=${r.content_id}`, text: r.title }),
            el('div', { class: 'tiny muted', text: fmt.date(r.created_at) }),
          ]),
        ])))
        : el('p', { class: 'muted small', style: { margin: 0 }, text: 'Nothing to show.' }),
    ]);

    host.appendChild(el('div', { class: 'two-col' }, [
      listPanel('Recently added', 'The newest arrivals on the shelf.', data.recent),
      listPanel('Never opened', 'Nobody has started these — worth re-tagging or re-rating.',
        data.neglected),
    ]));
  }

  // --- content --------------------------------------------------------------
  // --- the shelves ----------------------------------------------------------
  // Books and videos are kept apart because they are different jobs: a book
  // needs pages and a reading level, a video needs a link and a running time,
  // and a librarian working through one is not thinking about the other.
  const SHELVES = {
    books: { type: 'BOOK', noun: 'book', plural: 'books' },
    videos: { type: 'VIDEO', noun: 'video', plural: 'videos' },
  };

  // What is typed in each shelf's search box, kept here so that reloading the
  // list after an edit or a deletion does not throw the filter away.
  const search = { books: '', videos: '', categories: '' };

  // How many pages each book has, so the shelf can show at a glance which
  // books are still only a catalogue entry. One request covers the whole
  // shelf; asking per row would be three hundred requests to draw one table.
  let pageCounts = null;

  async function ensurePageCounts({ force = false } = {}) {
    if (pageCounts && !force) return pageCounts;
    try {
      const data = await global.api.get('/api/catalog/page-counts');
      pageCounts = new Map(data.counts.map((r) => [r.content_id, r.pages]));
    } catch (err) {
      // The shelf is still usable without them, so this is not worth an alert.
      pageCounts = new Map();
    }
    return pageCounts;
  }

  function describeFilter(shelf, shown, total) {
    const term = search[shelf];
    const { plural } = SHELVES[shelf];
    if (!term) {
      return `${total} ${total === 1 ? SHELVES[shelf].noun : plural} on the shelves.`;
    }
    if (!shown) return `Nothing matches "${term}".`;
    return `${shown} of ${total} ${plural} match "${term}".`;
  }

  /** Fetches and draws just the table, leaving the search box where it is. */
  async function refreshShelf(shelf) {
    const { type } = SHELVES[shelf];
    const body = $(`#shelf-${shelf}-results`);
    if (!body) return;

    const query = { limit: 300, sort: 'title', type };
    const term = search[shelf].trim();
    if (term) query.q = term;

    let data;
    try {
      data = await global.api.get('/api/content', query);
    } catch (err) {
      showError(err);
      return;
    }
    // Only the book shelf has a text column to fill.
    if (shelf === 'books') {
      await ensurePageCounts();
      // A book added, imported or restored since the counts were last fetched
      // is not in them, and would show an unhelpful dash where it should say
      // it has no pages yet. Rather than remember to refresh at every place
      // that can put a book on the shelf, notice that one is missing here.
      if (data.items.some((c) => !pageCounts.has(c.content_id))) {
        await ensurePageCounts({ force: true });
      }
    }

    // A second keystroke may have landed while this was in flight; the newer
    // request owns the table.
    if (search[shelf].trim() !== term) return;

    const totalOnShelf = Number($(`#shelf-${shelf}-total`).dataset.total || data.total);

    clear(body);
    body.appendChild(el('p', {
      class: 'tiny muted',
      style: { margin: '0 0 10px' },
      text: describeFilter(shelf, data.items.length, totalOnShelf),
    }));

    if (!data.items.length) {
      body.appendChild(el('p', { class: 'muted small', style: { margin: 0 }, text: term
        ? 'Try part of a title, an author, or a category name.'
        : `There are no ${SHELVES[shelf].plural} in the catalogue yet.` }));
      return;
    }

    const books = shelf === 'books';

    /** The text column: how much of the book is actually written. */
    function textCell(c) {
      const n = pageCounts ? pageCounts.get(c.content_id) : undefined;
      if (n === undefined) return el('td', { class: 'small muted', text: '—' });
      if (!n) {
        return el('td', {}, [
          el('span', { class: 'pill pill-warn', text: 'No pages' }),
        ]);
      }
      return el('td', { class: 'small muted', text: `${n} page${n === 1 ? '' : 's'}` });
    }

    const rows = data.items.map((c) => el('tr', {}, [
      el('td', {}, [
        el('a', { href: `/content?id=${c.content_id}`, text: c.title }),
        el('div', { class: 'tiny muted', text: c.author_creator || '' }),
      ]),
      el('td', { class: 'small', text: c.age_rating === null ? '—' : `${c.age_rating}+` }),
      el('td', { class: 'small muted', text: fmt.level(c.reading_level) }),
      books ? textCell(c) : null,
      el('td', { class: 'small muted', text: (c.tags || []).join(', ') }),
      el('td', { class: 'actions' }, [
        books
          ? el('button', {
            class: 'btn btn-sm btn-outline', onclick: () => openPagesEditor(c, shelf),
          }, ['Pages'])
          : null,
        el('button', {
          class: 'btn btn-sm btn-outline', onclick: () => openContentEditor(c, shelf),
        }, ['Edit']),
        el('button', {
          class: 'btn btn-sm btn-danger',
          onclick: () => confirmDialog(`Remove "${c.title}"?`,
            'It disappears from every library, along with its reviews and reading progress.',
            async () => {
              try {
                await global.api.del(`/api/catalog/content/${c.content_id}`);
                toast('Removed.', 'ok');
                await loadShelf(shelf);
              } catch (err) { showError(err); }
            }),
        }, ['Delete']),
      ]),
    ]));

    body.appendChild(table(
      books
        ? ['Title', 'Ages', 'Level', 'Text', 'Categories', '']
        : ['Title', 'Ages', 'Level', 'Categories', ''],
      rows,
    ));
  }

  /**
   * Draws a shelf: the heading, the search box, and the table under it.
   *
   * The search box is only built once per visit to the tab. Rebuilding it on
   * every keystroke would take the cursor out of it, which is the one thing a
   * search box must never do.
   */
  async function loadShelf(shelf) {
    const { type, noun, plural } = SHELVES[shelf];
    const host = panel(shelf);

    if (!$(`#shelf-${shelf}-results`)) {
      clear(host);

      host.appendChild(el('div', { class: 'panel-head' }, [
        el('h3', { style: { fontSize: '.95rem' }, text: noun === 'book' ? 'Books' : 'Videos' }),
        el('div', { class: 'row' }, [
          el('button', { class: 'btn btn-outline btn-sm', onclick: openImportDialog },
            ['Bulk import']),
          el('button', {
            class: 'btn btn-primary btn-sm',
            // Adding from the video shelf should start as a video.
            onclick: () => openContentEditor(null, shelf),
          }, [`Add a ${noun}`]),
        ]),
      ]));

      const box = el('input', {
        type: 'search',
        id: `shelf-${shelf}-search`,
        placeholder: `Search ${plural} by title, author or category`,
        'aria-label': `Search ${plural}`,
        value: search[shelf],
      });
      const clearBtn = el('button', {
        class: 'btn btn-outline btn-sm',
        type: 'button',
        onclick: () => {
          search[shelf] = '';
          box.value = '';
          box.focus();
          refreshShelf(shelf);
        },
      }, ['Clear']);

      // Waiting a moment after the last keystroke means typing a whole word
      // sends one request instead of one per letter.
      let timer = null;
      box.addEventListener('input', () => {
        search[shelf] = box.value;
        clearTimeout(timer);
        timer = setTimeout(() => refreshShelf(shelf), 220);
      });
      box.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && box.value) {
          search[shelf] = '';
          box.value = '';
          refreshShelf(shelf);
        }
        if (e.key === 'Enter') {
          clearTimeout(timer);
          refreshShelf(shelf);
        }
      });

      host.appendChild(el('div', { class: 'panel' }, [
        el('div', { class: 'row', style: { marginBottom: '12px' } }, [
          el('div', { style: { flex: '1 1 260px' } }, [box]),
          clearBtn,
        ]),
        el('div', { id: `shelf-${shelf}-results` }),
        // Holds the unfiltered count, so "3 of 48" stays truthful while a
        // filter is on rather than counting only what came back.
        el('span', { id: `shelf-${shelf}-total`, class: 'hidden' }),
      ]));
    }

    // The size of the shelf itself, independent of any filter.
    try {
      const all = await global.api.get('/api/content', { limit: 1, type });
      $(`#shelf-${shelf}-total`).dataset.total = String(all.total);
    } catch (err) { /* the filtered count alone will have to do */ }

    await refreshShelf(shelf);
  }

  /**
   * `shelf` is the tab this was opened from. It decides what a new title
   * starts as, and which list is redrawn afterwards.
   */
  function openContentEditor(existing, shelf = 'books') {
    const isNew = !existing;
    const title = el('input', { type: 'text', maxlength: '255', value: existing ? existing.title : '' });
    const type = el('select', {}, [['BOOK', 'Book'], ['VIDEO', 'Video']]
      .map(([v, l]) => el('option', { value: v, text: l })));
    type.value = existing ? existing.content_type : SHELVES[shelf].type;
    const author = el('input', {
      type: 'text', maxlength: '255', value: existing ? existing.author_creator || '' : '',
    });
    const description = el('textarea', {
      maxlength: '4000', text: existing ? existing.description || '' : '',
    });
    const ageRating = el('input', {
      type: 'number', min: '0', max: '18',
      value: existing && existing.age_rating !== null ? String(existing.age_rating) : '',
    });
    const level = el('select', {}, [['', 'Not set'], ['BEGINNER', 'Beginner'],
      ['INTERMEDIATE', 'Intermediate'], ['ADVANCED', 'Advanced']]
      .map(([v, l]) => el('option', { value: v, text: l })));
    if (existing) level.value = existing.reading_level || '';
    const duration = el('input', {
      type: 'number', min: '0', max: '1000',
      value: existing && existing.duration_minutes !== null ? String(existing.duration_minutes) : '',
    });
    const cover = el('input', {
      type: 'text', placeholder: 'https://… (optional)',
      value: existing ? existing.cover_image_url || '' : '',
    });
    const link = el('input', {
      type: 'text', placeholder: 'https://… (optional)',
      value: existing ? existing.external_link || '' : '',
    });
    const preview = el('input', {
      type: 'text', placeholder: 'https://… (optional)',
      value: existing ? existing.preview_url || '' : '',
    });

    const selected = new Set(existing ? existing.tags || [] : []);
    const chips = el('div', { class: 'chips' }, allTags.map((tag) => {
      const chip = el('button', {
        class: `chip ${selected.has(tag.tag_name) ? 'on' : ''}`.trim(),
        type: 'button', text: tag.tag_name,
      });
      chip.addEventListener('click', () => {
        if (selected.has(tag.tag_name)) selected.delete(tag.tag_name);
        else selected.add(tag.tag_name);
        chip.classList.toggle('on');
      });
      return chip;
    }));

    const body = el('div', { class: 'form-grid' }, [
      field('Title', title),
      el('div', { class: 'form-grid two' }, [field('Type', type), field('Author or creator', author)]),
      field('Description', description),
      el('div', { class: 'form-grid two' }, [
        field('Minimum age', ageRating, 'Children whose limit is below this will not see it.'),
        field('Reading level', level),
      ]),
      el('div', { class: 'form-grid two' }, [
        field('Length in minutes', duration),
        field('Cover image URL', cover, 'Leave blank to use a generated cover.'),
      ]),
      field('External link', link),
      field('Preview or trailer link', preview,
        'Anyone may open this, including visitors who have not signed in.'),
      el('div', { class: 'field' }, [el('label', { text: 'Tags' }), chips]),
    ]);

    const dialog = modal(
      isNew ? `Add a ${SHELVES[shelf].noun}` : `Edit "${existing.title}"`, body, [
      el('button', { class: 'btn btn-outline', onclick: () => dialog.close() }, ['Cancel']),
      el('button', {
        class: 'btn btn-primary',
        onclick: async (event) => {
          event.currentTarget.disabled = true;
          const payload = {
            content_type: type.value,
            title: title.value,
            author_creator: author.value,
            description: description.value,
            age_rating: ageRating.value === '' ? null : Number(ageRating.value),
            reading_level: level.value,
            duration_minutes: duration.value === '' ? null : Number(duration.value),
            cover_image_url: cover.value,
            external_link: link.value,
            preview_url: preview.value,
            tags: Array.from(selected),
          };
          try {
            if (isNew) await global.api.post('/api/catalog/content', payload);
            else await global.api.put(`/api/catalog/content/${existing.content_id}`, payload);
            dialog.close();
            toast('Saved.', 'ok');
            // A title whose type was changed has moved to the other shelf, so
            // redraw whichever one it is on now as well as the one we are on.
            const landedOn = type.value === 'VIDEO' ? 'videos' : 'books';
            await loadShelf(shelf);
            if (landedOn !== shelf) await loadShelf(landedOn);
          } catch (err) {
            event.currentTarget.disabled = false;
            showError(err);
          }
        },
      }, [isNew ? 'Add to library' : 'Save']),
    ]);
  }


  // --- the pages of a book --------------------------------------------------
  // The catalogue form above shelves a book. This writes it. They are separate
  // dialogs because they are separate jobs, and because a story is long: it
  // has no business sharing a form with an age rating.

  const SAMPLE_STORY = `# The night the lamp went out
The lighthouse had burned every night for ninety years.

On the ninety-first, it did not.

---

Mira counted to ten and looked again. Still dark.

---

# Down the stairs
There were one hundred and forty steps, and she took them two at a time.`;

  /**
   * Turns pasted prose into pages.
   *
   * A line of its own holding three or more dashes starts a new page, so
   * somebody can paste a whole story and still decide where it breaks. Blank
   * lines inside a page are left alone: that is how paragraphs are stored, and
   * the reader is what splits them. A first line beginning with a hash becomes
   * that page's heading.
   */
  function splitIntoPages(raw, mode) {
    const text = String(raw || '').replace(/\r\n?/g, '\n');
    const chunks = mode === 'blank'
      ? text.split(/\n[ \t]*\n/)
      : text.split(/^[ \t]*-{3,}[ \t]*$/m);

    return chunks.map((chunk) => {
      const lines = chunk.replace(/^\n+/, '').replace(/\n+$/, '').split('\n');
      let heading = null;
      if (lines.length && /^#{1,3}\s+/.test(lines[0])) {
        heading = lines.shift().replace(/^#{1,3}\s+/, '').trim().slice(0, 200);
      }
      return { heading, body: lines.join('\n').trim(), illustration: null };
    }).filter((page) => page.body);
  }

  function wordCount(text) {
    const words = String(text || '').trim().split(/\s+/).filter(Boolean);
    return words.length;
  }

  /**
   * The page editor. `pages` below is the single source of truth: typing
   * updates it in place and leaves the DOM alone, so the cursor stays where it
   * is. Only a structural change - adding, deleting, moving a page - redraws
   * the list, because only then do the page numbers change.
   */
  function openPagesEditor(content, shelf = 'books') {
    let pages = [];
    let dirty = false;
    let limits = { max_pages: 300, max_body: 8000 };

    const summary = el('p', { class: 'tiny muted', style: { margin: 0 } });
    const unsaved = el('span', { class: 'pill pill-warn hidden', text: 'Unsaved' });
    const list = el('div', { class: 'page-editor' });
    const pasteSlot = el('div');

    // Everything in here edits a copy. Nothing reaches the library until Save
    // is pressed, so the dialog has to say so and go on saying it, rather than
    // mentioning it once in a message that fades.
    function touch() {
      dirty = true;
      unsaved.classList.remove('hidden');
    }

    function updateSummary() {
      const words = pages.reduce((n, p) => n + wordCount(p.body), 0);
      if (!pages.length) {
        summary.textContent = 'No pages yet.';
        return;
      }
      summary.textContent = `${pages.length} page${pages.length === 1 ? '' : 's'}, `
        + `about ${words} word${words === 1 ? '' : 's'}. Readers see them in this order.`;
    }

    function move(from, to) {
      if (to < 0 || to >= pages.length) return;
      const [page] = pages.splice(from, 1);
      pages.splice(to, 0, page);
      touch();
      draw();
      // Keep the moved page under the pointer: the button that moved it is the
      // one somebody is about to press again.
      const card = list.children[to];
      if (card) {
        const btn = card.querySelector(from < to ? '[data-act="down"]' : '[data-act="up"]');
        if (btn) btn.focus();
      }
    }

    function addPage(at) {
      pages.splice(at, 0, { heading: null, body: '', illustration: null });
      touch();
      draw();
      const card = list.children[at];
      const field = card && card.querySelector('textarea');
      if (field) field.focus();
    }

    function card(page, index) {
      const heading = el('input', {
        type: 'text',
        maxlength: '200',
        value: page.heading || '',
        placeholder: 'Optional heading',
        'aria-label': `Heading for page ${index + 1}`,
      });
      heading.addEventListener('input', () => {
        page.heading = heading.value;
        touch();
      });

      const illustration = el('input', {
        type: 'text',
        maxlength: '255',
        value: page.illustration || '',
        placeholder: '🦊',
        class: 'page-glyph',
        'aria-label': `Picture for page ${index + 1}`,
      });
      illustration.addEventListener('input', () => {
        page.illustration = illustration.value;
        touch();
      });

      const words = el('span', { class: 'tiny muted' });
      const body = el('textarea', {
        rows: '5',
        maxlength: String(limits.max_body),
        text: page.body || '',
        'aria-label': `Text of page ${index + 1}`,
      });
      const countWords = () => {
        const n = wordCount(body.value);
        words.textContent = `${n} word${n === 1 ? '' : 's'}`;
      };
      body.addEventListener('input', () => {
        page.body = body.value;
        touch();
        countWords();
        updateSummary();
      });
      countWords();

      const tool = (label, act, hint, onclick, disabled) => el('button', {
        class: 'btn btn-sm btn-outline',
        type: 'button',
        dataset: { act },
        title: hint,
        'aria-label': hint,
        disabled: disabled ? true : null,
        onclick,
      }, [label]);

      return el('div', { class: 'page-card' }, [
        el('div', { class: 'page-card-head' }, [
          el('span', { class: 'page-no', text: `Page ${index + 1}` }),
          illustration,
          el('div', { class: 'grow' }, [heading]),
          el('div', { class: 'row page-card-tools' }, [
            tool('↑', 'up', `Move page ${index + 1} up`, () => move(index, index - 1), index === 0),
            tool('↓', 'down', `Move page ${index + 1} down`, () => move(index, index + 1),
              index === pages.length - 1),
            tool('✚', 'add', `Insert a page after page ${index + 1}`, () => addPage(index + 1)),
            el('button', {
              class: 'btn btn-sm btn-danger',
              type: 'button',
              title: `Delete page ${index + 1}`,
              'aria-label': `Delete page ${index + 1}`,
              onclick: () => {
                // A page with nothing on it needs no ceremony to remove.
                if (!String(page.body || '').trim()) {
                  pages.splice(index, 1);
                  touch();
                  draw();
                  return;
                }
                confirmDialog(`Delete page ${index + 1}?`,
                  'The text on it goes with it. Nothing is written to the library until you save.',
                  () => {
                    pages.splice(index, 1);
                    touch();
                    draw();
                  }, 'Delete page');
              },
            }, ['✕']),
          ]),
        ]),
        body,
        el('div', { class: 'row', style: { marginTop: '4px', justifyContent: 'flex-end' } },
          [words]),
      ]);
    }

    function draw() {
      clear(list);
      if (!pages.length) {
        list.appendChild(el('div', { class: 'panel', style: { margin: 0, textAlign: 'center' } }, [
          el('p', { class: 'small', style: { margin: '0 0 4px' },
            text: 'This book has no pages yet.' }),
          el('p', { class: 'tiny muted', style: { margin: '0 0 12px' } }, [
            'Until it has some, the reader can only show a short sample built '
            + 'from the description. Write the first page, or paste the whole story at once.',
          ]),
          el('div', { class: 'row', style: { justifyContent: 'center' } }, [
            el('button', { class: 'btn btn-primary btn-sm', type: 'button',
              onclick: () => addPage(0) }, ['Write the first page']),
          ]),
        ]));
      } else {
        pages.forEach((page, i) => list.appendChild(card(page, i)));
        list.appendChild(el('div', { class: 'row', style: { justifyContent: 'center' } }, [
          el('button', {
            class: 'btn btn-outline btn-sm',
            type: 'button',
            onclick: () => addPage(pages.length),
          }, ['Add a page at the end']),
        ]));
      }
      updateSummary();
    }

    /** The paste panel, folded away until it is asked for. */
    function togglePaste() {
      if (pasteSlot.firstChild) { clear(pasteSlot); return; }

      const text = el('textarea', {
        rows: '10',
        placeholder: SAMPLE_STORY,
        style: { fontFamily: 'var(--mono, ui-monospace, monospace)', fontSize: '.8rem' },
      });
      const mode = el('select', {}, [
        el('option', { value: 'rule', text: 'A line of three dashes starts a new page' }),
        el('option', { value: 'blank', text: 'Every paragraph is its own page' }),
      ]);
      const where = el('select', {}, [
        el('option', { value: 'replace', text: 'Replace the pages that are there' }),
        el('option', { value: 'append', text: 'Add to the end of the book' }),
      ]);
      const note = el('p', { class: 'tiny muted', style: { margin: 0 } });

      const preview = () => {
        if (!text.value.trim()) { note.textContent = ''; return; }
        const n = splitIntoPages(text.value, mode.value).length;
        note.textContent = `That makes ${n} page${n === 1 ? '' : 's'}.`;
      };
      text.addEventListener('input', preview);
      mode.addEventListener('change', preview);

      pasteSlot.appendChild(el('div', { class: 'panel', style: { margin: '0 0 14px' } }, [
        el('p', { class: 'tiny muted', style: { marginTop: 0 } }, [
          'Paste the story below. A line holding only dashes starts a new page, '
          + 'and a line starting with # becomes that page’s heading. '
          + 'Nothing is saved to the library until you press Save pages.',
        ]),
        text,
        el('div', { class: 'form-grid two', style: { marginTop: '10px' } }, [
          field('Where a page ends', mode),
          field('What to do with it', where),
        ]),
        el('div', { class: 'spread', style: { marginTop: '10px' } }, [
          note,
          el('div', { class: 'row' }, [
            el('button', { class: 'btn btn-outline btn-sm', type: 'button',
              onclick: () => clear(pasteSlot) }, ['Cancel']),
            el('button', {
              class: 'btn btn-primary btn-sm',
              type: 'button',
              onclick: () => {
                const made = splitIntoPages(text.value, mode.value);
                if (!made.length) {
                  note.textContent = 'There is nothing to make pages out of.';
                  return;
                }
                const next = where.value === 'append' ? pages.concat(made) : made;
                if (next.length > limits.max_pages) {
                  note.textContent = `That would be ${next.length} pages, and a book may `
                    + `have at most ${limits.max_pages}.`;
                  return;
                }
                const long = made.find((p) => p.body.length > limits.max_body);
                if (long) {
                  note.textContent = `One page came out at ${long.body.length} characters, over `
                    + `the ${limits.max_body} limit. Break it with a line of dashes.`;
                  return;
                }
                pages = next;
                touch();
                clear(pasteSlot);
                draw();
              },
            }, ['Make the pages']),
          ]),
        ]),
      ]));
      text.focus();
    }

    const body = el('div', {}, [
      el('div', { class: 'spread', style: { marginBottom: '12px', alignItems: 'flex-end' } }, [
        el('div', {}, [
          el('div', { class: 'row', style: { gap: '8px' } }, [summary, unsaved]),
          el('p', { class: 'tiny muted', style: { margin: '2px 0 0' },
            text: 'Leave a blank line between paragraphs. Nothing reaches the library until '
              + 'you press Save pages.' }),
        ]),
        el('div', { class: 'row' }, [
          el('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: togglePaste },
            ['Paste a story']),
        ]),
      ]),
      pasteSlot,
      list,
    ]);

    const saveBtn = el('button', { class: 'btn btn-primary', disabled: true }, ['Save pages']);
    const dialog = modal(`Pages of "${content.title}"`, body, [
      el('button', { class: 'btn btn-outline', onclick: () => dialog.close() }, ['Close']),
      saveBtn,
    ], {
      // Escape, the X and a click outside all come through here, and a story
      // somebody has just typed is not something to lose to a stray click.
      confirmClose: () => !dirty
        || global.confirm('There are unsaved changes to this book. Close anyway?'),
    });
    dialog.node.querySelector('.modal').classList.add('modal-wide');

    saveBtn.addEventListener('click', async () => {
      const payload = pages.map((p) => ({
        heading: String(p.heading || '').trim() || null,
        body: String(p.body || '').trim(),
        illustration: String(p.illustration || '').trim() || null,
      }));
      const blank = payload.findIndex((p) => !p.body);
      if (blank !== -1) {
        toast(`Page ${blank + 1} has no text. Write something on it, or remove it.`, 'err');
        const card = list.children[blank];
        const field = card && card.querySelector('textarea');
        if (field) field.focus();
        return;
      }

      saveBtn.disabled = true;
      try {
        const res = await global.api.put(
          `/api/catalog/content/${content.content_id}/pages`, { pages: payload },
        );
        dirty = false;
        unsaved.classList.add('hidden');
        dialog.close({ force: true });
        toast(res.pages
          ? `Saved ${res.pages} page${res.pages === 1 ? '' : 's'}.`
          : 'The text was removed.', 'ok');
        await ensurePageCounts({ force: true });
        await refreshShelf(shelf);
      } catch (err) {
        saveBtn.disabled = false;
        showError(err);
      }
    });

    list.appendChild(el('p', { class: 'muted small', text: 'Reading the book…' }));

    (async () => {
      try {
        const data = await global.api.get(`/api/catalog/content/${content.content_id}/pages`);
        limits = { max_pages: data.max_pages, max_body: data.max_body };
        pages = data.pages.map((p) => ({
          heading: p.heading, body: p.body, illustration: p.illustration,
        }));
        saveBtn.disabled = false;
        draw();
      } catch (err) {
        clear(list);
        list.appendChild(el('div', { class: 'alert alert-error', text: err.message }));
      }
    })();
  }

  // --- bulk import ----------------------------------------------------------
  const IMPORT_HEADER = 'content_type,title,description,author_creator,age_rating,'
    + 'reading_level,language,duration_minutes,cover_image_url,external_link,preview_url,tags';
  const IMPORT_EXAMPLE = `${IMPORT_HEADER}
BOOK,The Paper Boat,A boat folded from a letter sails to the sea.,Ada Rennick,6,BEGINNER,English,18,,,,Adventure|Nature
VIDEO,How Bees Talk,Eight minutes on the waggle dance.,Orbit Academy,7,BEGINNER,English,8,,,,Animals|Science`;

  /** Renders the per-row outcome of an import, dry run or real. */
  function renderImportResult(res, slot) {
    clear(slot);
    const lines = [];
    if (res.dry_run) {
      lines.push(`${res.created.length} title${res.created.length === 1 ? '' : 's'} ready to import.`);
    } else {
      lines.push(`${res.imported} title${res.imported === 1 ? '' : 's'} added.`);
    }
    if (res.skipped.length) lines.push(`${res.skipped.length} skipped (already in the library).`);
    if (res.failed.length) lines.push(`${res.failed.length} could not be read.`);

    const kind = res.failed.length ? 'alert-warn' : 'alert-ok';
    slot.appendChild(el('div', { class: `alert ${kind}`, text: lines.join(' ') }));

    if (res.failed.length) {
      slot.appendChild(el('div', { class: 'table-scroll' }, el('table', {}, [
        el('thead', {}, el('tr', {}, [
          el('th', { text: 'Line' }), el('th', { text: 'Title' }), el('th', { text: 'Problem' }),
        ])),
        el('tbody', {}, res.failed.map((f) => el('tr', {}, [
          el('td', { class: 'small', text: String(f.line) }),
          el('td', { class: 'small', text: f.title || '—' }),
          el('td', { class: 'small muted', text: f.error }),
        ]))),
      ])));
    }
    if (res.skipped.length) {
      slot.appendChild(el('p', { class: 'tiny muted', text: `Skipped: ${
        res.skipped.map((k) => k.title).join(', ')}` }));
    }
  }

  /**
   * Paste a spreadsheet export, check it, then load it. Rows are validated one
   * at a time server-side, so one bad line does not cost you the other 199.
   */
  function openImportDialog() {
    const csv = el('textarea', {
      rows: '9', placeholder: IMPORT_EXAMPLE,
      style: { fontFamily: 'var(--mono, ui-monospace, monospace)', fontSize: '.78rem' },
    });
    const file = el('input', { type: 'file', accept: '.csv,text/csv,text/plain' });
    file.addEventListener('change', () => {
      const chosen = file.files && file.files[0];
      if (!chosen) return;
      const reader = new FileReader();
      reader.onload = () => { csv.value = String(reader.result || ''); };
      reader.readAsText(chosen);
    });

    const skipDuplicates = el('input', { type: 'checkbox', checked: true });
    const slot = el('div');

    async function send(dryRun, button) {
      if (!csv.value.trim()) {
        clear(slot);
        slot.appendChild(el('div', { class: 'alert alert-error', text: 'Paste some rows first.' }));
        return;
      }
      button.disabled = true;
      try {
        const res = await global.api.post('/api/catalog/content/import', {
          csv: csv.value,
          dry_run: dryRun,
          skip_duplicates: skipDuplicates.checked,
        });
        renderImportResult(res, slot);
        if (!dryRun && res.imported) {
          toast(`Imported ${res.imported} title${res.imported === 1 ? '' : 's'}.`, 'ok');
          // An import file can hold both kinds, so neither shelf is safe to
          // leave as it was.
          await loadShelf('books');
          await loadShelf('videos');
        }
      } catch (err) {
        clear(slot);
        slot.appendChild(el('div', { class: 'alert alert-error', text: err.message }));
      } finally {
        button.disabled = false;
      }
    }

    const body = el('div', { class: 'form-grid' }, [
      el('p', { class: 'muted small', style: { margin: 0 } }, [
        'One title per line, with a header row. Separate several tags with a '
        + 'vertical bar. Only content_type and title are required.',
      ]),
      el('div', { class: 'field' }, [
        el('label', { text: 'Choose a CSV file' }), file,
      ]),
      el('div', { class: 'field' }, [
        el('label', { text: '…or paste the rows' }), csv,
      ]),
      el('label', { class: 'checkbox' }, [
        skipDuplicates,
        el('span', { text: 'Skip titles that are already in the library' }),
      ]),
      slot,
    ]);

    const dialog = modal('Bulk import titles', body, [
      el('button', { class: 'btn btn-outline', onclick: () => dialog.close() }, ['Close']),
      el('button', {
        class: 'btn', onclick: (e) => send(true, e.currentTarget),
      }, ['Check it first']),
      el('button', {
        class: 'btn btn-primary', onclick: (e) => send(false, e.currentTarget),
      }, ['Import']),
    ]);
  }

  // --- categories -----------------------------------------------------------
  const CATEGORY_KINDS = [['GENRE', 'Genre'], ['THEME', 'Theme'], ['TOPIC', 'Topic']];

  /**
   * The tag vocabulary behind the library filters. Renaming one here renames it
   * everywhere, because titles point at the tag rather than a copy of its name.
   */
  /**
   * Draws the category table, filtered by whatever is in the search box.
   *
   * The whole vocabulary is a few dozen rows and is already in memory, so this
   * filters what was loaded rather than asking the server again: the list
   * narrows as fast as it can be typed.
   */
  function refreshCategories() {
    const body = $('#categories-results');
    if (!body) return;

    const term = search.categories.trim().toLowerCase();
    const shown = term
      ? allTags.filter((tag) => tag.tag_name.toLowerCase().includes(term)
        || String(tag.category || '').toLowerCase().includes(term))
      : allTags;

    clear(body);
    body.appendChild(el('p', {
      class: 'tiny muted',
      style: { margin: '0 0 10px' },
      text: term
        ? (shown.length
          ? `${shown.length} of ${allTags.length} categories match "${search.categories.trim()}".`
          : `Nothing matches "${search.categories.trim()}".`)
        : `${allTags.length} categor${allTags.length === 1 ? 'y' : 'ies'} in the vocabulary.`,
    }));

    if (!shown.length) {
      body.appendChild(el('p', { class: 'muted small', style: { margin: 0 },
        text: 'Try part of a category name, or a kind: genre, theme or topic.' }));
      return;
    }

    const rows = shown.map((tag) => el('tr', {}, [
      el('td', {}, [el('a', {
        href: `/library?tag=${encodeURIComponent(tag.tag_name)}`, text: tag.tag_name,
      })]),
      el('td', {}, [el('span', { class: 'pill', text: tag.category })]),
      el('td', { class: 'small muted', text: `${tag.content_count} title${tag.content_count === 1 ? '' : 's'}` }),
      el('td', { class: 'actions' }, [
        el('button', {
          class: 'btn btn-sm btn-outline', onclick: () => openCategoryEditor(tag),
        }, ['Edit']),
        el('button', {
          class: 'btn btn-sm btn-danger',
          onclick: () => confirmDialog(`Delete "${tag.tag_name}"?`,
            tag.content_count
              ? `${tag.content_count} title${tag.content_count === 1 ? '' : 's'} will lose this tag. `
                + 'The titles themselves stay in the library.'
              : 'Nothing uses it, so nothing else changes.',
            async () => {
              try {
                await global.api.del(`/api/catalog/tags/${tag.tag_id}`);
                toast('Deleted.', 'ok');
                await loadCategories();
              } catch (err) { showError(err); }
            }),
        }, ['Delete']),
      ]),
    ]));

    body.appendChild(table(['Name', 'Kind', 'Used by', ''], rows));
  }

  async function loadCategories() {
    const host = panel('categories');

    // Built once, like the shelves: rebuilding the search box on every
    // keystroke would take the cursor out of it.
    if (!$('#categories-results')) {
      clear(host);

      host.appendChild(el('div', { class: 'panel-head' }, [
        el('h3', { style: { fontSize: '.95rem' } }, ['Categories']),
        el('button', { class: 'btn btn-primary btn-sm', onclick: () => openCategoryEditor(null) },
          ['Add a category']),
      ]));

      const box = el('input', {
        type: 'search',
        id: 'categories-search',
        placeholder: 'Search categories by name or kind',
        'aria-label': 'Search categories',
        value: search.categories,
      });
      const clearBtn = el('button', {
        class: 'btn btn-outline btn-sm',
        type: 'button',
        onclick: () => {
          search.categories = '';
          box.value = '';
          box.focus();
          refreshCategories();
        },
      }, ['Clear']);

      // No debounce: nothing is fetched, so there is nothing to wait for.
      box.addEventListener('input', () => {
        search.categories = box.value;
        refreshCategories();
      });
      box.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && box.value) {
          search.categories = '';
          box.value = '';
          refreshCategories();
        }
      });

      host.appendChild(el('div', { class: 'panel' }, [
        el('div', { class: 'row', style: { marginBottom: '12px' } }, [
          el('div', { style: { flex: '1 1 260px' } }, [box]),
          clearBtn,
        ]),
        el('div', { id: 'categories-results' }),
      ]));

      host.appendChild(el('p', { class: 'tiny muted' }, [
        'Genres and topics are what a child sees on their library page; themes are '
        + 'kept for grown-ups and the Story Chat. A genre can also be blocked per '
        + 'child from the Family page.',
      ]));
    }

    const data = await global.api.get('/api/content/tags');
    allTags = data.items;
    refreshCategories();
  }

  function openCategoryEditor(existing) {
    const isNew = !existing;
    const name = el('input', {
      type: 'text', maxlength: '100', value: existing ? existing.tag_name : '',
    });
    const kind = el('select', {}, CATEGORY_KINDS.map(([value, label]) => el('option', {
      value, text: label,
    })));
    if (existing) kind.value = existing.category;

    const dialog = modal(isNew ? 'Add a category' : `Edit "${existing.tag_name}"`,
      el('div', { class: 'form-grid' }, [
        field('Name', name),
        field('Kind', kind, 'Genres and topics show on the children\u2019s library page.'),
      ]), [
        el('button', { class: 'btn btn-outline', onclick: () => dialog.close() }, ['Cancel']),
        el('button', {
          class: 'btn btn-primary',
          onclick: async (event) => {
            event.currentTarget.disabled = true;
            try {
              if (isNew) {
                await global.api.post('/api/catalog/tags',
                  { tag_name: name.value, category: kind.value });
              } else {
                await global.api.patch(`/api/catalog/tags/${existing.tag_id}`,
                  { tag_name: name.value, category: kind.value });
              }
              dialog.close();
              toast('Saved.', 'ok');
              loadCategories();
            } catch (err) {
              event.currentTarget.disabled = false;
              showError(err);
            }
          },
        }, [isNew ? 'Add it' : 'Save']),
      ]);
  }

  // --- tabs -----------------------------------------------------------------
  const loaders = {
    overview: loadOverview,
    books: () => loadShelf('books'),
    videos: () => loadShelf('videos'),
    categories: loadCategories,
  };

  async function switchTab(name) {
    $$('#tabs .tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === name));
    Object.keys(loaders).forEach((n) => panel(n).classList.toggle('hidden', n !== name));
    try {
      await loaders[name]();
    } catch (err) {
      showError(err);
    }
  }

  async function start() {
    const ok = await global.SN.init({ requireRole: 'LIBRARIAN', requireAuth: true, active: '/librarian' });
    if (!ok) return;

    try {
      const tags = await global.api.get('/api/content/tags');
      allTags = tags.items;
    } catch (err) { /* editors cope with an empty tag list */ }

    $$('#tabs .tab').forEach((tab) => tab.addEventListener('click', () => switchTab(tab.dataset.tab)));
    switchTab('overview');
  }

  document.addEventListener('DOMContentLoaded', start);
}(window));
