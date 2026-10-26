// Admin Users: create and manage Staff and Rider accounts.
import { bootAdminPage } from '../../core/nav.js';
import { subscribeAdminWorkspace } from '../../core/realtime.js';
import {
  confirmModal,
  enablePasswordToggles,
  escapeHtml,
  getInitials,
  setBusy,
  showToast,
} from '../../core/ui.js';
import {
  createStaffOrRiderAccount,
  getStaffAndRidersForAdmin,
  setRiderAvailability,
  updateUserByAdmin,
} from '../../services/usersService.js';

export async function mount() {
  const titleEl = document.getElementById('page-title');
  const subEl = document.getElementById('page-sub');
  const rightEl = document.getElementById('topbar-right');
  const content = document.getElementById('content');

  if (titleEl) titleEl.textContent = 'Users';

  const params = new URLSearchParams(window.location.search);
  const initialRoleParam = params.get('role');
  const initialActionParam = params.get('action');

  let users = [];
  let roleFilter =
    initialRoleParam === 'rider' || initialRoleParam === 'staff' ? initialRoleParam : 'all';
  let searchQuery = '';

  if (rightEl) {
    rightEl.innerHTML = `<button type="button" class="btn btn-primary" id="btn-add-user">+ Add user</button>`;
    rightEl
      .querySelector('#btn-add-user')
      ?.addEventListener('click', () =>
        openCreateUserModal(roleFilter === 'rider' ? 'rider' : 'staff')
      );
  }

  async function loadUsers() {
    try {
      users = await getStaffAndRidersForAdmin();
      const staffCount = users.filter((u) => u.role === 'staff').length;
      const riderCount = users.filter((u) => u.role === 'rider').length;
      if (subEl) {
        subEl.textContent = `Staff and rider accounts · ${staffCount} staff, ${riderCount} riders`;
      }
      renderView();
    } catch (err) {
      showToast(err.message || 'Could not load user accounts.', 'error');
    }
  }

  function openCreateUserModal(defaultRole = 'staff') {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="add-user-title">
        <div class="modal-header">
          <h3 class="modal-title" id="add-user-title">Add staff or rider account</h3>
          <button type="button" class="modal-close" data-close aria-label="Close">×</button>
        </div>
        <form id="add-user-form">
          <div class="modal-body stack">
            <div class="field">
              <label class="label" for="new-user-name">Full name</label>
              <input class="input" id="new-user-name" name="fullName" type="text" placeholder="e.g. Marco Reyes" required />
            </div>
            <div class="form-row">
              <div class="field">
                <label class="label" for="new-user-role">Role</label>
                <select class="select" id="new-user-role" name="role">
                  <option value="staff" ${defaultRole === 'staff' ? 'selected' : ''}>Staff</option>
                  <option value="rider" ${defaultRole === 'rider' ? 'selected' : ''}>Rider</option>
                </select>
              </div>
              <div class="field">
                <label class="label" for="new-user-phone">Mobile number</label>
                <input class="input" id="new-user-phone" name="phone" type="tel" placeholder="0917 555 0101" required />
              </div>
            </div>
            <div class="field">
              <label class="label" for="new-user-email">Email address</label>
              <input class="input" id="new-user-email" name="email" type="email" placeholder="user@aquarun.local" required />
            </div>
            <div class="field">
              <label class="label" for="new-user-password">Temporary password</label>
              <input class="input" id="new-user-password" name="password" type="password" minlength="8" placeholder="At least 8 characters, 1 number, 1 special character" required />
            <p style="font-size: 11.5px; color: #64748b; margin-top: 4px;">Must be at least 8 characters, with 1 letter, 1 number, and 1 special character.</p>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-close>Cancel</button>
            <button type="submit" class="btn btn-primary" id="btn-save-new-user">Create account</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(backdrop);
    enablePasswordToggles(backdrop);
    backdrop.querySelector('#new-user-name')?.focus();

    const close = () => backdrop.remove();
    backdrop.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close();
    });

    const form = backdrop.querySelector('#add-user-form');
    const submitBtn = backdrop.querySelector('#btn-save-new-user');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      setBusy(submitBtn, true, 'Creating...');
      try {
        await createStaffOrRiderAccount({
          fullName: fd.get('fullName'),
          role: fd.get('role'),
          phone: fd.get('phone'),
          email: fd.get('email'),
          password: fd.get('password'),
        });
        showToast('Account created and activated.', 'success');
        close();
        await loadUsers();
      } catch (err) {
        showToast(err.message || 'Could not create account.', 'error');
        setBusy(submitBtn, false);
      }
    });
  }

  function openEditUserModal(user) {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="edit-user-title">
        <div class="modal-header">
          <h3 class="modal-title" id="edit-user-title">Edit user account</h3>
          <button type="button" class="modal-close" data-close aria-label="Close">×</button>
        </div>
        <form id="edit-user-form">
          <div class="modal-body stack">
            <div class="field">
              <label class="label" for="edit-user-name">Full name</label>
              <input class="input" id="edit-user-name" name="fullName" type="text" value="${escapeHtml(user.full_name)}" required />
            </div>
            <div class="form-row">
              <div class="field">
                <label class="label" for="edit-user-role">Role</label>
                <select class="select" id="edit-user-role" name="role">
                  <option value="staff" ${user.role === 'staff' ? 'selected' : ''}>Staff</option>
                  <option value="rider" ${user.role === 'rider' ? 'selected' : ''}>Rider</option>
                </select>
              </div>
              <div class="field">
                <label class="label" for="edit-user-phone">Mobile number</label>
                <input class="input" id="edit-user-phone" name="phone" type="tel" value="${escapeHtml(user.phone || '')}" required />
              </div>
            </div>
            <div class="field">
              <label class="label" for="edit-user-status">Account status</label>
              <select class="select" id="edit-user-status" name="isActive">
                <option value="true" ${user.is_active ? 'selected' : ''}>Active</option>
                <option value="false" ${!user.is_active ? 'selected' : ''}>Inactive</option>
              </select>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-close>Cancel</button>
            <button type="submit" class="btn btn-primary" id="btn-update-user">Save changes</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(backdrop);

    const close = () => backdrop.remove();
    backdrop.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close();
    });

    const form = backdrop.querySelector('#edit-user-form');
    const submitBtn = backdrop.querySelector('#btn-update-user');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);

      const willDeactivate = user.is_active && fd.get('isActive') === 'false';
      if (willDeactivate) {
        const confirmed = await confirmModal({
          title: `Deactivate ${user.full_name}?`,
          message: `Setting this account to Inactive will immediately block ${user.full_name} from logging in.`,
          confirmText: 'Deactivate account',
          cancelText: 'Cancel',
          danger: true,
        });
        if (!confirmed) return;
      }

      setBusy(submitBtn, true, 'Saving...');
      try {
        await updateUserByAdmin(user.id, {
          fullName: fd.get('fullName'),
          role: fd.get('role'),
          phone: fd.get('phone'),
          isActive: fd.get('isActive') === 'true',
        });
        showToast('User account updated.', 'success');
        close();
        await loadUsers();
      } catch (err) {
        showToast(err.message || 'Could not update user.', 'error');
        setBusy(submitBtn, false);
      }
    });
  }

  function renderView() {
    const staffUsers = users.filter((u) => u.role === 'staff');
    const riderUsers = users.filter((u) => u.role === 'rider');
    const activeStaff = staffUsers.filter((u) => u.is_active).length;
    const availableRiders = riderUsers.filter((u) => u.is_active && u.is_available).length;
    const offShiftRiders = riderUsers.length - availableRiders;

    const q = searchQuery.trim().toLowerCase();
    const filtered = users.filter((u) => {
      if (roleFilter !== 'all' && u.role !== roleFilter) return false;
      if (!q) return true;
      return (
        String(u.full_name || '').toLowerCase().includes(q) ||
        String(u.phone || '').toLowerCase().includes(q)
      );
    });

    const avatarTones = [''];

    const rowsHtml =
      filtered.length === 0
        ? `<tr><td colspan="5" class="text-muted" style="text-align:center; padding: 28px;">No staff or rider accounts found. Click "+ Add user" to create one.</td></tr>`
        : filtered
            .map((u, idx) => {
              const rolePill =
                u.role === 'staff'
                  ? `<span class="pill pill-info">Staff</span>`
                  : `<span class="pill pill-warning">Rider</span>`;
              const statusPill = u.is_active
                ? `<span class="pill pill-success">Active</span>`
                : `<span class="pill pill-neutral">Inactive</span>`;
              const riderShiftPill =
                u.role === 'rider' && u.is_active
                  ? `<button type="button" class="pill ${u.is_available ? 'pill-success' : 'pill-neutral'} pill-btn-toggle" style="margin-left: 6px;" data-toggle-shift="${escapeHtml(u.id)}" title="Click to toggle shift availability">${u.is_available ? 'Available' : 'Off shift'}</button>`
                  : '';

              return `
                <tr>
                  <td>
                    <div class="admin-customer-cell">
                      <span class="dash-avatar ${avatarTones[idx % avatarTones.length]}">${escapeHtml(
                        getInitials(u.full_name)
                      )}</span>
                      <span style="font-weight: 700;">${escapeHtml(u.full_name)}</span>
                    </div>
                  </td>
                  <td>${rolePill}</td>
                  <td>${escapeHtml(u.phone || '—')}</td>
                  <td>${statusPill}${riderShiftPill}</td>
                  <td>
                    <div class="admin-action-btns">
                      <button type="button" class="btn btn-secondary btn-sm" data-edit-user="${escapeHtml(u.id)}">Edit</button>
                      <button type="button" class="btn btn-secondary btn-sm" data-toggle-user="${escapeHtml(u.id)}">
                        ${u.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                    </div>
                  </td>
                </tr>
              `;
            })
            .join('');

    content.innerHTML = `
      <div class="stack-lg">
        <div class="grid-2">
          <div class="admin-stat-card is-interactive" data-role-card="staff">
            <span class="stat-label">Staff accounts <span class="stat-card-arrow">→</span></span>
            <div class="stat-value">${staffUsers.length}</div>
            <span class="stat-sub">${activeStaff === staffUsers.length ? 'All active' : `${activeStaff} active`}</span>
          </div>
          <div class="admin-stat-card is-interactive" data-role-card="rider">
            <span class="stat-label">Rider accounts <span class="stat-card-arrow">→</span></span>
            <div class="stat-value">${riderUsers.length}</div>
            <span class="stat-sub">${availableRiders} available · ${Math.max(0, offShiftRiders)} off shift</span>
          </div>
        </div>

        <section class="card">
          <div class="admin-table-toolbar">
            <div class="filter-bar">
              <button type="button" class="filter-chip${roleFilter === 'all' ? ' is-active' : ''}" data-role-filter="all">All ${users.length}</button>
              <button type="button" class="filter-chip${roleFilter === 'staff' ? ' is-active' : ''}" data-role-filter="staff">Staff ${staffUsers.length}</button>
              <button type="button" class="filter-chip${roleFilter === 'rider' ? ' is-active' : ''}" data-role-filter="rider">Riders ${riderUsers.length}</button>
            </div>
            <input
              type="search"
              class="input admin-search-input"
              id="admin-user-search"
              placeholder="Search name or contact"
              value="${escapeHtml(searchQuery)}"
            />
          </div>

          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Contact</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                ${rowsHtml}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    `;

    content.querySelectorAll('[data-role-card]').forEach((card) => {
      card.addEventListener('click', () => {
        const nextRole = card.getAttribute('data-role-card') || 'all';
        roleFilter = roleFilter === nextRole ? 'all' : nextRole;
        renderView();
      });
    });

    content.querySelectorAll('[data-role-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        roleFilter = btn.getAttribute('data-role-filter') || 'all';
        renderView();
      });
    });

    const searchInput = content.querySelector('#admin-user-search');
    searchInput?.addEventListener('input', (e) => {
      searchQuery = e.target.value;
      const pos = searchInput.selectionStart;
      renderView();
      const nextInput = content.querySelector('#admin-user-search');
      if (nextInput) {
        nextInput.focus();
        nextInput.setSelectionRange(pos, pos);
      }
    });

    content.querySelectorAll('[data-edit-user]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-edit-user');
        const user = users.find((u) => u.id === id);
        if (user) openEditUserModal(user);
      });
    });

    content.querySelectorAll('[data-toggle-shift]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-toggle-shift');
        const user = users.find((u) => u.id === id);
        if (!user) return;
        const nextAvail = !user.is_available;
        user.is_available = nextAvail;
        renderView();
        try {
          await setRiderAvailability(user.id, nextAvail);
          showToast(
            `${user.full_name} is now ${nextAvail ? 'Available' : 'Off shift'}.`,
            'success'
          );
        } catch (err) {
          user.is_available = !nextAvail;
          renderView();
          showToast(err.message || 'Could not update shift availability.', 'error');
        }
      });
    });

    content.querySelectorAll('[data-toggle-user]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-toggle-user');
        const user = users.find((u) => u.id === id);
        if (!user) return;

        if (user.is_active) {
          const confirmed = await confirmModal({
            title: `Deactivate ${user.full_name}?`,
            message: `Are you sure you want to deactivate ${user.full_name}? They will be immediately blocked from logging into the platform.`,
            confirmText: 'Deactivate user',
            cancelText: 'Cancel',
            danger: true,
          });
          if (!confirmed) return;
        }

        setBusy(btn, true, '...');
        try {
          await updateUserByAdmin(user.id, {
            fullName: user.full_name,
            phone: user.phone,
            role: user.role,
            isActive: !user.is_active,
          });
          showToast(
            `${user.full_name} ${!user.is_active ? 'activated' : 'deactivated'}.`,
            'success'
          );
          await loadUsers();
        } catch (err) {
          showToast(err.message || 'Could not update status.', 'error');
          setBusy(btn, false);
        }
      });
    });
  }

  await loadUsers();

  if (initialActionParam === 'add') {
    openCreateUserModal(initialRoleParam === 'rider' ? 'rider' : 'staff');
  }

  const unsubscribe = subscribeAdminWorkspace(() => {
    loadUsers();
  });
  return () => unsubscribe();
}

bootAdminPage('users', mount);
