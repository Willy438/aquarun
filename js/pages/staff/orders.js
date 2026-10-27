import { bootStaffPage, navigateStaffSpa, updateStaffOrdersBadge } from '../../core/nav.js';
import { STATUS_LABELS, STATUS_PILL_TONE } from '../../core/constants.js';
import { subscribeStaffWorkspace } from '../../core/realtime.js';
import {
  confirmModal,
  escapeHtml,
  formatPeso,
  getTodayManila,
  matchesDateFilter,
  paginateList,
  renderPaginationHtml,
  setBusy,
  showToast,
} from '../../core/ui.js';
import {
  formatSlotCompact,
  getAllOrdersForStaff,
  getEffectiveSlot,
  getRiderRemittanceSummary,
  isOrderItemNewContainer,
  staffAcceptRiderRemittance,
  staffAssignBatchToRider,
  summarizeOrderItems,
} from '../../services/ordersService.js';
import { getAllActiveRiders } from '../../services/usersService.js';

const ICONS = {
  cart: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="20" r="1.5"/><circle cx="17" cy="20" r="1.5"/><path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h8.8a2 2 0 0 0 2-1.6L21 7H6"/></svg>`,
  bolt: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
  pin: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-5.6-7-11a7 7 0 1 1 14 0c0 5.4-7 11-7 11Z"/><circle cx="12" cy="10" r="2.5"/></svg>`,
  truck: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="15" height="12" rx="1"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>`,
  money: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/></svg>`,
  check: `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
};

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
  { value: 'attempted', label: 'Attempted' },
  { value: 'cancelled', label: 'Cancelled' },
];

function ensureOrdersAssets() {
  if (!document.querySelector('link[href*="orders.css"]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '../css/pages/staff/orders.css';
    document.head.appendChild(link);
  }
}

export async function mount() {
  ensureOrdersAssets();
  const content = document.querySelector('#content');
  let allOrders = [];
  let activeRiders = [];
  let currentTab = 'all'; // 'all' | 'batch'
  let searchQuery = '';
  let statusFilter = 'all';
  let ordersDateFilter = 'all'; // 'all' | 'today' | 'yesterday' | 'week' | 'month'
  let ordersPage = 1;
  const ordersPageSize = 10;

  function countBatchReadyOrders() {
    return allOrders.filter(
      (o) => !o.rider_id && ['ready', 'confirmed', 'refilling'].includes(o.status)
    ).length;
  }

  function renderView() {
    const batchReadyCount = countBatchReadyOrders();
    const activeCount = allOrders.filter(
      (o) => !['completed', 'cancelled'].includes(o.status)
    ).length;

    content.innerHTML = `
      <!-- View Mode Tabs -->
      <div class="orders-view-tabs">
        <button type="button" class="orders-view-tab ${currentTab === 'all' ? 'is-active' : ''}" id="tab-all-orders">
          ${ICONS.cart}
          <span>All Orders</span>
          <span class="badge">${activeCount} active</span>
        </button>
        <button type="button" class="orders-view-tab ${currentTab === 'batch' ? 'is-active' : ''}" id="tab-batch-dispatch">
          ${ICONS.bolt}
          <span>Smart Batch Dispatch</span>
          ${batchReadyCount > 0 ? `<span class="badge" style="background:#22c55e;color:#fff;font-weight:700;">${batchReadyCount} ready</span>` : ''}
        </button>
        <a class="orders-view-tab" href="remittance.html" id="tab-rider-remittance">
          ${ICONS.money}
          <span>Cash Remittance &amp; Sales</span>
        </a>
      </div>

      <div id="orders-tab-body"></div>
    `;

    document.querySelector('#tab-all-orders')?.addEventListener('click', () => {
      currentTab = 'all';
      renderView();
    });

    document.querySelector('#tab-batch-dispatch')?.addEventListener('click', () => {
      currentTab = 'batch';
      renderView();
    });

    const bodyContainer = document.querySelector('#orders-tab-body');
    if (currentTab === 'all') {
      renderAllOrdersTab(bodyContainer);
    } else {
      renderBatchDispatchTab(bodyContainer);
    }
  }

  function renderAllOrdersTab(container) {
    container.innerHTML = `
      <div class="card" style="border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
        <div class="card-header" style="border-bottom: 1px solid #e2e8f0; padding: 14px 18px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
          <div class="card-title-group">
            <span class="card-icon">${ICONS.cart}</span>
            <h2 class="card-title" style="margin: 0; font-size: 15px; font-weight: 700; color: #0f172a;">Order Queue &amp; History</h2>
          </div>
          <span class="pill pill-neutral" id="staff-orders-count-badge" style="font-size: 11.5px; font-weight: 700;">
            ${allOrders.length} orders
          </span>
        </div>

        <div class="table-filter-toolbar">
          <div class="table-search-box">
            <span class="table-search-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            </span>
            <input type="search" id="order-search" placeholder="Search order #, customer, or barangay..." value="${escapeHtml(searchQuery)}">
          </div>

          <div class="table-filter-group">
            <select class="table-filter-select" id="status-filter">
              ${FILTER_STATUSES.map(
                (s) =>
                  `<option value="${escapeHtml(s.value)}"${s.value === statusFilter ? ' selected' : ''}>${escapeHtml(s.label)}</option>`
              ).join('')}
            </select>

            <select class="table-filter-select" id="date-filter">
              <option value="all"${ordersDateFilter === 'all' ? ' selected' : ''}>All Dates</option>
              <option value="today"${ordersDateFilter === 'today' ? ' selected' : ''}>Today</option>
              <option value="yesterday"${ordersDateFilter === 'yesterday' ? ' selected' : ''}>Yesterday</option>
              <option value="week"${ordersDateFilter === 'week' ? ' selected' : ''}>Past 7 Days</option>
              <option value="month"${ordersDateFilter === 'month' ? ' selected' : ''}>This Month</option>
            </select>

            ${
              searchQuery || statusFilter !== 'all' || ordersDateFilter !== 'all'
                ? `<button type="button" class="btn btn-light btn-sm" id="btn-reset-order-filters" style="font-size: 12px; height: 36px;">Reset</button>`
                : ''
            }
          </div>
        </div>

        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Customer</th>
                <th>Area / Barangay</th>
                <th>Items</th>
                <th>Delivery slot</th>
                <th>Status</th>
                <th>Total</th>
                <th style="text-align: right;">Action</th>
              </tr>
            </thead>
            <tbody id="staff-orders-tbody"></tbody>
          </table>
        </div>

        <div id="staff-orders-pagination"></div>
      </div>
    `;

    document.querySelector('#order-search')?.addEventListener('input', (e) => {
      searchQuery = e.target.value;
      ordersPage = 1;
      populateTableBody();
    });

    document.querySelector('#status-filter')?.addEventListener('change', (e) => {
      statusFilter = e.target.value;
      ordersPage = 1;
      populateTableBody();
    });

    document.querySelector('#date-filter')?.addEventListener('change', (e) => {
      ordersDateFilter = e.target.value;
      ordersPage = 1;
      populateTableBody();
    });

    document.querySelector('#btn-reset-order-filters')?.addEventListener('click', () => {
      searchQuery = '';
      statusFilter = 'all';
      ordersDateFilter = 'all';
      ordersPage = 1;
      renderAllOrdersTab(container);
    });

    populateTableBody();
  }

  function openOrderDetailsModal(order) {
    const tone = STATUS_PILL_TONE?.[order.status] || (order.status === 'completed' ? 'green' : order.status === 'cancelled' ? 'rose' : 'neutral');
    const statusLabel = STATUS_LABELS[order.status] || order.status;
    const customerName = order.customer?.full_name || 'Customer';
    const customerPhone = order.customer?.phone || '—';
    const addressText = formatAddressFull ? formatAddressFull(order.address) : `${order.address?.street || ''}, ${order.address?.barangay || ''}, ${order.address?.city || ''}`;
    const slotText = formatSlotWindow ? formatSlotWindow(getEffectiveSlot(order)) : formatSlotCompact(getEffectiveSlot(order));
    const riderName = order.rider?.full_name || 'Not assigned';
    const isCompleted = order.status === 'completed' || order.status === 'delivered';
    const isCancelled = order.status === 'cancelled';
    const isActive = !isCompleted && !isCancelled;

    const itemsListHtml = (order.items || [])
      .map(
        (it) => `
          <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid #f1f5f9; font-size:13.5px;">
            <span>${escapeHtml(it.quantity)} × ${escapeHtml(it.product?.name || 'Water Refill')} <small style="color:#64748b;">(${escapeHtml(getOrderItemPricingTag ? getOrderItemPricingTag(it) : 'refill')} · ${escapeHtml(formatPeso(it.unit_price || 0))})</small></span>
            <span style="font-weight:600; color:#0f172a;">${escapeHtml(formatPeso(Number(it.quantity || 0) * Number(it.unit_price || 0)))}</span>
          </div>
        `
      )
      .join('');

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" style="max-width: 540px; border-radius: 14px;">
        <div class="modal-header" style="padding: 16px 20px; border-bottom: 1px solid #e2e8f0; display:flex; justify-content:space-between; align-items:flex-start;">
          <div>
            <h3 class="modal-title" style="margin:0; font-size:18px; font-weight:700; color:#0f172a;">Order #${escapeHtml(order.order_number)}</h3>
            <p class="text-muted" style="font-size:12px; margin:3px 0 0;">
              Placed ${escapeHtml(formatDateShort(order.created_at))} at ${escapeHtml(formatTimeShort(order.created_at))}
            </p>
          </div>
          <div style="display:flex; align-items:center; gap:8px;">
            <span class="pill pill-${escapeHtml(tone)}">${escapeHtml(statusLabel)}</span>
            <button type="button" class="modal-close" data-close aria-label="Close" style="background:none; border:none; font-size:20px; cursor:pointer; color:#64748b; line-height:1;">×</button>
          </div>
        </div>

        <div class="modal-body stack" style="gap:14px; padding: 18px 20px; max-height: 75vh; overflow-y: auto;">
          <!-- Customer & Contact -->
          <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:12px 14px;">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px;">
              <div>
                <p style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.5px; color:#64748b; margin:0 0 2px;">Customer</p>
                <p style="margin:0; font-weight:700; color:#0f172a; font-size:14px;">${escapeHtml(customerName)}</p>
                <p style="margin:2px 0 0; font-size:12.5px; color:#64748b;">${escapeHtml(customerPhone)}</p>
              </div>
              <div style="text-align:right;">
                <p style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.5px; color:#64748b; margin:0 0 2px;">Assigned Rider</p>
                <p style="margin:0; font-weight:600; color:#0f172a; font-size:13px;">${escapeHtml(riderName)}</p>
              </div>
            </div>
            <div style="margin-top:10px; padding-top:10px; border-top:1px dashed #cbd5e1;">
              <p style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.5px; color:#64748b; margin:0 0 2px;">Delivery Address</p>
              <p style="margin:0; font-size:13px; color:#1e293b; line-height:1.4;">${escapeHtml(addressText)}</p>
            </div>
          </div>

          <!-- Schedule & Window -->
          <div style="display:flex; gap:12px; font-size:13px;">
            <div style="flex:1; background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:10px 12px;">
              <p style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.5px; color:#64748b; margin:0 0 2px;">Delivery Window</p>
              <p style="margin:0; font-weight:600; color:#0f172a;">${escapeHtml(slotText)}</p>
            </div>
            ${
              order.delivered_at
                ? `
              <div style="flex:1; background:#f0fdf4; border:1px solid #bbf7d0; border-radius:10px; padding:10px 12px;">
                <p style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.5px; color:#166534; margin:0 0 2px;">Delivered At</p>
                <p style="margin:0; font-weight:600; color:#166534;">${escapeHtml(formatDateShort(order.delivered_at))} ${escapeHtml(formatTimeShort(order.delivered_at))}</p>
              </div>
            `
                : ''
            }
            ${
              isCancelled
                ? `
              <div style="flex:1; background:#fef2f2; border:1px solid #fecaca; border-radius:10px; padding:10px 12px;">
                <p style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.5px; color:#991b1b; margin:0 0 2px;">Reason</p>
                <p style="margin:0; font-weight:600; color:#991b1b;">${escapeHtml(order.cancellation_reason || order.cancellation_note || 'Order cancelled')}</p>
              </div>
            `
                : ''
            }
          </div>

          <!-- Items Breakdown -->
          <div>
            <p style="font-size:11.5px; font-weight:700; text-transform:uppercase; letter-spacing:0.5px; color:#64748b; margin:0 0 6px;">Order Items</p>
            <div style="border:1px solid #e2e8f0; border-radius:10px; padding:8px 14px; background:#ffffff;">
              ${itemsListHtml || '<p class="text-muted" style="margin:6px 0;">No items listed</p>'}
              <div style="display:flex; justify-content:space-between; padding:8px 0; font-size:13px; color:#64748b;">
                <span>Delivery service charge</span>
                <span>${escapeHtml(formatPeso(order.service_charge || 0))}</span>
              </div>
              <div style="display:flex; justify-content:space-between; align-items:baseline; padding-top:10px; border-top:1px solid #e2e8f0; margin-top:4px;">
                <span style="font-weight:700; font-size:14px; color:#0f172a;">
                  Total Amount <small style="font-weight:500; color:#64748b;">(${order.payment_status === 'paid' ? 'Paid COD' : 'Unpaid COD'})</small>
                </span>
                <span style="font-weight:700; font-size:17px; color:#0f172a;">${escapeHtml(formatPeso(order.total))}</span>
              </div>
            </div>
          </div>
        </div>

        <div class="modal-footer" style="padding: 14px 20px; border-top: 1px solid #e2e8f0; display:flex; justify-content:flex-end; gap:8px;">
          ${
            isActive
              ? `<button type="button" class="btn btn-primary btn-sm" id="btn-modal-open-processing">Go to Order Processing</button>`
              : ''
          }
          <button type="button" class="btn btn-secondary btn-sm" data-close>Close</button>
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);
    const close = () => backdrop.remove();
    backdrop.querySelectorAll('[data-close]').forEach((btn) => btn.addEventListener('click', close));
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close();
    });

    backdrop.querySelector('#btn-modal-open-processing')?.addEventListener('click', () => {
      close();
      navigateStaffSpa(`order-processing.html?id=${encodeURIComponent(order.id)}`);
    });
  }

  function populateTableBody() {
    const tbody = document.querySelector('#staff-orders-tbody');
    const paginationContainer = document.querySelector('#staff-orders-pagination');
    const countBadge = document.querySelector('#staff-orders-count-badge');
    if (!tbody) return;

    const q = searchQuery.trim().toLowerCase();
    const today = getTodayManila();
    const now = Date.now();

    const filtered = allOrders.filter((order) => {
      // 1. Status Filter
      if (statusFilter !== 'all' && order.status !== statusFilter) return false;

      // 2. Date Filter
      if (!matchesDateFilter(order.delivery_date || order.delivered_at || order.created_at, ordersDateFilter)) return false;

      // 3. Search Query
      if (q) {
        const orderNum = String(order.order_number || '').toLowerCase();
        const customerName = String(order.customer?.full_name || '').toLowerCase();
        const brgy = String(order.address?.barangay || '').toLowerCase();
        if (!orderNum.includes(q) && !customerName.includes(q) && !brgy.includes(q)) return false;
      }

      return true;
    });

    if (countBadge) {
      countBadge.textContent = `${filtered.length} ${filtered.length === 1 ? 'order' : 'orders'}`;
    }

    if (!filtered.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" class="empty-state" style="padding: 32px 16px; text-align: center; color: #64748b;">
            No matching orders found.
          </td>
        </tr>
      `;
      if (paginationContainer) paginationContainer.innerHTML = '';
      return;
    }

    const paged = paginateList(filtered, ordersPage, ordersPageSize);

    tbody.innerHTML = paged.items
      .map((order) => {
        const customerName = order.customer?.full_name || 'Customer';
        const brgy = order.address?.barangay && order.address.barangay !== 'N/A' ? order.address.barangay : '—';
        const slotText = formatSlotCompact(getEffectiveSlot(order));
        const isTerminal = ['completed', 'cancelled'].includes(order.status);
        const actionLabel = isTerminal ? 'View' : 'Process';
        return `
          <tr class="is-clickable" data-order-id="${escapeHtml(order.id)}" data-order-status="${escapeHtml(order.status)}">
            <td class="table-order-id">#${escapeHtml(order.order_number)}</td>
            <td style="font-weight: 600; color: #0f172a;">${escapeHtml(customerName)}</td>
            <td><span class="badge" style="font-size:11px; background:#f1f5f9; color:#334155; display:inline-flex; align-items:center; gap:3px;">${ICONS.pin} ${escapeHtml(brgy)}</span></td>
            <td>${escapeHtml(summarizeOrderItems(order.items))}</td>
            <td style="color: #64748b; font-size: 13px;">${escapeHtml(slotText)}</td>
            <td>
              <span class="pill status-${escapeHtml(order.status)}">
                ${escapeHtml(STATUS_LABELS[order.status] || order.status)}
              </span>
            </td>
            <td class="table-strong">${escapeHtml(formatPeso(order.total))}</td>
            <td style="text-align: right;">
              <button type="button" class="table-action-link" data-action-order="${escapeHtml(order.id)}" style="background:none; border:none; padding:0; font:inherit; color:var(--blue-app, #1d5bd6); font-weight:600; cursor:pointer;">
                ${actionLabel}
              </button>
            </td>
          </tr>
        `;
      })
      .join('');

    if (paginationContainer) {
      paginationContainer.innerHTML = renderPaginationHtml(paged);
      paginationContainer.querySelectorAll('.pagination-btn[data-page]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const p = Number(btn.dataset.page);
          if (!isNaN(p) && p >= 1 && p !== ordersPage) {
            ordersPage = p;
            populateTableBody();
          }
        });
      });
    }

    const handleOrderSelect = (orderId) => {
      const order = allOrders.find((o) => String(o.id) === String(orderId));
      if (!order) return;
      if (['completed', 'cancelled'].includes(order.status)) {
        openOrderDetailsModal(order);
      } else {
        navigateStaffSpa(`order-processing.html?id=${encodeURIComponent(order.id)}`);
      }
    };

    tbody.querySelectorAll('[data-action-order]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleOrderSelect(btn.getAttribute('data-action-order'));
      });
    });

    tbody.querySelectorAll('tr[data-order-id]').forEach((row) => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('button, a')) return;
        handleOrderSelect(row.dataset.orderId);
      });
    });
  }

  function renderBatchDispatchTab(container) {
    // Filter unassigned orders ready for delivery
    const dispatchableOrders = allOrders.filter(
      (o) => !o.rider_id && ['ready', 'confirmed', 'refilling'].includes(o.status)
    );

    if (!dispatchableOrders.length) {
      container.innerHTML = `
        <div class="card empty-state" style="padding: 40px 20px; text-align: center;">
          <div style="display: flex; justify-content: center; margin-bottom: 10px;">${ICONS.check}</div>
          <h3 style="font-size: 16px; font-weight: 700; color: #0f172a; margin-bottom: 4px;">No unassigned orders ready for dispatch</h3>
          <p class="text-muted" style="font-size: 13px;">All confirmed and ready orders have been assigned to riders or completed.</p>
        </div>
      `;
      return;
    }

    // Group orders by Area / Barangay
    const clusterMap = new Map();
    dispatchableOrders.forEach((order) => {
      const rawBrgy = order.address?.barangay;
      const key = rawBrgy && rawBrgy !== 'N/A' ? rawBrgy.trim() : 'General Station Vicinity';
      if (!clusterMap.has(key)) {
        clusterMap.set(key, []);
      }
      clusterMap.get(key).push(order);
    });

    const clusters = Array.from(clusterMap.entries()).map(([areaName, orders]) => {
      let totalGallons = 0;
      let roundCount = 0;
      let slimCount = 0;
      let newCount = 0;
      let totalCod = 0;

      orders.forEach((o) => {
        totalCod += Number(o.total || 0);
        (o.items || []).forEach((item) => {
          const qty = Number(item.quantity || 0);
          totalGallons += qty;
          const name = String(item.product?.name || '').toLowerCase();
          if (isOrderItemNewContainer(item)) {
            newCount += qty;
          } else if (name.includes('slim')) {
            slimCount += qty;
          } else {
            roundCount += qty;
          }
        });
      });

      return {
        areaName,
        orders,
        totalGallons,
        roundCount,
        slimCount,
        newCount,
        totalCod,
      };
    });

    container.innerHTML = `
      <div style="margin-bottom: 14px;">
        <h2 style="font-size: 15px; font-weight: 700; color: #0f172a; margin-bottom: 2px;">
          Smart Neighborhood Clusters (${clusters.length} Areas)
        </h2>
        <p class="text-muted" style="font-size: 12.5px;">
          Orders in the same barangay are clustered together to save rider gas. Assign an entire neighborhood batch in 1 click.
        </p>
      </div>

      <div class="batch-cards-grid">
        ${clusters
          .map((c, idx) => {
            const clusterId = `cluster-${idx}`;
            const breakdownParts = [];
            if (c.roundCount > 0) breakdownParts.push(`${c.roundCount} Round`);
            if (c.slimCount > 0) breakdownParts.push(`${c.slimCount} Slim`);
            if (c.newCount > 0) breakdownParts.push(`${c.newCount} New Gallon`);

            return `
              <div class="batch-card" data-cluster-key="${clusterId}">
                <div class="batch-card-header">
                  <div>
                    <div class="batch-area-title">
                      ${ICONS.pin}
                      <span>${escapeHtml(c.areaName)}</span>
                    </div>
                    <div class="batch-stats-strip">
                      <span class="batch-stat-pill is-gallons">
                        ${c.totalGallons} Gallons (${c.orders.length} ${c.orders.length === 1 ? 'order' : 'orders'})
                      </span>
                      <span class="batch-stat-pill is-cash">
                        ${formatPeso(c.totalCod)} Total COD
                      </span>
                      ${
                        breakdownParts.length
                          ? `<span class="batch-stat-pill">${escapeHtml(breakdownParts.join(', '))}</span>`
                          : ''
                      }
                    </div>
                  </div>
                </div>

                <!-- Orders in this Cluster -->
                <div class="batch-orders-list">
                  ${c.orders
                    .map((o) => {
                      const customerName = o.customer?.full_name || 'Customer';
                      const street = o.address?.street || 'Address';
                      const itemsStr = summarizeOrderItems(o.items);
                      return `
                        <div class="batch-order-item">
                          <div class="batch-order-left">
                            <span class="batch-order-num">#${escapeHtml(o.order_number)} · ${escapeHtml(customerName)}</span>
                            <span class="batch-order-addr">${escapeHtml(street)}</span>
                          </div>
                          <div class="batch-order-right">
                            <span style="font-weight:700; color:#1e40af;">${escapeHtml(itemsStr)}</span>
                            <span class="pill status-${escapeHtml(o.status)}" style="font-size:10px; padding:2px 6px;">
                              ${escapeHtml(STATUS_LABELS[o.status] || o.status)}
                            </span>
                          </div>
                        </div>
                      `;
                    })
                    .join('')}
                </div>

                <!-- Assign Batch to Rider Action -->
                <div class="batch-action-bar">
                  <select class="batch-rider-select" id="select-${clusterId}">
                    <option value="">Select rider to dispatch...</option>
                    ${activeRiders
                      .map(
                        (r) => `
                        <option value="${escapeHtml(r.id)}">
                          ${escapeHtml(r.full_name)} (${r.is_available ? '● Available' : 'Off-shift'})
                        </option>
                      `
                      )
                      .join('')}
                  </select>
                  <button type="button" class="btn btn-primary batch-assign-btn" data-batch-btn="${clusterId}">
                    ${ICONS.truck}
                    <span>Assign Batch</span>
                  </button>
                </div>
              </div>
            `;
          })
          .join('')}
      </div>
    `;

    // Hook up batch assign buttons
    clusters.forEach((c, idx) => {
      const clusterId = `cluster-${idx}`;
      const btn = container.querySelector(`[data-batch-btn="${clusterId}"]`);
      const select = container.querySelector(`#select-${clusterId}`);

      btn?.addEventListener('click', async () => {
        const riderId = select?.value;
        if (!riderId) {
          showToast('Please select a rider from the dropdown first.', 'error');
          select?.focus();
          return;
        }

        const riderObj = activeRiders.find((r) => r.id === riderId);
        const riderName = riderObj?.full_name || 'Rider';

        const confirmed = await confirmModal({
          title: `Assign Batch to ${riderName}?`,
          message: `Assign ${c.orders.length} orders (${c.totalGallons} total gallons) in "${c.areaName}" to ${riderName}?`,
          confirmText: 'Yes, assign batch',
          cancelText: 'Cancel',
        });
        if (!confirmed) return;

        setBusy(btn, true, 'Assigning...');
        try {
          const orderIds = c.orders.map((o) => o.id);
          await staffAssignBatchToRider(orderIds, riderId);
          showToast(`Batch of ${c.orders.length} orders assigned to ${riderName}!`, 'success');
          await loadData();
        } catch (err) {
          showToast(err.message || 'Could not assign batch.', 'error');
          setBusy(btn, false);
        }
      });
    });
  }

  async function renderRiderRemittanceTab(container) {
    container.innerHTML = `
      <div style="padding: 24px; text-align: center; color: var(--muted-blue);">
        Loading rider remittances...
      </div>
    `;

    try {
      const summaries = await Promise.all(
        activeRiders.map(async (rider) => {
          const sum = await getRiderRemittanceSummary(rider.id).catch(() => ({ totalCash: 0, count: 0, unremittedOrders: [] }));
          return { rider, ...sum };
        })
      );

      container.innerHTML = `
        <div class="card" style="margin-bottom: 16px;">
          <div class="card-header" style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px;">
            <div>
              <h2 class="card-title">Rider Cash Remittances & Shift Handover</h2>
              <p class="text-muted" style="margin: 4px 0 0 0; font-size: 13px;">
                Verify physical cash envelopes turned in by riders upon returning to the station.
              </p>
            </div>
            <a class="btn btn-outline-blue btn-sm" href="remittance.html" style="font-weight: 700;">
              Open Dedicated Sales &amp; Remittance Hub →
            </a>
          </div>
        </div>

        <div class="batch-clusters-grid">
          ${
            summaries.length
              ? summaries
                  .map((s) => {
                    const isSettled = s.totalCash === 0;
                    return `
                      <div class="batch-cluster-card" style="border-top: 4px solid ${isSettled ? '#cbd5e1' : '#10b981'};">
                        <div class="batch-cluster-header">
                          <div>
                            <span class="batch-cluster-title" style="font-size: 15px; font-weight: 700; color: #0f172a;">
                              ${escapeHtml(s.rider.full_name)}
                            </span>
                            <span class="batch-cluster-meta" style="font-size: 12px; color: #64748b;">
                              ${escapeHtml(s.rider.phone || 'No phone')} · Rider
                            </span>
                          </div>
                          <span class="pill ${isSettled ? 'pill-neutral' : 'pill-green'}">
                            ${isSettled ? 'Settled' : 'Cash to Remit'}
                          </span>
                        </div>

                        <div class="batch-stats-row" style="margin: 12px 0;">
                          <span class="batch-stat-pill is-cash" style="font-size: 14px; font-weight: 800;">
                            ${formatPeso(s.totalCash)} Cash on Hand
                          </span>
                          <span class="batch-stat-pill">
                            ${s.count} completed ${s.count === 1 ? 'order' : 'orders'}
                          </span>
                        </div>

                        ${
                          !isSettled && s.hasSubmitted
                            ? `
                              <div style="margin-top: 14px; border-top: 1px solid #f1f5f9; padding-top: 12px;">
                                <button
                                  type="button"
                                  class="btn btn-primary btn-block"
                                  data-accept-remittance="${escapeHtml(s.rider.id)}"
                                  data-rider-name="${escapeHtml(s.rider.full_name)}"
                                  data-amount="${s.submittedCash || s.totalCash}"
                                  style="font-weight: 700;"
                                >
                                  Verify &amp; Accept Cash (${formatPeso(s.submittedCash || s.totalCash)})
                                </button>
                              </div>
                            `
                            : !isSettled
                              ? `
                                <div style="margin-top: 12px; font-size: 12px; color: #64748b; text-align: center; padding: 6px 0; background: #f8fafc; border-radius: 6px;">
                                  Cash on duty in pocket. Waiting for rider turnover.
                                </div>
                              `
                              : `
                                <div style="margin-top: 12px; font-size: 12.5px; color: #64748b; text-align: center; padding: 6px 0;">
                                  No pending cash collection for this rider.
                                </div>
                              `
                        }
                      </div>
                    `;
                  })
                  .join('')
              : `
                <div class="card empty-state" style="padding: 40px; text-align: center; grid-column: 1 / -1;">
                  <p>No active riders found.</p>
                </div>
              `
          }
        </div>
      `;

      container.querySelectorAll('[data-accept-remittance]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const riderId = btn.dataset.acceptRemittance;
          const riderName = btn.dataset.riderName;
          const amount = Number(btn.dataset.amount || 0);

          const confirmed = await confirmModal({
            title: `Accept Cash Remittance from ${riderName}?`,
            message: `Confirm that ${riderName} has physically turned over ${formatPeso(amount)} cash from completed deliveries to the station cash register?`,
            confirmText: 'Yes, accept remittance',
            cancelText: 'Cancel',
          });
          if (!confirmed) return;

          setBusy(btn, true, 'Accepting...');
          try {
            await staffAcceptRiderRemittance(riderId);
            showToast(`Cash remittance of ${formatPeso(amount)} from ${riderName} accepted!`, 'success');
            await loadData();
            renderView();
          } catch (err) {
            showToast(err.message || 'Could not accept remittance.', 'error');
            setBusy(btn, false);
          }
        });
      });
    } catch (err) {
      container.innerHTML = `<div class="card"><p class="text-danger">Could not load remittances: ${escapeHtml(err.message)}</p></div>`;
    }
  }

  async function loadData() {
    try {
      const [orders, riders] = await Promise.all([
        getAllOrdersForStaff({ limit: 200 }),
        getAllActiveRiders().catch(() => []),
      ]);
      allOrders = orders;
      activeRiders = riders;
      renderView();
      updateStaffOrdersBadge().catch(() => {});
    } catch (err) {
      showToast(err.message || 'Could not load orders.', 'error');
    }
  }

  await loadData();
  const unsub = subscribeStaffWorkspace(() => {
    loadData();
    updateStaffOrdersBadge().catch(() => {});
  });

  const pollTimer = setInterval(() => {
    if (document.visibilityState === 'visible') {
      loadData();
    }
  }, 4000);

  return () => {
    clearInterval(pollTimer);
    unsub();
  };
}

bootStaffPage('orders', mount);
