/* Adult sign-up form. */
(function register(global) {
  'use strict';
  const { $, showError } = global.SN;

  async function start() {
    await global.SN.init({ active: '/register' });
    if (global.SN.user) {
      global.location.href = '/';
      return;
    }

    $('#registerForm').addEventListener('submit', async (event) => {
      event.preventDefault();

      if ($('#password').value !== $('#confirm').value) {
        showError({ message: 'The two passwords do not match.' });
        return;
      }
      if (!$('#consent').checked) {
        showError({ message: 'Please confirm you are the parent or guardian.' });
        return;
      }

      const button = $('#submitBtn');
      button.disabled = true;
      button.textContent = 'Creating…';

      try {
        await global.api.post('/api/auth/register', {
          name: $('#name').value,
          email: $('#email').value,
          dob: $('#dob').value,
          password: $('#password').value,
        });
        // A reader who was stopped part-way through a preview arrives with
        // ?next= pointing at the page they were on, and should land back there
        // rather than on the family page.
        const next = new URLSearchParams(global.location.search).get('next');
        global.location.href = next && next.startsWith('/') && !next.startsWith('//')
          ? next
          : '/parent';
      } catch (err) {
        showError(err);
        button.disabled = false;
        button.textContent = 'Create account';
      }
    });
  }

  document.addEventListener('DOMContentLoaded', start);
}(window));
