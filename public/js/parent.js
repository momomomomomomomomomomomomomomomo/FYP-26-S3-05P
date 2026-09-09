/* The Family page: an adult's view of the child accounts they created -
   parental controls, unlock requests, and each child's activity. */
(function parent(global) {
  'use strict';
  const {
    el, $, $$, clear, fmt, modal, confirmDialog, showError, toast, emptyState,
  } = global.SN;

  const LEVELS = [['', 'Not set'], ['BEGINNER', 'Beginner'],
    ['INTERMEDIATE', 'Intermediate'], ['ADVANCED', 'Advanced']];

  let allTags = [];
  let children = [];

  function panel(name) { return $(`#panel-${name}`); }

  function field(labelText, control, hint) {
    return el('div', { class: 'field' }, [
      el('label', { text: labelText }),
      control,
      hint ? el('span', { class: 'hint', text: hint }) : null,
    ]);
  }

  function select(options, value) {
    const node = el('select', {}, options.map(([v, label]) => el('option', { value: v, text: label })));
    node.value = value === null || value === undefined ? '' : String(value);
    return node;
  }

  // --- add / edit a child ---------------------------------------------------
  function openChildForm(existing) {
    const isNew = !existing;
    const name = el('input', { type: 'text', maxlength: '100', value: existing ? existing.name : '' });
    const loginId = el('input', {
      type: 'text', maxlength: '50', value: existing ? existing.login_id : '',
      placeholder: 'e.g. leo (no email needed)',
    });
    const dob = el('input', { type: 'date', value: existing ? existing.dob : '' });
    const password = el('input', {
      type: 'text', maxlength: '100',
      placeholder: isNew ? 'At least 6 characters' : 'Leave blank to keep the current one',
    });
    const level = select(LEVELS, existing ? existing.reading_level : '');

    const body = el('div', { class: 'form-grid' }, [
      field('Name', name),
      field('Login ID', loginId, 'This is what your child types to sign in. Letters, numbers, dots and dashes.'),
      isNew ? field('Date of birth', dob) : null,
      field(isNew ? 'Password' : 'New password', password),
      field('Reading level', level),
    ]);

    const dialog = modal(isNew ? 'Add a child' : `Edit ${existing.name}`, body, [
      el('button', { class: 'btn btn-outline', onclick: () => dialog.close() }, ['Cancel']),
      el('button', {
        class: 'btn btn-primary',
        onclick: async (event) => {
          event.currentTarget.disabled = true;
          try {
            if (isNew) {
              const res = await global.api.post('/api/children', {
                name: name.value,
                login_id: loginId.value,
                password: password.value,
                dob: dob.value,
                reading_level: level.value,
                max_age: null,
                daily_screen_limit: null,
                allow_content: true,
              });
              dialog.close();
              toast(`${name.value} can now sign in with "${res.login_id}".`, 'ok');
            } else {
              const patch = {
                name: name.value, login_id: loginId.value, reading_level: level.value,
              };
              if (password.value.trim()) patch.password = password.value;
              await global.api.patch(`/api/children/${existing.user_id}`, patch);
              dialog.close();
              toast('Saved.', 'ok');
            }
            loadChildren();
          } catch (err) {
            event.currentTarget.disabled = false;
            showError(err);
          }
        },
      }, [isNew ? 'Create account' : 'Save']),
    ]);
  }

  // --- parental controls ----------------------------------------------------
  function openControls(child) {
    const c = child.controls;

    const maxAge = select([['', 'No age limit'],
      ...[3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]
        .map((n) => [String(n), `Up to age ${n}`])], c.max_age);

    const screenLimit = select([['', 'No limit'],
      ...[15, 30, 45, 60, 90, 120, 180].map((n) => [String(n), `${n} minutes a day`])],
    c.daily_screen_limit);

    const allow = el('input', { type: 'checkbox' });
    allow.checked = c.allow_content;

    const selected = new Set(c.blocked_genres);
    const chips = el('div', { class: 'chips' }, allTags.map((tag) => {
      const chip = el('button', {
        class: `chip ${selected.has(tag.tag_name) ? 'blocked' : ''}`.trim(),
        type: 'button',
        text: tag.tag_name,
      });
      chip.addEventListener('click', () => {
        if (selected.has(tag.tag_name)) selected.delete(tag.tag_name);
        else selected.add(tag.tag_name);
        chip.classList.toggle('blocked');
      });
      return chip;
    }));

    const body = el('div', { class: 'form-grid' }, [
      el('p', { class: 'muted small', style: { margin: 0 } },
        [`These settings decide what ${child.name} sees in the library. Anything you unlock `
        + 'from a request stays visible even if it breaks these rules.']),
      field('Highest age rating', maxAge, `${child.name} is ${child.age}. Titles rated above this are hidden.`),
      field('Daily screen time', screenLimit, 'Reading and watching time is counted each day.'),
      el('label', { class: 'checkbox' }, [
        allow,
        el('span', {}, ['Let them browse the library. Turn this off and only titles you unlock will show up.']),
      ]),
      el('div', { class: 'field' }, [
        el('label', { text: 'Blocked genres and topics' }),
        el('span', { class: 'hint', text: 'Tap to block. Blocked ones turn red.' }),
        chips,
      ]),
    ]);

    const dialog = modal(`Controls for ${child.name}`, body, [
      el('button', { class: 'btn btn-outline', onclick: () => dialog.close() }, ['Cancel']),
      el('button', {
        class: 'btn btn-primary',
        onclick: async (event) => {
          event.currentTarget.disabled = true;
          try {
            await global.api.put(`/api/children/${child.user_id}/controls`, {
              max_age: maxAge.value === '' ? null : Number(maxAge.value),
              daily_screen_limit: screenLimit.value === '' ? null : Number(screenLimit.value),
              allow_content: allow.checked,
              blocked_genres: Array.from(selected),
            });
            dialog.close();
            toast('Controls updated.', 'ok');
            loadChildren();
          } catch (err) {
            event.currentTarget.disabled = false;
            showError(err);
          }
        },
      }, ['Save controls']),
    ]);
  }

  // --- children tab ---------------------------------------------------------
  function childCard(child) {
    const c = child.controls;
    const limits = [
      c.max_age === null ? 'any age rating' : `up to age ${c.max_age}`,
      c.daily_screen_limit === null ? 'no time limit' : `${c.daily_screen_limit} min/day`,
      c.blocked_genres.length ? `${c.blocked_genres.length} genre(s) blocked` : 'no blocked genres',
    ].join(' · ');

    const screenBar = c.daily_screen_limit
      ? el('div', {}, [
        el('div', { class: 'card-bar', style: { marginTop: '8px' } },
          el('span', {
            style: {
              width: `${Math.min(100, (child.stats.screen_time_today / c.daily_screen_limit) * 100)}%`,
              background: child.stats.screen_time_today >= c.daily_screen_limit
                ? 'var(--red)' : 'var(--blue-500)',
            },
          })),
        el('div', { class: 'tiny muted', style: { marginTop: '4px' } },
          [`${child.stats.screen_time_today} of ${c.daily_screen_limit} minutes used today`]),
      ])
      : null;

    return el('div', { class: 'panel' }, [
      el('div', { class: 'panel-head' }, [
        el('div', { class: 'row' }, [
          el('span', { class: 'avatar', text: fmt.initials(child.name) }),
          el('div', {}, [
            el('div', { style: { fontWeight: '700' } }, [
              child.name,
              child.account_status !== 'ACTIVE'
                ? el('span', { class: 'pill pill-danger', style: { marginLeft: '8px' }, text: 'Suspended' })
                : null,
            ]),
            el('div', { class: 'tiny muted', text: `age ${child.age} · login ID "${child.login_id}"` }),
          ]),
        ]),
        el('div', { class: 'row' }, [
          child.stats.pending_requests
            ? el('span', { class: 'pill pill-warn', text: `${child.stats.pending_requests} request(s)` })
            : null,
          el('button', { class: 'btn btn-sm btn-primary', onclick: () => openControls(child) }, ['Controls']),
          el('button', { class: 'btn btn-sm btn-outline', onclick: () => openChildForm(child) }, ['Edit']),
          el('button', {
            class: 'btn btn-sm btn-outline',
            onclick: () => viewActivity(child),
          }, ['Activity']),
          el('button', {
            class: 'btn btn-sm btn-danger',
            onclick: () => confirmDialog(`Delete ${child.name}?`,
              'This removes the account and everything in it - reading history, favourites and badges. '
              + 'It cannot be undone.',
              async () => {
                try {
                  await global.api.del(`/api/children/${child.user_id}`);
                  toast('Account deleted.', 'ok');
                  loadChildren();
                } catch (err) { showError(err); }
              }),
          }, ['Delete']),
        ]),
      ]),
      el('div', { class: 'small muted', text: limits }),
      screenBar,
      el('div', { class: 'row', style: { marginTop: '10px', gap: '18px' } }, [
        el('span', { class: 'small' }, [el('strong', { text: String(child.stats.completed) }), ' finished']),
        el('span', { class: 'small' }, [el('strong', { text: String(child.stats.started) }), ' started']),
        el('span', { class: 'small muted', text: `reading level: ${fmt.level(child.reading_level)}` }),
      ]),
    ]);
  }

  async function loadChildren() {
    const host = panel('children');
    clear(host);
    try {
      const data = await global.api.get('/api/children');
      children = data.items;
      if (!children.length) {
        host.appendChild(emptyState('👧', 'No child accounts yet',
          'Create an account for each child. You choose their login ID, what they can see, and how long they get.',
          el('button', { class: 'btn btn-primary', onclick: () => openChildForm(null) }, ['Add a child'])));
        return;
      }
      children.forEach((child) => host.appendChild(childCard(child)));
      loadRequestCount();
    } catch (err) {
      showError(err);
    }
  }

  // --- requests tab ---------------------------------------------------------
  async function loadRequestCount() {
    try {
      const data = await global.api.get('/api/children/requests', { status: 'PENDING' });
      const badge = $('#requestCount');
      clear(badge);
      if (data.items.length) {
        badge.appendChild(el('span', { class: 'pill pill-warn', text: String(data.items.length) }));
      }
    } catch (err) { /* not fatal */ }
  }

  async function loadRequests() {
    const host = panel('requests');
    clear(host);
    try {
      const data = await global.api.get('/api/children/requests');
      if (!data.items.length) {
        host.appendChild(emptyState('✅', 'No requests',
          'When a child asks to unlock a title, it will appear here.'));
        return;
      }

      data.items.forEach((r) => {
        const pending = r.status === 'PENDING';
        host.appendChild(el('div', { class: 'panel' }, [
          el('div', { class: 'panel-head' }, [
            el('div', {}, [
              el('div', { style: { fontWeight: '700' } }, [
                el('a', { href: `/content?id=${r.content_id}`, text: r.title }),
              ]),
              el('div', { class: 'tiny muted' }, [
                `${r.child_name} asked on ${fmt.date(r.request_date)} · `
                + `${r.content_type === 'VIDEO' ? 'Video' : 'Book'}, ages ${r.age_rating}+`,
              ]),
            ]),
            pending
              ? el('div', { class: 'row' }, [
                el('button', {
                  class: 'btn btn-sm btn-primary',
                  onclick: () => decide(r.request_id, 'APPROVED'),
                }, ['Unlock it']),
                el('button', {
                  class: 'btn btn-sm btn-outline',
                  onclick: () => decide(r.request_id, 'DENIED'),
                }, ['Not this one']),
              ])
              : el('span', {
                class: `pill ${r.status === 'APPROVED' ? 'pill-ok' : 'pill-danger'}`,
                text: r.status.toLowerCase(),
              }),
          ]),
          r.description ? el('p', { class: 'small muted', style: { margin: 0 }, text: r.description }) : null,
        ]));
      });
    } catch (err) {
      showError(err);
    }
  }

  async function decide(requestId, decision) {
    try {
      await global.api.post(`/api/children/requests/${requestId}/decision`, { decision });
      toast(decision === 'APPROVED' ? 'Unlocked.' : 'Left locked.', 'ok');
      loadRequests();
      loadRequestCount();
    } catch (err) {
      showError(err);
    }
  }

  // --- activity tab ---------------------------------------------------------
  async function renderActivity(childId) {
    const host = panel('activity');
    clear(host);

    const picker = el('select', {}, children.map((c) => el('option', {
      value: String(c.user_id), text: c.name,
    })));
    if (childId) picker.value = String(childId);
    picker.addEventListener('change', () => renderActivity(Number(picker.value)));

    host.appendChild(el('div', { class: 'panel-head' }, [
      el('h2', { style: { fontSize: '1.05rem' } }, ['Activity']),
      el('div', { class: 'field', style: { minWidth: '180px' } }, [picker]),
    ]));

    const selected = Number(picker.value);
    if (!selected) {
      host.appendChild(emptyState('📋', 'No children yet', 'Add a child account first.'));
      return;
    }

    try {
      const data = await global.api.get(`/api/children/${selected}/activity`, { limit: 60 });

      if (data.screen_time_week.length) {
        const max = Math.max(...data.screen_time_week.map((d) => d.minutes), 1);
        host.appendChild(el('div', { class: 'panel' }, [
          el('h3', { style: { fontSize: '.95rem' } }, ['Screen time, last 7 days']),
          el('div', { class: 'row', style: { alignItems: 'flex-end', gap: '14px', height: '90px' } },
            data.screen_time_week.map((d) => el('div', {
              style: { textAlign: 'center', flex: '1', maxWidth: '60px' },
            }, [
              el('div', {
                style: {
                  height: `${Math.max(4, (d.minutes / max) * 60)}px`,
                  background: 'var(--blue-500)', borderRadius: '4px 4px 0 0',
                },
                title: `${d.minutes} minutes`,
              }),
              el('div', { class: 'tiny muted', text: String(d.minutes) }),
              el('div', { class: 'tiny muted', text: fmt.date(d.day).split(' ').slice(0, 2).join(' ') }),
            ]))),
        ]));
      }

      const rows = data.items.map((log) => el('tr', {}, [
        el('td', { class: 'small nowrap', text: fmt.dateTime(log.created_at) }),
        el('td', {}, [el('span', { class: 'pill', text: fmt.activity(log.activity_type) })]),
        el('td', { class: 'small', text: log.description || '' }),
        el('td', { class: 'small' }, [
          log.content_title
            ? el('a', { href: `/content?id=${log.content_id}`, text: log.content_title })
            : el('span', { class: 'muted', text: '—' }),
        ]),
      ]));

      host.appendChild(el('div', { class: 'panel' }, [
        el('h3', { style: { fontSize: '.95rem' } }, ['What they did']),
        rows.length
          ? el('div', { class: 'table-scroll' }, el('table', {}, [
            el('thead', {}, el('tr', {}, [
              el('th', { text: 'When' }), el('th', { text: 'What' }),
              el('th', { text: 'Detail' }), el('th', { text: 'Title' }),
            ])),
            el('tbody', {}, rows),
          ]))
          : el('p', { class: 'muted small', style: { margin: 0 } }, ['Nothing recorded yet.']),
      ]));
    } catch (err) {
      showError(err);
    }
  }

  function viewActivity(child) {
    switchTab('activity', child.user_id);
  }

  function switchTab(name, arg) {
    $$('#tabs .tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === name));
    ['children', 'requests', 'activity'].forEach((n) => {
      panel(n).classList.toggle('hidden', n !== name);
    });
    if (name === 'children') loadChildren();
    if (name === 'requests') loadRequests();
    if (name === 'activity') renderActivity(arg);
  }

  async function start() {
    const ok = await global.SN.init({ requireRole: ['ADULT', 'ADMIN'], requireAuth: true, active: '/parent' });
    if (!ok) return;

    try {
      const tags = await global.api.get('/api/content/tags');
      allTags = tags.items;
    } catch (err) { /* the controls dialog copes with an empty list */ }

    $('#addChild').addEventListener('click', () => openChildForm(null));
    $$('#tabs .tab').forEach((tab) => {
      tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    await loadChildren();
  }

  document.addEventListener('DOMContentLoaded', start);
}(window));
