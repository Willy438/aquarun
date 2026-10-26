import { bootStaffPage, navigateStaffSpa } from '../../core/nav.js';
import { STATUS_LABELS } from '../../core/constants.js';
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
  money: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>`,
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
        return `
          <tr class="is-clickable" data-order-id="${escapeHtml(order.id)}">
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
              <a class="table-action-link" href="order-processing.html?id=${encodeURIComponent(order.id)}">View</a>
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

    tbody.querySelectorAll('tr[data-order-id]').forEach((row) => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('a')) return;
        navigateStaffSpa(`order-processing.html?id=${encodeURIComponent(row.dataset.orderId)}`);
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
    } catch (err) {
      showToast(err.message || 'Could not load orders.', 'error');
    }
  }

  await loadData();
  return subscribeStaffWorkspace(loadData);
}

bootStaffPage('orders', mount);
