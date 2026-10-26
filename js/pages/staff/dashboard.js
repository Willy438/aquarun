import { bootStaffPage, navigateStaffSpa, renderNav } from '../../core/nav.js';
import { STATUS_LABELS } from '../../core/constants.js';
import { subscribeStaffWorkspace } from '../../core/realtime.js';
import {
  escapeHtml,
  formatDateHeading,
  formatPeso,
  formatTimeShort,
  getInitials,
  getTodayManila,
  showToast,
} from '../../core/ui.js';
import {
  formatSlotCompact,
  formatSlotWindow,
  getAllOrdersForStaff,
  getEffectiveSlot,
  summarizeOrderItems,
} from '../../services/ordersService.js';
import { getSlotAvailability } from '../../services/slotsService.js';
import { getTodayReportSummary } from '../../services/reportsService.js';

const ICONS = {
  plus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`,
  clock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
  pin: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-5.6-7-11a7 7 0 1 1 14 0c0 5.4-7 11-7 11Z"/><circle cx="12" cy="10" r="2.5"/></svg>`,
};

function getQueueActionLabel(order) {
  switch (order.status) {
    case 'submitted':
      return 'Review';
    case 'confirmed':
      return 'Start refill';
    case 'refilling':
      return 'Mark as ready';
    case 'ready':
      return 'Assign rider';
    case 'delivered':
      return 'Confirm payment';
    default:
      return 'Open';
  }
}

