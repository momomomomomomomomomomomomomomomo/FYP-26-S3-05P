/* The Library and Watch pages. Watch is the same page pinned to videos. */
(function library(global) {
  'use strict';
  const {
    el, $, $$, clear, card, skeletonGrid, emptyState, showError, modal, guestEmail,
  } = global.SN;

  const VIDEOS_ONLY = global.location.pathname.replace(/\.html$/, '') === '/watch';
  const PAGE_SIZE = 24;

  const state = {
    q: '', type: VIDEOS_ONLY ? 'VIDEO' : '', reading_level: '', age_max: '',
    sort: 'popular', tags: [], offset: 0, total: 0,
  };

  function readQueryString() {
    const params = new URLSearchParams(global.location.search);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('tag')) state.tags = [params.get('tag')];
    if (!VIDEOS_ONLY && params.get('type')) state.type = params.get('type');
  }

  /** Explains to a child why their library is smaller than the whole catalogue. */
  function renderScopeNote() {
    const scope = global.SN.scope;
    const host = $('#scopeNote');
    clear(host);
    if (!scope || !scope.restricted) return;

    const bits = [];
    if (!scope.allowContent) {
      bits.push('A grown-up has paused the library for you - only titles they unlock will show up here.');
    } else {
      if (scope.maxAge !== null && scope.maxAge !== undefined) {
        bits.push(`titles for ages ${scope.maxAge} and under`);
      }
      if (scope.blockedGenres && scope.blockedGenres.length) {
        bits.push(`no ${scope.blockedGenres.join(' or ')}`);
      }
    }
    if (!bits.length) return;

    host.appendChild(el('div', { class: 'alert alert-info' },
      scope.allowContent
        ? `Your grown-up set this library to show ${bits.join(', and ')}. Ask them if you want more.`
        : bits[0]));
  }

  /** True once the signed-in reader is a child: fewer controls, bigger targets. */
  function isKid() {
    const scope = global.SN.scope;
    return !!(scope && scope.role === 'CHILD');
  }

  /**
   * The children's version of the catalogue. Same data and the same parental
   * filtering - only the controls change: no sort menu, no reading level, no
   * age menu (their grown-up already set that), and topics as big chips.
   */
  function renderKidControls() {
    document.body.classList.add('kid-mode');
    $('#filters').classList.add('hidden');
    $('#filterToggle').classList.add('hidden');

    $('#pageTitle').textContent = 'My Library';
    $('#pageSub').textContent = 'Everything you can read and watch.';
    $('#q').placeholder = 'Look for a dragon, a puppy, space\u2026';

    const host = el('div', { class: 'kid-topics', id: 'kidControls' }, [
      // The Watch page is already pinned to videos, so a format switch there
      // would only let a child undo the page they chose.
      VIDEOS_ONLY ? null : el('div', { class: 'kid-switch' }, [
        ['', '\u2728 Everything'], ['BOOK', '\ud83d\udcd6 Books'], ['VIDEO', '\u25b6 Videos'],
      ].map(([value, label]) => el('button', {
        class: `chip ${state.type === value ? 'on' : ''}`.trim(),
        type: 'button',
        text: label,
        onclick: (event) => {
          state.type = value;
          $$('#kidControls .kid-switch .chip').forEach((c) => c.classList.remove('on'));
          event.currentTarget.classList.add('on');
          reload();
        },
      }))),
      el('h2', { text: 'What are you in the mood for?' }),
      el('div', { class: 'chips', id: 'tagChipsKid' }),
    ]);
    $('#filters').insertAdjacentElement('afterend', host);
  }

  /** Guests keep favourites against an email address, so show them back. */
  function renderGuestSaved() {
    if (global.SN.user || !guestEmail()) return;
    const link = el('button', {
      class: 'btn btn-ghost btn-sm',
      type: 'button',
      text: '\u2606 Titles I saved',
      onclick: async () => {
        const body = el('div', { class: 'grid grid-narrow' });
        const dialog = modal('Saved to your email', body, null);
        try {
          const data = await global.api.get(
            `/api/content/guest-favourites/${encodeURIComponent(guestEmail())}`,
          );
          clear(body);
          if (!data.items.length) {
            body.appendChild(emptyState('\u2606', 'Nothing saved yet',
              'Use Preview on any cover to save it with your email.'));
            return;
          }
          data.items.forEach((titleItem) => body.appendChild(card(titleItem, { preview: false })));
        } catch (err) {
          clear(body);
          body.appendChild(el('div', { class: 'alert alert-error', text: err.message }));
        }
        return dialog;
      },
    });
    $('#filterToggle').insertAdjacentElement('beforebegin', link);
  }

  async function loadTags() {
    try {
      const data = await global.api.get('/api/content/tags');
      const host = $('#tagChipsKid') || $('#tagChips');
      clear(host);
      // Children get topics and genres only: a theme like "Kindness" means
      // little to them when they are hunting for dinosaurs.
      const usable = data.items.filter((t) => t.content_count > 0
        && (!isKid() || t.category !== 'THEME'));
      usable.forEach((tag) => {
        host.appendChild(el('button', {
          class: `chip ${state.tags.includes(tag.tag_name) ? 'on' : ''}`.trim(),
          type: 'button',
          text: tag.tag_name,
          onclick: (event) => {
            const idx = state.tags.indexOf(tag.tag_name);
            if (idx >= 0) state.tags.splice(idx, 1);
            else state.tags.push(tag.tag_name);
            event.currentTarget.classList.toggle('on');
            reload();
          },
        }));
      });
    } catch (err) { /* filters are optional */ }
  }

  async function load(append) {
    const grid = $('#grid');
    if (!append) {
      state.offset = 0;
      skeletonGrid(8, grid);
    }
    try {
      const data = await global.api.get('/api/content', {
        q: state.q,
        type: state.type,
        reading_level: state.reading_level,
        age_max: state.age_max,
        sort: state.sort,
        tag: state.tags,
        limit: PAGE_SIZE,
        offset: state.offset,
      });

      state.total = data.total;
      if (!append) clear(grid);

      if (!data.items.length && !append) {
        grid.appendChild(emptyState('📚', 'Nothing here yet',
          state.q ? `No titles match "${state.q}".` : 'Try clearing the filters.'));
      }
      data.items.forEach((item) => grid.appendChild(card(item)));

      const shown = state.offset + data.items.length;
      $('#resultCount').textContent = data.total
        ? `Showing ${shown} of ${data.total} title${data.total === 1 ? '' : 's'}`
        : '';
      $('#loadMore').classList.toggle('hidden', shown >= data.total);
      state.offset = shown;
    } catch (err) {
      if (!append) clear(grid);
      showError(err);
    }
  }

  const reload = () => load(false);

  let searchTimer;
  function debouncedSearch(value) {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.q = value.trim(); reload(); }, 250);
  }

  async function start() {
    await global.SN.init({ active: VIDEOS_ONLY ? '/watch' : '/library' });
    readQueryString();

    if (VIDEOS_ONLY) {
      $('#pageTitle').textContent = 'Watch';
      $('#pageSub').textContent = 'Every video you can play.';
      const typeField = $('#fType').closest('.field');
      if (typeField) typeField.classList.add('hidden');
    }

    $('#q').value = state.q;
    $('#fType').value = state.type;
    $('#fSort').value = state.sort;

    $('#q').addEventListener('input', (e) => debouncedSearch(e.target.value));
    $('#fType').addEventListener('change', (e) => { state.type = e.target.value; reload(); });
    $('#fLevel').addEventListener('change', (e) => { state.reading_level = e.target.value; reload(); });
    $('#fAge').addEventListener('change', (e) => { state.age_max = e.target.value; reload(); });
    $('#fSort').addEventListener('change', (e) => { state.sort = e.target.value; reload(); });
    $('#filterToggle').addEventListener('click', () => $('#filters').classList.toggle('collapsed'));
    $('#loadMore').addEventListener('click', () => load(true));
    $('#clearFilters').addEventListener('click', () => {
      state.q = '';
      state.type = VIDEOS_ONLY ? 'VIDEO' : '';
      state.reading_level = '';
      state.age_max = '';
      state.sort = 'popular';
      state.tags = [];
      $('#q').value = '';
      $('#fType').value = state.type;
      $('#fLevel').value = '';
      $('#fAge').value = '';
      $('#fSort').value = 'popular';
      $$('#tagChips .chip').forEach((c) => c.classList.remove('on'));
      reload();
    });

    if (isKid()) renderKidControls();
    renderGuestSaved();
    renderScopeNote();
    loadTags();
    load(false);
  }

  document.addEventListener('DOMContentLoaded', start);
}(window));
