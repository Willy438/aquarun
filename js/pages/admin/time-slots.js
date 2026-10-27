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
import {
  getAllTimeSlotsForAdmin,
  saveTimeSlot,
  deleteTimeSlot,
  toggleSlotClosureToday,
  toggleTimeSlotActive,
} from '../../services/slotsService.js';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function pad(n) {
  return String(n).padStart(2, '0');
}

export function formatTime24to12(timeStr) {
  if (!timeStr) return '';
  const [hStr, mStr] = String(timeStr).split(':');
  let h = parseInt(hStr, 10);
  const m = mStr ? mStr.slice(0, 2) : '00';
  if (isNaN(h)) return timeStr;
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m} ${ampm}`;
}

export function generateSlotWindowLabel(startTime24, endTime24) {
  if (!startTime24 || !endTime24) return '';
  return `${formatTime24to12(startTime24)} – ${formatTime24to12(endTime24)}`;
}

export function generateTimeOptions() {
  const options = [];
  for (let h = 6; h <= 22; h++) {
    for (let m = 0; m < 60; m += 30) {
      if (h === 22 && m > 0) break;
      const val = `${pad(h)}:${pad(m)}`;
      const label = formatTime24to12(val);
      options.push({ val, label });
    }
  }
  return options;
}

export function addHoursToTime(time24, hoursToAdd) {
  if (!time24) return '11:00';
  const [hStr, mStr] = String(time24).split(':');
  let h = parseInt(hStr, 10) + hoursToAdd;
  const m = mStr ? mStr.slice(0, 2) : '00';
  if (h > 23) h = 23;
  return `${pad(h)}:${m}`;
}

export function assignSlotCodes(slotList = []) {
  const sorted = [...slotList].sort((a, b) => {
    const timeA = String(a.start_time || '00:00').slice(0, 5);
    const timeB = String(b.start_time || '00:00').slice(0, 5);
    const cmp = timeA.localeCompare(timeB);
    if (cmp !== 0) return cmp;
    const endA = String(a.end_time || '00:00').slice(0, 5);
    const endB = String(b.end_time || '00:00').slice(0, 5);
    return endA.localeCompare(endB);
  });

  let morningCount = 0;
  let afternoonCount = 0;
  let eveningCount = 0;

  const codeMap = new Map();

  for (const s of sorted) {
    const hour = Number(String(s.start_time || '08:00').split(':')[0]);
    let code = '';
    let tone = 'is-morning';
    if (hour < 12) {
      code = `Morning ${LETTERS[morningCount % LETTERS.length]}`;
      morningCount++;
      tone = 'is-morning';
    } else if (hour < 18) {
      code = `Afternoon ${LETTERS[afternoonCount % LETTERS.length]}`;
      afternoonCount++;
      tone = 'is-afternoon';
    } else {
      code = `Evening ${LETTERS[eveningCount % LETTERS.length]}`;
      eveningCount++;
      tone = 'is-evening';
    }
    codeMap.set(s.id, { code, tone });
  }

  return { sorted, codeMap };
}

export function previewSlotCode(newStartTime, existingSlots = [], editingSlotId = null) {
  if (!newStartTime) return { code: 'Delivery slot', tone: 'is-morning' };
  const remaining = existingSlots.filter((s) => s.id !== editingSlotId);
  const temp = [...remaining, { id: '__preview__', start_time: newStartTime }];
  const { codeMap } = assignSlotCodes(temp);
  return codeMap.get('__preview__') || { code: 'Delivery slot', tone: 'is-morning' };
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
    let startVal = slot?.start_time ? String(slot.start_time).slice(0, 5) : '08:00';
    let endVal = slot?.end_time ? String(slot.end_time).slice(0, 5) : '11:00';
    const initialAutoLabel = generateSlotWindowLabel(startVal, endVal);
    let labelVal = slot?.label || initialAutoLabel;
    let autoSyncLabel = !slot || slot.label === initialAutoLabel;

    const timeOptions = generateTimeOptions();
    const startOptionsHtml = timeOptions
      .map((opt) => `<option value="${opt.val}" ${opt.val === startVal ? 'selected' : ''}>${opt.label}</option>`)
      .join('');
    const endOptionsHtml = timeOptions
      .map((opt) => `<option value="${opt.val}" ${opt.val === endVal ? 'selected' : ''}>${opt.label}</option>`)
      .join('');

    const initialPreview = previewSlotCode(startVal, slots, slot?.id);

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="slot-modal-title" style="max-width: 520px;">
        <div class="modal-header">
          <h3 class="modal-title" id="slot-modal-title">${isEdit ? 'Edit time slot' : 'Add delivery time slot'}</h3>
          <button type="button" class="modal-close" data-close aria-label="Close">×</button>
        </div>
        <form id="slot-modal-form">
          <div class="modal-body stack" style="gap: 14px;">
            
            <!-- Dynamic Slot Preview Banner -->
            <div class="slot-banner">
              <div class="slot-banner-left">
                <span class="slot-banner-badge" id="slot-preview-code">${escapeHtml(initialPreview.code)}</span>
                <div>
                  <strong class="slot-banner-title" id="slot-preview-time">${escapeHtml(initialAutoLabel)}</strong>
                  <p class="slot-banner-sub" id="slot-preview-sub">Assigned automatically by chronological start time</p>
                </div>
              </div>
            </div>

            <!-- Quick Window Presets (1-Click Selection) -->
            <div class="field" style="margin-bottom: 2px;">
              <label class="label" style="margin-bottom: 4px;">Quick delivery window presets</label>
              <div class="slot-preset-pills">
                <button type="button" class="slot-preset-btn" data-start="08:00" data-end="11:00">Morning (8 AM – 11 AM)</button>
                <button type="button" class="slot-preset-btn" data-start="10:00" data-end="13:00">Midday (10 AM – 1 PM)</button>
                <button type="button" class="slot-preset-btn" data-start="13:00" data-end="16:00">Afternoon (1 PM – 4 PM)</button>
                <button type="button" class="slot-preset-btn" data-start="16:00" data-end="19:00">Late (4 PM – 7 PM)</button>
                <button type="button" class="slot-preset-btn" data-start="18:00" data-end="21:00">Evening (6 PM – 9 PM)</button>
              </div>
            </div>

            <!-- Start & End Time Controls -->
            <div class="form-row">
              <div class="field">
                <label class="label" for="slot-start-select">Start time</label>
                <select class="select" id="slot-start-select">
                  ${startOptionsHtml}
                </select>
                <input class="input" id="slot-start" name="startTime" type="time" value="${escapeHtml(startVal)}" style="margin-top: 6px; font-size: 13px;" required />
              </div>
              <div class="field">
                <label class="label" for="slot-end-select">End time</label>
                <select class="select" id="slot-end-select">
                  ${endOptionsHtml}
                </select>
                <input class="input" id="slot-end" name="endTime" type="time" value="${escapeHtml(endVal)}" style="margin-top: 6px; font-size: 13px;" required />
                <div class="slot-duration-pills">
                  <span style="font-size: 11px; color: #64748b; align-self: center;">Duration:</span>
                  <button type="button" class="slot-duration-btn" data-hours="1">+1 hr</button>
                  <button type="button" class="slot-duration-btn" data-hours="2">+2 hrs</button>
                  <button type="button" class="slot-duration-btn" data-hours="3">+3 hrs</button>
                  <button type="button" class="slot-duration-btn" data-hours="4">+4 hrs</button>
                </div>
              </div>
            </div>

            <!-- Automated Display Window Label -->
            <div class="field">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                <label class="label" for="slot-label" style="margin: 0;">Display window label</label>
                <label class="check" style="margin: 0; font-size: 11.5px; font-weight: 600; color: #1d5bd6; cursor: pointer;">
                  <input type="checkbox" id="slot-auto-sync-chk" ${autoSyncLabel ? 'checked' : ''} style="margin-right: 4px;">
                  Auto-format from time
                </label>
              </div>
              <input class="input" id="slot-label" name="label" type="text" value="${escapeHtml(labelVal)}" placeholder="e.g. 8:00 AM – 11:00 AM" required />
              <p class="field-hint" style="margin-top: 4px;">This is the label displayed to customers when ordering.</p>
            </div>

            <!-- Capacity & Active Switch -->
            <div class="form-row">
              <div class="field">
                <label class="label" for="slot-max">Max orders per day</label>
                <input class="input" id="slot-max" name="maxOrders" type="number" min="1" step="1" value="${escapeHtml(slot?.max_orders ?? 10)}" required />
              </div>
              <div class="field">
                <label class="label" for="slot-active">Status</label>
                <select class="select" id="slot-active" name="isActive">
                  <option value="true" ${slot?.is_active !== false ? 'selected' : ''}>Enabled (Active)</option>
                  <option value="false" ${slot?.is_active === false ? 'selected' : ''}>Disabled (Inactive)</option>
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
    const startSelect = backdrop.querySelector('#slot-start-select');
    const startInput = backdrop.querySelector('#slot-start');
    const endSelect = backdrop.querySelector('#slot-end-select');
    const endInput = backdrop.querySelector('#slot-end');
    const labelInput = backdrop.querySelector('#slot-label');
    const autoSyncChk = backdrop.querySelector('#slot-auto-sync-chk');
    const previewCodeEl = backdrop.querySelector('#slot-preview-code');
    const previewTimeEl = backdrop.querySelector('#slot-preview-time');

    function syncState(newStart, newEnd) {
      startVal = newStart;
      endVal = newEnd;

      startInput.value = startVal;
      endInput.value = endVal;

      if (startSelect.querySelector(`option[value="${startVal}"]`)) {
        startSelect.value = startVal;
      }
      if (endSelect.querySelector(`option[value="${endVal}"]`)) {
        endSelect.value = endVal;
      }

      const generatedLabel = generateSlotWindowLabel(startVal, endVal);
      if (autoSyncChk.checked) {
        labelInput.value = generatedLabel;
      }

      const preview = previewSlotCode(startVal, slots, slot?.id);
      if (previewCodeEl) previewCodeEl.textContent = preview.code;
      if (previewTimeEl) previewTimeEl.textContent = generatedLabel;
    }

    // Start time change
    startSelect.addEventListener('change', () => {
      const s = startSelect.value;
      let e = endInput.value;
      if (e <= s) {
        e = addHoursToTime(s, 2);
      }
      syncState(s, e);
    });
    startInput.addEventListener('input', () => {
      const s = startInput.value;
      let e = endInput.value;
      if (s && e <= s) {
        e = addHoursToTime(s, 2);
      }
      syncState(s, e);
    });

    // End time change
    endSelect.addEventListener('change', () => {
      syncState(startInput.value, endSelect.value);
    });
    endInput.addEventListener('input', () => {
      syncState(startInput.value, endInput.value);
    });

    // Duration button click
    backdrop.querySelectorAll('.slot-duration-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const hours = Number(btn.dataset.hours || 2);
        const curStart = startInput.value || '08:00';
        const newEnd = addHoursToTime(curStart, hours);
        syncState(curStart, newEnd);
      });
    });

    // Preset button click
    backdrop.querySelectorAll('.slot-preset-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        backdrop.querySelectorAll('.slot-preset-btn').forEach((b) => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        const pStart = btn.dataset.start;
        const pEnd = btn.dataset.end;
        syncState(pStart, pEnd);
      });
    });

    // Manual typing on label unchecks auto-sync
    labelInput.addEventListener('input', () => {
      autoSyncChk.checked = false;
    });

    autoSyncChk.addEventListener('change', () => {
      if (autoSyncChk.checked) {
        labelInput.value = generateSlotWindowLabel(startInput.value, endInput.value);
      }
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const sTime = fd.get('startTime');
      const eTime = fd.get('endTime');

      if (!sTime || !eTime) {
        showToast('Please enter both start and end times.', 'error');
        return;
      }
      if (eTime <= sTime) {
        showToast('End time must be later than start time.', 'error');
        endInput.focus();
        return;
      }

      setBusy(submitBtn, true, 'Saving...');
      try {
        await saveTimeSlot({
          id: slot?.id || null,
          label: fd.get('label'),
          startTime: sTime,
          endTime: eTime,
          maxOrders: Number(fd.get('maxOrders')),
          isActive: fd.get('isActive') === 'true',
        });
        showToast(isEdit ? 'Time slot updated.' : 'Time slot added successfully.', 'success');
        close();
        await loadSlots();
      } catch (err) {
        showToast(err.message || 'Could not save time slot.', 'error');
        setBusy(submitBtn, false);
      }
    });
  }

  function renderView() {
    const { sorted: sortedSlots, codeMap } = assignSlotCodes(slots);

    const enabledSlots = sortedSlots.filter((s) => s.is_active && !s.is_closed_today);
    const dailyCapacity = enabledSlots.reduce((sum, s) => sum + Number(s.max_orders || 0), 0);
    const ordersToday = sortedSlots.reduce((sum, s) => sum + Number(s.orders_count || 0), 0);
    const fullSlots = enabledSlots.filter(
      (s) => Number(s.orders_count || 0) >= Number(s.max_orders || 1)
    ).length;

    const rowsHtml =
      sortedSlots.length === 0
        ? `<tr><td colspan="7" class="text-muted" style="text-align:center; padding: 28px;">No time slots configured.</td></tr>`
        : sortedSlots
            .map((slot) => {
              const codeInfo = codeMap.get(slot.id) || { code: 'Slot', tone: 'is-morning' };
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
              const canonicalWindow = generateSlotWindowLabel(slot.start_time, slot.end_time);
              const isCustomLabel = slot.label && slot.label.trim() !== canonicalWindow.trim();

              return `
                <tr>
                  <td>
                    <span class="slot-code-badge">${escapeHtml(codeInfo.code)}</span>
                  </td>
                  <td>
                    <strong style="color: #0f172a;">${escapeHtml(canonicalWindow || slot.label)}</strong>
                    ${isCustomLabel ? `<span class="slot-custom-tag">Label: ${escapeHtml(slot.label)}</span>` : ''}
                  </td>
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
                      <button type="button" class="btn btn-outline-danger btn-sm" data-delete-slot="${escapeHtml(slot.id)}" title="Delete time slot">
                        Delete
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
            <div class="stat-value">${enabledSlots.length} <span style="font-size: 16px; font-weight: 500; color: var(--text-muted);">of ${sortedSlots.length}</span></div>
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
                  <th style="min-width: 130px;">Slot</th>
                  <th style="min-width: 170px;">Delivery Window</th>
                  <th>Capacity</th>
                  <th>Orders today</th>
                  <th>Status</th>
                  <th>Enabled</th>
                  <th style="min-width: 220px;">Actions</th>
                </tr>
              </thead>
              <tbody>
                ${rowsHtml}
              </tbody>
            </table>
          </div>
          <div class="dash-pending-note" style="margin-top: 16px;">
            Changes apply to new orders immediately. Delivery windows are automatically sequenced chronologically from earliest to latest.
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
            message: 'This delivery window will be deactivated and hidden from customers permanently until re-enabled.',
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
            message: "Customers will no longer be able to select this delivery window for today's orders.",
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

    content.querySelectorAll('[data-delete-slot]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-delete-slot');
        const slot = slots.find((s) => s.id === id);
        if (!slot) return;

        const confirmed = await confirmModal({
          title: `Delete time slot "${slot.label}"?`,
          message: 'Are you sure you want to remove this delivery window? If customers already booked orders in this slot, it will be safely deactivated.',
          confirmText: 'Delete slot',
          cancelText: 'Cancel',
          danger: true,
        });
        if (!confirmed) return;

        setBusy(btn, true, 'Deleting...');
        try {
          await deleteTimeSlot(slot.id);
          showToast('Time slot removed.', 'success');
          await loadSlots();
        } catch (err) {
          showToast(err.message || 'Could not delete slot.', 'error');
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
