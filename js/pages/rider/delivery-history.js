import { bootRiderPage } from '../../core/nav.js';
import { STATUS_LABELS } from '../../core/constants.js';
import { subscribeRiderWorkspace } from '../../core/realtime.js';
import { escapeHtml, formatDateShort, showToast } from '../../core/ui.js';
import { getOrderTotalGallons } from '../../services/ordersService.js';
import { getRiderDeliveries } from '../../services/deliveryService.js';

const ICONS = {
  truck: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="15" height="12" rx="1"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>`,
  drop: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3s6 6.7 6 11a6 6 0 1 1-12 0c0-4.3 6-11 6-11Z"/></svg>`,
  cube: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/></svg>`,
};

export async function mount(me) {
  const content = document.querySelector('#content');
  let historyOrders = [];
  let filterMode = 'all'; // 'all' | 'completed' | 'pending'

  function getLedgerEntry(order) {
    if (Array.isArray(order.ledger)) return order.ledger[0] || null;
    return order.ledger || null;
  }

  function renderView() {
    const filtered = historyOrders.filter((o) => {
      if (filterMode === 'completed') return o.status === 'completed' || o.payment_status === 'paid';
      if (filterMode === 'pending') return o.status === 'delivered' && o.payment_status === 'unpaid';
      return true;
    });

    const totalDeliveries = historyOrders.length;
    const totalDeliveredBottles = historyOrders.reduce((sum, o) => {
      const l = getLedgerEntry(o);
      return sum + Number(l?.bottles_delivered ?? getOrderTotalGallons(o.items));
    }, 0);
    const totalEmpties = historyOrders.reduce((sum, o) => {
      const l = getLedgerEntry(o);
      return sum + Number(l?.empties_collected ?? 0);
    }, 0);

    const rowsHtml = filtered.length
      ? filtered
          .map((o) => {
            const l = getLedgerEntry(o);
            const delivered = l?.bottles_delivered ?? getOrderTotalGallons(o.items);
            const empties = l?.empties_collected ?? 0;
            const isPaid = o.payment_status === 'paid';

            return `
              <tr>
                <td class="table-order-id">#${escapeHtml(o.order_number)}</td>
                <td>${escapeHtml(o.customer?.full_name || 'Customer')}</td>
                <td>${escapeHtml(formatDateShort(o.delivered_at || o.delivery_date))}</td>
                <td>${escapeHtml(delivered)}</td>
                <td>${escapeHtml(empties)}</td>
                <td>
                  <span class="pill ${isPaid ? 'pill-green' : 'pill-amber'}">
                    ${isPaid ? 'Paid' : 'Pending'}
                  </span>
                </td>
                <td>
                  <span class="pill ${o.status === 'completed' ? 'pill-green' : 'pill-blue'}">
                    ${escapeHtml(STATUS_LABELS[o.status] || o.status)}
                  </span>
                </td>
              </tr>
            `;
          })
          .join('')
      : `
        <tr>
          <td colspan="7" class="empty-state">No past deliveries match this filter.</td>
        </tr>
      `;

    content.innerHTML = `
      <div class="grid-3">
        <div class="stat-card stat-card-between">
          <div>
            <p class="stat-label-top">Deliveries this week</p>
            <p class="stat-value">${escapeHtml(totalDeliveries)}</p>
          </div>
          <span class="stat-icon">${ICONS.truck}</span>
        </div>

        <div class="stat-card stat-card-between">
          <div>
            <p class="stat-label-top">Bottles delivered</p>
            <p class="stat-value">${escapeHtml(totalDeliveredBottles)}</p>
          </div>
          <span class="stat-icon">${ICONS.drop}</span>
        </div>

        <div class="stat-card stat-card-between">
          <div>
            <p class="stat-label-top">Empties collected</p>
            <p class="stat-value">${escapeHtml(totalEmpties)}</p>
          </div>
          <span class="stat-icon">${ICONS.cube}</span>
        </div>
      </div>

      <div class="card">
        <div class="filter-pills">
          <button type="button" class="filter-pill ${filterMode === 'all' ? 'is-active' : ''}" data-filter="all">All</button>
          <button type="button" class="filter-pill ${filterMode === 'completed' ? 'is-active' : ''}" data-filter="completed">Completed</button>
          <button type="button" class="filter-pill ${filterMode === 'pending' ? 'is-active' : ''}" data-filter="pending">Payment pending</button>
        </div>

        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Customer</th>
                <th>Date</th>
                <th>Delivered</th>
                <th>Empties</th>
                <th>Payment</th>
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

    content.querySelectorAll('[data-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        filterMode = btn.dataset.filter;
        renderView();
      });
    });
  }

  async function loadHistory() {
    try {
      const all = await getRiderDeliveries(me.id);
      historyOrders = all.filter((o) => ['delivered', 'completed'].includes(o.status));
      renderView();
    } catch (err) {
      showToast(err.message || 'Could not load delivery history.', 'error');
    }
  }

  await loadHistory();
  return subscribeRiderWorkspace(me.id, loadHistory);
}

bootRiderPage('delivery-history', mount);
