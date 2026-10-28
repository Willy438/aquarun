import { bootStaffPage, renderNav } from '../../core/nav.js';
import { subscribeStaffWorkspace } from '../../core/realtime.js';
import { confirmModal, escapeHtml, formatPeso, setBusy, showToast } from '../../core/ui.js';
import {
  formatSlotWindow,
  getEffectiveSlot,
  getNextOrderForProcessing,
  getOrderItemPricingTag,
  getStaffOrderById,
  renderStaffOrderHero,
  staffAdjustDeliverySlot,
  staffAssignRider,
  staffCancelOrder,
  staffConfirmOrder,
  staffConfirmPayment,
  staffFastTrackAssignRider,
  staffMarkReady,
  staffReassignRider,
  staffStartRefill,
} from '../../services/ordersService.js';
import { getSlotAvailability } from '../../services/slotsService.js';
import { getAllActiveRiders, getAvailableRiders } from '../../services/usersService.js';

const ICONS = {
  cart: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="20" r="1.5"/><circle cx="17" cy="20" r="1.5"/><path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h8.8a2 2 0 0 0 2-1.6L21 7H6"/></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
};

function formatSlotNotes(rawNote) {
  if (!rawNote) return '';
  const str = String(rawNote).trim();
  if (!str) return '';

  const notes = [];
  const earlyDepartMatch = str.match(/\[EARLY_DEPART:\s*([^\]]+)\]/i);
  const lateDepartMatch = str.match(/\[LATE_DEPART:\s*([^\]]+)\]/i);
  const earlyDeliveryMatch = str.match(/\[EARLY_DELIVERY:\s*([^\]]+)\]/i);
  const lateDeliveryMatch = str.match(/\[LATE_DELIVERY:\s*([^\]]+)\]/i);
  const isRemitSubmitted = /\[REMITTANCE_SUBMITTED\]/i.test(str);

  if (earlyDepartMatch) {
    notes.push({ label: 'Early departure', text: earlyDepartMatch[1], type: 'amber' });
  }
  if (lateDepartMatch) {
    notes.push({ label: 'Late departure', text: lateDepartMatch[1], type: 'rose' });
  }
  if (earlyDeliveryMatch) {
    notes.push({ label: 'Early delivery', text: earlyDeliveryMatch[1], type: 'amber' });
  }
  if (lateDeliveryMatch) {
    notes.push({ label: 'Late delivery', text: lateDeliveryMatch[1], type: 'rose' });
  }
  if (isRemitSubmitted) {
    notes.push({ label: 'Remittance', text: 'Cash remittance submitted by rider', type: 'neutral' });
  }

  const cleaned = str
    .replace(/\[EARLY_DEPART:[^\]]+\]/gi, '')
    .replace(/\[LATE_DEPART:[^\]]+\]/gi, '')
    .replace(/\[EARLY_DELIVERY:[^\]]+\]/gi, '')
    .replace(/\[LATE_DELIVERY:[^\]]+\]/gi, '')
    .replace(/\[REMITTANCE_SUBMITTED\]/gi, '')
    .trim();

  if (cleaned) {
    notes.push({ label: 'Customer note', text: cleaned, type: 'neutral' });
  }

  if (notes.length === 0) return '';

  return `
    <div style="margin: 12px 0; padding: 12px 14px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px;">
      <p style="margin: 0 0 8px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #475569;">
        Schedule &amp; Dispatch Audit
      </p>
      <div style="display: flex; flex-direction: column; gap: 6px;">
        ${notes
          .map(
            (n) => `
          <div style="font-size: 12px; line-height: 1.4; color: #1e293b; display: flex; align-items: baseline; gap: 6px;">
            <span class="pill pill-${n.type === 'amber' ? 'amber' : n.type === 'rose' ? 'rose' : 'neutral'}" style="font-size: 10px; font-weight: 700; padding: 1px 6px;">
              ${escapeHtml(n.label)}
            </span>
            <span>${escapeHtml(n.text)}</span>
          </div>
        `
          )
          .join('')}
      </div>
    </div>
  `;
}

