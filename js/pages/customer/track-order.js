import { bootCustomerPage, renderNav } from '../../core/nav.js';
import { STATUS_LABELS } from '../../core/constants.js';
import { subscribeCustomerOrders } from '../../core/realtime.js';
import { confirmModal, escapeHtml, formatPeso, setBusy, showToast } from '../../core/ui.js';
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
  summarizeOrderItems,
} from '../../services/ordersService.js';
import { getCustomerBottleBalance } from '../../services/ledgerService.js';

const ICONS = {
  pin: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-5.6-7-11a7 7 0 1 1 14 0c0 5.4-7 11-7 11Z"/><circle cx="12" cy="10" r="2.5"/></svg>`,
  clock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`,
};

export async function mount(me) {
  const content = document.querySelector('#content');
  const rightEl = document.querySelector('#topbar-right');
  const params = new URLSearchParams(window.location.search);
  let currentOrderId = params.get('id');

  async function renderPage() {
    try {
      const activeOrders = await getCustomerActiveOrders(me.id);
      let order = null;

      if (currentOrderId) {
        order =
          activeOrders.find((o) => o.id === currentOrderId) ||
          (await getCustomerOrderById(me.id, currentOrderId));
      }

      if (!order && activeOrders.length > 0) {
        order = activeOrders[0];
        currentOrderId = order.id;
      }

      if (rightEl) {
        if (activeOrders.length > 1) {
          rightEl.innerHTML = `
            <div class="admin-seg-group" role="tablist" aria-label="Switch active order">
              ${activeOrders
                .map(
                  (o) => `
                  <button
                    type="button"
                    class="admin-seg-btn${order && o.id === order.id ? ' is-active' : ''}"
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

      if (!order) {
        content.innerHTML = `
          <div class="card empty-state">
            <h3>No active order to track</h3>
            <p>Place a refill order to see your live status tracker here, or view past orders in Order history.</p>
            <div style="margin-top: 16px; display: flex; flex-wrap: wrap; gap: 10px; justify-content: center;">
              <a class="btn btn-primary" href="new-order.html">Place a refill order</a>
              <a class="btn btn-light" href="order-history.html">Order history</a>
            </div>
          </div>
        `;
        return;
      }

      const showSwitcherBar =
        activeOrders.length > 1 ||
        (activeOrders.length === 1 && activeOrders[0].id !== order.id);

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

      content.innerHTML = `
        ${switcherHtml}
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
    } catch (err) {
      showToast(err.message || 'Could not load order tracking.', 'error');
    }
  }

  await renderPage();
  return subscribeCustomerOrders(me.id, () => {
    renderPage();
    renderNav(me, 'track-order');
  });
}

bootCustomerPage('track-order', mount);
