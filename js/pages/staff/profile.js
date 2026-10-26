import { bootStaffPage, renderNav } from '../../core/nav.js';
import { setCachedProfile } from '../../core/auth.js';
import { confirmModal, enablePasswordToggles, escapeHtml, setBusy, showToast } from '../../core/ui.js';
import { updateOwnPassword, updateOwnProfile } from '../../services/usersService.js';
import { validatePassword } from '../../services/verificationService.js';

const ICONS = {
  user: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20a8 8 0 0 1 16 0"/></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
};

export async function mount(initialMe) {
  let me = initialMe;
  const content = document.querySelector('#content');

  content.innerHTML = `
    <div class="grid-2">
      <div class="card">
        <div class="card-header">
          <div class="card-title-group">
            <span class="card-icon">${ICONS.user}</span>
            <h2 class="card-title">Personal details</h2>
          </div>
        </div>

        <form class="form-stack" id="profile-form" novalidate>
          <div class="field">
            <label class="field-label" for="prof-name">Full name</label>
            <input class="input" id="prof-name" name="fullName" type="text" autocomplete="name" value="${escapeHtml(me.full_name || '')}" required>
          </div>

          <div class="field">
            <label class="field-label" for="prof-phone">Contact number</label>
            <input class="input" id="prof-phone" name="phone" type="tel" autocomplete="tel" placeholder="0917 555 0140" value="${escapeHtml(me.phone || '')}" required>
          </div>

          <div class="field">
            <label class="field-label" for="prof-email">Email address</label>
            <input class="input" id="prof-email" name="email" type="email" autocomplete="email" value="${escapeHtml(me.email || '')}" required>
          </div>

          <div>
            <button type="submit" class="btn btn-primary" id="save-profile-btn">Save changes</button>
          </div>
        </form>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title-group">
            <span class="card-icon">${ICONS.check}</span>
            <h2 class="card-title">Change password</h2>
          </div>
        </div>

        <form class="form-stack" id="password-form" novalidate>
          <div class="field">
            <label class="field-label" for="new-password">New password</label>
            <input class="input" id="new-password" name="newPassword" type="password" autocomplete="new-password" placeholder="Enter new password" required>
          </div>

          <div class="field">
            <label class="field-label" for="confirm-password">Confirm password</label>
            <input class="input" id="confirm-password" name="confirmPassword" type="password" autocomplete="new-password" placeholder="Confirm new password" required>
          </div>

          <div class="notice">
            Must be at least 8 characters, with at least 1 letter, 1 number, and 1 special character.
          </div>

          <div>
            <button type="submit" class="btn btn-primary" id="update-password-btn">Update password</button>
          </div>
        </form>
      </div>
    </div>
  `;

  enablePasswordToggles(content);

  document.querySelector('#profile-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const btn = form.querySelector('#save-profile-btn');

    setBusy(btn, true, 'Saving...');
    try {
      const updated = await updateOwnProfile(me.id, {
        fullName: form.fullName.value,
        phone: form.phone.value,
        email: form.email.value,
        currentEmail: me.email,
      });
      me = {
        ...me,
        full_name: updated.fullName,
        phone: updated.phone,
        email: form.email.value.trim().toLowerCase(),
      };
      setCachedProfile(me);
      await renderNav(me, 'profile');
      showToast(
        updated.emailUpdated
          ? 'Profile saved! Check your inbox to confirm your new email address.'
          : 'Personal details updated.',
        'success'
      );
    } catch (err) {
      showToast(err.message || 'Could not update profile.', 'error');
    } finally {
      setBusy(btn, false);
    }
  });

  document.querySelector('#password-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const btn = form.querySelector('#update-password-btn');
    const newPass = form.newPassword.value;
    const confirmPass = form.confirmPassword.value;

    if (newPass.length < 8) {
      showToast('Use at least 8 characters for your password.', 'error');
      return;
    }
    if (newPass !== confirmPass) {
      showToast('The two passwords do not match.', 'error');
      return;
    }

    const confirmed = await confirmModal({
      title: 'Change password?',
      message: 'Are you sure you want to update your password? You will need to use this new password next time you sign in.',
      confirmText: 'Update password',
      cancelText: 'Cancel',
    });
    if (!confirmed) return;

    setBusy(btn, true, 'Updating...');
    try {
      await updateOwnPassword(newPass);
      form.reset();
      showToast('Password updated!', 'success');
    } catch (err) {
      showToast(err.message || 'Could not update password.', 'error');
    } finally {
      setBusy(btn, false);
    }
  });

  return null;
}

bootStaffPage('profile', mount);
