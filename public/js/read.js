/* The reader / player.
 *
 * The sample library stores metadata only - there are no book files or video
 * streams in the repository - so this page renders a demo reader: a paginated
 * placeholder built from the title's own description. What is real is
 * everything around it: opening a title is authorised by the server, reading
 * position is saved to `progress`, and a minute of screen time is reported
 * every minute so parental limits actually bite. Swap `buildPages()` for your
 * real content (or an <iframe>/<video> pointed at external_link) and the rest
 * keeps working.
 */
(function reader(global) {
  'use strict';
  const { el, $, clear, showError, emptyState, toast, fmt } = global.SN;

  const contentId = Number(new URLSearchParams(global.location.search).get('id'));
  const PAGES = 8;

  let item = null;
  let page = 0;
  let heartbeat = null;

  function buildPages(content) {
    const lead = content.description || 'A story is waiting for you here.';
    const pages = [];
    for (let i = 0; i < PAGES; i += 1) {
      if (i === 0) {
        pages.push([lead,
          `This is the StoryNest demo reader. In a finished build the pages of "${content.title}" `
          + 'would appear here. Everything else on this screen is real: your place is saved, and '
          + 'your reading time counts towards any daily limit a grown-up has set.']);
      } else if (i === PAGES - 1) {
        pages.push([`Page ${i + 1} of ${PAGES}.`,
          'The end. Tap "Finish" to mark this one as read - that is what earns your badges.']);
      } else {
        pages.push([`Page ${i + 1} of ${PAGES}.`,
          'Sample text stands in for the real pages of the book while the catalogue is being filled in.']);
      }
    }
    return pages;
  }

  function renderPage() {
    const pages = buildPages(item);
    const reader = $('#reader');
    clear(reader);
    pages[page].forEach((para) => reader.appendChild(el('p', { text: para })));

    $('#progressLabel').textContent = `Page ${page + 1} of ${PAGES}`;
    $('#prevBtn').disabled = page === 0;
    $('#nextBtn').textContent = page === PAGES - 1 ? 'Finish ✓' : 'Next →';
    global.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function saveProgress() {
    const pct = Math.round(((page + 1) / PAGES) * 100);
    try {
      const res = await global.api.put(`/api/content/${contentId}/progress`, {
        percentage_completed: pct,
        last_position: page,
      });
      (res.badges_awarded || []).forEach((b) => toast(`Badge unlocked: ${b}`, 'ok'));
    } catch (err) {
      showError(err);
    }
  }

  /** Reports a minute of viewing so parental screen limits can be enforced. */
  function startHeartbeat() {
    heartbeat = setInterval(async () => {
      try {
        const res = await global.api.post('/api/me/screen-time', {
          minutes: 1, content_id: contentId,
        });
        if (res.limit !== null && res.remaining !== undefined) {
          renderScreenTime(res.remaining, res.limit);
          if (res.remaining <= 0) {
            clearInterval(heartbeat);
            outOfTime();
          }
        }
      } catch (err) { /* a missed minute is not worth interrupting a reader */ }
    }, 60 * 1000);
  }

  function renderScreenTime(remaining, limit) {
    const host = $('#screenTime');
    clear(host);
    if (remaining > 10) return;
    host.appendChild(el('div', { class: 'alert alert-warn' },
      [`${remaining} of your ${limit} minutes left today.`]));
  }

  function outOfTime() {
    const main = $('#main');
    clear(main);
    main.appendChild(emptyState('⏰', 'That is all for today',
      'You have used up your screen time. Come back tomorrow!',
      el('a', { class: 'btn btn-primary', href: '/', text: 'Back to the home page' })));
  }

  async function start() {
    const ok = await global.SN.init({ requireAuth: true, active: '/library' });
    if (!ok) return;
    if (!contentId) {
      global.location.href = '/library';
      return;
    }

    try {
      // The server decides whether this reader may open this title at all.
      await global.api.post(`/api/content/${contentId}/open`, {});
      const data = await global.api.get(`/api/content/${contentId}`);
      item = data.item;
    } catch (err) {
      const main = $('#main');
      clear(main);
      main.appendChild(emptyState(
        err.status === 403 ? '🔒' : '📕',
        err.status === 403 ? 'Not right now' : 'Could not open this',
        err.message,
        el('a', { class: 'btn btn-primary', href: '/library', text: 'Back to the library' }),
      ));
      return;
    }

    document.title = `${item.title} — StoryNest`;
    $('#title').textContent = item.title;
    $('#byline').textContent = [
      item.author_creator ? `by ${item.author_creator}` : null,
      fmt.ages(item),
      fmt.duration(item.duration_minutes),
    ].filter(Boolean).join(' · ');
    $('#backLink').href = `/content?id=${contentId}`;

    page = Math.min(Number(item.last_position) || 0, PAGES - 1);
    renderPage();
    saveProgress();
    startHeartbeat();

    $('#prevBtn').addEventListener('click', () => {
      if (page > 0) {
        page -= 1;
        renderPage();
      }
    });
    $('#nextBtn').addEventListener('click', async () => {
      if (page < PAGES - 1) {
        page += 1;
        renderPage();
        saveProgress();
      } else {
        await saveProgress();
        toast('Finished! Nice work.', 'ok');
        global.location.href = `/content?id=${contentId}`;
      }
    });

    global.addEventListener('beforeunload', () => clearInterval(heartbeat));
  }

  document.addEventListener('DOMContentLoaded', start);
}(window));
