/* One title: cover, details, actions, reviews and "more like this".
   Also handles the 403 a child gets for a locked title, which is where the
   "ask a grown-up" request flow starts. */
(function contentPage(global) {
  'use strict';
  const { el, $, clear, card, fmt, modal, toast, showError, emptyState } = global.SN;

  const contentId = Number(new URLSearchParams(global.location.search).get('id'));
  let item = null;

  // --- locked title ---------------------------------------------------------
  function renderLocked(details) {
    const host = $('#detail');
    clear(host);
    host.appendChild(el('div', { class: 'panel center', style: { padding: '40px 20px' } }, [
      el('div', { style: { fontSize: '2rem' } }, ['🔒']),
      el('h1', { style: { fontSize: '1.3rem' } }, [details && details.title ? details.title : 'Locked']),
      el('p', { class: 'muted' },
        ['A grown-up needs to unlock this one before you can open it.']),
      el('div', { class: 'row', style: { justifyContent: 'center' } }, [
        el('button', {
          class: 'btn btn-primary',
          onclick: () => askForAccess(details && details.content_id ? details.content_id : contentId),
        }, ['Ask a grown-up']),
        el('a', { class: 'btn btn-outline', href: '/library', text: 'Back to the library' }),
      ]),
    ]));
  }

  function askForAccess(id) {
    const note = el('textarea', {
      placeholder: 'Tell your grown-up why you would like to read this (optional)', maxlength: '300',
    });
    const dialog = modal('Ask to unlock this title', el('div', { class: 'form-grid' }, [
      el('p', { class: 'muted small', style: { margin: 0 } },
        ['Your grown-up will see this in their Family page and can unlock it for you.']),
      note,
    ]), [
      el('button', { class: 'btn btn-outline', onclick: () => dialog.close() }, ['Cancel']),
      el('button', {
        class: 'btn btn-primary',
        onclick: async (event) => {
          event.currentTarget.disabled = true;
          try {
            await global.api.post('/api/me/requests', { content_id: id, note: note.value });
            dialog.close();
            toast('Sent! Your grown-up will get a message.', 'ok');
          } catch (err) {
            dialog.close();
            showError(err);
          }
        },
      }, ['Send request']),
    ]);
  }

  // --- saved lists ----------------------------------------------------------
  async function toggleSave(listType, button) {
    if (!global.SN.user) {
      global.location.href = `/login?next=${encodeURIComponent(`/content?id=${contentId}`)}`;
      return;
    }
    const isOn = button.dataset.on === 'true';
    try {
      if (isOn) {
        await global.api.del(`/api/me/saved/${contentId}`, { list_type: listType });
      } else {
        await global.api.post('/api/me/saved', { content_id: contentId, list_type: listType });
      }
      button.dataset.on = String(!isOn);
      setSaveLabel(button, listType, !isOn);
    } catch (err) {
      showError(err);
    }
  }

  function setSaveLabel(button, listType, on) {
    if (listType === 'FAVORITE') {
      button.textContent = on ? '★ In favourites' : '☆ Add to favourites';
    } else {
      button.textContent = on ? '✓ In watchlist' : '+ Add to watchlist';
    }
    button.classList.toggle('btn-primary', on);
    button.classList.toggle('btn-outline', !on);
  }

  // --- main render ----------------------------------------------------------
  function renderDetail() {
    const host = $('#detail');
    clear(host);

    const meta = [
      fmt.ages(item),
      item.content_type === 'VIDEO' ? 'Video' : 'Book',
      fmt.duration(item.duration_minutes),
      item.reading_level ? fmt.level(item.reading_level) : null,
      item.language,
    ].filter(Boolean);

    const actions = el('div', { class: 'row' });

    const openBtn = el('a', {
      class: 'btn btn-primary',
      href: `/read?id=${item.content_id}`,
      text: item.content_type === 'VIDEO' ? '▶ Play' : '📖 Read now',
    });
    actions.appendChild(openBtn);

    if (item.external_link) {
      actions.appendChild(el('a', {
        class: 'btn btn-outline', href: item.external_link,
        target: '_blank', rel: 'noopener noreferrer', text: 'Open source ↗',
      }));
    }

    const favBtn = el('button', { class: 'btn', dataset: { on: String(!!item.is_favorite) } });
    setSaveLabel(favBtn, 'FAVORITE', !!item.is_favorite);
    favBtn.addEventListener('click', () => toggleSave('FAVORITE', favBtn));
    actions.appendChild(favBtn);

    const watchBtn = el('button', { class: 'btn', dataset: { on: String(!!item.in_watchlist) } });
    setSaveLabel(watchBtn, 'WATCHLIST', !!item.in_watchlist);
    watchBtn.addEventListener('click', () => toggleSave('WATCHLIST', watchBtn));
    actions.appendChild(watchBtn);

    if (global.SN.user) {
      actions.appendChild(el('button', {
        class: 'btn btn-ghost btn-sm', text: 'Report', onclick: openReportDialog,
      }));
    }

    const tagRow = el('div', { class: 'chips', style: { marginBottom: '14px' } },
      (item.tags || []).map((tag) => el('a', {
        class: 'chip', href: `/library?tag=${encodeURIComponent(tag)}`, text: tag,
      })));

    host.appendChild(el('div', { class: 'detail' }, [
      el('div', { class: 'detail-cover' }, global.SN.coverEl(item)),
      el('div', {}, [
        el('h1', { text: item.title, style: { marginBottom: '4px' } }),
        item.author_creator
          ? el('p', { class: 'muted', style: { marginBottom: '10px' } },
            [`by ${item.author_creator}`])
          : null,
        el('div', { class: 'detail-meta' }, [
          ...meta.map((m) => el('span', { text: m })),
          item.rating_count
            ? el('span', {}, [
              el('span', { class: 'stars', text: fmt.stars(item.rating_avg) }),
              el('span', { text: ` ${item.rating_avg} (${item.rating_count})` }),
            ])
            : el('span', { class: 'muted', text: 'No reviews yet' }),
        ]),
        tagRow,
        item.description ? el('p', { text: item.description }) : null,
        item.progress
          ? el('div', { class: 'small muted', style: { marginBottom: '12px' } },
            [item.progress >= 100 ? '✓ You finished this one' : `You are ${item.progress}% through this`])
          : null,
        actions,
      ]),
    ]));
  }

  function openReportDialog() {
    const reason = el('textarea', { placeholder: 'What is wrong with this title?', maxlength: '1000' });
    const dialog = modal('Report this title', el('div', { class: 'form-grid' }, [
      el('p', { class: 'muted small', style: { margin: 0 } },
        ['An administrator will read this and decide what to do.']),
      reason,
    ]), [
      el('button', { class: 'btn btn-outline', onclick: () => dialog.close() }, ['Cancel']),
      el('button', {
        class: 'btn btn-primary',
        onclick: async () => {
          try {
            await global.api.post('/api/me/reports', {
              content_id: contentId, reason: reason.value,
            });
            dialog.close();
            toast('Thank you - an administrator will look at this.', 'ok');
          } catch (err) {
            dialog.close();
            showError(err);
          }
        },
      }, ['Send report']),
    ]);
  }

  // --- reviews --------------------------------------------------------------
  function renderReviews(reviews) {
    const host = $('#reviews');
    clear(host);
    $('#reviewsSection').classList.remove('hidden');

    if (global.SN.user) $('#writeReview').classList.remove('hidden');

    if (!reviews.length) {
      host.appendChild(el('p', { class: 'muted small', style: { margin: 0 } },
        ['No reviews yet. Be the first!']));
      return;
    }
    reviews.forEach((review) => {
      host.appendChild(el('div', { class: 'review' }, [
        el('div', { class: 'spread' }, [
          el('div', { class: 'row' }, [
            el('span', { class: 'avatar', text: fmt.initials(review.author) }),
            el('strong', { text: review.author }),
            el('span', { class: 'stars', text: fmt.stars(review.rating) }),
          ]),
          el('span', { class: 'tiny muted', text: fmt.date(review.created_at) }),
        ]),
        el('p', { class: 'small', style: { margin: '6px 0 0' }, text: review.review }),
      ]));
    });
  }

  function openReviewForm() {
    const rating = el('select', {}, [5, 4, 3, 2, 1].map((n) => el('option', {
      value: String(n), text: `${'★'.repeat(n)} (${n})`,
    })));
    const text = el('textarea', { placeholder: 'What did you think of it?', maxlength: '2000' });

    const dialog = modal('Write a review', el('div', { class: 'form-grid' }, [
      el('div', { class: 'field' }, [el('label', { text: 'Rating' }), rating]),
      el('div', { class: 'field' }, [el('label', { text: 'Your review' }), text]),
    ]), [
      el('button', { class: 'btn btn-outline', onclick: () => dialog.close() }, ['Cancel']),
      el('button', {
        class: 'btn btn-primary',
        onclick: async () => {
          try {
            const res = await global.api.post(`/api/content/${contentId}/feedback`, {
              rating: Number(rating.value), review: text.value,
            });
            dialog.close();
            (res.badges_awarded || []).forEach((b) => toast(`Badge unlocked: ${b}`, 'ok'));
            load();
          } catch (err) {
            dialog.close();
            showError(err);
          }
        },
      }, ['Post review']),
    ]);
  }

  // --- load -----------------------------------------------------------------
  async function load() {
    try {
      const data = await global.api.get(`/api/content/${contentId}`);
      item = data.item;
      document.title = `${item.title} — StoryNest`;

      renderDetail();
      renderReviews(data.reviews);

      if (data.related.length) {
        const host = $('#related');
        clear(host);
        data.related.forEach((r) => host.appendChild(card(r)));
        $('#relatedSection').classList.remove('hidden');
      }
    } catch (err) {
      if (err.status === 403 && err.details && err.details.canRequest) {
        renderLocked(err.details);
        return;
      }
      clear($('#detail'));
      $('#detail').appendChild(emptyState('📕', 'Title not found',
        err.message, el('a', { class: 'btn btn-primary', href: '/library', text: 'Back to the library' })));
    }
  }

  async function start() {
    await global.SN.init({ active: '/library' });
    if (!contentId) {
      global.location.href = '/library';
      return;
    }
    $('#writeReview').addEventListener('click', openReviewForm);
    load();
  }

  document.addEventListener('DOMContentLoaded', start);
}(window));
