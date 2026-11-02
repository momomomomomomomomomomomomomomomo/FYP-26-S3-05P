/* The reader / player.
 *
 * Titles that have their text in the database - everything in database/books/ -
 * are read here for real, a page at a time, straight from
 * GET /api/content/:id/pages.
 *
 * Titles that have no text, which is the videos and the older metadata-only
 * entries, fall back to a short generated sample built from the blurb, and say
 * so plainly rather than pretending.
 *
 * Either way the machinery around it is the same and is real: the server
 * authorises the open, reading position is saved to `progress`, and a minute of
 * screen time is reported every minute so parental limits actually bite.
 */
(function reader(global) {
  'use strict';
  const { el, $, clear, showError, emptyState, toast, fmt } = global.SN;

  const contentId = Number(new URLSearchParams(global.location.search).get('id'));

  let item = null;
  let pages = [];       // [{ heading, paragraphs[], illustration }]
  let page = 0;
  let heartbeat = null;

  /** For titles with no text of their own: a short, honest stand-in. */
  function samplePages(content) {
    const lead = content.description || 'A story is waiting for you here.';
    return [
      {
        heading: content.title,
        paragraphs: [lead,
          'This title is in the catalogue but its pages are not in StoryNest yet, so this is a '
          + 'stand-in rather than the real thing.'],
        illustration: content.content_type === 'VIDEO' ? '🎬' : '📄',
      },
      {
        paragraphs: ['Everything around it is real, though: your place is saved as you go, and '
          + 'your reading time counts towards any daily limit a grown-up has set.',
        'Tap Finish to mark it as read.'],
        illustration: null,
      },
    ];
  }

  function renderPage() {
    const reader = $('#reader');
    const current = pages[page];
    clear(reader);

    if (current.illustration) {
      reader.appendChild(el('div', { class: 'page-motif', 'aria-hidden': 'true',
        text: current.illustration }));
    }
    if (current.heading) {
      reader.appendChild(el('h2', { class: 'page-heading', text: current.heading }));
    }
    current.paragraphs.forEach((para) => reader.appendChild(el('p', { text: para })));

    $('#progressLabel').textContent = `Page ${page + 1} of ${pages.length}`;
    $('#prevBtn').disabled = page === 0;
    $('#nextBtn').textContent = page === pages.length - 1 ? 'Finish ✓' : 'Next →';
    global.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function saveProgress() {
    const pct = Math.round(((page + 1) / pages.length) * 100);
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
      const [data, text] = await Promise.all([
        global.api.get(`/api/content/${contentId}`),
        global.api.get(`/api/content/${contentId}/pages`),
      ]);
      item = data.item;
      pages = text.has_text ? text.pages : samplePages(item);
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

    page = Math.min(Number(item.last_position) || 0, pages.length - 1);
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
      if (page < pages.length - 1) {
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
