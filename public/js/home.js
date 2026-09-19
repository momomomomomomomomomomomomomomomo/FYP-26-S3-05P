/* The landing page, which is a different page for each kind of visitor.
 *
 *   Guest      welcome, then a sliding shelf of what readers have said
 *   Adult      a greeting, then how their children have been getting on
 *   Child      a greeting, the book they are part-way through, then picks
 *   Staff      never gets here - admins and librarians are sent to their own
 *              dashboards before anything is rendered
 *
 * Every shelf still comes from the scoped endpoints, so a child's landing page
 * can only ever show titles their grown-up allows. */
(function home(global) {
  'use strict';
  const {
    el, $, $$, clear, card, fmt, skeletonGrid, emptyState, showError,
  } = global.SN;

  const filters = { type: '', age_max: '', tag: '' };

  function firstName(name) {
    return String(name || '').trim().split(' ')[0] || 'there';
  }

  /** Morning / afternoon / evening, from the reader's own clock. */
  function timeOfDay() {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 18) return 'Good afternoon';
    return 'Good evening';
  }

  // --- greeting --------------------------------------------------------------
  function renderGreeting() {
    const user = global.SN.user;
    if (!user) return;

    const host = $('#greeting');
    const isChild = user.role === 'CHILD';

    const lines = el('div', {}, [
      el('p', { class: 'greeting-eyebrow', text: `${timeOfDay()},` }),
      el('h1', { class: 'greeting-name', text: `${firstName(user.name)}!` }),
      el('p', { class: 'greeting-sub', text: isChild
        ? 'Here is what is waiting for you today.'
        : 'Here is how everyone has been getting on.' }),
    ]);

    const actions = el('div', { class: 'row' }, isChild
      ? [
        el('a', { class: 'btn btn-primary', href: '/library', text: '📚 My library' }),
        el('a', { class: 'btn btn-outline', href: '/chat', text: '💬 Ask Story Chat' }),
      ]
      : [
        el('a', { class: 'btn btn-primary', href: '/parent', text: 'Family page' }),
        el('a', { class: 'btn btn-outline', href: '/library', text: 'Browse the library' }),
      ]);

    clear(host);
    host.appendChild(el('div', { class: 'greeting-inner' }, [
      el('span', { class: 'greeting-avatar', text: fmt.initials(user.name) }),
      lines,
      el('div', { class: 'greeting-actions' }, actions),
    ]));
    host.classList.remove('hidden');
  }

  // --- guest: sliding review shelf -------------------------------------------
  /**
   * A scroll-snap track rather than a transform carousel: it stays swipeable on
   * a phone, keyboard-scrollable, and readable if the script never runs.
   */
  function renderReviews(items) {
    const track = $('#reviewTrack');
    const dots = $('#revDots');
    clear(track);
    clear(dots);

    items.forEach((r) => {
      track.appendChild(el('article', { class: 'review-card' }, [
        el('div', { class: 'review-stars', text: fmt.stars(r.rating), 'aria-label': `${r.rating} out of 5` }),
        el('blockquote', { class: 'review-quote', text: `“${r.review}”` }),
        el('a', { class: 'review-title', href: `/content?id=${r.content_id}` }, [
          el('span', { class: 'review-kind', text: r.content_type === 'VIDEO' ? 'Video' : 'Book' }),
          el('span', { text: r.title }),
        ]),
        el('div', { class: 'review-by' }, [
          el('span', { class: 'avatar avatar-sm', text: fmt.initials(r.author) }),
          el('span', { class: 'tiny muted', text: `${r.author} · ${fmt.date(r.created_at)}` }),
        ]),
      ]));
    });

    const cards = $$('.review-card', track);
    cards.forEach((_, i) => {
      dots.appendChild(el('button', {
        class: `carousel-dot ${i === 0 ? 'on' : ''}`.trim(),
        type: 'button',
        'aria-label': `Review ${i + 1} of ${cards.length}`,
        onclick: () => scrollToCard(i),
      }));
    });

    function currentIndex() {
      const x = track.scrollLeft;
      let best = 0;
      let bestGap = Infinity;
      cards.forEach((c, i) => {
        const gap = Math.abs(c.offsetLeft - track.offsetLeft - x);
        if (gap < bestGap) { bestGap = gap; best = i; }
      });
      return best;
    }

    function scrollToCard(i) {
      const target = cards[Math.max(0, Math.min(cards.length - 1, i))];
      if (target) track.scrollTo({ left: target.offsetLeft - track.offsetLeft, behavior: 'smooth' });
    }

    function paintDots() {
      const at = currentIndex();
      $$('.carousel-dot', dots).forEach((d, i) => d.classList.toggle('on', i === at));
    }

    let scrollTimer;
    track.addEventListener('scroll', () => {
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(paintDots, 90);
    });
    $('#revPrev').addEventListener('click', () => scrollToCard(currentIndex() - 1));
    $('#revNext').addEventListener('click', () => scrollToCard(currentIndex() + 1));

    // Drift gently through the shelf, but never fight someone who is reading:
    // hovering, focusing or touching it stops the timer for good.
    const calm = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!calm && cards.length > 1) {
      const timer = setInterval(() => {
        const at = currentIndex();
        scrollToCard(at + 1 >= cards.length ? 0 : at + 1);
      }, 6000);
      ['mouseenter', 'focusin', 'touchstart'].forEach((evt) => {
        track.addEventListener(evt, () => clearInterval(timer), { once: true, passive: true });
      });
    }

    $('#reviewsSection').classList.remove('hidden');
  }

  async function loadReviews() {
    try {
      const data = await global.api.get('/api/content/reviews/recent', { limit: 8 });
      if (data.items.length) renderReviews(data.items);
    } catch (err) { /* the shelf is a bonus, never a blocker */ }
  }

  // --- adult: how the children are getting on --------------------------------
  const ACTIVITY_GLYPH = {
    CONTENT_OPEN: '📖',
    CONTENT_COMPLETE: '✅',
    CONTENT_REQUEST: '🙋',
    FEEDBACK: '⭐',
    REACTION: '💬',
  };

  async function loadFamily() {
    try {
      const data = await global.api.get('/api/children/activity');
      if (!data.children.length) return;

      const strip = $('#childStrip');
      clear(strip);
      data.children.forEach((child) => {
        const bits = [`${child.finished} finished`, `${child.started} started`];
        if (child.daily_screen_limit !== null) {
          bits.push(`${child.screen_time_today}/${child.daily_screen_limit} min today`);
        }
        strip.appendChild(el('a', { class: 'child-tile', href: '/parent' }, [
          el('span', { class: 'avatar', text: fmt.initials(child.name) }),
          el('div', { class: 'grow' }, [
            el('div', { class: 'child-tile-name' }, [
              child.name,
              child.allow_content ? null : el('span', {
                class: 'pill pill-warn', style: { marginLeft: '6px' }, text: 'Paused',
              }),
            ]),
            el('div', { class: 'tiny muted', text: bits.join(' · ') }),
            el('div', { class: 'tiny muted', text: child.last_read
              ? `Last read ${fmt.date(child.last_read)}`
              : 'Has not opened anything yet' }),
          ]),
        ]));
      });

      if (data.pending_requests) {
        strip.appendChild(el('a', { class: 'child-tile child-tile-action', href: '/parent?tab=requests' }, [
          el('span', { class: 'child-tile-glyph', text: '🙋' }),
          el('div', { class: 'grow' }, [
            el('div', { class: 'child-tile-name', text: `${data.pending_requests} title${
              data.pending_requests === 1 ? '' : 's'} to approve` }),
            el('div', { class: 'tiny muted', text: 'Someone asked to unlock something.' }),
          ]),
        ]));
      }

      const feed = $('#activityFeed');
      clear(feed);
      if (!data.events.length) {
        feed.appendChild(el('p', { class: 'muted small', style: { margin: 0 },
          text: 'Nothing yet this week. Activity shows up here as soon as they open something.' }));
      } else {
        data.events.forEach((e) => {
          feed.appendChild(el('div', { class: 'activity-row' }, [
            el('span', { class: 'activity-glyph', text: ACTIVITY_GLYPH[e.activity_type] || '•' }),
            el('div', { class: 'grow' }, [
              el('div', { class: 'small' }, [
                el('strong', { text: e.child_name }),
                el('span', { text: ` ${fmt.activity(e.activity_type).toLowerCase()}` }),
                e.content_title ? el('span', {}, [' — ', el('em', { text: e.content_title })]) : null,
              ]),
              el('div', { class: 'tiny muted', text: fmt.dateTime(e.created_at) }),
            ]),
          ]));
        });
      }

      $('#familySection').classList.remove('hidden');
    } catch (err) { /* an adult with no children simply has no panel */ }
  }

  // --- child: the one book they are part-way through -------------------------
  function renderResume(item) {
    const host = $('#resumeHost');
    clear(host);
    const pct = Math.round(Number(item.percentage_completed) || 0);

    host.appendChild(el('div', { class: 'resume' }, [
      el('a', { class: 'resume-cover', href: `/content?id=${item.content_id}` },
        [global.SN.coverEl(item)]),
      el('div', { class: 'resume-body' }, [
        el('div', { class: 'card-eyebrow', text: item.content_type === 'VIDEO' ? 'Keep watching' : 'Keep reading' }),
        el('h3', { class: 'resume-title', text: item.title }),
        item.author_creator ? el('p', { class: 'muted small', text: `by ${item.author_creator}` }) : null,
        el('div', { class: 'resume-bar' }, el('span', { style: { width: `${pct}%` } })),
        el('p', { class: 'tiny muted', text: `${pct}% of the way through` }),
        el('div', { class: 'row' }, [
          el('a', { class: 'btn btn-primary', href: `/read?id=${item.content_id}`,
            text: item.content_type === 'VIDEO' ? '▶ Keep watching' : '📖 Keep reading' }),
          el('a', { class: 'btn btn-outline', href: `/content?id=${item.content_id}`, text: 'About this one' }),
        ]),
      ]),
    ]));
    $('#resumeSection').classList.remove('hidden');
  }

  async function loadContinue() {
    if (!global.SN.user) return;
    try {
      const data = await global.api.get('/api/me/progress');
      const unfinished = data.items.filter((i) => i.percentage_completed < 100);
      if (!unfinished.length) return;

      if (global.SN.user.role === 'CHILD') {
        // One title, big, with a real "carry on" button. The rest of a child's
        // reading list is a tap away and does not belong on the front page.
        renderResume(unfinished[0]);
        return;
      }
      const grid = $('#continueGrid');
      clear(grid);
      unfinished.slice(0, 4).forEach((item) => grid.appendChild(card(item, { eyebrow: 'Keep reading' })));
      $('#continueSection').classList.remove('hidden');
    } catch (err) { /* not fatal */ }
  }

  // --- picks -----------------------------------------------------------------
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
      // The match drives the ranking, but labelling most of the shelf with it
      // says nothing - only the strongest few carry the badge.
      let badged = 0;
      data.items.forEach((item) => {
        const badge = item.fav_match && badged < 3;
        if (badge) badged += 1;
        grid.appendChild(card(item, { eyebrow: badge ? 'Like your favourites' : 'Top picks' }));
      });

      if (!filtered && badged) {
        $('#picksWhy').textContent = 'Chosen from what you are allowed to open, '
          + 'leaning towards the kinds of stories you have already favourited.';
        $('#picksWhy').classList.remove('hidden');
      }
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
              $$('#fTag .chip').forEach((c) => c.classList.remove('on'));
              if (!on) event.currentTarget.classList.add('on');
              loadPicks();
            },
          }));
        });
    } catch (err) { /* the filter bar is optional, the shelf still works */ }
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
    const user = global.SN.user;

    // Staff have a dashboard, not a bookshelf. Replace rather than push, so
    // Back does not bounce them straight here again.
    const staffHome = global.SN.homeFor(user);
    if (staffHome !== '/') {
      global.location.replace(staffHome);
      return;
    }

    if (!user) {
      $('#guestHero').classList.remove('hidden');
      $('#guestPitch').classList.remove('hidden');
      loadReviews();
    } else {
      renderGreeting();
      if (user.role === 'CHILD') {
        $('#picksHeading').textContent = 'Picked for you';
      } else {
        loadFamily();
      }
    }

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
