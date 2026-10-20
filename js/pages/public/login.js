// Log in: call auth.js, then send the user to the dashboard for their role.
import { getCurrentProfile, homeFor, logIn } from '../../core/auth.js';
import { setBusy, showToast } from '../../core/ui.js';

const form = document.querySelector('#login-form');
const errorBox = document.querySelector('#form-error');
const button = form.querySelector('button[type="submit"]');

// Already signed in? Skip the form.
getCurrentProfile().then((profile) => {
  if (profile?.is_active) window.location.href = homeFor(profile.role);
}).catch(() => {});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorBox.textContent = '';
  setBusy(button, true, 'Logging in...');
  try {
    const role = await logIn(form.identifier.value, form.password.value);
    window.location.href = homeFor(role);
  } catch (error) {
    errorBox.textContent = error.message;
    setBusy(button, false);
  }
});