export async function mount(me) {
  const pageSub = document.querySelector('#page-sub') || document.querySelector('.topbar-sub');
  const content = document.querySelector('#content');

  if (pageSub) {
    pageSub.textContent = `${formatDateHeading()} · Start with the oldest order that needs action.`;
  }

  async function loadAndRender() {
    try {
      const today = getTodayManila();
      const [orders, slots, todayReport] = await Promise.all([
        getAllOrdersForStaff({ limit: 200 }),
        getSlotAvailability(today),
        getTodayReportSummary(),
      ]);

      const newOrdersCount = orders.filter((o) => o.status === 'submitted').length;
      const refillingCount = orders.filter((o) =>
        ['confirmed', 'refilling'].includes(o.status)
      ).length;
      const readyCount = orders.filter((o) => o.status === 'ready').length;
      const outForDeliveryCount = orders.filter((o) =>
        ['rider_assigned', 'out_for_delivery'].includes(o.status)
      ).length;

      const attentionOrders = orders
        .filter(
          (o) =>
            ['submitted', 'confirmed', 'refilling', 'ready'].includes(o.status) ||
            (o.status === 'delivered' && o.payment_status === 'unpaid')
        )
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
        .slice(0, 6);

      const attentionHtml = attentionOrders.length
        ? `<div class="queue-list">
            ${attentionOrders
              .map((order) => {
                const customerName = order.customer?.full_name || 'Customer';
                const slotText = formatSlotCompact(getEffectiveSlot(order));
                const timeSub =
                  order.status === 'submitted'
                    ? ` · submitted ${formatTimeShort(order.created_at)}`
                    : '';
                return `
                  <div class="queue-row">
                    <div class="queue-left">
                      <span class="queue-avatar">${escapeHtml(getInitials(customerName))}</span>
                      <div>
                        <p class="queue-title">#${escapeHtml(order.order_number)} · ${escapeHtml(customerName)}</p>
                        <p class="queue-sub">${escapeHtml(summarizeOrderItems(order.items))} refills · ${escapeHtml(slotText)}${escapeHtml(timeSub)}</p>
                      </div>
                    </div>
                    <div class="queue-right">
                      <span class="pill status-${escapeHtml(order.status)}">${escapeHtml(STATUS_LABELS[order.status] || order.status)}</span>
                      <a class="btn btn-outline-blue" href="order-processing.html?id=${encodeURIComponent(order.id)}">${escapeHtml(getQueueActionLabel(order))}</a>
                    </div>
                  </div>
                `;
              })
              .join('')}
          </div>`
        : `<div class="empty-state">All caught up! No orders currently waiting for staff action.</div>`;

      const slotsHtml = slots.length
        ? `<div class="kv-list">
            ${slots
              .map((slot) => {
                const label = formatSlotWindow(slot);
                let rightBadge = `<span class="kv-value">${slot.orders_count} / ${slot.max_orders}</span>`;
                if (slot.is_closed) {
                  rightBadge = `<span class="pill pill-red">Closed</span>`;
                } else if (slot.is_full) {
                  rightBadge = `<span class="pill pill-red">Full ${slot.orders_count} / ${slot.max_orders}</span>`;
                }
                return `
                  <div class="kv-row">
                    <span class="kv-label">${escapeHtml(label)}</span>
                    ${rightBadge}
                  </div>
                `;
              })
              .join('')}
          </div>`
        : `<div class="empty-state">No active delivery slots configured.</div>`;

      content.innerHTML = `
        <div class="grid-4">
          <div class="stat-card">
            <span class="stat-icon">${ICONS.plus}</span>
            <div>
              <p class="stat-value">${escapeHtml(newOrdersCount)}</p>
              <p class="stat-label">New orders</p>
            </div>
          </div>

          <div class="stat-card">
            <span class="stat-icon">${ICONS.clock}</span>
            <div>
              <p class="stat-value">${escapeHtml(refillingCount)}</p>
              <p class="stat-label">Being refilled</p>
            </div>
          </div>

          <div class="stat-card">
            <span class="stat-icon">${ICONS.check}</span>
            <div>
              <p class="stat-value">${escapeHtml(readyCount)}</p>
              <p class="stat-label">Ready for dispatch</p>
            </div>
          </div>

          <div class="stat-card">
            <span class="stat-icon">${ICONS.pin}</span>
            <div>
              <p class="stat-value">${escapeHtml(outForDeliveryCount)}</p>
              <p class="stat-label">Out for delivery</p>
            </div>
          </div>
        </div>

        <div class="grid-split">
          <div class="card">
            <div class="card-header">
              <div class="card-title-group">
                <span class="card-icon">${ICONS.clock}</span>
                <h2 class="card-title">Needs attention</h2>
              </div>
              <a class="card-link" href="orders.html">All orders</a>
            </div>

            ${attentionHtml}

            <div class="notice queue-workflow-notice">
              <strong>Workflow rule:</strong> Mark an order Ready only after refilling is finished, then assign an available rider.
            </div>
          </div>

          <div class="stack">
            <div class="card">
              <div class="card-header">
                <div class="card-title-group">
                  <span class="card-icon">${ICONS.clock}</span>
                  <h2 class="card-title">Orders per slot today</h2>
                </div>
              </div>
              ${slotsHtml}
            </div>

            <div class="card">
              <div class="card-header">
                <div class="card-title-group">
                  <span class="card-icon">${ICONS.check}</span>
                  <h2 class="card-title">Completed today</h2>
                </div>
              </div>
              <div class="kv-list">
                <div class="kv-row">
                  <span class="kv-label">Completed orders</span>
                  <span class="kv-value">${escapeHtml(todayReport.orders)}</span>
                </div>
                <div class="kv-row completed-total-row">
                  <span class="kv-label">Recorded sales</span>
                  <span class="kv-value">${escapeHtml(formatPeso(todayReport.recorded_sales))}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      `;
    } catch (err) {
      showToast(err.message || 'Could not load station dashboard.', 'error');
    }
  }

  await loadAndRender();
  const unsub = subscribeStaffWorkspace(() => {
    loadAndRender();
    renderNav(me, 'dashboard');
  });

  const pollTimer = setInterval(() => {
    if (document.visibilityState === 'visible') {
      loadAndRender();
    }
  }, 4000);

  return () => {
    clearInterval(pollTimer);
    unsub();
  };
}

bootStaffPage('dashboard', mount);
