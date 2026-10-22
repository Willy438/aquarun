// Landing page: links to log in and sign up + mobile slide-in overlay drawer menu.
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

// Mobile overlay drawer toggle (closes on backdrop tap, X button, Escape key, or nav link tap)
const publicNav = document.getElementById('public-nav');
const toggleBtn = document.getElementById('public-nav-toggle');
const closeBtn = document.getElementById('public-nav-close');
const backdropEl = document.getElementById('public-nav-backdrop');

function closePublicDrawer() {
  if (!publicNav) return;
  publicNav.classList.remove('is-open');
  document.body.classList.remove('is-drawer-open');
  toggleBtn?.setAttribute('aria-expanded', 'false');
}

function openPublicDrawer() {
  if (!publicNav) return;
  publicNav.classList.add('is-open');
  document.body.classList.add('is-drawer-open');
  toggleBtn?.setAttribute('aria-expanded', 'true');
}

if (publicNav && toggleBtn) {
  toggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (publicNav.classList.contains('is-open')) {
      closePublicDrawer();
    } else {
      openPublicDrawer();
    }
  });

  closeBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    closePublicDrawer();
  });

  backdropEl?.addEventListener('click', (e) => {
    e.stopPropagation();
    closePublicDrawer();
  });

  publicNav.querySelectorAll('.nav-links a, .nav-actions a, .nav-drawer-head a').forEach((link) => {
    link.addEventListener('click', () => {
      closePublicDrawer();
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closePublicDrawer();
    }
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth >= 1024) {
      closePublicDrawer();
    }
  });
}
