/* The administrator console: every account, the whole catalogue, reported
   content, announcements and the audit trail. */
(function admin(global) {
  'use strict';
  const {
    el, $, $$, clear, fmt, modal, confirmDialog, showError, toast, emptyState,
  } = global.SN;

  const state = { userFilter: { role: '', status: '', q: '' }, logFilter: { activity_type: '', actor_role: '' } };
  let allTags = [];

  function panel(name) { return $(`#panel-${name}`); }
  function roleClass(role) {
    return role === 'ADMIN' ? 'pill-admin' : role === 'ADULT' ? 'pill-adult' : 'pill-child';
  }
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

  // --- overview -------------------------------------------------------------
  async function loadOverview() {
    const host = panel('overview');
    clear(host);
    const data = await global.api.get('/api/admin/stats');
    const t = data.totals;

    host.appendChild(el('div', { class: 'stat-row' }, [
      ['Adults', t.adults], ['Children', t.children], ['Administrators', t.admins],
      ['Books', t.books], ['Videos', t.videos], ['Reviews', t.reviews],
      ['Open reports', t.open_reports], ['Pending requests', t.pending_requests],
    ].map(([label, value]) => el('div', { class: 'stat' }, [
      el('div', { class: 'stat-value', text: String(value) }),
      el('div', { class: 'stat-label', text: label }),
    ]))));

    if (data.activity.length) {
      const max = Math.max(...data.activity.map((a) => a.events), 1);
      host.appendChild(el('div', { class: 'panel' }, [
        el('h3', { style: { fontSize: '.95rem' } }, ['Activity, last 14 days']),
        el('div', { class: 'row', style: { alignItems: 'flex-end', gap: '6px', height: '90px' } },
          // maxWidth keeps a single day's bar from stretching across the panel.
          data.activity.map((a) => el('div', {
            style: { flex: '1', maxWidth: '52px', textAlign: 'center' },
          }, [
            el('div', {
              style: {
                height: `${Math.max(3, (a.events / max) * 64)}px`,
                background: 'var(--blue-500)', borderRadius: '3px 3px 0 0',
              },
              title: `${a.events} events on ${a.day}`,
            }),
            el('div', { class: 'tiny muted', text: String(a.events) }),
          ]))),
      ]));
    }

    host.appendChild(el('div', { class: 'panel' }, [
      el('h3', { style: { fontSize: '.95rem' } }, ['Most opened titles']),
      table(['Title', 'Type', 'Readers', 'Rating'], data.popular.map((p) => el('tr', {}, [
        el('td', {}, [el('a', { href: `/content?id=${p.content_id}`, text: p.title })]),
        el('td', { class: 'small muted', text: p.content_type }),
        el('td', { text: String(p.readers) }),
        el('td', {}, [el('span', { class: 'stars', text: fmt.stars(p.avg_rating) })]),
      ]))),
    ]));
  }

  // --- users ----------------------------------------------------------------
  async function loadUsers() {
    const host = panel('users');
    clear(host);

    const search = el('input', {
      type: 'search', placeholder: 'Name or email…', value: state.userFilter.q,
    });
    const role = el('select', {}, [['', 'All roles'], ['ADMIN', 'Administrators'],
      ['ADULT', 'Adults'], ['CHILD', 'Children']].map(([v, l]) => el('option', { value: v, text: l })));
    role.value = state.userFilter.role;
    const status = el('select', {}, [['', 'Any status'], ['ACTIVE', 'Active'],
      ['SUSPENDED', 'Suspended']].map(([v, l]) => el('option', { value: v, text: l })));
    status.value = state.userFilter.status;

    let timer;
    search.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => { state.userFilter.q = search.value.trim(); loadUsers(); }, 250);
    });
    role.addEventListener('change', () => { state.userFilter.role = role.value; loadUsers(); });
    status.addEventListener('change', () => { state.userFilter.status = status.value; loadUsers(); });

    host.appendChild(el('div', { class: 'filters' },
      el('div', { class: 'filter-row' }, [
        field('Search', search), field('Role', role), field('Status', status),
      ])));

    const data = await global.api.get('/api/admin/users', state.userFilter);

    const rows = data.items.map((u) => el('tr', {}, [
      el('td', {}, [
        el('div', { class: 'row' }, [
          el('span', { class: 'avatar', text: fmt.initials(u.name) }),
          el('div', {}, [
            el('div', { style: { fontWeight: '600' }, text: u.name }),
            el('div', { class: 'tiny muted', text: u.email || 'no login' }),
          ]),
        ]),
      ]),
      el('td', {}, [el('span', { class: `pill ${roleClass(u.role)}`, text: u.role })]),
      el('td', { class: 'small', text: u.age === null ? '—' : String(u.age) }),
      el('td', { class: 'small muted' }, [
        u.role === 'CHILD'
          ? el('span', { text: u.parents || 'no parent linked' })
          : el('span', { text: u.child_count ? `${u.child_count} child account(s)` : '—' }),
      ]),
      el('td', {}, [el('span', {
        class: `pill ${u.account_status === 'ACTIVE' ? 'pill-ok' : 'pill-danger'}`,
        text: u.account_status,
      })]),
      el('td', { class: 'small muted nowrap', text: fmt.date(u.created_at) }),
      el('td', { class: 'actions' }, [
        el('button', {
          class: 'btn btn-sm btn-outline',
          onclick: () => openUserEditor(u),
        }, ['Edit']),
        el('button', {
          class: 'btn btn-sm btn-outline',
          onclick: async () => {
            try {
              await global.api.patch(`/api/admin/users/${u.user_id}`, {
                account_status: u.account_status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE',
              });
              toast(u.account_status === 'ACTIVE' ? 'Account suspended.' : 'Account restored.', 'ok');
              loadUsers();
            } catch (err) { showError(err); }
          },
        }, [u.account_status === 'ACTIVE' ? 'Suspend' : 'Restore']),
        el('button', {
          class: 'btn btn-sm btn-danger',
          onclick: () => confirmDialog(`Delete ${u.name}?`,
            'Everything belonging to this account goes with it, including any child accounts they own. '
            + 'This cannot be undone.',
            async () => {
              try {
                await global.api.del(`/api/admin/users/${u.user_id}`);
                toast('Account deleted.', 'ok');
                loadUsers();
              } catch (err) { showError(err); }
            }),
        }, ['Delete']),
      ]),
    ]));

    host.appendChild(el('div', { class: 'panel' }, [
      el('div', { class: 'panel-head' }, [
        el('h3', { style: { fontSize: '.95rem' } }, [`${data.total} account(s)`]),
      ]),
      rows.length
        ? table(['Account', 'Role', 'Age', 'Family', 'Status', 'Joined', ''], rows)
        : el('p', { class: 'muted small', style: { margin: 0 } }, ['Nothing matches those filters.']),
    ]));
  }

  function openUserEditor(user) {
    const name = el('input', { type: 'text', value: user.name, maxlength: '100' });
    const role = el('select', {}, [['ADMIN', 'Administrator'], ['ADULT', 'Adult'],
      ['CHILD', 'Child']].map(([v, l]) => el('option', { value: v, text: l })));
    role.value = user.role;
    if (user.role === 'CHILD') role.disabled = true;
    const password = el('input', { type: 'text', placeholder: 'Leave blank to keep the current one' });

    const dialog = modal(`Edit ${user.name}`, el('div', { class: 'form-grid' }, [
      field('Name', name),
      field('Role', role, user.role === 'CHILD'
        ? 'A child account cannot be promoted. Create a new adult account instead.' : null),
      field('Reset password', password),
    ]), [
      el('button', { class: 'btn btn-outline', onclick: () => dialog.close() }, ['Cancel']),
      el('button', {
        class: 'btn btn-primary',
        onclick: async (event) => {
          event.currentTarget.disabled = true;
          try {
            const patch = { name: name.value };
            if (!role.disabled) patch.role = role.value;
            if (password.value.trim()) patch.password = password.value;
            await global.api.patch(`/api/admin/users/${user.user_id}`, patch);
            dialog.close();
            toast('Saved.', 'ok');
            loadUsers();
          } catch (err) {
            event.currentTarget.disabled = false;
            showError(err);
          }
        },
      }, ['Save']),
    ]);
  }

  // --- content --------------------------------------------------------------
  async function loadContent() {
    const host = panel('content');
    clear(host);

    host.appendChild(el('div', { class: 'panel-head' }, [
      el('h3', { style: { fontSize: '.95rem' } }, ['Catalogue']),
      el('button', { class: 'btn btn-primary btn-sm', onclick: () => openContentEditor(null) },
        ['Add a title']),
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
                await global.api.del(`/api/admin/content/${c.content_id}`);
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
            tags: Array.from(selected),
          };
          try {
            if (isNew) await global.api.post('/api/admin/content', payload);
            else await global.api.put(`/api/admin/content/${existing.content_id}`, payload);
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

  // --- reports --------------------------------------------------------------
  async function loadReports() {
    const host = panel('reports');
    clear(host);
    const data = await global.api.get('/api/admin/reports');

    if (!data.items.length) {
      host.appendChild(emptyState('🛡️', 'Nothing reported', 'Reports from users will appear here.'));
      return;
    }

    data.items.forEach((r) => {
      const open = r.status === 'OPEN';
      host.appendChild(el('div', { class: 'panel' }, [
        el('div', { class: 'panel-head' }, [
          el('div', {}, [
            el('div', { style: { fontWeight: '700' } }, [
              r.content_title
                ? el('a', { href: `/content?id=${r.content_id}`, text: r.content_title })
                : el('span', { text: 'A review' }),
            ]),
            el('div', { class: 'tiny muted' }, [
              `Reported by ${r.reporter} (${r.reporter_role.toLowerCase()}) on ${fmt.date(r.created_at)}`,
            ]),
          ]),
          el('span', {
            class: `pill ${open ? 'pill-warn' : r.status === 'RESOLVED' ? 'pill-ok' : ''}`.trim(),
            text: r.status,
          }),
        ]),
        el('p', { class: 'small', style: { margin: '0 0 8px' }, text: r.reason }),
        r.reported_review
          ? el('div', { class: 'alert', style: { marginBottom: '8px' } }, [
            el('div', { class: 'tiny muted', text: `Review by ${r.review_author}:` }),
            el('div', { class: 'small', text: r.reported_review }),
          ])
          : null,
        open
          ? el('div', { class: 'row' }, [
            el('button', {
              class: 'btn btn-sm btn-primary',
              onclick: () => decideReport(r.report_id, 'RESOLVED', false),
            }, ['Mark resolved']),
            r.feedback_id
              ? el('button', {
                class: 'btn btn-sm btn-danger',
                onclick: () => decideReport(r.report_id, 'RESOLVED', true),
              }, ['Hide the review'])
              : null,
            el('button', {
              class: 'btn btn-sm btn-outline',
              onclick: () => decideReport(r.report_id, 'DISMISSED', false),
            }, ['Dismiss']),
          ])
          : null,
      ]));
    });
  }

  async function decideReport(reportId, status, hideReview) {
    try {
      await global.api.patch(`/api/admin/reports/${reportId}`, { status, hide_review: hideReview });
      toast('Report updated.', 'ok');
      loadReports();
    } catch (err) {
      showError(err);
    }
  }

  // --- announcements --------------------------------------------------------
  async function loadAnnouncements() {
    const host = panel('announcements');
    clear(host);

    const title = el('input', { type: 'text', maxlength: '255' });
    const message = el('textarea', { maxlength: '4000' });

    host.appendChild(el('div', { class: 'panel' }, [
      el('h3', { style: { fontSize: '.95rem' } }, ['Post an announcement']),
      el('p', { class: 'muted small' },
        ['Everyone with an active account gets this as a notification.']),
      el('div', { class: 'form-grid' }, [
        field('Title', title),
        field('Message', message),
        el('div', {}, el('button', {
          class: 'btn btn-primary',
          onclick: async (event) => {
            event.currentTarget.disabled = true;
            try {
              await global.api.post('/api/admin/announcements', {
                title: title.value, message: message.value,
              });
              toast('Posted.', 'ok');
              loadAnnouncements();
            } catch (err) {
              showError(err);
            } finally {
              event.currentTarget.disabled = false;
            }
          },
        }, ['Post announcement'])),
      ]),
    ]));

    const data = await global.api.get('/api/admin/announcements');
    host.appendChild(el('div', { class: 'panel' }, [
      el('h3', { style: { fontSize: '.95rem' } }, ['Posted']),
      data.items.length
        ? table(['Title', 'Message', 'By', 'When', ''], data.items.map((a) => el('tr', {}, [
          el('td', { style: { fontWeight: '600' }, text: a.title }),
          el('td', { class: 'small', text: a.message }),
          el('td', { class: 'small muted', text: a.posted_by }),
          el('td', { class: 'small muted nowrap', text: fmt.date(a.created_at) }),
          el('td', { class: 'actions' }, [el('button', {
            class: 'btn btn-sm btn-danger',
            onclick: async () => {
              try {
                await global.api.del(`/api/admin/announcements/${a.announcement_id}`);
                loadAnnouncements();
              } catch (err) { showError(err); }
            },
          }, ['Delete'])]),
        ])))
        : el('p', { class: 'muted small', style: { margin: 0 } }, ['Nothing posted yet.']),
    ]));
  }

  // --- audit log ------------------------------------------------------------
  async function loadLogs() {
    const host = panel('logs');
    clear(host);
    const data = await global.api.get('/api/admin/logs', { ...state.logFilter, limit: 150 });

    const activity = el('select', {}, [el('option', { value: '', text: 'All activity' }),
      ...data.activity_types.map((t) => el('option', { value: t, text: fmt.activity(t) }))]);
    activity.value = state.logFilter.activity_type;
    activity.addEventListener('change', () => {
      state.logFilter.activity_type = activity.value;
      loadLogs();
    });

    const actor = el('select', {}, [['', 'All roles'], ['ADMIN', 'Administrators'],
      ['ADULT', 'Adults'], ['CHILD', 'Children']].map(([v, l]) => el('option', { value: v, text: l })));
    actor.value = state.logFilter.actor_role;
    actor.addEventListener('change', () => {
      state.logFilter.actor_role = actor.value;
      loadLogs();
    });

    host.appendChild(el('div', { class: 'filters' },
      el('div', { class: 'filter-row' }, [field('Activity', activity), field('Role', actor)])));

    host.appendChild(el('div', { class: 'panel' },
      table(['When', 'Who', 'Role', 'What', 'Detail'], data.items.map((log) => el('tr', {}, [
        el('td', { class: 'small nowrap muted', text: fmt.dateTime(log.created_at) }),
        el('td', { class: 'small', text: log.actor_name }),
        el('td', {}, [el('span', { class: `pill ${roleClass(log.actor_role)}`, text: log.actor_role })]),
        el('td', { class: 'small', text: fmt.activity(log.activity_type) }),
        el('td', { class: 'small muted', text: log.description || '' }),
      ])))));
  }

  // --- tabs -----------------------------------------------------------------
  const loaders = {
    overview: loadOverview,
    users: loadUsers,
    content: loadContent,
    reports: loadReports,
    announcements: loadAnnouncements,
    logs: loadLogs,
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
    const ok = await global.SN.init({ requireRole: 'ADMIN', requireAuth: true, active: '/admin' });
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
