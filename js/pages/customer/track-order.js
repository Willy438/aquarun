import { bootCustomerPage, renderNav } from '../../core/nav.js';
import { STATUS_LABELS } from '../../core/constants.js';
import { subscribeCustomerOrders } from '../../core/realtime.js';
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
  cancelOrder,
  formatAddressLine,
  formatSlotWindow,
  getCustomerActiveOrders,
  getCustomerOrderById,
  getCustomerOrders,
  getEffectiveSlot,
  getOrderItemPricingTag,
  isOrderItemNewContainer,
  isSlotAdjusted,
  renderCustomerOrderHero,
  rescheduleOrder,
  summarizeOrderItems,
} from '../../services/ordersService.js';
import { getCustomerBottleBalance } from '../../services/ledgerService.js';
import { getSlotAvailability } from '../../services/slotsService.js';

const ICONS = {
  pin: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-5.6-7-11a7 7 0 1 1 14 0c0 5.4-7 11-7 11Z"/><circle cx="12" cy="10" r="2.5"/></svg>`,
  clock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`,
  alert: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
};

export async function mount(me) {
  const content = document.querySelector('#content');
  const rightEl = document.querySelector('#topbar-right');
  const params = new URLSearchParams(window.location.search);
  let currentOrderId = params.get('id');

  async function renderPage() {
    try {
      const activeOrders = await getCustomerActiveOrders(me.id, { forceRefresh: true });
      let order = null;
      let pastTerminalOrder = null;

      if (currentOrderId) {
        order = activeOrders.find((o) => o.id === currentOrderId);
        if (!order) {
          // Check if this was a completed or cancelled past order
          const found = await getCustomerOrderById(me.id, currentOrderId, { forceRefresh: true }).catch(() => null);
          if (found && ['completed', 'cancelled'].includes(found.status)) {
            pastTerminalOrder = found;
          }
        }
      }

      // If customer has active orders and tried to track a past/cancelled order or visited with no ID,
      // default to tracking their active order!
      if (!order && activeOrders.length > 0) {
        order = activeOrders[0];
        currentOrderId = order.id;
        window.history.replaceState({}, '', `track-order.html?id=${encodeURIComponent(order.id)}`);
      }

      if (rightEl) {
        if (activeOrders.length > 1 && order) {
          rightEl.innerHTML = `
            <div class="admin-seg-group" role="tablist" aria-label="Switch active order">
              ${activeOrders
                .map(
                  (o) => `
                  <button
                    type="button"
                    class="admin-seg-btn${o.id === order.id ? ' is-active' : ''}"
                    data-switch-order="${escapeHtml(o.id)}"
                  >
                    #${escapeHtml(o.order_number)}
                  </button>
                `
                )
                .join('')}
            </div>
          `;
          rightEl.querySelectorAll('[data-switch-order]').forEach((btn) => {
            btn.addEventListener('click', () => {
              const nextId = btn.getAttribute('data-switch-order');
              if (!nextId || nextId === currentOrderId) return;
              currentOrderId = nextId;
              window.history.replaceState({}, '', `track-order.html?id=${encodeURIComponent(nextId)}`);
              renderPage();
            });
          });
        } else {
          rightEl.innerHTML = '';
        }
      }

      // If customer has NO active orders and opened a past/cancelled order
      if (!order && pastTerminalOrder) {
        const isCancelled = pastTerminalOrder.status === 'cancelled';
        content.innerHTML = `
          ${renderCustomerOrderHero(pastTerminalOrder, { showTrackButton: false })}

          <div class="card" style="padding: 12px 18px; margin-top: 14px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff;">
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;">
              <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                <span class="pill ${isCancelled ? 'pill-danger' : 'pill-green'}" style="font-size: 11.5px;">
                  ${isCancelled ? 'Cancelled' : 'Completed'}
                </span>
                <span style="font-size: 13.5px; font-weight: 700; color: var(--ink-navy);">
                  Order #${escapeHtml(pastTerminalOrder.order_number)}
                </span>
                <span style="font-size: 12.5px; color: var(--muted-blue);">
                  ${
                    isCancelled
                      ? 'Order was cancelled.'
                      : `Delivered on ${escapeHtml(formatDateShort(pastTerminalOrder.delivered_at || pastTerminalOrder.delivery_date))}.`
                  }
                </span>
              </div>
              <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
                <a class="btn btn-primary btn-sm" href="new-order.html">Place refill order</a>
                <a class="btn btn-light btn-sm" href="order-history.html?viewOrder=${encodeURIComponent(pastTerminalOrder.id)}">View full receipt</a>
              </div>
            </div>
          </div>
        `;
        return;
      }

      if (!order) {
        content.innerHTML = `
          <div class="card empty-state">
            <h3>No active orders to track</h3>
            <p>You don't have any refill deliveries in progress right now. Place a new order or check your past receipts in Order history.</p>
            <div style="margin-top: 16px; display: flex; flex-wrap: wrap; gap: 10px; justify-content: center;">
              <a class="btn btn-primary" href="new-order.html">Place a refill order</a>
              <a class="btn btn-light" href="order-history.html">Order history</a>
            </div>
          </div>
        `;
        return;
      }

      const showSwitcherBar = activeOrders.length > 1;

      const switcherHtml = showSwitcherBar
        ? `
          <div class="track-switcher-bar" role="region" aria-label="Active orders shortcut">
            <div class="track-switcher-head">
              <span>Active orders</span>
              <span class="track-switcher-count">${activeOrders.length}</span>
            </div>
            <div class="track-switcher-list">
              ${activeOrders
                .map((o) => {
                  const isCurrent = o.id === order.id;
                  return `
                    <button
                      type="button"
                      class="track-switcher-btn${isCurrent ? ' is-active' : ''}"
                      data-switch-order="${escapeHtml(o.id)}"
                    >
                      <span class="track-switcher-order">#${escapeHtml(o.order_number)}</span>
                      <span class="track-switcher-meta">${escapeHtml(summarizeOrderItems(o.items))}</span>
                      <span class="pill status-${escapeHtml(o.status)}">${escapeHtml(STATUS_LABELS[o.status] || o.status)}</span>
                    </button>
                  `;
                })
                .join('')}
            </div>
          </div>
        `
        : '';

      const noticeRedirectHtml = pastTerminalOrder
        ? `
          <div class="notice notice-info" style="margin-bottom: 14px;">
            Order #${escapeHtml(pastTerminalOrder.order_number)} is ${escapeHtml(pastTerminalOrder.status)}. Tracking your active order #${escapeHtml(order.order_number)}.
            <a href="order-history.html?viewOrder=${encodeURIComponent(pastTerminalOrder.id)}" style="font-weight: 700; margin-left: 6px;">View receipt in Order history →</a>
          </div>
        `
        : '';

      const preferredWindow = formatSlotWindow(order.preferred_slot);
      const expectedWindow = formatSlotWindow(getEffectiveSlot(order));
      const adjusted = isSlotAdjusted(order);
      const canCancel = order.status === 'submitted';
      const riderName = order.rider?.full_name || 'Assigned rider';
      const firstName = riderName.split(/\s+/)[0];
      // Swap model: count returnable gallons split between 1-to-1 swaps and new gallon + water.
      let returnableGallons = 0;
      let swapGallons = 0;
      let newContainerGallons = 0;
      for (const item of order.items || []) {
        const qty = Number(item.quantity || 0);
        if (item.product?.is_returnable !== false) {
          returnableGallons += qty;
          if (isOrderItemNewContainer(item)) {
            newContainerGallons += qty;
          } else {
            swapGallons += qty;
          }
        }
      }
      const gallonText = `${returnableGallons} filled ${returnableGallons === 1 ? 'gallon' : 'gallons'}`;

      // Use only data the customer can already read. If a lookup fails, fall back to neutral text.
      const [balanceInfo, pastOrders] = await Promise.all([
        getCustomerBottleBalance(me.id).catch(() => null),
        getCustomerOrders(me.id, { limit: 50 }).catch(() => null),
      ]);
      const currentBalance = balanceInfo ? Number(balanceInfo.balance ?? 0) : null;
      const hasEarlierDelivery = Array.isArray(pastOrders)
        ? pastOrders.some(
            (o) =>
              o.id !== order.id &&
              (o.status === 'delivered' || o.status === 'completed' || Boolean(o.delivered_at))
          )
        : null;

      let handoverText;
      if (returnableGallons === 0) {
        handoverText = 'The rider hands over your items. No empty gallons needed.';
      } else if (swapGallons > 0 && newContainerGallons > 0) {
        const emptyWord = swapGallons === 1 ? '1 empty gallon' : `${swapGallons} empty gallons`;
        const newWord = newContainerGallons === 1 ? '1 new gallon' : `${newContainerGallons} new gallons`;
        handoverText = `The rider hands over ${gallonText} (${swapGallons} swap + ${newWord}) and collects ${emptyWord}.`;
      } else if (newContainerGallons > 0 && swapGallons === 0) {
        handoverText = `The rider hands over ${gallonText} (new gallon + water). No empty gallons needed for this order.`;
      } else if (currentBalance !== null && currentBalance > 0) {
        const expectedCollect = Math.min(swapGallons, currentBalance);
        const emptyWord = expectedCollect === 1 ? '1 empty gallon' : `${expectedCollect} empty gallons`;
        handoverText = `The rider hands over ${gallonText} and collects ${emptyWord}.`;
      } else if (hasEarlierDelivery === false) {
        handoverText = `The rider hands over ${gallonText}. First order: no empty gallons needed.`;
      } else {
        handoverText = `The rider hands over ${gallonText}.`;
      }

      const itemsBreakdownHtml = (order.items || [])
        .map((it) => {
          const qty = Number(it.quantity || 0);
          const unitPrice = Number(it.unit_price || 0);
          let tag = getOrderItemPricingTag(it);
          if (tag === 'Swap refill' && hasEarlierDelivery === false) {
            tag = '1st order';
          }
          return `
            <div class="kv-row">
              <span class="kv-label">${escapeHtml(`${qty} × ${it.product?.name || 'Refill'} (${tag})`)}</span>
              <span class="kv-value">${escapeHtml(formatPeso(qty * unitPrice))}</span>
            </div>
          `;
        })
        .join('');

      const adjustmentHtml = adjusted
        ? `
          <div class="notice notice-warning">
            ${escapeHtml(
              order.slot_note ||
                'The station adjusted your delivery window because of a high number of orders today.'
            )}
          </div>
        `
        : '';

      const cancelSectionHtml =
        order.status === 'cancelled'
          ? `<div class="notice"><strong>Order cancelled:</strong> This order was cancelled while Submitted.</div>`
          : `
            <div class="notice">
              <strong>Cancel order:</strong> Available only while the order is Submitted.
            </div>
            ${
              canCancel
                ? `<button type="button" class="btn btn-outline-danger track-cancel-btn" id="cancel-order-btn">Cancel order</button>`
                : `<button type="button" class="btn btn-outline-danger track-cancel-btn" disabled>Cancel order</button>`
            }
          `;

      const isAttempted =
        order.status === 'attempted' ||
        String(order.slot_note || '').startsWith('[ATTEMPTED]');

      const attemptedAlertHtml = isAttempted
        ? `
          <div class="card" style="border-left: 4px solid #f59e0b; background: #fffbeb; padding: 16px; margin-bottom: 16px;">
            <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap;">
              <div>
                <h3 style="font-size: 15px; font-weight: 700; color: #92400e; margin: 0 0 4px 0;">
                  ${ICONS.alert} Delivery Attempted — Customer Unavailable
                </h3>
                <p style="font-size: 13px; color: #b45309; margin: 0; line-height: 1.45;">
                  ${escapeHtml(
                    order.slot_note
                      ? order.slot_note.replace('[ATTEMPTED]:', 'Reason:').trim()
                      : 'The rider visited your address but was unable to complete the delivery.'
                  )}
                  <br>Your order is safely held at the station. Please choose a new delivery time window below.
                </p>
              </div>
              <button type="button" class="btn btn-primary" id="track-reschedule-btn" style="background: #d97706; border-color: #d97706; font-weight: 700;">
                Reschedule delivery
              </button>
            </div>
          </div>
        `
        : '';

      content.innerHTML = `
        ${noticeRedirectHtml}
        ${switcherHtml}
        ${attemptedAlertHtml}
        ${renderCustomerOrderHero(order, { showTrackButton: false })}

        <div class="grid-2">
          <div class="card">
            <div class="card-header">
              <div class="card-title-group">
                <span class="card-icon">${ICONS.pin}</span>
                <h2 class="card-title">Order details</h2>
              </div>
            </div>

            <div class="kv-list">
              ${itemsBreakdownHtml}
              <div class="kv-row">
                <span class="kv-label">Delivery address</span>
                <span class="kv-value">${escapeHtml(formatAddressLine(order.address))}</span>
              </div>
              <div class="kv-row">
                <span class="kv-label">Payment</span>
                <span class="kv-value">Cash on delivery</span>
              </div>
              <div class="kv-row">
                <span class="kv-label">Rider</span>
                <span class="kv-value">${escapeHtml(order.rider?.full_name || 'Awaiting assignment')}</span>
              </div>
              <div class="kv-row">
                <span class="kv-label">Your preferred slot</span>
                <span class="kv-value">${escapeHtml(preferredWindow)}</span>
              </div>
              <div class="kv-row">
                <span class="kv-label">Expected delivery window</span>
                <span class="kv-value">${escapeHtml(expectedWindow)}</span>
              </div>
            </div>

            <div class="track-notices">
              ${adjustmentHtml}
              ${cancelSectionHtml}
            </div>
          </div>

          <div class="card">
            <div class="card-header">
              <div class="card-title-group">
                <span class="card-icon">${ICONS.clock}</span>
                <h2 class="card-title">What happens next?</h2>
              </div>
            </div>

            <div class="step-list">
              <div class="step-row">
                <span class="step-num">1</span>
                <span>${escapeHtml(order.rider?.full_name ? firstName : 'Your rider')} arrives at your address in the expected window.</span>
              </div>
              <div class="step-row">
                <span class="step-num">2</span>
                <span>${escapeHtml(handoverText)}</span>
              </div>
              <div class="step-row">
                <span class="step-num">3</span>
                <span>You pay ${escapeHtml(formatPeso(order.total))} in cash.</span>
              </div>
              <div class="step-row">
                <span class="step-num">4</span>
                <span>The order is marked Delivered and your bottle balance updates.</span>
              </div>
            </div>
          </div>
        </div>
      `;

      content.querySelectorAll('[data-switch-order]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const nextId = btn.getAttribute('data-switch-order');
          if (!nextId || nextId === currentOrderId) return;
          currentOrderId = nextId;
          window.history.replaceState({}, '', `track-order.html?id=${encodeURIComponent(nextId)}`);
          renderPage();
        });
      });

      document.querySelector('#cancel-order-btn')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        const confirmed = await confirmModal({
          title: `Cancel Order #${order.order_number}?`,
          message: 'Are you sure you want to cancel this refill order? This action cannot be undone.',
          confirmText: 'Yes, cancel order',
          cancelText: 'Keep order',
          danger: true,
        });
        if (!confirmed) return;

        setBusy(btn, true, 'Cancelling...');
        try {
          await cancelOrder(order.id);
          showToast('Order cancelled.', 'success');
          currentOrderId = null;
          await renderNav(me, 'track-order');
          await renderPage();
        } catch (err) {
          showToast(err.message || 'Could not cancel order.', 'error');
          setBusy(btn, false);
          await renderPage();
        }
      });

      document.querySelector('#track-reschedule-btn')?.addEventListener('click', async () => {
        let rescheduleDate = getTodayManila();
        let availSlots = [];

        async function fetchSlots(d) {
          availSlots = await getSlotAvailability(d).catch(() => []);
        }

        await fetchSlots(rescheduleDate);

        const modalBackdrop = document.createElement('div');
        modalBackdrop.className = 'modal-backdrop';

        function renderModalInner() {
          const now = new Date();
          const currentMinutes = now.getHours() * 60 + now.getMinutes();

          const slotOptions = availSlots.length
            ? availSlots
                .map((s) => {
                  let isPassed = false;
                  if (rescheduleDate === getTodayManila() && s.end_time) {
                    const [h, m] = s.end_time.split(':').map(Number);
                    isPassed = currentMinutes >= (h * 60 + (m || 0));
                  }
                  const disabled = s.is_closed || s.is_full || isPassed;
                  const suffix = s.is_closed ? ' (Closed)' : s.is_full ? ' (Full)' : isPassed ? ' (Window passed)' : '';
                  return `<option value="${escapeHtml(s.slot_id)}"${disabled ? ' disabled' : ''}>${escapeHtml(s.label.replace(/\s*-\s*/g, '–'))}${suffix}</option>`;
                })
                .join('')
            : '<option value="">No slots available</option>';

          modalBackdrop.innerHTML = `
            <div class="modal-card" style="max-width: 440px;">
              <div class="modal-header">
                <h3 class="modal-title">Reschedule Delivery</h3>
                <button type="button" class="modal-close" data-action="cancel">×</button>
              </div>
              <div class="modal-body stack" style="gap: 14px;">
                <p style="font-size: 13.5px; color: var(--muted-blue); line-height: 1.45;">
                  Pick a new date and delivery window for Order #${escapeHtml(order.order_number)}. Your order will return to the station queue.
                </p>
                <div class="field">
                  <label class="field-label" for="resched-date">Delivery date</label>
                  <input class="input" type="date" id="resched-date" min="${getTodayManila()}" value="${rescheduleDate}">
                </div>
                <div class="field">
                  <label class="field-label" for="resched-slot">Preferred delivery window</label>
                  <select class="select" id="resched-slot">
                    ${slotOptions}
                  </select>
                </div>
              </div>
              <div class="modal-actions" style="margin-top: 14px; display: flex; gap: 8px; justify-content: flex-end;">
                <button type="button" class="btn btn-light" data-action="cancel">Cancel</button>
                <button type="button" class="btn btn-primary" data-action="submit" style="font-weight: 700;">Confirm Reschedule</button>
              </div>
            </div>
          `;

          const close = () => modalBackdrop.remove();
          modalBackdrop.querySelectorAll('[data-action="cancel"]').forEach((b) => b.addEventListener('click', close));

          modalBackdrop.querySelector('#resched-date')?.addEventListener('change', async (e) => {
            rescheduleDate = e.target.value;
            await fetchSlots(rescheduleDate);
            renderModalInner();
          });

          modalBackdrop.querySelector('[data-action="submit"]')?.addEventListener('click', async (e) => {
            const slotVal = modalBackdrop.querySelector('#resched-slot')?.value;
            if (!slotVal) {
              showToast('Please pick an available delivery window.', 'error');
              return;
            }
            setBusy(e.currentTarget, true, 'Rescheduling...');
            try {
              await rescheduleOrder({ orderId: order.id, newDate: rescheduleDate, newSlotId: slotVal });
              showToast('Delivery rescheduled! Order returned to station queue.', 'success');
              close();
              await renderNav(me, 'track-order');
              await renderPage();
            } catch (err) {
              showToast(err.message || 'Could not reschedule delivery.', 'error');
              setBusy(e.currentTarget, false);
            }
          });
        }

        renderModalInner();
        document.body.appendChild(modalBackdrop);
      });
    } catch (err) {
      showToast(err.message || 'Could not load order tracking.', 'error');
    }
  }

  await renderPage();
  const unsub = subscribeCustomerOrders(me.id, () => {
    renderPage();
    renderNav(me, 'track-order');
  });

  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      renderPage();
      renderNav(me, 'track-order');
    }
  };
  document.addEventListener('visibilitychange', onVisibilityChange);

  // Responsive near-instant polling fallback (5s) for live tracking
  const pollTimer = setInterval(() => {
    if (document.visibilityState === 'visible') {
      renderPage();
    }
  }, 5000);

  return () => {
    clearInterval(pollTimer);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    unsub();
  };
}

bootCustomerPage('track-order', mount);
