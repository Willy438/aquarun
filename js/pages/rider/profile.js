import { bootRiderPage, renderNav } from '../../core/nav.js';
import { setCachedProfile } from '../../core/auth.js';
import { confirmModal, enablePasswordToggles, escapeHtml, setBusy, showToast } from '../../core/ui.js';
import { validatePassword } from '../../services/verificationService.js';
import {
  setRiderAvailability,
  updateOwnPassword,
  updateOwnProfile,
} from '../../services/usersService.js';

export async function mount(initialMe) {
  let me = initialMe;
  const topbarRight = document.querySelector('#topbar-right');
  const content = document.querySelector('#content');

  function updateTopbarBadge() {
    if (!topbarRight) return;
    topbarRight.innerHTML = `
      <span class="avail-pill ${me.is_available ? 'is-on' : 'is-off'}">
        ${me.is_available ? 'Available for assignment' : 'Unavailable'}
      </span>
    `;
  }

  updateTopbarBadge();

  content.innerHTML = `
    <div class="grid-split">
      <div class="card">
        <div class="card-header">
          <h2 class="card-title">Personal details</h2>
        </div>

        <form class="form-stack" id="rider-profile-form" novalidate>
          <div class="field-row">
            <div class="field">
              <label class="field-label" for="prof-name">Full name</label>
              <input class="input" id="prof-name" name="fullName" type="text" autocomplete="name" value="${escapeHtml(me.full_name || '')}" required>
            </div>
            <div class="field">
              <label class="field-label" for="prof-phone">Contact number</label>
              <input class="input" id="prof-phone" name="phone" type="tel" autocomplete="tel" placeholder="0917 555 0188" value="${escapeHtml(me.phone || '')}" required>
            </div>
          </div>

          <div class="field">
            <label class="field-label" for="prof-email">Email</label>
            <input class="input" id="prof-email" name="email" type="email" autocomplete="email" value="${escapeHtml(me.email || '')}" required>
          </div>

          <div class="field-row">
            <div class="field">
              <label class="field-label" for="new-password">New password</label>
              <input class="input" id="new-password" name="newPassword" type="password" autocomplete="new-password" placeholder="Leave blank to keep current">
            </div>
            <div class="field">
              <label class="field-label" for="confirm-password">Confirm password</label>
              <input class="input" id="confirm-password" name="confirmPassword" type="password" autocomplete="new-password" placeholder="Confirm new password">
            </div>
          </div>
          <p class="field-hint" style="font-size: 11.5px; color: var(--muted-blue, #64748b); margin: -4px 0 2px 0;">
            Must be at least 8 characters, including at least 1 number and 1 special character.
          </p>
          <p class="form-error" id="password-error" role="alert" style="margin: 2px 0 4px 0; font-size: 12.5px; color: #dc2626; font-weight: 600;" hidden></p>

          <div>
            <button type="submit" class="btn btn-primary" id="save-profile-btn">Save changes</button>
          </div>
        </form>
      </div>

      <div class="card">
        <div class="card-header">
          <h2 class="card-title">Availability</h2>
        </div>

        <div class="avail-switch-box">
          <div>
            <p class="avail-switch-title">Available for assignment</p>
            <p class="avail-switch-sub">Staff can only assign riders who are available</p>
          </div>
          <label class="toggle-switch" aria-label="Available for assignment">
            <input type="checkbox" id="avail-toggle" ${me.is_available ? 'checked' : ''}>
            <span class="toggle-slider"></span>
          </label>
        </div>

        <p style="font-size: 12.5px; color: var(--muted-blue); line-height: 1.55;">
          Switch this off when you are on break or done for the day. You will disappear from the staff rider picker and the owner's available riders count.
        </p>
      </div>
    </div>
  `;

  enablePasswordToggles(content);

  document.querySelector('#avail-toggle')?.addEventListener('change', async (e) => {
    const checkbox = e.currentTarget;
    const nextState = checkbox.checked;
    checkbox.disabled = true;
    try {
      const updated = await setRiderAvailability(me.id, nextState);
      me = { ...me, is_available: updated.is_available };
      setCachedProfile(me);
      updateTopbarBadge();
      showToast(
        me.is_available
          ? 'You are now Available for assignment.'
          : 'You are now marked Unavailable.',
        'success'
      );
    } catch (err) {
      checkbox.checked = !nextState;
      showToast(err.message || 'Could not update availability.', 'error');
    } finally {
      checkbox.disabled = false;
    }
  });

  document.querySelector('#rider-profile-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const btn = form.querySelector('#save-profile-btn');
    const newPass = form.newPassword.value;
    const confirmPass = form.confirmPassword.value;

    const passError = form.querySelector('#password-error');
    if (passError) {
      passError.textContent = '';
      passError.hidden = true;
    }
    form.newPassword?.classList.remove('is-invalid', 'is-valid');
    form.confirmPassword?.classList.remove('is-invalid', 'is-valid');

    if (newPass) {
      const passRes = validatePassword(newPass);
      if (!passRes.valid) {
        if (passError) {
          passError.textContent = passRes.message;
          passError.hidden = false;
        }
        form.newPassword?.classList.add('is-invalid');
        form.newPassword?.focus();
        showToast(passRes.message, 'error');
        return;
      }
      if (newPass !== confirmPass) {
        if (passError) {
          passError.textContent = 'The two passwords do not match.';
          passError.hidden = false;
        }
        form.confirmPassword?.classList.add('is-invalid');
        form.confirmPassword?.focus();
        showToast('The two passwords do not match.', 'error');
        return;
      }
      form.newPassword?.classList.add('is-valid');
      form.confirmPassword?.classList.add('is-valid');
      const confirmed = await confirmModal({
        title: 'Change password?',
        message: 'Are you sure you want to update your password? You will need to use this new password next time you sign in.',
        confirmText: 'Update password',
        cancelText: 'Cancel',
      });
      if (!confirmed) return;
    }

    setBusy(btn, true, 'Saving...');
    try {
      const updated = await updateOwnProfile(me.id, {
        fullName: form.fullName.value,
        phone: form.phone.value,
        email: form.email.value,
        currentEmail: me.email,
      });
      if (newPass) {
        await updateOwnPassword(newPass);
        form.newPassword.value = '';
        form.confirmPassword.value = '';
      }
      me = {
        ...me,
        full_name: updated.fullName,
        phone: updated.phone,
        email: form.email.value.trim().toLowerCase(),
      };
      setCachedProfile(me);
      await renderNav(me, 'profile');
      showToast('Profile updated!', 'success');
    } catch (err) {
      showToast(err.message || 'Could not update profile.', 'error');
    } finally {
      setBusy(btn, false);
    }
  });

  return null;
}

bootRiderPage('profile', mount);
