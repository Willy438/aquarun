import { signUpCustomer, homeFor } from '../../core/auth.js';
import { ROLES } from '../../core/constants.js';
import { enablePasswordToggles, setBusy, showToast } from '../../core/ui.js';
import {
  validatePassword,
  verifyEmailAddress,
  verifyPhoneNumber,
} from '../../services/verificationService.js';

const form = document.querySelector('#signup-form');
const errorBox = document.querySelector('#form-error');
const button = form.querySelector('button[type="submit"]');

enablePasswordToggles(form);

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorBox.textContent = '';

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

    setBusy(button, true, 'Creating account...');
    const { needsConfirmation } = await signUpCustomer({
      fullName,
      phone: phoneRes.normalized,
      email: emailRes.email,
      password: form.password.value,
    });

    if (needsConfirmation) {
      showToast('Account created! Check your email to confirm it, then log in.', 'success');
      setTimeout(() => { window.location.href = 'login.html'; }, 2500);
      return;
    }

    showToast('Account created! Welcome to AquaRun.', 'success');
    setTimeout(() => { window.location.href = homeFor(ROLES.CUSTOMER); }, 900);
  } catch (error) {
    errorBox.textContent = error.message;
    setBusy(button, false);
  }
});
