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
 *
 * A visitor with no account can read the opening pages and is then asked to
 * sign up. The server decides how much they get, not this file: it sends only
 * the pages they are entitled to and says whether more exist. Nothing here
 * holds text it then hides.
 */
(function reader(global) {
  'use strict';
  const { el, $, clear, showError, emptyState, toast, fmt, modal } = global.SN;

  const contentId = Number(new URLSearchParams(global.location.search).get('id'));

  let item = null;
  let pages = [];       // [{ heading, paragraphs[], illustration }]
  let page = 0;
  let heartbeat = null;
  let isReader = false; // signed in with an account that reads
  let morePages = 0;    // pages the server withheld, 0 for a full reader
  let gateOpen = false; // the sign-up dialog is up over the page

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

  /**
   * Where to send someone so they come back to where they stopped.
   *
   * `from` is the page to open on their return, so signing up carries on from
   * the gate rather than starting the book again.
   */
  function backHere() {
    return encodeURIComponent(`/read?id=${contentId}&from=${pages.length + 1}`);
  }

  /**
   * Shown when a preview runs out. It takes the place of the next page rather
   * than appearing over it, so it is clear that the reading has stopped and
   * what it would take to carry on.
   */
  /**
   * Shown when a preview runs out: a dialog over the last page, rather than a
   * page of its own. The reading stays on screen behind it, so closing the
   * dialog puts them straight back where they were instead of making them
   * navigate out of an interruption.
   */
  function showGate() {
    if (gateOpen) return;
    gateOpen = true;
    const staff = global.SN.isStaff && global.SN.isStaff();
    const left = `That is the first ${pages.length} pages. There `
      + `${morePages === 1 ? 'is 1 more page' : `are ${morePages} more pages`} to go.`;

    const lead = { margin: 0 };
    const after = { margin: '12px 0 0' };

    const body = el('div', {}, staff
      // Already signed in, just not as somebody who reads. Inviting them to
      // register would make no sense, so say what is actually going on.
      ? [
        el('p', { class: 'muted', style: lead, text: left }),
        el('p', { class: 'muted', style: after,
          text: 'Staff accounts do not have a reader profile, so they see the opening pages of '
            + 'a title rather than the whole of it.' }),
      ]
      : [
        el('p', { class: 'muted', style: lead, text: left }),
        el('p', { class: 'muted', style: after,
          text: 'Make a free account and StoryNest keeps your place, so you can pick this up '
            + 'right where you stopped whenever you come back.' }),
        el('p', { class: 'tiny muted', style: after,
          text: 'A grown-up sets what a child can see.' }),
      ]);

    const footer = staff
      ? [
        el('button', { class: 'btn btn-outline', onclick: () => dialog.close() }, ['Close']),
        global.SN.user && global.SN.user.role === 'LIBRARIAN'
          ? el('a', { class: 'btn btn-primary', href: '/librarian', text: 'Open the catalogue' })
          : el('a', { class: 'btn btn-primary', href: `/content?id=${contentId}`,
            text: 'Back to the title' }),
      ]
      : [
        el('button', { class: 'btn btn-outline', onclick: () => dialog.close() }, ['Not now']),
        el('a', { class: 'btn', href: `/login?next=${backHere()}`, text: 'I already have one' }),
        el('a', { class: 'btn btn-primary', href: `/register?next=${backHere()}`,
          text: 'Create an account' }),
      ];

    const dialog = modal(
      staff ? 'That is the end of the preview' : 'Keep reading?', body, footer,
    );
    // The dialog can also be dismissed with Escape or the backdrop, so the flag
    // is cleared by watching for the element going away rather than only in the
    // Not now handler.
    const watch = setInterval(() => {
      if (!document.body.contains(dialog.node)) {
        clearInterval(watch);
        gateOpen = false;
      }
    }, 200);
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

    const last = page === pages.length - 1;
    $('#progressLabel').textContent = morePages
      ? `Page ${page + 1} of ${pages.length + morePages} \u00b7 free preview`
      : `Page ${page + 1} of ${pages.length}`;
    $('#prevBtn').disabled = page === 0;
    $('#nextBtn').disabled = false;
    // On the last page of a preview the button leads to the sign-up panel, not
    // to a finish the reader has not earned.
    $('#nextBtn').textContent = last
      ? (morePages ? 'Read on \u2192' : 'Finish \u2713')
      : 'Next \u2192';
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
    const ok = await global.SN.init({ active: '/library' });
    if (!ok) return;
    if (!contentId) {
      global.location.href = '/library';
      return;
    }

    const user = global.SN.user;
    isReader = !!user && (user.role === 'ADULT' || user.role === 'CHILD');

    try {
      // Opening a title is a reader's action: it starts a progress row and
      // counts against a daily limit, neither of which a visitor has. The
      // pages request below is what decides whether they may see anything.
      if (isReader) await global.api.post(`/api/content/${contentId}/open`, {});
      const [data, text] = await Promise.all([
        global.api.get(`/api/content/${contentId}`),
        global.api.get(`/api/content/${contentId}/pages`),
      ]);
      item = data.item;
      pages = text.has_text ? text.pages : samplePages(item);
      morePages = text.has_text ? Number(text.more_pages) || 0 : 0;
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

    // Someone returning from the sign-up gate carries the page they reached.
    // It only applies to a full reader: on a preview it would point past the
    // end of what was sent.
    const from = Number(new URLSearchParams(global.location.search).get('from'));
    page = (isReader && Number.isFinite(from) && from > 1)
      ? Math.min(from - 1, pages.length - 1)
      : Math.min(Number(item.last_position) || 0, pages.length - 1);
    renderPage();
    if (isReader) {
      saveProgress();
      startHeartbeat();
    }

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
        if (isReader) saveProgress();
      } else if (morePages) {
        showGate();
      } else if (isReader) {
        await saveProgress();
        toast('Finished! Nice work.', 'ok');
        global.location.href = `/content?id=${contentId}`;
      } else {
        global.location.href = `/content?id=${contentId}`;
      }
    });

    global.addEventListener('beforeunload', () => clearInterval(heartbeat));
  }

  document.addEventListener('DOMContentLoaded', start);
}(window));
