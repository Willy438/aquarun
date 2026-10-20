// Landing page: links to log in and sign up.
import { getCurrentProfile, homeFor } from '../../core/auth.js';

// If the visitor is already signed in, point the nav buttons at their workspace.
const loginLink = document.querySelector('[data-login]');
const orderLink = document.querySelector('[data-order]');

getCurrentProfile().then((profile) => {
  if (!profile?.is_active) return;
  loginLink.textContent = 'Dashboard';
  loginLink.href = homeFor(profile.role);
  orderLink.href = homeFor(profile.role);
}).catch(() => {});