function getPrimaryActionMeta(order, availableRidersCount = 0) {
  switch (order.status) {
    case 'submitted':
    case 'confirmed':
    case 'refilling':
    case 'ready':
      if (availableRidersCount > 0) {
        return {
          label: 'Accept & Assign Rider',
          hint: '1-click dispatch: accepts order, preps refills, and assigns the selected rider immediately.',
          enabled: true,
        };
      }
      return {
        label: 'Accept order (Assign rider later)',
        hint: 'Confirms this order. You can assign a rider once they become available.',
        enabled: true,
      };
    case 'rider_assigned':
      return {
        label: 'Waiting for rider to start delivery',
        hint: 'The assigned rider will start the delivery when leaving the station.',
        enabled: false,
      };
    case 'out_for_delivery':
      return {
        label: 'Out for delivery with rider',
        hint: 'The rider will record delivered gallons and empties at the door.',
        enabled: false,
      };
    case 'delivered':
      if (order.payment_status === 'unpaid') {
        return {
          label: 'Confirm payment',
          hint: 'Confirm cash payment received to complete this order and add it to sales.',
          enabled: true,
        };
      }
      return {
        label: 'Order completed',
        hint: 'Delivery and payment have been confirmed.',
        enabled: false,
      };
    case 'completed':
      return {
        label: 'Order completed',
        hint: 'Payment is confirmed and this order is closed.',
        enabled: false,
      };
    case 'cancelled':
      return {
        label: 'Order cancelled',
        hint: 'This order was cancelled while Submitted.',
        enabled: false,
      };
    default:
      return { label: 'No action', hint: '', enabled: false };
  }
}

