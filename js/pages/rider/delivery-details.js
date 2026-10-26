import { bootRiderPage, navigateRiderSpa, renderNav } from '../../core/nav.js';
import { STATUS_LABELS } from '../../core/constants.js';
import { subscribeRiderWorkspace } from '../../core/realtime.js';
import {
  confirmModal,
  escapeHtml,
  formatDateShort,
  formatPeso,
  getTodayManila,
  setBusy,
  showToast,
} from '../../core/ui.js';
import {
  checkOrderDeliveryTiming,
  formatAddressFull,
  formatSlotWindow,
  getEffectiveSlot,
  getOrderItemPricingTag,
  isSlotAdjusted,
  promptDeliveryTimingModal,
  recordDeliveryTimingNote,
} from '../../services/ordersService.js';
import {
  getRiderCurrentOrder,
  riderRecordAttempt,
  riderStartDelivery,
} from '../../services/deliveryService.js';

const CHECK_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
const MAP_PIN_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px;"><path d="M12 21s-7-5.6-7-11a7 7 0 1 1 14 0c0 5.4-7 11-7 11Z"/><circle cx="12" cy="10" r="2.5"/></svg>`;

export async function mount(me) {
  const pageTitle = document.querySelector('#page-title') || document.querySelector('.topbar h1');
  const pageSub = document.querySelector('#page-sub') || document.querySelector('.topbar-sub');
  const topbarRight = document.querySelector('#topbar-right');
  const content = document.querySelector('#content');

  const params = new URLSearchParams(window.location.search);
  let targetOrderId = params.get('id');

  if (topbarRight) {
    topbarRight.innerHTML = `<a class="btn btn-light btn-sm" href="my-deliveries.html">← My deliveries</a>`;
  }

  async function renderPage() {
    try {
      const order = await getRiderCurrentOrder(me.id, targetOrderId);
      if (!order) {
        if (pageTitle) pageTitle.textContent = 'Current delivery';
        if (pageSub) pageSub.textContent = 'No active delivery assigned right now.';
        content.innerHTML = `
          <div class="card empty-state">
            <h3>No active delivery selected</h3>
            <p>When station staff assign a ready order to you, its details and address will appear here.</p>
            <div style="margin-top: 16px;">
              <a class="btn btn-primary" href="my-deliveries.html">Back to My deliveries</a>
            </div>
          </div>
        `;
        return;
      }

      targetOrderId = order.id;
      const isToday = order.delivery_date === getTodayManila();
      const dateLabel = isToday ? 'Today' : formatDateShort(order.delivery_date);

      if (pageTitle) pageTitle.textContent = `Order #${order.order_number}`;
      if (pageSub) {
        pageSub.textContent = `${STATUS_LABELS[order.status] || order.status} · ${dateLabel}`;
      }

      const customerName = order.customer?.full_name || 'Customer';
      const customerPhone = order.customer?.phone || '—';
      const fullAddress = formatAddressFull(order.address);
      const barangayBadge =
        order.address?.barangay && order.address.barangay !== 'N/A'
          ? `Brgy. ${order.address.barangay.replace(/^Brgy\.?\s*/i, '')}`
          : order.address?.city || 'Delivery';

      const effectiveSlotText = formatSlotWindow(getEffectiveSlot(order));
      const preferredSlotText = formatSlotWindow(order.preferred_slot);
      const adjusted = isSlotAdjusted(order);

      const itemsRowsHtml = (order.items || [])
        .map((item) => {
          const name = (item.product?.name || 'Gallon Refill')
            .replace(/Purified Water Refill\s*\((.+)\)/i, '$1 Refill')
            .replace(/Mineral Water Refill\s*\((.+)\)/i, 'Mineral $1 Refill');
          const qty = Number(item.quantity || 0);
          const unitPrice = Number(item.unit_price || 0);
          const pricingTag = getOrderItemPricingTag(item);
          return `
            <tr>
              <td>${escapeHtml(name)} (${escapeHtml(pricingTag)}) · ${escapeHtml(formatPeso(unitPrice))} each</td>
              <td>${escapeHtml(qty)}</td>
              <td class="table-strong" style="text-align:right;">${escapeHtml(formatPeso(qty * unitPrice))}</td>
            </tr>
          `;
        })
        .join('');

      const step1Done = ['rider_assigned', 'out_for_delivery', 'delivered', 'completed'].includes(
        order.status
      );
      const step2Done = ['out_for_delivery', 'delivered', 'completed'].includes(order.status);
      const step3Done = ['delivered', 'completed'].includes(order.status);

      let actionBtnHtml = '';
      if (order.status === 'rider_assigned') {
        actionBtnHtml = `
          <button type="button" class="btn btn-primary btn-block" id="start-delivery-btn">Start delivery</button>
          <p class="proc-action-hint" style="text-align:center; margin-top:8px;">Changes the status to Out for delivery</p>
        `;
      } else if (order.status === 'out_for_delivery') {
        actionBtnHtml = `
          <a class="btn btn-primary btn-block" href="complete-delivery.html?id=${encodeURIComponent(order.id)}">Complete delivery</a>
          <button type="button" class="btn btn-outline-danger btn-block" id="report-attempt-btn" style="margin-top: 8px;">Cannot Deliver / Report Issue</button>
          <p class="proc-action-hint" style="text-align:center; margin-top:8px;">Enter bottle counts at door or report if customer is unavailable</p>
        `;
      } else if (order.status === 'attempted' || String(order.slot_note || '').startsWith('[ATTEMPTED]')) {
        actionBtnHtml = `
          <div class="notice notice-warning" style="margin-bottom: 8px;">
            <strong>Delivery Attempted:</strong> ${escapeHtml(order.slot_note || 'Customer was unavailable.')}
          </div>
          <button type="button" class="btn btn-light btn-block" disabled>Delivery attempted</button>
        `;
      } else {
        actionBtnHtml = `
          <button type="button" class="btn btn-primary btn-block" disabled>Delivery completed</button>
        `;
      }

      content.innerHTML = `
        <div class="grid-split">
          <div class="stack">
            <div class="card">
              <div class="card-header">
                <h2 class="card-title">Customer</h2>
                <span class="pill pill-blue">${escapeHtml(barangayBadge)}</span>
              </div>

              <div class="rider-cust-grid">
                <div>
                  <p class="rider-field-caption">Name</p>
                  <p class="rider-field-value">${escapeHtml(customerName)}</p>
                </div>
                <div>
                  <p class="rider-field-caption">Contact</p>
                  <p class="rider-field-value">${escapeHtml(customerPhone)}</p>
                </div>
              </div>

              <div>
                <p class="rider-field-caption">Address</p>
                <p class="rider-field-value">${escapeHtml(fullAddress)}</p>
                ${
                  order.address?.landmark
                    ? `<p class="rider-landmark">Landmark: ${escapeHtml(order.address.landmark)}</p>`
                    : ''
                }
                <div style="margin-top: 10px;">
                  <a
                    class="btn btn-outline-blue btn-sm"
                    href="${
                      order.address?.latitude && order.address?.longitude
                        ? `https://www.google.com/maps/search/?api=1&query=${order.address.latitude},${order.address.longitude}`
                        : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddress)}`
                    }"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    ${MAP_PIN_SVG} Open in Google Maps
                  </a>
                </div>
              </div>
            </div>

            <div class="card">
              <div class="card-header">
                <h2 class="card-title">Items</h2>
              </div>

              <div class="table-wrap">
                <table class="table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Qty</th>
                      <th style="text-align:right;">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${itemsRowsHtml}
                    <tr>
                      <td>Delivery service charge</td>
                      <td>1</td>
                      <td class="table-strong" style="text-align:right;">${escapeHtml(formatPeso(order.service_charge))}</td>
                    </tr>
                    <tr>
                      <td class="table-strong" colspan="2">Cash to collect</td>
                      <td class="rider-cash-total" style="text-align:right;">${escapeHtml(formatPeso(order.total))}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div class="card">
              <div class="card-header">
                <h2 class="card-title">Customer note</h2>
              </div>
              <p style="font-size:13.5px; color:var(--muted-blue); line-height:1.5;">
                ${escapeHtml(order.notes || 'No special delivery instructions provided.')}
              </p>
            </div>
          </div>

          <div class="stack">
            <div class="card">
              <div class="card-header">
                <h2 class="card-title">Delivery window</h2>
              </div>
              <p class="rider-window-big">${escapeHtml(effectiveSlotText)}</p>
              ${
                adjusted
                  ? `<div class="notice notice-warning">Staff adjusted this window. Customer preferred ${escapeHtml(preferredSlotText)}.</div>`
                  : `<div class="notice">Scheduled delivery window for ${escapeHtml(dateLabel.toLowerCase())}.</div>`
              }
            </div>

            <div class="card">
              <div class="card-header">
                <h2 class="card-title">Progress</h2>
              </div>

              <div class="rider-progress-list">
                <div class="rider-progress-step ${step1Done ? 'is-done' : ''}">
                  <span class="checklist-circle" style="${step1Done ? 'background:var(--blue-app);border-color:var(--blue-app);color:#fff;' : ''}">${CHECK_SVG}</span>
                  <span>Rider assigned</span>
                </div>
                <div class="rider-progress-step ${step2Done ? 'is-done' : ''}">
                  <span class="checklist-circle" style="${step2Done ? 'background:var(--blue-app);border-color:var(--blue-app);color:#fff;' : ''}">${CHECK_SVG}</span>
                  <span>Out for delivery</span>
                </div>
                <div class="rider-progress-step ${step3Done ? 'is-done' : ''}">
                  <span class="checklist-circle" style="${step3Done ? 'background:var(--blue-app);border-color:var(--blue-app);color:#fff;' : ''}">${CHECK_SVG}</span>
                  <span>Delivered</span>
                </div>
              </div>

              ${actionBtnHtml}
            </div>
          </div>
        </div>
      `;

      document.querySelector('#start-delivery-btn')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        const timing = checkOrderDeliveryTiming(order);
        let timingReason = null;

        if (timing.isEarly || timing.isLate) {
          const res = await promptDeliveryTimingModal({
            actionType: 'depart',
            timing,
            order,
          });
          if (!res.confirmed) return;
          timingReason = res.reason;
        }

        setBusy(btn, true, 'Starting delivery...');
        try {
          if (timingReason) {
            await recordDeliveryTimingNote(order.id, 'depart', timingReason, timing);
          }
          await riderStartDelivery(order.id);
          showToast('Status updated to Out for delivery!', 'success');
          await renderNav(me, 'delivery-details');
          await renderPage();
        } catch (err) {
          showToast(err.message || 'Could not start delivery.', 'error');
          setBusy(btn, false);
        }
      });

      document.querySelector('#report-attempt-btn')?.addEventListener('click', () => {
        const modalBackdrop = document.createElement('div');
        modalBackdrop.className = 'modal-backdrop';
        modalBackdrop.innerHTML = `
          <div class="modal-card" style="max-width: 440px;">
            <div class="modal-header">
              <h3 class="modal-title">Report Delivery Issue</h3>
              <button type="button" class="modal-close" data-action="cancel">×</button>
            </div>
            <div class="modal-body stack" style="gap: 12px;">
              <p style="font-size: 13.5px; color: var(--muted-blue); line-height: 1.45;">
                Select why Order #${escapeHtml(order.order_number)} could not be completed. The customer will be prompted to reschedule.
              </p>
              <div class="field">
                <label class="field-label">Reason</label>
                <div class="stack" style="gap: 8px;">
                  <label style="display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer;">
                    <input type="radio" name="attempt-reason" value="Customer not answering gate or phone" checked>
                    <span>Customer not answering gate or phone</span>
                  </label>
                  <label style="display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer;">
                    <input type="radio" name="attempt-reason" value="Gate locked / Nobody home">
                    <span>Gate locked / Nobody home</span>
                  </label>
                  <label style="display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer;">
                    <input type="radio" name="attempt-reason" value="No empty bottle ready to swap">
                    <span>No empty bottle ready for 1-to-1 swap</span>
                  </label>
                  <label style="display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer;">
                    <input type="radio" name="attempt-reason" value="Customer requested later delivery">
                    <span>Customer requested later delivery</span>
                  </label>
                </div>
              </div>
              <div class="field">
                <label class="field-label" for="attempt-note">Optional note</label>
                <input class="input" id="attempt-note" placeholder="e.g. Waited 10 mins, called twice">
              </div>
            </div>
            <div class="modal-actions" style="margin-top: 14px; display: flex; gap: 8px; justify-content: flex-end;">
              <button type="button" class="btn btn-light" data-action="cancel">Cancel</button>
              <button type="button" class="btn btn-danger" data-action="submit">Mark Attempted</button>
            </div>
          </div>
        `;

        document.body.appendChild(modalBackdrop);

        const close = () => modalBackdrop.remove();
        modalBackdrop.querySelectorAll('[data-action="cancel"]').forEach((b) => b.addEventListener('click', close));

        modalBackdrop.querySelector('[data-action="submit"]')?.addEventListener('click', async (e) => {
          const selectedReason = modalBackdrop.querySelector('input[name="attempt-reason"]:checked')?.value || 'Customer unavailable';
          const noteVal = modalBackdrop.querySelector('#attempt-note')?.value || '';

          const confirmed = await confirmModal({
            title: 'Confirm Delivery Attempted?',
            message: `Mark Order #${order.order_number} as Attempted (${selectedReason})? Customer will receive a notification to reschedule.`,
            confirmText: 'Yes, mark attempted',
            cancelText: 'Back',
            danger: true,
          });
          if (!confirmed) return;

          setBusy(e.currentTarget, true, 'Saving...');
          try {
            await riderRecordAttempt({ orderId: order.id, reason: selectedReason, note: noteVal });
            showToast('Delivery attempt recorded. Order held for customer rescheduling.', 'success');
            close();
            await renderNav(me, 'delivery-details');
            await renderPage();
          } catch (err) {
            showToast(err.message || 'Could not record attempt.', 'error');
            setBusy(e.currentTarget, false);
          }
        });
      });
    } catch (err) {
      showToast(err.message || 'Could not load delivery details.', 'error');
    }
  }

  await renderPage();
  const unsub = subscribeRiderWorkspace(me.id, renderPage);
  const pollTimer = setInterval(() => {
    if (document.visibilityState === 'visible') {
      renderPage();
    }
  }, 4000);

  return () => {
    clearInterval(pollTimer);
    unsub();
  };
}

bootRiderPage('delivery-details', mount);
