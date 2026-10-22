import { bootStaffPage, navigateStaffSpa } from '../../core/nav.js';
import { STATUS_LABELS } from '../../core/constants.js';
import { subscribeStaffWorkspace } from '../../core/realtime.js';
import { escapeHtml, formatPeso, showToast } from '../../core/ui.js';
import {
  formatSlotCompact,
  getAllOrdersForStaff,
  getEffectiveSlot,
  summarizeOrderItems,
} from '../../services/ordersService.js';

const CART_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="20" r="1.5"/><circle cx="17" cy="20" r="1.5"/><path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h8.8a2 2 0 0 0 2-1.6L21 7H6"/></svg>`;

const FILTER_STATUSES = [
  { value: 'all', label: 'All statuses' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'refilling', label: 'Refilling' },
  { value: 'ready', label: 'Ready' },
  { value: 'rider_assigned', label: 'Rider assigned' },
  { value: 'out_for_delivery', label: 'Out for delivery' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

export async function mount() {
  const content = document.querySelector('#content');
  let allOrders = [];
  let searchQuery = '';
  let statusFilter = 'all';

  function renderTableBody() {
    const tbody = document.querySelector('#staff-orders-tbody');
    const activeCountEl = document.querySelector('#staff-active-count');
    if (!tbody) return;

    const activeCount = allOrders.filter(
      (o) => !['completed', 'cancelled'].includes(o.status)
    ).length;
    if (activeCountEl) activeCountEl.textContent = `${activeCount} active`;

    const q = searchQuery.trim().toLowerCase();
    const filtered = allOrders.filter((order) => {
      if (statusFilter !== 'all' && order.status !== statusFilter) return false;
      if (!q) return true;
      const orderNum = String(order.order_number || '').toLowerCase();
      const customerName = String(order.customer?.full_name || '').toLowerCase();
      return orderNum.includes(q) || customerName.includes(q);
    });

    if (!filtered.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" class="empty-state">No matching orders found.</td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = filtered
      .map((order) => {
        const customerName = order.customer?.full_name || 'Customer';
        const slotText = formatSlotCompact(getEffectiveSlot(order));
        return `
          <tr class="is-clickable" data-order-id="${escapeHtml(order.id)}">
            <td class="table-order-id">#${escapeHtml(order.order_number)}</td>
            <td>${escapeHtml(customerName)}</td>
            <td>${escapeHtml(summarizeOrderItems(order.items))}</td>
            <td>${escapeHtml(slotText)}</td>
            <td>
              <span class="pill status-${escapeHtml(order.status)}">
                ${escapeHtml(STATUS_LABELS[order.status] || order.status)}
              </span>
            </td>
            <td class="table-strong">${escapeHtml(formatPeso(order.total))}</td>
            <td>
              <a class="table-action-link" href="order-processing.html?id=${encodeURIComponent(order.id)}">View</a>
            </td>
          </tr>
        `;
      })
      .join('');

    tbody.querySelectorAll('tr[data-order-id]').forEach((row) => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('a')) return;
        navigateStaffSpa(`order-processing.html?id=${encodeURIComponent(row.dataset.orderId)}`);
      });
    });
  }

  content.innerHTML = `
    <div class="card">
      <div class="card-header">
        <div class="card-title-group">
          <span class="card-icon">${CART_ICON}</span>
          <h2 class="card-title">All orders <span class="card-count-sub" id="staff-active-count">0 active</span></h2>
        </div>
      </div>

      <div class="filter-bar">
        <div class="field">
          <label class="field-label" for="order-search">Search order or customer</label>
          <input class="input" id="order-search" type="search" placeholder="e.g. AR-1052 or Nina Santos" value="${escapeHtml(searchQuery)}">
        </div>
        <div class="field">
          <label class="field-label" for="status-filter">Status</label>
          <select class="select" id="status-filter">
            ${FILTER_STATUSES.map(
              (s) =>
                `<option value="${escapeHtml(s.value)}"${s.value === statusFilter ? ' selected' : ''}>${escapeHtml(s.label)}</option>`
            ).join('')}
          </select>
        </div>
      </div>

      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Order</th>
              <th>Customer</th>
              <th>Items</th>
              <th>Delivery slot</th>
              <th>Status</th>
              <th>Total</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="staff-orders-tbody"></tbody>
        </table>
      </div>
    </div>
  `;

  document.querySelector('#order-search')?.addEventListener('input', (e) => {
    searchQuery = e.target.value;
    renderTableBody();
  });

  document.querySelector('#status-filter')?.addEventListener('change', (e) => {
    statusFilter = e.target.value;
    renderTableBody();
  });

  async function loadOrders() {
    try {
      allOrders = await getAllOrdersForStaff({ limit: 200 });
      renderTableBody();
    } catch (err) {
      showToast(err.message || 'Could not load orders.', 'error');
    }
  }

  await loadOrders();
  return subscribeStaffWorkspace(loadOrders);
}

bootStaffPage('orders', mount);
