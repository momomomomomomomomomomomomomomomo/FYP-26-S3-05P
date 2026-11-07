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

    const rows = data.items.map((c) => el('tr', {}, [
      el('td', {}, [
        el('a', { href: `/content?id=${c.content_id}`, text: c.title }),
        el('div', { class: 'tiny muted', text: c.author_creator || '' }),
      ]),
      el('td', { class: 'small', text: c.age_rating === null ? '—' : `${c.age_rating}+` }),
      el('td', { class: 'small muted', text: fmt.level(c.reading_level) }),
      el('td', { class: 'small muted', text: (c.tags || []).join(', ') }),
      el('td', { class: 'actions' }, [
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

    body.appendChild(table(['Title', 'Ages', 'Level', 'Categories', ''], rows));
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
