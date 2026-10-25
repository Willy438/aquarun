// Admin Time Slots: manage delivery windows, capacity limits, enabled switches, and same-day closures.
import { bootAdminPage } from '../../core/nav.js';
import { subscribeAdminWorkspace } from '../../core/realtime.js';
import {
  confirmModal,
  escapeHtml,
  getTodayManila,
  setBusy,
  showToast,
} from '../../core/ui.js';
import { formatSlotWindow } from '../../services/ordersService.js';
import {
  getAllTimeSlotsForAdmin,
  saveTimeSlot,
  toggleSlotClosureToday,
  toggleTimeSlotActive,
} from '../../services/slotsService.js';

function getSlotNameFromWindow(slot, idx) {
  const startHour = Number(String(slot?.start_time || '08:00').split(':')[0]);
  if (startHour < 10) return 'Morning A';
  if (startHour < 12) return 'Morning B';
  if (startHour < 15) return 'Afternoon A';
  if (startHour < 17) return 'Afternoon B';
  return `Evening ${idx + 1}`;
}

export async function mount() {
  const titleEl = document.getElementById('page-title');
  const subEl = document.getElementById('page-sub');
  const rightEl = document.getElementById('topbar-right');
  const content = document.getElementById('content');

  if (titleEl) titleEl.textContent = 'Time slots';
  if (subEl) subEl.textContent = 'Delivery windows and per-slot order capacity';

  if (rightEl) {
    rightEl.innerHTML = `<button type="button" class="btn btn-primary" id="btn-add-slot">+ Add slot</button>`;
    rightEl.querySelector('#btn-add-slot')?.addEventListener('click', () => openSlotModal(null));
  }

  const today = getTodayManila();
  let slots = [];

  async function loadSlots() {
    try {
      slots = await getAllTimeSlotsForAdmin(today);
      renderView();
    } catch (err) {
      showToast(err.message || 'Could not load time slots.', 'error');
    }
  }

  function openSlotModal(slot) {
    const isEdit = Boolean(slot?.id);
    const startVal = slot?.start_time ? String(slot.start_time).slice(0, 5) : '08:00';
    const endVal = slot?.end_time ? String(slot.end_time).slice(0, 5) : '10:00';

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="slot-modal-title">
        <div class="modal-header">
          <h3 class="modal-title" id="slot-modal-title">${isEdit ? 'Edit time slot' : 'Add delivery time slot'}</h3>
          <button type="button" class="modal-close" data-close aria-label="Close">×</button>
        </div>
        <form id="slot-modal-form">
          <div class="modal-body stack">
            <div class="field">
              <label class="label" for="slot-label">Display window label</label>
              <input class="input" id="slot-label" name="label" type="text" value="${escapeHtml(slot?.label || '')}" placeholder="e.g. 8:00 AM - 10:00 AM" required />
            </div>
            <div class="form-row">
              <div class="field">
                <label class="label" for="slot-start">Start time</label>
                <input class="input" id="slot-start" name="startTime" type="time" value="${escapeHtml(startVal)}" required />
              </div>
              <div class="field">
                <label class="label" for="slot-end">End time</label>
                <input class="input" id="slot-end" name="endTime" type="time" value="${escapeHtml(endVal)}" required />
              </div>
            </div>
            <div class="form-row">
              <div class="field">
                <label class="label" for="slot-max">Max orders per day</label>
                <input class="input" id="slot-max" name="maxOrders" type="number" min="1" step="1" value="${escapeHtml(slot?.max_orders ?? 10)}" required />
              </div>
              <div class="field">
                <label class="label" for="slot-active">Enabled</label>
                <select class="select" id="slot-active" name="isActive">
                  <option value="true" ${slot?.is_active !== false ? 'selected' : ''}>Enabled</option>
                  <option value="false" ${slot?.is_active === false ? 'selected' : ''}>Disabled</option>
                </select>
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-close>Cancel</button>
            <button type="submit" class="btn btn-primary" id="btn-save-slot">${isEdit ? 'Save changes' : 'Add slot'}</button>
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

    const form = backdrop.querySelector('#slot-modal-form');
    const submitBtn = backdrop.querySelector('#btn-save-slot');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      setBusy(submitBtn, true, 'Saving...');
      try {
        await saveTimeSlot({
          id: slot?.id || null,
          label: fd.get('label'),
          startTime: fd.get('startTime'),
          endTime: fd.get('endTime'),
          maxOrders: Number(fd.get('maxOrders')),
          isActive: fd.get('isActive') === 'true',
        });
        showToast(isEdit ? 'Time slot updated.' : 'Time slot added.', 'success');
        close();
        await loadSlots();
      } catch (err) {
        showToast(err.message || 'Could not save time slot.', 'error');
        setBusy(submitBtn, false);
      }
    });
  }

  function renderView() {
    const enabledSlots = slots.filter((s) => s.is_active && !s.is_closed_today);
    const dailyCapacity = enabledSlots.reduce((sum, s) => sum + Number(s.max_orders || 0), 0);
    const ordersToday = slots.reduce((sum, s) => sum + Number(s.orders_count || 0), 0);
    const fullSlots = enabledSlots.filter(
      (s) => Number(s.orders_count || 0) >= Number(s.max_orders || 1)
    ).length;

    const rowsHtml =
      slots.length === 0
        ? `<tr><td colspan="7" class="text-muted" style="text-align:center; padding: 28px;">No time slots configured.</td></tr>`
        : slots
            .map((slot, idx) => {
              const slotName = getSlotNameFromWindow(slot, idx);
              const used = Number(slot.orders_count || 0);
              const max = Math.max(1, Number(slot.max_orders || 10));
              const pct = Math.min(100, Math.round((used / max) * 100));
              const isFull = used >= max;
              const isClosedToday = Boolean(slot.is_closed_today);
              const isEnabled = Boolean(slot.is_active) && !isClosedToday;

              let statusPill = `<span class="pill pill-success">Open</span>`;
              if (!slot.is_active || isClosedToday) {
                statusPill = `<span class="pill pill-danger">Closed today</span>`;
              } else if (isFull) {
                statusPill = `<span class="pill pill-warning">Full</span>`;
              }

              const fillTone = !isEnabled ? 'is-closed' : isFull ? 'is-full' : '';

              return `
                <tr>
                  <td style="font-weight: 700;">${escapeHtml(slotName)}</td>
                  <td>${escapeHtml(formatSlotWindow(slot))}</td>
                  <td>${max} orders</td>
                  <td>
                    <div class="slot-cap-cell">
                      <div class="slot-cap-bar">
                        <div class="slot-cap-fill ${fillTone}" style="width: ${pct}%"></div>
                      </div>
                      <span class="slot-cap-text">${used}/${max}</span>
                    </div>
                  </td>
                  <td>${statusPill}</td>
                  <td>
                    <button
                      type="button"
                      class="admin-switch${isEnabled ? ' is-on' : ''}"
                      data-toggle-slot="${escapeHtml(slot.id)}"
                      aria-label="Toggle slot enabled"
                    ></button>
                  </td>
                  <td>
                    <div class="admin-action-btns">
                      <button type="button" class="btn btn-secondary btn-sm" data-edit-slot="${escapeHtml(slot.id)}">Edit</button>
                      <button type="button" class="btn btn-secondary btn-sm" data-close-today="${escapeHtml(slot.id)}">
                        ${isClosedToday ? 'Reopen today' : 'Close today'}
                      </button>
                    </div>
                  </td>
                </tr>
              `;
            })
            .join('');

    content.innerHTML = `
      <div class="stack-lg">
        <div class="grid-4">
          <div class="admin-stat-card">
            <span class="stat-label">Active slots</span>
            <div class="stat-value">${enabledSlots.length} <span style="font-size: 16px; font-weight: 500; color: var(--text-muted);">of ${slots.length}</span></div>
          </div>
          <div class="admin-stat-card">
            <span class="stat-label">Daily capacity</span>
            <div class="stat-value">${dailyCapacity} <span style="font-size: 16px; font-weight: 500; color: var(--text-muted);">orders</span></div>
          </div>
          <div class="admin-stat-card">
            <span class="stat-label">Orders today</span>
            <div class="stat-value">${ordersToday}</div>
          </div>
          <div class="admin-stat-card">
            <span class="stat-label">Full slots</span>
            <div class="stat-value">${fullSlots}</div>
          </div>
        </div>

        <section class="card">
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th>Slot</th>
                  <th>Time</th>
                  <th>Capacity</th>
                  <th>Orders today</th>
                  <th>Status</th>
                  <th>Enabled</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                ${rowsHtml}
              </tbody>
            </table>
          </div>
          <div class="dash-pending-note" style="margin-top: 16px;">
            Changes apply to new orders immediately. A slot that reaches its capacity shows as Full to customers.
          </div>
        </section>
      </div>
    `;

    content.querySelectorAll('[data-toggle-slot]').forEach((sw) => {
      sw.addEventListener('click', async () => {
        const id = sw.getAttribute('data-toggle-slot');
        const slot = slots.find((s) => s.id === id);
        if (!slot) return;

        if (slot.is_active) {
          const confirmed = await confirmModal({
            title: `Disable ${slot.label}?`,
            message: `This delivery window will be deactivated and hidden from customers permanently until re-enabled.`,
            confirmText: 'Disable window',
            cancelText: 'Keep active',
            danger: true,
          });
          if (!confirmed) return;
        }

        sw.disabled = true;
        try {
          if (slot.is_closed_today) {
            await toggleSlotClosureToday(slot.id, today, false);
          }
          await toggleTimeSlotActive(slot.id, !slot.is_active);
          showToast(
            `${slot.label} ${!slot.is_active ? 'enabled' : 'disabled'}.`,
            'success'
          );
          await loadSlots();
        } catch (err) {
          showToast(err.message || 'Could not update slot.', 'error');
          sw.disabled = false;
        }
      });
    });

    content.querySelectorAll('[data-edit-slot]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-edit-slot');
        const slot = slots.find((s) => s.id === id);
        if (slot) openSlotModal(slot);
      });
    });

    content.querySelectorAll('[data-close-today]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-close-today');
        const slot = slots.find((s) => s.id === id);
        if (!slot) return;

        const shouldClose = !slot.is_closed_today;
        if (shouldClose) {
          const confirmed = await confirmModal({
            title: `Close ${slot.label} for today?`,
            message: `Customers will no longer be able to select this delivery window for today's orders.`,
            confirmText: 'Close for today',
            cancelText: 'Keep open',
            danger: true,
          });
          if (!confirmed) return;
        }

        setBusy(btn, true, '...');
        try {
          const shouldClose = !slot.is_closed_today;
          await toggleSlotClosureToday(slot.id, today, shouldClose);
          showToast(
            `${slot.label} ${shouldClose ? 'closed for today' : 'reopened for today'}.`,
            'success'
          );
          await loadSlots();
        } catch (err) {
          showToast(err.message || 'Could not update today closure.', 'error');
          setBusy(btn, false);
        }
      });
    });
  }

  await loadSlots();
  const unsubscribe = subscribeAdminWorkspace(() => {
    loadSlots();
  });
  return () => unsubscribe();
}

bootAdminPage('time-slots', mount);
