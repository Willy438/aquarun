import { getCurrentProfile, homeFor, logIn } from '../../core/auth.js';
import { supabase } from '../../core/supabase.js';
import { enablePasswordToggles, setBusy, showToast } from '../../core/ui.js';

const form = document.querySelector('#login-form');
const errorBox = document.querySelector('#form-error');
const button = form.querySelector('button[type="submit"]');

enablePasswordToggles(form);

// Already signed in? Skip the form.
getCurrentProfile().then((profile) => {
  if (profile?.is_active) window.location.href = homeFor(profile.role);
}).catch(() => {});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorBox.innerHTML = '';
  setBusy(button, true, 'Logging in...');
  try {
    const role = await logIn(form.email.value, form.password.value);
    window.location.href = homeFor(role);
  } catch (error) {
    const isUnconfirmed = /confirm/i.test(error.message);
    if (isUnconfirmed) {
      const emailVal = form.email.value.trim();
      errorBox.innerHTML = `
        <span>${error.message}</span>
        <button type="button" id="resend-login-btn" style="display:inline-block; margin-top:6px; background:none; border:none; color:var(--blue-app,#1d5bd6); font-weight:600; text-decoration:underline; cursor:pointer; padding:0; font-size:inherit;">
          Resend confirmation email
        </button>
      `;
      const resendBtn = document.querySelector('#resend-login-btn');
      resendBtn?.addEventListener('click', async () => {
        resendBtn.disabled = true;
        resendBtn.textContent = 'Resending...';
        try {
          const { error: resendErr } = await supabase.auth.resend({
            type: 'signup',
            email: emailVal,
            options: { emailRedirectTo: window.location.origin + '/login.html' }
          });
          if (resendErr) throw resendErr;
          showToast('Confirmation link sent! Check your inbox and spam folder.', 'success');
          resendBtn.textContent = 'Sent! Check inbox';
        } catch (resendError) {
          showToast(resendError.message || 'Failed to resend confirmation email.', 'error');
          resendBtn.disabled = false;
          resendBtn.textContent = 'Resend confirmation email';
        }
      });
    } else {
      errorBox.textContent = error.message;
    }
    setBusy(button, false);
  }
});
