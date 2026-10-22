import { bootCustomerPage, navigateCustomerSpa } from '../../core/nav.js';
import { STATUS_LABELS } from '../../core/constants.js';
import { subscribeCustomerOrders } from '../../core/realtime.js';
import { escapeHtml, formatDateShort, formatPeso, showToast } from '../../core/ui.js';
import {
  formatSlotWindow,
  getCustomerOrders,
  getEffectiveSlot,
  summarizeOrderItems,
} from '../../services/ordersService.js';

const CLOCK_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`;

export async function mount(me) {
  const content = document.querySelector('#content');

  async function loadAndRender() {
    try {
      const orders = await getCustomerOrders(me.id, { limit: 100 });

      const rowsHtml = orders.length
        ? orders
            .map((order) => {
              const slotWindow = formatSlotWindow(getEffectiveSlot(order));
              return `
                <tr class="is-clickable" data-order-id="${escapeHtml(order.id)}">
                  <td class="table-order-id">#${escapeHtml(order.order_number)}</td>
                  <td>${escapeHtml(summarizeOrderItems(order.items))}</td>
                  <td>${escapeHtml(formatDateShort(order.delivery_date || order.created_at))}</td>
                  <td>${escapeHtml(slotWindow)}</td>
                  <td class="table-strong">${escapeHtml(formatPeso(order.total))}</td>
                  <td>
                    <span class="pill status-${escapeHtml(order.status)}">
                      ${escapeHtml(STATUS_LABELS[order.status] || order.status)}
                    </span>
                  </td>
                </tr>
              `;
            })
            .join('')
        : `
          <tr>
            <td colspan="6" class="empty-state">You have not placed any refill orders yet.</td>
          </tr>
        `;

      content.innerHTML = `
        <div class="card">
          <div class="card-header">
            <div class="card-title-group">
              <span class="card-icon">${CLOCK_ICON}</span>
              <h2 class="card-title">All orders</h2>
            </div>
          </div>
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Items</th>
                  <th>Date</th>
                  <th>Delivery slot</th>
                  <th>Total</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                ${rowsHtml}
              </tbody>
            </table>
          </div>
        </div>
      `;

      content.querySelectorAll('tr[data-order-id]').forEach((row) => {
        row.addEventListener('click', () => {
          navigateCustomerSpa(`track-order.html?id=${encodeURIComponent(row.dataset.orderId)}`);
        });
      });
    } catch (err) {
      showToast(err.message || 'Could not load order history.', 'error');
    }
  }

  await loadAndRender();
  return subscribeCustomerOrders(me.id, loadAndRender);
}

bootCustomerPage('order-history', mount);
