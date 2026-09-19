/* Sign-in form. */
(function login(global) {
  'use strict';
  const { $, showError } = global.SN;

  async function start() {
    await global.SN.init({ active: '/login' });
    if (global.SN.user) {
      global.location.href = global.SN.homeFor(global.SN.user);
      return;
    }

    $('#loginForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = $('#submitBtn');
      button.disabled = true;
      button.textContent = 'Signing in…';

      try {
        const res = await global.api.post('/api/auth/login', {
          identifier: $('#identifier').value,
          password: $('#password').value,
        });
        // Send people where they were headed, but only to a path on this site.
        const next = new URLSearchParams(global.location.search).get('next');
        // An explicit ?next= still wins - it is how a locked page sends someone
        // here and gets them back - otherwise each role goes where it works.
        global.location.href = next && next.startsWith('/') && !next.startsWith('//')
          ? next
          : global.SN.homeFor(res.user);
      } catch (err) {
        showError(err);
        button.disabled = false;
        button.textContent = 'Sign in';
      }
    });
  }

  document.addEventListener('DOMContentLoaded', start);
}(window));
