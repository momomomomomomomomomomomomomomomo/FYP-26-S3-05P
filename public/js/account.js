/* "My account" - the only account page a child ever needs: what they are
   reading, their lists, their badges, their unlock requests, and their own
   details. Adults and administrators see the same page. */
(function account(global) {
  'use strict';
  const { el, $, $$, clear, card, fmt, showError, showOk, toast, emptyState } = global.SN;

  const BADGE_GLYPHS = {
    'First Steps': '🌱',
    'Page Turner': '📄',
    Bookworm: '🐛',
    'Story Explorer': '🧭',
    Critic: '✍️',
    Curator: '⭐',
    Chatterbox: '💬',
  };

  function panel(name) { return $(`#panel-${name}`); }

  function grid(items, emptyGlyph, emptyTitle, emptyMessage) {
    if (!items.length) {
      return emptyState(emptyGlyph, emptyTitle, emptyMessage,
        el('a', { class: 'btn btn-primary', href: '/library', text: 'Browse the library' }));
    }
    return el('div', { class: 'grid' }, items.map((item) => card(item)));
  }

  // --- tabs -----------------------------------------------------------------
  const loaders = {
    async reading() {
      const host = panel('reading');
      clear(host);
      const data = await global.api.get('/api/me/progress');
      const reading = data.items.filter((i) => i.percentage_completed < 100);
      const finished = data.items.filter((i) => i.percentage_completed >= 100);

      host.appendChild(el('h2', { style: { fontSize: '1.05rem' } }, ['Still reading']));
      host.appendChild(grid(reading, '📖', 'Nothing on the go',
        'Open a book or video and it will show up here.'));

      if (finished.length) {
        host.appendChild(el('h2', { style: { fontSize: '1.05rem', marginTop: '28px' } },
          [`Finished (${finished.length})`]));
        host.appendChild(el('div', { class: 'grid' }, finished.map((i) => card(i))));
      }
    },

    async favourites() {
      const host = panel('favourites');
      clear(host);
      const data = await global.api.get('/api/me/saved', { list_type: 'FAVORITE' });
      host.appendChild(grid(data.items, '⭐', 'No favourites yet',
        'Tap the star on any title to keep it here.'));
    },

    async watchlist() {
      const host = panel('watchlist');
      clear(host);
      const data = await global.api.get('/api/me/saved', { list_type: 'WATCHLIST' });
      host.appendChild(grid(data.items, '🔖', 'Your watchlist is empty',
        'Add titles you want to get to later.'));
    },

    async badges() {
      const host = panel('badges');
      clear(host);
      const data = await global.api.get('/api/me/badges');
      const s = data.stats;

      host.appendChild(el('div', { class: 'stat-row' }, [
        ['Finished', s.completed], ['Started', s.started], ['Reviews', s.reviews],
        ['Favourites', s.favourites], ['Chat questions', s.chatMessages],
      ].map(([label, value]) => el('div', { class: 'stat' }, [
        el('div', { class: 'stat-value', text: String(value) }),
        el('div', { class: 'stat-label', text: label }),
      ]))));

      host.appendChild(el('div', { class: 'grid grid-narrow' }, data.items.map((badge) => el('div', {
        class: `badge-tile ${badge.earned ? 'earned' : ''}`.trim(),
      }, [
        el('div', { class: 'badge-glyph', text: BADGE_GLYPHS[badge.badge_name] || '🏅' }),
        el('div', { style: { fontWeight: '600', fontSize: '.88rem' }, text: badge.badge_name }),
        el('div', { class: 'tiny muted', text: badge.description }),
        el('div', { class: 'tiny', style: { marginTop: '6px' } },
          [badge.earned ? `Earned ${fmt.date(badge.awarded_at)}` : 'Not yet']),
      ]))));
    },

    async requests() {
      const host = panel('requests');
      clear(host);
      const data = await global.api.get('/api/me/requests');

      if (!data.items.length) {
        host.appendChild(emptyState('🔒', 'No requests',
          'When you find a locked title you can ask a grown-up to unlock it.'));
        return;
      }

      const rows = data.items.map((r) => el('tr', {}, [
        el('td', {}, [el('a', { href: `/content?id=${r.content_id}`, text: r.title })]),
        el('td', {}, [el('span', {
          class: `pill ${r.status === 'APPROVED' ? 'pill-ok' : r.status === 'DENIED' ? 'pill-danger' : 'pill-warn'}`,
          text: r.status === 'PENDING' ? 'Waiting' : r.status.toLowerCase(),
        })]),
        el('td', { class: 'small muted', text: fmt.date(r.request_date) }),
        el('td', { class: 'small muted', text: r.decided_by || '—' }),
      ]));

      host.appendChild(el('div', { class: 'panel' }, el('div', { class: 'table-scroll' },
        el('table', {}, [
          el('thead', {}, el('tr', {}, [
            el('th', { text: 'Title' }), el('th', { text: 'Status' }),
            el('th', { text: 'Asked' }), el('th', { text: 'Decided by' }),
          ])),
          el('tbody', {}, rows),
        ]))));
    },

    async profile() {
      const host = panel('profile');
      clear(host);
      const user = global.SN.user;
      const isChild = user.role === 'CHILD';

      const name = el('input', { type: 'text', value: user.name, maxlength: '100' });
      const email = el('input', {
        type: isChild ? 'text' : 'email', value: user.email || '', disabled: isChild,
      });
      const level = el('select', {}, [
        el('option', { value: '', text: 'Not set' }),
        el('option', { value: 'BEGINNER', text: 'Beginner' }),
        el('option', { value: 'INTERMEDIATE', text: 'Intermediate' }),
        el('option', { value: 'ADVANCED', text: 'Advanced' }),
      ]);
      level.value = user.reading_level || '';

      host.appendChild(el('div', { class: 'panel' }, [
        el('h2', { style: { fontSize: '1.05rem' } }, ['Your details']),
        el('div', { class: 'form-grid two' }, [
          el('div', { class: 'field' }, [el('label', { text: 'Name' }), name]),
          el('div', { class: 'field' }, [
            el('label', { text: isChild ? 'Login ID' : 'Email' }),
            email,
            isChild ? el('span', { class: 'hint', text: 'Only a grown-up can change this.' }) : null,
          ]),
          el('div', { class: 'field' }, [el('label', { text: 'Reading level' }), level]),
          el('div', { class: 'field' }, [
            el('label', { text: 'Date of birth' }),
            el('input', { type: 'text', value: `${user.dob} (age ${user.age})`, disabled: true }),
          ]),
        ]),
        el('div', { style: { marginTop: '14px' } }, el('button', {
          class: 'btn btn-primary',
          onclick: async (event) => {
            event.currentTarget.disabled = true;
            try {
              const body = { name: name.value, reading_level: level.value };
              if (!isChild) body.email = email.value;
              await global.api.patch('/api/auth/me', body);
              showOk('Saved.');
              const me = await global.api.get('/api/auth/me');
              global.SN.state.user = me.user;
              global.SN.renderNav(global.SN.currentPath());
              renderHeader();
            } catch (err) {
              showError(err);
            } finally {
              event.currentTarget.disabled = false;
            }
          },
        }, ['Save changes'])),
      ]));

      const current = el('input', { type: 'password', autocomplete: 'current-password' });
      const next = el('input', { type: 'password', autocomplete: 'new-password' });
      const confirm = el('input', { type: 'password', autocomplete: 'new-password' });

      host.appendChild(el('div', { class: 'panel' }, [
        el('h2', { style: { fontSize: '1.05rem' } }, ['Change your password']),
        el('div', { class: 'form-grid two' }, [
          el('div', { class: 'field' }, [el('label', { text: 'Current password' }), current]),
          el('div', { class: 'field' }, [
            el('label', { text: 'New password' }),
            next,
            el('span', {
              class: 'hint',
              text: isChild ? 'At least 6 characters.' : 'At least 8 characters, with a letter and a number.',
            }),
          ]),
          el('div', { class: 'field' }, [el('label', { text: 'Confirm new password' }), confirm]),
        ]),
        el('div', { style: { marginTop: '14px' } }, el('button', {
          class: 'btn btn-outline',
          onclick: async (event) => {
            if (next.value !== confirm.value) {
              showError({ message: 'The two new passwords do not match.' });
              return;
            }
            event.currentTarget.disabled = true;
            try {
              await global.api.post('/api/auth/change-password', {
                current_password: current.value, new_password: next.value,
              });
              current.value = '';
              next.value = '';
              confirm.value = '';
              showOk('Password changed.');
            } catch (err) {
              showError(err);
            } finally {
              event.currentTarget.disabled = false;
            }
          },
        }, ['Change password'])),
      ]));
    },
  };

  function renderHeader() {
    const user = global.SN.user;
    $('#bigAvatar').textContent = fmt.initials(user.name);
    $('#userName').textContent = user.name;
    $('#userMeta').textContent = [
      user.role === 'CHILD' ? 'Child account' : user.role === 'ADMIN' ? 'Administrator' : 'Adult account',
      user.role === 'CHILD' ? `login ID: ${user.email}` : user.email,
      `age ${user.age}`,
      user.reading_level ? fmt.level(user.reading_level) : null,
    ].filter(Boolean).join(' · ');
  }

  /** Shows a child what their grown-up has set, in plain words. */
  function renderScopeNote() {
    const scope = global.SN.scope;
    if (!scope || !scope.restricted) return;
    const bits = [];
    if (!scope.allowContent) bits.push('the library is paused - only unlocked titles show up');
    if (scope.maxAge !== null && scope.maxAge !== undefined) bits.push(`titles for ages ${scope.maxAge} and under`);
    if (scope.blockedGenres && scope.blockedGenres.length) bits.push(`no ${scope.blockedGenres.join(' or ')}`);
    if (scope.dailyScreenLimit !== null && scope.dailyScreenLimit !== undefined) {
      const left = scope.screenTimeLeft === undefined ? scope.dailyScreenLimit : scope.screenTimeLeft;
      bits.push(`${scope.dailyScreenLimit} minutes a day (${left} left today)`);
    }
    if (!bits.length) return;
    $('#scopeNote').appendChild(el('div', { class: 'alert alert-info' },
      [`Your grown-up set: ${bits.join('; ')}.`]));
  }

  async function switchTab(name) {
    $$('#tabs .tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === name));
    ['reading', 'favourites', 'watchlist', 'badges', 'requests', 'profile'].forEach((n) => {
      panel(n).classList.toggle('hidden', n !== name);
    });
    try {
      await loaders[name]();
    } catch (err) {
      showError(err);
    }
  }

  async function start() {
    const ok = await global.SN.init({ requireAuth: true, active: '/account' });
    if (!ok) return;

    renderHeader();
    renderScopeNote();

    $$('#tabs .tab').forEach((tab) => {
      tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    const wanted = new URLSearchParams(global.location.search).get('tab');
    switchTab(loaders[wanted] ? wanted : 'reading');
  }

  document.addEventListener('DOMContentLoaded', start);
}(window));
