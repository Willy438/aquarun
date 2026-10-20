// Sign up: creates a customer account only.
import { signUpCustomer, homeFor } from '../../core/auth.js';
import { ROLES } from '../../core/constants.js';
import { setBusy, showToast } from '../../core/ui.js';

const form = document.querySelector('#signup-form');
const errorBox = document.querySelector('#form-error');
const button = form.querySelector('button[type="submit"]');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorBox.textContent = '';
  if (form.password.value.length < 8) return void (errorBox.textContent = 'Use a password with at least 8 characters.');
  if (form.password.value !== form.confirm.value) return void (errorBox.textContent = 'The two passwords do not match.');
  if (!form.terms.checked) return void (errorBox.textContent = 'Please accept the terms to continue.');

  setBusy(button, true, 'Creating account...');
  try {
    const { addressSaved } = await signUpCustomer({
      fullName: form.fullName.value.trim(),
      phone: form.phone.value,
      contactEmail: form.email.value.trim(),
      address: form.address.value.trim(),
      password: form.password.value,
    });
    showToast(addressSaved ? 'Account created. Welcome to AquaRun!' : 'Account created. Please add your address in Saved addresses.', 'success');
    setTimeout(() => { window.location.href = homeFor(ROLES.CUSTOMER); }, 900);
  } catch (error) {
    errorBox.textContent = error.message;
    setBusy(button, false);
  }
});
