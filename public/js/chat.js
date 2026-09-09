/* Story Chat. Renders the transcript, sends messages, and shows the titles the
   bot recommended as tappable cards. */
(function chatPage(global) {
  'use strict';
  const { el, $, clear, fmt, coverStyle, showError, toast } = global.SN;

  const SUGGESTIONS = [
    'Something funny',
    'A short bedtime story',
    'Videos about space',
    'A book about animals',
    'Something with dragons',
  ];

  let sessionId = null;

  /** Renders **bold** without ever handing raw text to innerHTML. */
  function richText(text) {
    const frag = document.createDocumentFragment();
    String(text).split(/(\*\*[^*]+\*\*)/g).forEach((part) => {
      if (!part) return;
      if (part.startsWith('**') && part.endsWith('**')) {
        frag.appendChild(el('strong', { text: part.slice(2, -2) }));
      } else {
        frag.appendChild(document.createTextNode(part));
      }
    });
    return frag;
  }

  function recommendationCard(rec) {
    return el('a', { class: 'rec-card', href: `/content?id=${rec.content_id}` }, [
      el('span', { class: 'rec-thumb', style: { background: coverStyle(rec.title) } }),
      el('span', {}, [
        el('div', { style: { fontWeight: '600' }, text: rec.title }),
        el('div', { class: 'tiny muted', text: [
          rec.content_type === 'VIDEO' ? 'Video' : 'Book',
          rec.age_rating ? `ages ${rec.age_rating}+` : null,
          fmt.duration(rec.duration_minutes),
        ].filter(Boolean).join(' · ') }),
      ]),
    ]);
  }

  function renderMessage(msg) {
    const isUser = msg.sender === 'USER';
    const node = el('div', { class: `msg ${isUser ? 'msg-user' : 'msg-bot'}` });

    const bubble = el('div', { class: 'bubble' });
    bubble.appendChild(richText(msg.message_text));
    node.appendChild(bubble);

    if (msg.recommendations && msg.recommendations.length) {
      node.appendChild(el('div', { class: 'rec-row' }, msg.recommendations.map(recommendationCard)));
    }

    const footer = el('div', { class: 'row', style: { gap: '8px' } }, [
      el('span', { class: 'msg-time', text: fmt.time(msg.created_at) }),
    ]);

    if (!isUser && msg.message_id) {
      const rate = async (value, button, other) => {
        try {
          await global.api.post(`/api/chat/messages/${msg.message_id}/feedback`, { feedback: value });
          button.classList.add('on');
          other.classList.remove('on');
        } catch (err) { showError(err); }
      };
      const up = el('button', { title: 'Helpful', 'aria-label': 'Helpful' }, ['👍']);
      const down = el('button', { title: 'Not helpful', 'aria-label': 'Not helpful' }, ['👎']);
      if (msg.feedback === 'LIKE') up.classList.add('on');
      if (msg.feedback === 'DISLIKE') down.classList.add('on');
      up.addEventListener('click', () => rate('LIKE', up, down));
      down.addEventListener('click', () => rate('DISLIKE', down, up));
      footer.appendChild(el('div', { class: 'msg-actions' }, [up, down]));
    }

    node.appendChild(footer);
    return node;
  }

  function append(msg) {
    const log = $('#log');
    log.appendChild(renderMessage(msg));
    log.scrollTop = log.scrollHeight;
  }

  function showTyping() {
    const node = el('div', { class: 'msg msg-bot', id: 'typing' },
      el('div', { class: 'bubble typing' }, [el('span'), el('span'), el('span')]));
    $('#log').appendChild(node);
    $('#log').scrollTop = $('#log').scrollHeight;
    return node;
  }

  async function send(text) {
    if (!text.trim() || !sessionId) return;

    append({ sender: 'USER', message_text: text, created_at: new Date() });
    $('#message').value = '';
    const typing = showTyping();
    $('#sendBtn').disabled = true;

    try {
      const res = await global.api.post(`/api/chat/sessions/${sessionId}/messages`, { message: text });
      typing.remove();
      // The first message in the response is the echo of what was just sent.
      res.messages.slice(1).forEach(append);
      (res.badges_awarded || []).forEach((b) => toast(`Badge unlocked: ${b}`, 'ok'));
    } catch (err) {
      typing.remove();
      showError(err);
    } finally {
      $('#sendBtn').disabled = false;
      $('#message').focus();
    }
  }

  async function openSession(forceNew) {
    const log = $('#log');
    clear(log);
    try {
      if (forceNew && sessionId) await global.api.post(`/api/chat/sessions/${sessionId}/end`, {});
      const data = await global.api.post('/api/chat/sessions', {});
      sessionId = data.session_id;
      data.messages.forEach(append);
    } catch (err) {
      showError(err);
    }
  }

  async function start() {
    const ok = await global.SN.init({ requireAuth: true, active: '/chat' });
    if (!ok) return;

    const host = $('#suggestions');
    SUGGESTIONS.forEach((s) => host.appendChild(el('button', {
      class: 'chip', type: 'button', text: s, onclick: () => send(s),
    })));

    $('#chatForm').addEventListener('submit', (event) => {
      event.preventDefault();
      send($('#message').value);
    });
    $('#newChat').addEventListener('click', () => openSession(true));

    await openSession(false);
    $('#message').focus();
  }

  document.addEventListener('DOMContentLoaded', start);
}(window));
