/* Sign-in form. */
(function login(global) {
  'use strict';
  const { $, showError } = global.SN;

  async function start() {
    await global.SN.init({ active: '/login' });
    if (global.SN.user) {
      global.location.href = '/';
      return;
    }

    $('#loginForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = $('#submitBtn');
      button.disabled = true;
      button.textContent = 'Signing in…';

      try {
        await global.api.post('/api/auth/login', {
          identifier: $('#identifier').value,
          password: $('#password').value,
        });
        // Send people where they were headed, but only to a path on this site.
        const next = new URLSearchParams(global.location.search).get('next');
        global.location.href = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
      } catch (err) {
        showError(err);
        button.disabled = false;
        button.textContent = 'Sign in';
      }
    });
  }

  document.addEventListener('DOMContentLoaded', start);
}(window));
