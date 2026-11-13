/* The Library and Watch pages.
 *
 * One file, two shelves. The Library is books and Watch is videos, and neither
 * is a mixed shelf: the nav offers both, so a format switch inside a page would
 * only be a second way to do what the nav already does, and a reader who came
 * to read would have to filter videos back out every visit. The page decides
 * its own format and nothing in the interface can change it. */
(function library(global) {
  'use strict';
  const {
    el, $, $$, clear, card, skeletonGrid, emptyState, showError, modal, guestEmail,
  } = global.SN;

  const VIDEOS_ONLY = global.location.pathname.replace(/\.html$/, '') === '/watch';
  // The one thing about this shelf that no control may change.
  const PINNED_TYPE = VIDEOS_ONLY ? 'VIDEO' : 'BOOK';
  const PAGE_SIZE = 24;

  const state = {
    q: '', type: PINNED_TYPE, reading_level: '', age_max: '',
    sort: 'popular', tags: [], offset: 0, total: 0,
  };

  /**
   * Reads any filter passed in the address bar - the tag chips on a title page
   * link here with ?tag=.
   *
   * @returns {boolean} whether a filter arrived that lives *inside* the panel.
   *   The search box is visible either way, so a ?q= does not count.
   */
  function readQueryString() {
    const params = new URLSearchParams(global.location.search);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('tag')) state.tags = [params.get('tag')];
    // A ?type= in the address bar is ignored. The page is the format, and an
    // old link asking the Library for videos belongs on Watch instead.
    return Boolean(params.get('tag'));
  }

  /** Explains to a child why their library is smaller than the whole catalogue. */
  function renderScopeNote() {
    const scope = global.SN.scope;
    const host = $('#scopeNote');
    clear(host);
    if (!scope || !scope.restricted) return;

    const bits = [];
    if (!scope.allowContent) {
      bits.push('A grown-up has paused the library for you. You can still look at everything '
        + 'here - tap a cover and you can ask them to unlock it.');
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

    $('#pageTitle').textContent = VIDEOS_ONLY ? 'Things to watch' : 'My Library';
    $('#pageSub').textContent = VIDEOS_ONLY
      ? 'Every video you can play.'
      : 'Every book you can read.';
    $('#q').placeholder = VIDEOS_ONLY
      ? 'Look for animals, space, music\u2026'
      : 'Look for a dragon, a puppy, space\u2026';

    // No format switch: each page is one format, and the nav is how a child
    // moves between them.
    const host = el('div', { class: 'kid-topics', id: 'kidControls' }, [
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
        // "Try clearing the filters" is wrong - and confusing - when the reason
        // the shelf is bare is a parental control the reader cannot clear.
        const scope = global.SN.scope;
        const paused = scope && scope.restricted && !scope.allowContent;
        // The pinned format is not a filter anybody can clear, so it must not
        // count towards "you have filters on".
        const noFilters = !state.q && !state.reading_level
          && !state.age_max && !state.tags.length;

        if (paused) {
          // The shelf is no longer emptied by a pause, so getting here means a
          // pause AND something else - an age limit, a blocked genre, a search
          // - has left nothing to show.
          grid.appendChild(emptyState('\u23f8\ufe0f', 'Nothing to show here',
            'Your library is paused, and nothing left matches what you are looking for. '
            + 'Try clearing the search, or ask a grown-up.'));
        } else if (scope && scope.restricted && noFilters) {
          grid.appendChild(emptyState('\ud83d\udd12', 'Nothing to show yet',
            'Your grown-up\u2019s settings are hiding everything in the library right now. '
            + 'Ask them to allow a higher age rating.'));
        } else {
          grid.appendChild(emptyState(VIDEOS_ONLY ? '\ud83c\udfac' : '\ud83d\udcda',
            'Nothing here yet',
            state.q
              ? `No ${VIDEOS_ONLY ? 'videos' : 'books'} match "${state.q}".`
              : 'Try clearing the filters.'));
        }
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
    const arrivedFiltered = readQueryString();

    if (VIDEOS_ONLY) {
      $('#pageTitle').textContent = 'Watch';
      $('#pageSub').textContent = 'Every video you can play.';
      $('#q').setAttribute('aria-label', 'Search the videos');
    } else {
      $('#pageTitle').textContent = 'Library';
      $('#pageSub').textContent = 'Every book you can read.';
    }

    $('#q').value = state.q;
    $('#fSort').value = state.sort;

    $('#q').addEventListener('input', (e) => debouncedSearch(e.target.value));
    $('#fLevel').addEventListener('change', (e) => { state.reading_level = e.target.value; reload(); });
    $('#fAge').addEventListener('change', (e) => { state.age_max = e.target.value; reload(); });
    $('#fSort').addEventListener('change', (e) => { state.sort = e.target.value; reload(); });
    $('#filterToggle').addEventListener('click', () => {
      const panel = $('#filters');
      panel.classList.toggle('collapsed');
      $('#filterToggle').setAttribute('aria-expanded', String(!panel.classList.contains('collapsed')));
    });

    // The panel starts shut. The one exception is arriving with a filter already
    // applied - from a tag chip on a title page - where leaving it shut would
    // narrow the shelf with nothing on screen to say why.
    if (arrivedFiltered) {
      $('#filters').classList.remove('collapsed');
    }
    $('#filterToggle').setAttribute('aria-expanded',
      String(!$('#filters').classList.contains('collapsed')));
    $('#filterToggle').setAttribute('aria-controls', 'filters');
    $('#loadMore').addEventListener('click', () => load(true));
    $('#clearFilters').addEventListener('click', () => {
      state.q = '';
      // state.type is not cleared: the format is the page, not a filter.
      state.reading_level = '';
      state.age_max = '';
      state.sort = 'popular';
      state.tags = [];
      $('#q').value = '';
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
