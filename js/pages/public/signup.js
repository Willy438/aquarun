import { signUpCustomer, homeFor } from '../../core/auth.js';
import { ROLES } from '../../core/constants.js';
import { enablePasswordToggles, setBusy, showToast } from '../../core/ui.js';

const form = document.querySelector('#signup-form');
const errorBox = document.querySelector('#form-error');
const button = form.querySelector('button[type="submit"]');

enablePasswordToggles(form);

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorBox.textContent = '';
  if (form.password.value.length < 8) return void (errorBox.textContent = 'Use a password with at least 8 characters.');
  if (form.password.value !== form.confirm.value) return void (errorBox.textContent = 'The two passwords do not match.');

  setBusy(button, true, 'Creating account...');
  try {
    const { needsConfirmation, addressSaved } = await signUpCustomer({
      fullName: form.fullName.value.trim(),
      phone: form.phone.value,
      email: form.email.value,
      address: form.address.value.trim(),
      password: form.password.value,
    });
    if (needsConfirmation) {
      showToast('Account created. Check your email to confirm it, then log in.', 'success');
      setTimeout(() => { window.location.href = 'login.html'; }, 2500);
      return;
    }
    showToast(addressSaved ? 'Account created. Welcome to AquaRun!' : 'Account created. Please add your address in Addresses.', 'success');
    setTimeout(() => { window.location.href = homeFor(ROLES.CUSTOMER); }, 900);
  } catch (error) {
    errorBox.textContent = error.message;
    setBusy(button, false);
  }
});
