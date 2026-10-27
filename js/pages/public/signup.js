import { signUpCustomer, homeFor } from '../../core/auth.js';
import { ROLES } from '../../core/constants.js';
import { supabase } from '../../config/supabaseClient.js';
import { enablePasswordToggles, escapeHtml, setBusy, showToast } from '../../core/ui.js';
import {
  validatePassword,
  verifyEmailAddress,
  verifyPhoneNumber,
} from '../../services/verificationService.js';

const form = document.querySelector('#signup-form');
const errorBox = document.querySelector('#form-error');
const button = form.querySelector('button[type="submit"]');
const emailInput = form.querySelector('#email');
const emailFeedback = document.querySelector('#email-feedback');

enablePasswordToggles(form);

let emailTaken = false;
let emailCheckTimeout = null;

async function checkRealtimeEmail(rawEmail) {
  const clean = String(rawEmail || '').trim().toLowerCase();

  if (!clean || !clean.includes('@') || !clean.includes('.')) {
    if (emailFeedback) {
      emailFeedback.style.display = 'none';
      emailFeedback.innerHTML = '';
    }
    emailInput?.classList.remove('is-invalid', 'is-valid');
    emailTaken = false;
    return;
  }

  // Basic regex check before RPC lookup
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
    if (emailFeedback) {
      emailFeedback.style.display = 'none';
      emailFeedback.innerHTML = '';
    }
    emailInput?.classList.remove('is-invalid', 'is-valid');
    emailTaken = false;
    return;
  }

  if (emailFeedback) {
    emailFeedback.style.display = 'block';
    emailFeedback.innerHTML = '<span style="color: #64748b; font-size: 12px;">Checking availability...</span>';
  }

  try {
    const { data: exists, error } = await supabase.rpc('check_email_exists', {
      email_to_check: clean,
    });

    if (error) {
      // If RPC is not created yet in Supabase, fail silently so normal signup continues
      if (emailFeedback) {
        emailFeedback.style.display = 'none';
        emailFeedback.innerHTML = '';
      }
      emailInput?.classList.remove('is-invalid', 'is-valid');
      emailTaken = false;
      return;
    }

    if (exists === true) {
      emailTaken = true;
      emailInput?.classList.add('is-invalid');
      emailInput?.classList.remove('is-valid');
      if (emailFeedback) {
        emailFeedback.style.display = 'block';
        emailFeedback.innerHTML = '<span style="color: #dc2626; font-weight: 600;">This email is already registered.</span>';
      }
    } else {
      emailTaken = false;
      emailInput?.classList.remove('is-invalid');
      emailInput?.classList.add('is-valid');
      if (emailFeedback) {
        emailFeedback.style.display = 'block';
        emailFeedback.innerHTML = `
          <span style="color: #16a34a; font-weight: 600; display: inline-flex; align-items: center; gap: 4px;">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            Email is available
          </span>
        `;
      }
    }
  } catch {
    if (emailFeedback) emailFeedback.style.display = 'none';
    emailTaken = false;
  }
}

