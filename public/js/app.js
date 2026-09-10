/* StoryNest - shared front-end helpers: navigation, session, cover cards,
   notifications and toasts. Every page loads api.js then this file.

   Note on safety: user-supplied text (names, titles, reviews, chat messages)
   is always written with textContent, never innerHTML, so a review containing
   markup cannot execute on another reader's screen. */
(function attachApp(global, document) {
  'use strict';

  const state = { user: null, scope: { role: 'GUEST', restricted: false }, unread: 0 };

  // --- tiny DOM helper -----------------------------------------------------
  function el(tag, props, children) {
    const node = document.createElement(tag);
    if (props) {
      Object.entries(props).forEach(([key, value]) => {
        if (value === null || value === undefined || value === false) return;
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key.startsWith('on') && typeof value === 'function') {
          node.addEventListener(key.slice(2).toLowerCase(), value);
        } else if (key === 'dataset') Object.assign(node.dataset, value);
        else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
        else node.setAttribute(key, value === true ? '' : value);
      });
    }
    (Array.isArray(children) ? children : [children]).forEach((child) => {
      if (child === null || child === undefined || child === false) return;
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    });
    return node;
  }
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }

  // --- formatting ----------------------------------------------------------
  const ACTIVITY_WORDS = {
    LOGIN: 'Signed in',
    LOGOUT: 'Signed out',
    REGISTER: 'Created an account',
    CONTENT_OPEN: 'Opened a title',
    CONTENT_COMPLETE: 'Finished a title',
    CONTENT_REQUEST: 'Asked to unlock a title',
    REQUEST_APPROVE: 'Approved a request',
    REQUEST_DENY: 'Declined a request',
    SAVE_CONTENT: 'Saved a title',
    FEEDBACK: 'Wrote a review',
    CHAT_START: 'Started a Story Chat',
    CHAT_MESSAGE: 'Asked the Story Chat',
    CONTROLS_UPDATE: 'Changed parental controls',
    CHILD_CREATE: 'Added a child account',
    CHILD_UPDATE: 'Edited a child account',
    CHILD_DELETE: 'Deleted a child account',
    PROFILE_UPDATE: 'Updated a profile',
    PASSWORD_CHANGE: 'Changed a password',
    SCREEN_TIME: 'Screen time',
    REPORT: 'Reported something',
    REPORT_DECISION: 'Decided on a report',
    REACTION: 'Reacted to a title',
    CONTENT_IMPORT: 'Bulk imported titles',
    CONTENT_CREATE: 'Added a title',
    CONTENT_UPDATE: 'Edited a title',
    CONTENT_DELETE: 'Removed a title',
    ANNOUNCEMENT: 'Posted an announcement',
    ADMIN_USER_UPDATE: 'Edited an account',
    ADMIN_USER_DELETE: 'Deleted an account',
  };

  const fmt = {
    ages(item) {
      if (item.age_rating === null || item.age_rating === undefined) return 'All ages';
      return `Ages ${item.age_rating}+`;
    },
    duration(mins) {
      if (!mins) return null;
      if (mins < 60) return `${mins} min`;
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return m ? `${h} h ${m} min` : `${h} h`;
    },
    date(value) {
      if (!value) return '';
      return new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    },
    dateTime(value) {
      if (!value) return '';
      return new Date(value).toLocaleString(undefined, {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
      });
    },
    time(value) {
      if (!value) return '';
      return new Date(value).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    },
    stars(avg) {
      const n = Math.round(Number(avg) || 0);
      return '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n);
    },
    initials(name) {
      return String(name || '?').trim().split(/\s+/).slice(0, 2)
        .map((p) => p[0].toUpperCase()).join('');
    },
    activity(type) { return ACTIVITY_WORDS[type] || type; },
    level(value) {
      if (!value) return 'Any level';
      return value.charAt(0) + value.slice(1).toLowerCase();
    },
  };

  // --- generated covers ----------------------------------------------------
  // The sample library ships without artwork, so a cover is drawn from the
  // title: same title, same colours, every time.
  function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i += 1) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash);
  }
  function coverStyle(title) {
    const hue = hashString(String(title || '')) % 360;
    return `linear-gradient(150deg, hsl(${hue} 62% 62%), hsl(${(hue + 42) % 360} 58% 46%))`;
  }

  function coverEl(item, opts) {
    const options = opts || {};
    const box = el('div', { class: 'cover', style: { background: coverStyle(item.title) } });
    if (item.cover_image_url) {
      box.appendChild(el('img', { src: item.cover_image_url, alt: '', loading: 'lazy' }));
    } else {
      box.appendChild(el('div', { class: 'cover-title', text: item.title }));
    }
    box.appendChild(el('span', {
      class: 'cover-badge',
      text: item.content_type === 'VIDEO' ? 'Video' : 'Book',
    }));
    if (options.locked) {
      box.appendChild(el('div', { class: 'cover-lock' }, [
        el('div', { text: '🔒' }),
        el('div', { text: 'Ask a grown-up' }),
      ]));
    }
    return box;
  }

  // --- guest favourites ----------------------------------------------------
  // A Guest has no account, so a favourite is kept against an email address.
  // The address is remembered in this browser only, to save re-typing it.
  const GUEST_EMAIL_KEY = 'sn_guest_email';

  function guestEmail() {
    try { return global.localStorage.getItem(GUEST_EMAIL_KEY) || ''; } catch (err) { return ''; }
  }
  function rememberGuestEmail(value) {
    try { global.localStorage.setItem(GUEST_EMAIL_KEY, value); } catch (err) { /* private mode */ }
  }

  /**
   * Asks a Guest for an email address and favourites a title against it. The
   * rows become real favourites the moment that address registers.
   */
  function guestFavouriteDialog(item, onSaved) {
    const input = el('input', {
      type: 'email', placeholder: 'you@example.com', value: guestEmail(),
      'aria-label': 'Your email address',
    });
    const slot = el('div');

    const dialog = modal(`Save "${item.title}" for later`, el('div', { class: 'form-grid' }, [
      el('p', { class: 'muted small', style: { margin: 0 } }, [
        'You do not need an account. Give us an email address and we will keep your '
        + 'favourites against it - when you register with the same address they move '
        + 'into your new account.',
      ]),
      el('div', { class: 'field' }, [el('label', { text: 'Email' }), input]),
      slot,
    ]), [
      el('button', { class: 'btn btn-outline', onclick: () => dialog.close() }, ['Cancel']),
      el('button', {
        class: 'btn btn-primary',
        onclick: async (event) => {
          const button = event.currentTarget;
          button.disabled = true;
          clear(slot);
          try {
            const res = await global.api.post(
              `/api/content/${item.content_id}/guest-favourite`, { email: input.value.trim() },
            );
            rememberGuestEmail(input.value.trim().toLowerCase());
            dialog.close();
            toast(`Saved. You have ${res.saved_count} favourite${res.saved_count === 1 ? '' : 's'}.`, 'ok');
            if (onSaved) onSaved(res);
          } catch (err) {
            button.disabled = false;
            slot.appendChild(el('div', { class: 'alert alert-error', text: err.message }));
          }
        },
      }, ['Save it']),
    ]);
    input.focus();
    return dialog;
  }

  // --- previews ------------------------------------------------------------
  /**
   * The few lines a Guest is allowed to see before opening anything: the blurb
   * plus the opening of the demo reader for a book. Mirrors read.js so a
   * preview reads like the first page of the real thing.
   */
  function sampleParagraphs(item) {
    const lead = item.description || 'A story is waiting for you here.';
    if (item.content_type === 'VIDEO') {
      return [lead, `A ${fmt.duration(item.duration_minutes) || 'short'} video${
        item.author_creator ? ` from ${item.author_creator}` : ''}. Press play to watch the whole thing.`];
    }
    return [lead, `The opening pages of "${item.title}" would start here. `
      + 'Open the book to read it properly - your place is saved as you go.'];
  }

  /** A read-only look at a title. Open to everyone, Guests included. */
  function previewDialog(item) {
    const meta = [
      fmt.ages(item),
      item.content_type === 'VIDEO' ? 'Video' : 'Book',
      fmt.duration(item.duration_minutes),
      item.reading_level ? fmt.level(item.reading_level) : null,
    ].filter(Boolean).join(' \u00b7 ');

    const body = el('div', { class: 'preview' }, [
      el('div', { class: 'preview-head' }, [
        el('div', { class: 'preview-cover' }, [coverEl(item)]),
        el('div', {}, [
          el('div', { class: 'card-meta', text: meta }),
          item.author_creator ? el('div', { class: 'small muted', text: `by ${item.author_creator}` }) : null,
          (item.tags && item.tags.length)
            ? el('div', { class: 'chips', style: { marginTop: '8px' } },
              item.tags.slice(0, 4).map((t) => el('span', { class: 'chip static', text: t })))
            : null,
        ]),
      ]),
      el('div', { class: 'preview-sample' },
        sampleParagraphs(item).map((para) => el('p', { text: para }))),
      item.preview_url
        ? el('a', {
          class: 'btn btn-outline btn-sm', href: item.preview_url,
          target: '_blank', rel: 'noopener noreferrer',
          text: item.content_type === 'VIDEO' ? 'Watch the trailer \u2197' : 'Read a sample \u2197',
        })
        : el('p', { class: 'tiny muted', text: 'No trailer has been added for this title yet.' }),
    ]);

    const footer = [
      el('button', { class: 'btn btn-outline', onclick: () => dialog.close() }, ['Close']),
    ];
    if (!state.user) {
      footer.push(el('button', {
        class: 'btn',
        onclick: () => { dialog.close(); guestFavouriteDialog(item); },
      }, ['\u2606 Save with my email']));
    }
    footer.push(el('a', {
      class: 'btn btn-primary', href: `/content?id=${item.content_id}`,
      text: item.content_type === 'VIDEO' ? 'Go to the video' : 'Go to the book',
    }));

    const dialog = modal(item.title, body, footer);
    return dialog;
  }

  /** One cover card, as used on the home page and throughout the library. */
  function card(item, opts) {
    const options = opts || {};
    const meta = [fmt.ages(item), (item.tags && item.tags[0]) || null].filter(Boolean).join(' · ');

    const body = el('div', { class: 'card-body' }, [
      options.eyebrow ? el('div', { class: 'card-eyebrow', text: options.eyebrow }) : null,
      el('div', { class: 'card-title', text: item.title }),
      el('div', { class: 'card-meta', text: meta }),
    ]);

    const pctRaw = options.progress !== undefined ? options.progress : item.percentage_completed;
    if (pctRaw) {
      const pct = Math.min(100, Number(pctRaw));
      body.appendChild(el('div', { class: 'card-bar' }, el('span', { style: { width: `${pct}%` } })));
      body.appendChild(el('div', { class: 'tiny muted', text: pct >= 100 ? 'Finished' : `${pct}% read` }));
    }

    const link = el('a', { class: 'card', href: `/content?id=${item.content_id}` },
      [coverEl(item, options), body]);

    if (options.preview === false) return link;

    // A button cannot live inside an <a>, so the card is wrapped and the
    // preview control is positioned over the cover.
    return el('div', { class: 'card-wrap' }, [
      link,
      el('button', {
        class: 'card-preview',
        type: 'button',
        title: `Preview "${item.title}"`,
        'aria-label': `Preview ${item.title}`,
        onclick: (event) => {
          event.preventDefault();
          event.stopPropagation();
          previewDialog(item);
        },
      }, ['\u25b6 Preview']),
    ]);
  }

  function skeletonGrid(count, target) {
    clear(target);
    for (let i = 0; i < count; i += 1) {
      target.appendChild(el('div', { class: 'card' }, [
        el('div', { class: 'skeleton skeleton-card' }),
        el('div', { class: 'card-body' }, el('div', { class: 'skeleton', style: { height: '32px' } })),
      ]));
    }
  }

  function emptyState(glyph, title, message, action) {
    return el('div', { class: 'empty' }, [
      el('div', { class: 'empty-glyph', text: glyph }),
      el('div', { class: 'stack' }, [
        el('h3', { text: title }),
        message ? el('p', { class: 'muted', text: message }) : null,
        action || null,
      ]),
    ]);
  }

  // --- toasts --------------------------------------------------------------
  function toast(message, kind) {
    let tray = $('.toasts');
    if (!tray) {
      tray = el('div', { class: 'toasts' });
      document.body.appendChild(tray);
    }
    const node = el('div', { class: `toast ${kind || ''}`.trim(), text: message });
    tray.appendChild(node);
    setTimeout(() => node.remove(), 3800);
  }

  /** Shows an error in a page's alert slot, or as a toast if there is none. */
  function showError(err, target) {
    const message = err && err.message ? err.message : 'Something went wrong.';
    const slot = target || $('#alert');
    if (slot) {
      clear(slot);
      slot.appendChild(el('div', { class: 'alert alert-error', text: message }));
    } else {
      toast(message, 'err');
    }
  }

  function showOk(message, target) {
    const slot = target || $('#alert');
    if (slot) {
      clear(slot);
      slot.appendChild(el('div', { class: 'alert alert-ok', text: message }));
    } else {
      toast(message, 'ok');
    }
  }

  // --- navigation ----------------------------------------------------------
  const NAV_LINKS = [
    { href: '/chat', label: 'Story Chat' },
    { href: '/library', label: 'Library' },
    { href: '/watch', label: 'Watch' },
    { href: '/about', label: 'About Us' },
  ];

  function renderNav(active) {
    const host = $('#nav');
    if (!host) return;
    clear(host);

    const links = el('nav', { class: 'nav-links', id: 'navLinks' },
      NAV_LINKS.map((link) => el('a', {
        href: link.href,
        text: link.label,
        class: link.href === active ? 'active' : '',
      })));

    const right = el('div', { class: 'nav-right' });

    if (state.user) {
      const bell = el('button', {
        class: 'bell', title: 'Notifications', 'aria-label': 'Notifications', onclick: toggleNotifications,
      }, ['🔔']);
      if (state.unread > 0) {
        bell.appendChild(el('span', {
          class: 'bell-dot', text: state.unread > 9 ? '9+' : String(state.unread),
        }));
      }
      right.appendChild(bell);

      if (state.user.role === 'ADMIN') {
        right.appendChild(el('a', { class: 'btn btn-sm btn-outline', href: '/admin', text: 'Admin' }));
      }
      if (state.user.role === 'ADULT') {
        right.appendChild(el('a', { class: 'btn btn-sm btn-outline', href: '/parent', text: 'Family' }));
      }

      right.appendChild(el('a', {
        class: 'nav-user', href: '/account', title: 'Your account',
        style: { textDecoration: 'none', color: 'inherit' },
      }, [
        el('span', { class: 'avatar', text: fmt.initials(state.user.name) }),
        el('span', { class: 'nowrap', text: state.user.name.split(' ')[0] }),
      ]));
      right.appendChild(el('button', { class: 'btn btn-sm btn-ghost', onclick: signOut }, ['Sign out']));
    } else {
      right.appendChild(el('a', { class: 'btn btn-sm btn-ghost', href: '/login', text: 'Sign in' }));
      right.appendChild(el('a', { class: 'btn btn-sm btn-primary', href: '/register', text: 'Get started' }));
    }

    host.appendChild(el('div', { class: 'nav-inner' }, [
      el('a', { class: 'brand', href: '/' }, [
        el('span', { class: 'brand-mark', text: '📖' }),
        el('span', { text: 'StoryNest' }),
      ]),
      links,
      el('button', {
        class: 'nav-toggle', 'aria-label': 'Menu', onclick: () => links.classList.toggle('open'),
      }, ['☰']),
      right,
    ]));
  }

  async function signOut() {
    try {
      await global.api.post('/api/auth/logout');
    } catch (err) { /* signing out locally is enough */ }
    global.location.href = '/';
  }

  // --- notifications drawer ------------------------------------------------
  let drawer = null;
  async function toggleNotifications() {
    if (drawer) {
      drawer.remove();
      drawer = null;
      return;
    }
    drawer = el('div', { class: 'drawer' }, el('div', { class: 'notif muted', text: 'Loading…' }));
    document.body.appendChild(drawer);

    try {
      const data = await global.api.get('/api/me/notifications');
      clear(drawer);
      drawer.appendChild(el('div', { class: 'drawer-head' }, [
        el('strong', { text: 'Notifications' }),
        el('button', {
          class: 'btn btn-sm btn-ghost',
          onclick: async () => {
            await global.api.post('/api/me/notifications/read', {});
            state.unread = 0;
            renderNav(currentPath());
            $$('.notif', drawer).forEach((n) => n.classList.remove('unread'));
          },
        }, ['Mark all read']),
      ]));

      if (!data.items.length) {
        drawer.appendChild(el('div', { class: 'notif muted', text: 'Nothing yet.' }));
      }
      data.items.forEach((n) => {
        drawer.appendChild(el('div', { class: `notif ${n.read_status ? '' : 'unread'}`.trim() }, [
          el('div', { class: 'notif-title', text: n.title }),
          el('div', { class: 'small muted', text: n.message }),
          el('div', { class: 'tiny muted', text: fmt.dateTime(n.created_at) }),
        ]));
      });
    } catch (err) {
      clear(drawer);
      drawer.appendChild(el('div', { class: 'notif', text: err.message }));
    }
  }

  document.addEventListener('click', (event) => {
    if (drawer && !drawer.contains(event.target) && !event.target.closest('.bell')) {
      drawer.remove();
      drawer = null;
    }
  });

  // --- floating Story Chat button -----------------------------------------
  function renderChatFab(active) {
    if (active === '/chat' || document.body.dataset.noFab === 'true') return;
    document.body.appendChild(el('button', {
      class: 'chat-fab', title: 'Open Story Chat', 'aria-label': 'Open Story Chat',
      onclick: () => { global.location.href = '/chat'; },
    }, ['💬']));
  }

  // --- modal ---------------------------------------------------------------
  function modal(title, contentNode, footerNodes) {
    const backdrop = el('div', { class: 'modal-backdrop' });
    const close = () => backdrop.remove();
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
    document.addEventListener('keydown', function esc(e) {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); }
    });

    backdrop.appendChild(el('div', { class: 'modal' }, [
      el('div', { class: 'modal-head' }, [
        el('h3', { text: title, style: { margin: 0 } }),
        el('button', { class: 'icon-btn', onclick: close, 'aria-label': 'Close' }, ['✕']),
      ]),
      contentNode,
      footerNodes ? el('div', { class: 'modal-foot' }, footerNodes) : null,
    ]));
    document.body.appendChild(backdrop);
    return { close, node: backdrop };
  }

  function confirmDialog(title, message, onConfirm, confirmLabel) {
    const dialog = modal(title, el('p', { class: 'muted', text: message }), [
      el('button', { class: 'btn btn-outline', onclick: () => dialog.close() }, ['Cancel']),
      el('button', {
        class: 'btn btn-danger',
        onclick: async () => { dialog.close(); await onConfirm(); },
      }, [confirmLabel || 'Delete']),
    ]);
    return dialog;
  }

  // --- session -------------------------------------------------------------
  function currentPath() {
    const path = global.location.pathname.replace(/\.html$/, '');
    return path === '' ? '/' : path;
  }

  /**
   * Every page calls this first. Loads the session, draws the shared chrome,
   * and (when requireAuth/requireRole is passed) bounces anyone who should not
   * be here. Resolves false when the page should stop rendering.
   */
  async function init(options) {
    const opts = options || {};
    try {
      const me = await global.api.get('/api/auth/me');
      state.user = me.user;
      state.scope = me.scope || state.scope;
      state.unread = me.unreadNotifications || 0;
    } catch (err) {
      state.user = null;
    }

    const active = opts.active || currentPath();
    renderNav(active);
    renderChatFab(active);

    if (opts.requireAuth && !state.user) {
      global.location.href = `/login?next=${encodeURIComponent(currentPath() + global.location.search)}`;
      return false;
    }
    if (opts.requireRole) {
      const allowed = [].concat(opts.requireRole);
      if (!state.user || !allowed.includes(state.user.role)) {
        const main = $('main');
        if (main) {
          clear(main);
          main.appendChild(emptyState('🔐', 'Not your page',
            'That area is for a different kind of account.',
            el('a', { class: 'btn btn-primary', href: '/', text: 'Back to the library' })));
        }
        return false;
      }
    }
    return true;
  }

  global.SN = {
    el, $, $$, clear, fmt, card, coverEl, coverStyle, skeletonGrid, emptyState,
    toast, showError, showOk, modal, confirmDialog, init, renderNav, signOut, currentPath,
    previewDialog, guestFavouriteDialog, guestEmail, sampleParagraphs,
    get user() { return state.user; },
    get scope() { return state.scope; },
    state,
  };
}(window, document));
