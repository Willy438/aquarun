import { bootCustomerPage } from '../../core/nav.js';
import { confirmModal, escapeHtml, setBusy, showToast } from '../../core/ui.js';
import {
  deleteCustomerAddress,
  getCustomerAddresses,
  saveCustomerAddress,
} from '../../services/addressesService.js';
import { formatAddressFull } from '../../services/ordersService.js';

const ICONS = {
  bookmark: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1Z"/></svg>`,
  home: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h4.5v-6h3v6H18a1 1 0 0 0 1-1V9.5"/></svg>`,
  pin: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-5.6-7-11a7 7 0 1 1 14 0c0 5.4-7 11-7 11Z"/><circle cx="12" cy="10" r="2.5"/></svg>`,
  plus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`,
};

function getAddressIcon(label = '') {
  return /^home$/i.test(label.trim()) ? ICONS.home : ICONS.pin;
}

export async function mount(me) {
  const content = document.querySelector('#content');
  let addresses = [];
  let editingId = null;

  function renderPage() {
    const editingAddr = editingId ? addresses.find((a) => a.id === editingId) : null;

    const listHtml = addresses.length
      ? `<div class="address-list">
          ${addresses
            .map(
              (addr) => `
            <div class="address-row">
              <div class="address-left">
                <span class="address-icon">${getAddressIcon(addr.label)}</span>
                <div>
                  <div class="address-title-row">
                    <span class="address-label">${escapeHtml(addr.label)}</span>
                    ${addr.is_default ? `<span class="pill pill-green">Default</span>` : ''}
                  </div>
                  <p class="address-line">${escapeHtml(formatAddressFull(addr))}</p>
                  ${
                    addr.landmark
                      ? `<p class="address-landmark">Landmark: ${escapeHtml(addr.landmark)}</p>`
                      : ''
                  }
                </div>
              </div>
              <div class="address-actions">
                <button type="button" class="btn btn-outline-blue" data-edit-id="${escapeHtml(addr.id)}">Edit</button>
                <button type="button" class="btn btn-outline-danger" data-delete-id="${escapeHtml(addr.id)}">Delete</button>
              </div>
            </div>
          `
            )
            .join('')}
        </div>`
      : `<div class="empty-state">No saved addresses yet. Add your first delivery address using the form on the right.</div>`;

    content.innerHTML = `
      <div class="grid-split">
        <div class="card">
          <div class="card-header">
            <div class="card-title-group">
              <span class="card-icon">${ICONS.bookmark}</span>
              <h2 class="card-title">Your addresses</h2>
            </div>
          </div>
          ${listHtml}
        </div>

        <div class="card">
          <div class="card-header">
            <div class="card-title-group">
              <span class="card-icon">${ICONS.plus}</span>
              <h2 class="card-title">${editingAddr ? 'Edit address' : 'Add address'}</h2>
            </div>
            ${
              editingAddr
                ? `<button type="button" class="card-link" id="cancel-edit-btn" style="background:none;border:none;padding:0;">Cancel</button>`
                : ''
            }
          </div>

          <form class="form-stack" id="address-form" novalidate>
            <div class="field">
              <label class="field-label" for="addr-label">Label</label>
              <input class="input" id="addr-label" name="label" type="text" placeholder="e.g. Home, Work" value="${escapeHtml(editingAddr?.label || '')}" required>
            </div>

            <div class="field">
              <label class="field-label" for="addr-street">Street</label>
              <input class="input" id="addr-street" name="street" type="text" placeholder="House number and street" value="${escapeHtml(editingAddr?.street || '')}" required>
            </div>

            <div class="field-row">
              <div class="field">
                <label class="field-label" for="addr-barangay">Barangay</label>
                <input class="input" id="addr-barangay" name="barangay" type="text" placeholder="Barangay" value="${escapeHtml(editingAddr?.barangay && editingAddr.barangay !== 'N/A' ? editingAddr.barangay : '')}" required>
              </div>
              <div class="field">
                <label class="field-label" for="addr-city">City</label>
                <input class="input" id="addr-city" name="city" type="text" placeholder="Pasig" value="${escapeHtml(editingAddr?.city || 'Pasig')}" required>
              </div>
            </div>

            <div class="field">
              <label class="field-label" for="addr-landmark">Landmark (optional)</label>
              <input class="input" id="addr-landmark" name="landmark" type="text" placeholder="Nearby landmark" value="${escapeHtml(editingAddr?.landmark || '')}">
            </div>

            <label class="check">
              <input type="checkbox" id="addr-default" name="isDefault" ${editingAddr?.is_default || addresses.length === 0 ? 'checked' : ''}>
              <span>Set as default address</span>
            </label>

            <button type="submit" class="btn btn-primary btn-block" id="save-address-btn">
              ${editingAddr ? 'Update address' : 'Save address'}
            </button>
          </form>
        </div>
      </div>
    `;

    content.querySelectorAll('[data-edit-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        editingId = btn.dataset.editId;
        renderPage();
        document.querySelector('#addr-label')?.focus();
      });
    });

    content.querySelector('#cancel-edit-btn')?.addEventListener('click', () => {
      editingId = null;
      renderPage();
    });

    content.querySelectorAll('[data-delete-id]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.deleteId;
        const target = addresses.find((a) => a.id === id);
        const confirmed = await confirmModal({
          title: `Delete "${target?.label || 'Address'}"?`,
          message: 'Are you sure you want to remove this saved address?',
          confirmText: 'Delete address',
          cancelText: 'Cancel',
          danger: true,
        });
        if (!confirmed) return;

        setBusy(btn, true, 'Deleting...');
        try {
          await deleteCustomerAddress(me.id, id);
          if (editingId === id) editingId = null;
          showToast('Address removed.', 'success');
          await loadAddresses();
        } catch (err) {
          showToast(err.message || 'Could not delete address.', 'error');
          setBusy(btn, false);
        }
      });
    });

    content.querySelector('#address-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const submitBtn = form.querySelector('#save-address-btn');

      setBusy(submitBtn, true, 'Saving...');
      try {
        await saveCustomerAddress(me.id, {
          id: editingId,
          label: form.label.value,
          street: form.street.value,
          barangay: form.barangay.value,
          city: form.city.value,
          landmark: form.landmark.value,
          isDefault: form.isDefault.checked,
        });
        showToast(editingId ? 'Address updated.' : 'Address saved.', 'success');
        editingId = null;
        await loadAddresses();
      } catch (err) {
        showToast(err.message || 'Could not save address.', 'error');
        setBusy(submitBtn, false);
      }
    });
  }

  async function loadAddresses() {
    try {
      addresses = await getCustomerAddresses(me.id);
      renderPage();
    } catch (err) {
      showToast(err.message || 'Could not load addresses.', 'error');
    }
  }

  await loadAddresses();
  return null;
}

bootCustomerPage('addresses', mount);
