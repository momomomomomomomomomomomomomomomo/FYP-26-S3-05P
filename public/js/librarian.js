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
  async function loadContent() {
    const host = panel('content');
    clear(host);

    host.appendChild(el('div', { class: 'panel-head' }, [
      el('h3', { style: { fontSize: '.95rem' } }, ['Catalogue']),
      el('div', { class: 'row' }, [
        el('button', { class: 'btn btn-outline btn-sm', onclick: openImportDialog },
          ['Bulk import']),
        el('button', { class: 'btn btn-primary btn-sm', onclick: () => openContentEditor(null) },
          ['Add a title']),
      ]),
    ]));

    const data = await global.api.get('/api/content', { limit: 60, sort: 'title' });

    const rows = data.items.map((c) => el('tr', {}, [
      el('td', {}, [
        el('a', { href: `/content?id=${c.content_id}`, text: c.title }),
        el('div', { class: 'tiny muted', text: c.author_creator || '' }),
      ]),
      el('td', { class: 'small', text: c.content_type }),
      el('td', { class: 'small', text: c.age_rating === null ? '—' : `${c.age_rating}+` }),
      el('td', { class: 'small muted', text: fmt.level(c.reading_level) }),
      el('td', { class: 'small muted', text: (c.tags || []).join(', ') }),
      el('td', { class: 'actions' }, [
        el('button', {
          class: 'btn btn-sm btn-outline', onclick: () => openContentEditor(c),
        }, ['Edit']),
        el('button', {
          class: 'btn btn-sm btn-danger',
          onclick: () => confirmDialog(`Remove "${c.title}"?`,
            'It disappears from every library, along with its reviews and reading progress.',
            async () => {
              try {
                await global.api.del(`/api/catalog/content/${c.content_id}`);
                toast('Removed.', 'ok');
                loadContent();
              } catch (err) { showError(err); }
            }),
        }, ['Delete']),
      ]),
    ]));

    host.appendChild(el('div', { class: 'panel' },
      table(['Title', 'Type', 'Ages', 'Level', 'Tags', ''], rows)));
  }

  function openContentEditor(existing) {
    const isNew = !existing;
    const title = el('input', { type: 'text', maxlength: '255', value: existing ? existing.title : '' });
    const type = el('select', {}, [['BOOK', 'Book'], ['VIDEO', 'Video']]
      .map(([v, l]) => el('option', { value: v, text: l })));
    if (existing) type.value = existing.content_type;
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

    const dialog = modal(isNew ? 'Add a title' : `Edit "${existing.title}"`, body, [
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
            loadContent();
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
          loadContent();
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
  async function loadCategories() {
    const host = panel('categories');
    clear(host);

    host.appendChild(el('div', { class: 'panel-head' }, [
      el('h3', { style: { fontSize: '.95rem' } }, ['Categories']),
      el('button', { class: 'btn btn-primary btn-sm', onclick: () => openCategoryEditor(null) },
        ['Add a category']),
    ]));

    const data = await global.api.get('/api/content/tags');
    allTags = data.items;

    const rows = data.items.map((tag) => el('tr', {}, [
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
                loadCategories();
              } catch (err) { showError(err); }
            }),
        }, ['Delete']),
      ]),
    ]));

    host.appendChild(el('div', { class: 'panel' },
      table(['Name', 'Kind', 'Used by', ''], rows)));
    host.appendChild(el('p', { class: 'tiny muted' }, [
      'Genres and topics are what a child sees on their library page; themes are '
      + 'kept for grown-ups and the Story Chat. A genre can also be blocked per '
      + 'child from the Family page.',
    ]));
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
    content: loadContent,
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