export async function mount(me) {
  const content = document.querySelector('#content');
  const params = new URLSearchParams(window.location.search);
  let currentOrderId = params.get('id');

  async function loadTargetOrder() {
    if (currentOrderId) {
      const found = await getStaffOrderById(currentOrderId);
      if (found) {
        if (['completed', 'cancelled'].includes(found.status)) {
          showToast(`Order #${found.order_number} is already ${found.status}.`, 'info');
          window.location.href = 'orders.html';
          return null;
        }
        return found;
      }
    }
    const nextOrder = await getNextOrderForProcessing();
    if (nextOrder) {
      currentOrderId = nextOrder.id;
      return nextOrder;
    }
    return null;
  }

  async function renderPage() {
    try {
      const order = await loadTargetOrder();
      if (!order) {
        content.innerHTML = `
          <div class="card empty-state">
            <h3>No orders to process right now</h3>
            <p>When a customer places a refill order, you can process it step by step here.</p>
            <div style="margin-top: 16px;">
              <a class="btn btn-primary" href="orders.html">View all orders</a>
            </div>
          </div>
        `;
        return;
      }

      const [slots, availableRiders, allActiveRiders] = await Promise.all([
        getSlotAvailability(order.delivery_date),
        getAvailableRiders(),
        getAllActiveRiders(),
      ]);

      const effectiveSlot = getEffectiveSlot(order);
      const selectedSlotId = effectiveSlot?.id || order.preferred_slot_id;
      const canAdjustSlot = ['submitted', 'confirmed', 'refilling', 'ready', 'rider_assigned'].includes(
        order.status
      );
      const actionMeta = getPrimaryActionMeta(order, availableRiders.length);

      const lineItemsHtml = (order.items || [])
        .map((item) => {
          const name = (item.product?.name || 'Gallon refill')
            .replace(/Purified Water Refill\s*\((.+)\)/i, '$1 refill')
            .replace(/Mineral Water Refill\s*\((.+)\)/i, 'Mineral $1 refill');
          const qty = Number(item.quantity || 0);
          const unitPrice = Number(item.unit_price || 0);
          const lineTotal = qty * unitPrice;
          const pricingTag = getOrderItemPricingTag(item);
          return `
            <div class="kv-row">
              <span class="kv-label">${escapeHtml(`${qty} ${name}${qty > 1 && !/s$/i.test(name) ? 's' : ''} · ${pricingTag} (${formatPeso(unitPrice)} ea)`)}</span>
              <span class="kv-value">${escapeHtml(formatPeso(lineTotal))}</span>
            </div>
          `;
        })
        .join('');

      const slotOptionsHtml = slots.length
        ? slots
            .map((s) => {
              const label = `${formatSlotWindow(s)} · ${s.orders_count} / ${s.max_orders} orders${
                s.is_closed ? ' (Closed)' : ''
              }`;
              const selected = s.slot_id === selectedSlotId ? ' selected' : '';
              return `<option value="${escapeHtml(s.slot_id)}"${selected}>${escapeHtml(label)}</option>`;
            })
            .join('')
        : `<option value="${escapeHtml(selectedSlotId)}">${escapeHtml(formatSlotWindow(effectiveSlot))}</option>`;

      let riderControlHtml = '';
      if (['submitted', 'confirmed', 'refilling', 'ready'].includes(order.status)) {
        if (availableRiders.length > 0) {
          riderControlHtml = `
            <div class="field" style="margin-top: 8px;">
              <label class="field-label" for="rider-select">Assign available rider (1-click)</label>
              <select class="select" id="rider-select">
                ${availableRiders
                  .map(
                    (r) =>
                      `<option value="${escapeHtml(r.id)}">${escapeHtml(r.full_name)}${r.phone ? ` · ${escapeHtml(r.phone)}` : ''}</option>`
                  )
                  .join('')}
              </select>
            </div>
          `;
        } else {
          riderControlHtml = `
            <div class="notice notice-warning" style="margin-top: 8px;">
              No riders are currently marked <strong>Available</strong>. You can accept the order now and assign a rider once online.
            </div>
          `;
        }
      } else if (order.status === 'rider_assigned') {
        const currentRiderName = order.rider?.full_name || 'Assigned rider';
        riderControlHtml = `
          <div style="border: 1.5px solid #cbd5e1; border-radius: 11px; padding: 14px 16px; background: #ffffff;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
              <div>
                <span style="display: block; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b;">Assigned Rider</span>
                <strong style="font-size: 15px; color: #0f172a;">${escapeHtml(currentRiderName)}</strong>
                ${order.rider?.phone ? `<span style="display: block; font-size: 12px; color: #64748b; margin-top: 1px;">${escapeHtml(order.rider.phone)}</span>` : ''}
              </div>
              <span class="pill pill-blue" style="font-weight: 700; font-size: 11px;">Assigned</span>
            </div>
            <div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid #e2e8f0;">
              <label class="field-label" for="reassign-rider-select" style="font-size: 12px; font-weight: 600; color: #334155; margin-bottom: 6px;">
                Re-assign to another rider
              </label>
              <div style="display: flex; gap: 8px;">
                <select class="select" id="reassign-rider-select" style="flex: 1; font-size: 13px;">
                  ${allActiveRiders
                    .map(
                      (r) =>
                        `<option value="${escapeHtml(r.id)}"${r.id === order.rider_id ? ' selected' : ''}>${escapeHtml(r.full_name)}${r.is_available ? ' (Available)' : ' (Busy)'}</option>`
                    )
                    .join('')}
                </select>
                <button type="button" class="btn btn-secondary" id="btn-confirm-reassign" style="font-weight: 600; border: 1.5px solid #0f172a; color: #0f172a; background: #f8fafc; padding: 0 14px; white-space: nowrap;">
                  Re-assign
                </button>
              </div>
            </div>
          </div>
        `;
      } else if (['out_for_delivery', 'delivered', 'completed'].includes(order.status)) {
        riderControlHtml = `
          <div class="proc-locked-box" style="margin-top: 8px;">
            Assigned rider: <strong>${escapeHtml(order.rider?.full_name || 'Assigned')}</strong>
          </div>
        `;
      }

      let actionStackHtml = '';
      if (['submitted', 'confirmed', 'refilling', 'ready'].includes(order.status)) {
        actionStackHtml = `
          ${
            canAdjustSlot
              ? `
                <div class="field">
                  <label class="field-label" for="adjust-slot-select">Adjust delivery window</label>
                  <select class="select" id="adjust-slot-select">
                    ${slotOptionsHtml}
                  </select>
                </div>
              `
              : ''
          }

          ${riderControlHtml}

          <div style="margin-top: 6px;">
            <button
              type="button"
              class="btn btn-primary btn-block"
              id="primary-step-btn"
              ${!actionMeta.enabled || (order.status === 'ready' && availableRiders.length === 0) ? 'disabled' : ''}
            >
              ${escapeHtml(actionMeta.label)}
            </button>
            <p class="proc-action-hint" style="margin-top: 6px; text-align: center;">${escapeHtml(actionMeta.hint)}</p>
          </div>

          <div style="margin-top: 12px; padding-top: 12px; border-top: 1px dashed #e2e8f0;">
            <button type="button" class="btn btn-outline-danger btn-block" id="btn-cancel-order" style="font-size: 13px;">
              Cancel order
            </button>
          </div>
        `;
      } else if (order.status === 'rider_assigned') {
        actionStackHtml = `
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px 14px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #3b82f6;"></span>
              <strong style="font-size: 13.5px; color: #0f172a;">Waiting for rider to start delivery</strong>
            </div>
            <p style="margin: 4px 0 0 16px; font-size: 12px; color: #64748b;">The assigned rider will start the delivery when leaving the station.</p>
          </div>

          ${riderControlHtml}

          ${
            canAdjustSlot
              ? `
                <div class="field">
                  <label class="field-label" for="adjust-slot-select">Adjust delivery window</label>
                  <select class="select" id="adjust-slot-select">
                    ${slotOptionsHtml}
                  </select>
                </div>
              `
              : ''
          }

          <div style="margin-top: 12px; padding-top: 12px; border-top: 1px dashed #e2e8f0;">
            <button type="button" class="btn btn-outline-danger btn-block" id="btn-cancel-order" style="font-size: 13px;">
              Cancel order
            </button>
          </div>
        `;
      } else if (order.status === 'delivered' && order.payment_status === 'unpaid') {
        actionStackHtml = `
          <div class="proc-locked-box">
            Assigned rider: <strong>${escapeHtml(order.rider?.full_name || 'Assigned')}</strong>
          </div>

          <div style="margin-top: 6px;">
            <button
              type="button"
              class="btn btn-primary btn-block"
              id="primary-step-btn"
            >
              ${escapeHtml(actionMeta.label)}
            </button>
            <p class="proc-action-hint" style="margin-top: 6px; text-align: center;">${escapeHtml(actionMeta.hint)}</p>
          </div>
        `;
      } else {
        actionStackHtml = `
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px 14px;">
            <p style="margin: 0; font-size: 13px; font-weight: 600; color: #0f172a;">${escapeHtml(actionMeta.label)}</p>
            <p style="margin: 4px 0 0; font-size: 12px; color: #64748b;">${escapeHtml(actionMeta.hint)}</p>
          </div>

          ${riderControlHtml}
        `;
      }

      content.innerHTML = `
        ${renderStaffOrderHero(order)}

        <div class="grid-2">
          <div class="card">
            <div class="card-header">
              <div class="card-title-group">
                <span class="card-icon">${ICONS.cart}</span>
                <h2 class="card-title">Order summary</h2>
              </div>
            </div>

            <div class="kv-list">
              ${lineItemsHtml}
              <div class="kv-row">
                <span class="kv-label">Delivery service charge</span>
                <span class="kv-value">${escapeHtml(formatPeso(order.service_charge))}</span>
              </div>
              <div class="kv-row proc-summary-total">
                <span class="kv-label">Total due</span>
                <span class="kv-value">${escapeHtml(formatPeso(order.total))}</span>
              </div>
            </div>

            ${formatSlotNotes(order.slot_note)}

            <div class="notice proc-ledger-notice">
              <strong>Container ledger:</strong> Delivered and collected counts are entered by the rider at delivery.
            </div>
          </div>

          <div class="card">
            <div class="card-header">
              <div class="card-title-group">
                <span class="card-icon">${ICONS.check}</span>
                <h2 class="card-title">Next action</h2>
              </div>
            </div>

            <div class="proc-action-stack">
              ${actionStackHtml}
            </div>
          </div>
        </div>
      `;

      document.querySelector('#adjust-slot-select')?.addEventListener('change', async (e) => {
        const newSlotId = e.target.value;
        if (order.status === 'submitted') {
          // Will be applied when clicking Confirm order
          return;
        }
        try {
          await staffAdjustDeliverySlot(
            order.id,
            newSlotId,
            'The station adjusted your delivery window because of a high number of orders today.'
          );
          showToast('Delivery window updated.', 'success');
          await renderPage();
        } catch (err) {
          showToast(err.message || 'Could not adjust delivery window.', 'error');
          await renderPage();
        }
      });

      document.querySelector('#btn-confirm-reassign')?.addEventListener('click', async (e) => {
        const newRiderId = document.querySelector('#reassign-rider-select')?.value;
        if (!newRiderId) return;
        const riderSelect = document.querySelector('#reassign-rider-select');
        const riderName = riderSelect?.options[riderSelect.selectedIndex]?.text?.replace(/\s*\([^)]*\)/, '') || 'Rider';

        const confirmed = await confirmModal({
          title: `Re-assign Order #${order.order_number}?`,
          message: `Are you sure you want to re-assign this order to ${riderName}?`,
          confirmText: 'Re-assign rider',
          cancelText: 'Keep current',
        });
        if (!confirmed) return;

        const btn = e.currentTarget;
        setBusy(btn, true, 'Re-assigning...');
        try {
          await staffReassignRider(order.id, newRiderId, 'Rider re-assigned by station staff.');
          showToast(`Order #${order.order_number} re-assigned to ${riderName}.`, 'success');
          await renderNav(me, 'order-processing');
          await renderPage();
        } catch (err) {
          showToast(err.message || 'Could not re-assign rider.', 'error');
          setBusy(btn, false);
        }
      });

      document.querySelector('#btn-cancel-order')?.addEventListener('click', async (e) => {
        const confirmed = await confirmModal({
          title: `Cancel Order #${order.order_number}?`,
          message: `Are you sure you want to cancel this order from ${order.customer?.full_name || 'Customer'}? This will stop processing and mark the order as Cancelled.`,
          confirmText: 'Yes, cancel order',
          cancelText: 'Keep order',
          danger: true,
        });
        if (!confirmed) return;

        const btn = e.currentTarget;
        setBusy(btn, true, 'Cancelling...');
        try {
          await staffCancelOrder(order.id, 'Cancelled by station staff');
          showToast(`Order #${order.order_number} has been cancelled.`, 'success');
          await renderNav(me, 'order-processing');
          currentOrderId = null;
          await renderPage();
        } catch (err) {
          showToast(err.message || 'Could not cancel order.', 'error');
          setBusy(btn, false);
        }
      });

      document.querySelector('#primary-step-btn')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        const chosenSlotId = document.querySelector('#adjust-slot-select')?.value || selectedSlotId;
        const chosenRiderId = document.querySelector('#rider-select')?.value || '';

        setBusy(btn, true, 'Processing...');
        try {
          if (['submitted', 'confirmed', 'refilling', 'ready'].includes(order.status)) {
            if (chosenRiderId) {
              await staffFastTrackAssignRider(order.id, chosenRiderId);
              showToast('Order prepared and assigned to rider in 1 click!', 'success');
            } else {
              const slotChanged = chosenSlotId !== order.preferred_slot_id;
              await staffConfirmOrder(
                order.id,
                chosenSlotId,
                slotChanged
                  ? 'The station adjusted your delivery window because of a high number of orders today.'
                  : null
              );
              showToast('Order confirmed! Assign an available rider when ready.', 'success');
            }
          } else if (order.status === 'delivered' && order.payment_status === 'unpaid') {
            const confirmed = await confirmModal({
              title: `Confirm Payment for Order #${order.order_number}?`,
              message: `Confirm that cash payment of ${formatPeso(order.total)} has been received from ${order.customer?.full_name || 'Customer'}? This will complete the order.`,
              confirmText: 'Confirm payment',
              cancelText: 'Cancel',
            });
            if (!confirmed) {
              setBusy(btn, false);
              return;
            }
            await staffConfirmPayment(order.id);
            showToast('Payment confirmed and order completed!', 'success');
          }
          await renderNav(me, 'order-processing');
          await renderPage();
        } catch (err) {
          showToast(err.message || 'Could not update order.', 'error');
          setBusy(btn, false);
          await renderPage();
        }
      });
    } catch (err) {
      showToast(err.message || 'Could not load order processing.', 'error');
    }
  }

  await renderPage();
  const unsub = subscribeStaffWorkspace(() => {
    renderPage();
    renderNav(me, 'order-processing');
  });

  const pollTimer = setInterval(() => {
    if (document.visibilityState === 'visible') {
      renderPage();
    }
  }, 35000);

  return () => {
    clearInterval(pollTimer);
    unsub();
  };
}

bootStaffPage('order-processing', mount);
