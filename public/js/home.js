/* Home page: hero, "continue reading" shelf and the Top Picks grid. */
(function home(global) {
  'use strict';
  const { el, $, clear, card, skeletonGrid, emptyState, showError } = global.SN;

  const filters = { type: '', age_max: '', tag: '' };

  async function loadPicks() {
    const grid = $('#picksGrid');
    skeletonGrid(8, grid);
    try {
      // Top Picks uses the ranked endpoint until the reader narrows it down,
      // then switches to the plain library search so the filters mean something.
      const filtered = filters.type || filters.age_max || filters.tag;
      const data = filtered
        ? await global.api.get('/api/content', {
          type: filters.type, age_max: filters.age_max, tag: filters.tag, limit: 8, sort: 'popular',
        })
        : await global.api.get('/api/content/top-picks', { limit: 8 });

      clear(grid);
      if (!data.items.length) {
        grid.appendChild(emptyState('🔍', 'Nothing matches that',
          'Try a different filter, or clear them to see everything.'));
        return;
      }
      data.items.forEach((item) => grid.appendChild(card(item, { eyebrow: 'Top picks' })));
    } catch (err) {
      clear(grid);
      showError(err);
    }
  }

  async function loadTags() {
    try {
      const data = await global.api.get('/api/content/tags');
      const host = $('#fTag');
      clear(host);
      data.items
        .filter((t) => t.category === 'GENRE' && t.content_count > 0)
        .slice(0, 8)
        .forEach((tag) => {
          host.appendChild(el('button', {
            class: 'chip',
            type: 'button',
            text: tag.tag_name,
            onclick: (event) => {
              const on = filters.tag === tag.tag_name;
              filters.tag = on ? '' : tag.tag_name;
              global.SN.$$('#fTag .chip').forEach((c) => c.classList.remove('on'));
              if (!on) event.currentTarget.classList.add('on');
              loadPicks();
            },
          }));
        });
    } catch (err) { /* the filter bar is optional, the shelf still works */ }
  }

  async function loadContinue() {
    if (!global.SN.user) return;
    try {
      const data = await global.api.get('/api/me/progress');
      const unfinished = data.items.filter((i) => i.percentage_completed < 100).slice(0, 4);
      if (!unfinished.length) return;
      const grid = $('#continueGrid');
      clear(grid);
      unfinished.forEach((item) => grid.appendChild(card(item, { eyebrow: 'Keep reading' })));
      $('#continueSection').classList.remove('hidden');
    } catch (err) { /* not fatal */ }
  }

  async function loadAnnouncement() {
    if (!global.SN.user) return;
    try {
      const data = await global.api.get('/api/me/announcements');
      if (!data.items.length) return;
      const latest = data.items[0];
      $('#announcement').appendChild(el('div', { class: 'alert alert-info' }, [
        el('strong', { text: `${latest.title}: ` }),
        el('span', { text: latest.message }),
      ]));
    } catch (err) { /* not fatal */ }
  }

  async function start() {
    await global.SN.init({ active: '/' });

    if (global.SN.user) $('#guestPitch').classList.add('hidden');

    $('#filterToggle').addEventListener('click', () => {
      $('#filters').classList.toggle('collapsed');
    });
    $('#fType').addEventListener('change', (e) => { filters.type = e.target.value; loadPicks(); });
    $('#fAge').addEventListener('change', (e) => { filters.age_max = e.target.value; loadPicks(); });

    loadTags();
    loadPicks();
    loadContinue();
    loadAnnouncement();
  }

  document.addEventListener('DOMContentLoaded', start);
}(window));