if (emailInput) {
  emailInput.addEventListener('input', () => {
    clearTimeout(emailCheckTimeout);
    emailCheckTimeout = setTimeout(() => {
      checkRealtimeEmail(emailInput.value);
    }, 350);
  });

  emailInput.addEventListener('blur', () => {
    clearTimeout(emailCheckTimeout);
    checkRealtimeEmail(emailInput.value);
  });
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorBox.innerHTML = '';

  const firstName = form.firstName.value.trim();
  const lastName = form.lastName.value.trim();
  if (!firstName) {
    errorBox.textContent = 'Please enter your first name.';
    form.firstName.focus();
    return;
  }
  if (!lastName) {
    errorBox.textContent = 'Please enter your last name.';
    form.lastName.focus();
    return;
  }
  const fullName = `${firstName} ${lastName}`.trim();

  // 1. Phone number validation (Philippine mobile + NTC carrier check)
  const phoneRes = verifyPhoneNumber(form.phone.value);
  if (!phoneRes.valid) {
    errorBox.textContent = phoneRes.message;
    form.phone.focus();
    return;
  }

  // 2. Password validation (at least 8 chars, 1 number, 1 special char, 1 letter)
  const passRes = validatePassword(form.password.value);
  if (!passRes.valid) {
    errorBox.textContent = passRes.message;
    form.password.focus();
    return;
  }
  if (form.password.value !== form.confirm.value) {
    errorBox.textContent = 'The two passwords do not match.';
    form.confirm.focus();
    return;
  }

  // Check if real-time check already marked email as taken
  if (emailTaken) {
    errorBox.textContent = 'This email is already registered.';
    form.email.focus();
    return;
  }

  // 3. Email verification API (format + disposable check + Google DNS MX record verification)
  setBusy(button, true, 'Verifying details...');
  try {
    const emailRes = await verifyEmailAddress(form.email.value);
    if (!emailRes.valid) {
      errorBox.textContent = emailRes.message;
      form.email.focus();
      setBusy(button, false);
      return;
    }

    // Double check email availability via RPC before proceeding
    let alreadyRegistered = false;
    try {
      const { data, error } = await supabase.rpc('check_email_exists', {
        email_to_check: emailRes.email,
      });
      if (!error && data === true) {
        alreadyRegistered = true;
      }
    } catch {
      alreadyRegistered = false;
    }

    if (alreadyRegistered === true) {
      errorBox.textContent = 'This email is already registered. Please log in instead.';
      form.email.focus();
      setBusy(button, false);
      return;
    }

    setBusy(button, true, 'Creating account...');
    const { needsConfirmation } = await signUpCustomer({
      fullName,
      phone: phoneRes.normalized,
      email: emailRes.email,
      password: form.password.value,
    });

    if (needsConfirmation) {
      const authCard = document.querySelector('.auth-card');
      if (authCard) {
        authCard.innerHTML = `
          <div style="text-align: center; padding: 12px 4px;">
            <div style="width: 68px; height: 68px; border-radius: 50%; background: #ebf2ff; color: #1d5bd6; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 20px;">
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
            </div>
            <h1 style="font-size: 24px; font-weight: 800; color: #0f172a; margin: 0 0 8px 0;">Verify your email</h1>
            <p style="font-size: 14.5px; color: #475569; margin: 0 0 18px 0; line-height: 1.55;">
              We sent an activation link to:<br>
              <strong style="color: #0f172a; font-size: 15.5px;">${escapeHtml(emailRes.email)}</strong>
            </p>
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin-bottom: 24px; text-align: left; font-size: 13px; color: #334155; line-height: 1.55;">
              <strong style="color: #0f172a; display: block; margin-bottom: 6px;">Next steps to activate your account:</strong>
              <ol style="margin: 0; padding-left: 20px;">
                <li>Open your email inbox (or Spam/Junk folder).</li>
                <li>Click the <strong>Confirm email address</strong> link.</li>
                <li>Your account will be verified and you can log in.</li>
              </ol>
            </div>
            <div style="display: flex; flex-direction: column; gap: 10px;">
              <button type="button" class="btn btn-primary" id="resend-confirmation-btn" style="width: 100%; min-height: 46px;">
                Resend confirmation email
              </button>
              <a href="login.html" class="btn btn-light" style="width: 100%; min-height: 46px;">
                Already confirmed? Go to Log In &rarr;
              </a>
            </div>
          </div>
        `;

        const resendBtn = authCard.querySelector('#resend-confirmation-btn');
        resendBtn?.addEventListener('click', async () => {
          setBusy(resendBtn, true, 'Resending email...');
          try {
            const { error: resendErr } = await supabase.auth.resend({
              type: 'signup',
              email: emailRes.email,
            });
            if (resendErr) throw resendErr;
            showToast('Confirmation email resent! Please check your inbox and spam folder.', 'success');
          } catch (err) {
            showToast(err.message || 'Could not resend email. Please try again.', 'error');
          } finally {
            setBusy(resendBtn, false);
          }
        });
      }
      return;
    }

    showToast('Account created! Welcome to AquaRun.', 'success');
    setTimeout(() => { window.location.href = homeFor(ROLES.CUSTOMER); }, 900);
  } catch (error) {
    errorBox.textContent = error.message;
    setBusy(button, false);
  }
});
