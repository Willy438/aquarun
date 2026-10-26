import { bootCustomerPage, navigateCustomerSpa } from '../../core/nav.js';
import { STATUS_LABELS, STATUS_PILL_TONE } from '../../core/constants.js';
import { subscribeCustomerOrders } from '../../core/realtime.js';
import {
  escapeHtml,
  formatDateShort,
  formatPeso,
  formatTimeShort,
  matchesDateFilter,
  paginateList,
  renderPaginationHtml,
  showToast,
} from '../../core/ui.js';
import {
  formatAddressFull,
  formatSlotWindow,
  getCustomerOrders,
  getEffectiveSlot,
  getOrderItemPricingTag,
  summarizeOrderItems,
} from '../../services/ordersService.js';

const CLOCK_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`;

export async function mount(me) {
  const content = document.querySelector('#content');
  const params = new URLSearchParams(window.location.search);
  const initialViewId = params.get('viewOrder');

  let orders = [];
  let filterMode = 'all'; // 'all' | 'active' | 'completed' | 'cancelled'
  let dateFilter = 'all'; // 'all' | 'today' | 'yesterday' | 'week' | 'month'
  let searchQuery = '';
  let ordersPage = 1;
  const ordersPageSize = 10;
  let autoOpenedId = null;

  function isActiveOrder(order) {
    return !['completed', 'cancelled'].includes(order.status);
  }

  function openOrderReceiptModal(order) {
    const tone = STATUS_PILL_TONE[order.status] || 'neutral';
    const statusLabel = STATUS_LABELS[order.status] || order.status;
    const isCompleted = order.status === 'completed';
    const isCancelled = order.status === 'cancelled';
    const addressText = formatAddressFull(order.address);
    const slotText = formatSlotWindow(getEffectiveSlot(order));
    const riderName = order.rider?.full_name || 'Assigned rider';

    const itemsListHtml = (order.items || [])
      .map((it) => {
        const qty = Number(it.quantity || 0);
        const unitPrice = Number(it.unit_price || 0);
        const tag = getOrderItemPricingTag(it);
        return `
          <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px; padding:8px 0; border-bottom:1px solid #f1f5f9;">
            <div>
              <p style="font-weight:600; color:var(--ink-navy); margin:0 0 2px 0;">
                ${escapeHtml(qty)} × ${escapeHtml(it.product?.name || 'Water Refill')}
              </p>
              <span class="pill pill-neutral" style="font-size:10.5px; padding:2px 7px;">${escapeHtml(tag)}</span>
              <span style="font-size:12px; color:var(--muted-blue); margin-left:4px;">${escapeHtml(formatPeso(unitPrice))} ea</span>
            </div>
            <span style="font-weight:700; color:var(--ink-navy); white-space:nowrap;">${escapeHtml(formatPeso(qty * unitPrice))}</span>
          </div>
        `;
      })
      .join('');

    let bannerHtml = '';
    if (isCompleted) {
      bannerHtml = `
        <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:10px; padding:12px 14px; margin-bottom:14px; display:flex; gap:10px; align-items:center;">
          <span class="pill pill-green" style="font-weight:700;">Delivered</span>
          <div>
            <p style="font-weight:700; color:#15803d; margin:0 0 2px 0;">Order completed</p>
            <p style="font-size:12px; color:#166534; margin:0;">
              Delivered on ${escapeHtml(formatDateShort(order.delivered_at || order.delivery_date))} · Rider: ${escapeHtml(riderName)}
            </p>
          </div>
        </div>
      `;
    } else if (isCancelled) {
      bannerHtml = `
        <div style="background:#fef2f2; border:1px solid #fecaca; border-radius:10px; padding:12px 14px; margin-bottom:14px; display:flex; gap:10px; align-items:center;">
          <span class="pill pill-danger" style="font-weight:700;">Cancelled</span>
          <div>
            <p style="font-weight:700; color:#b91c1c; margin:0 0 2px 0;">Order cancelled</p>
            <p style="font-size:12px; color:#991b1b; margin:0;">
              ${escapeHtml(order.slot_note || 'This order was cancelled while Submitted. No payment was collected.')}
            </p>
          </div>
        </div>
      `;
    }

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" style="max-width:520px;">
        <div class="modal-header">
          <div>
            <h3 class="modal-title">Receipt #${escapeHtml(order.order_number)}</h3>
            <p class="text-muted" style="font-size:12px; margin-top:2px;">
              Placed on ${escapeHtml(formatDateShort(order.created_at))} at ${escapeHtml(formatTimeShort(order.created_at))}
            </p>
          </div>
          <span class="pill pill-${escapeHtml(tone)}">${escapeHtml(statusLabel)}</span>
        </div>

        <div class="modal-body stack" style="gap:12px;">
          ${bannerHtml}

          <div>
            <p class="label" style="font-size:11px; text-transform:uppercase; letter-spacing:0.04em; color:var(--muted-blue); margin-bottom:4px;">Delivery address</p>
            <p style="color:var(--ink-navy); font-weight:600; margin:0;">${escapeHtml(addressText)}</p>
            <p style="font-size:12px; color:var(--muted-blue); margin-top:2px;">Scheduled window: ${escapeHtml(slotText)}</p>
          </div>

          <div>
            <p class="label" style="font-size:11px; text-transform:uppercase; letter-spacing:0.04em; color:var(--muted-blue); margin-bottom:6px;">Items breakdown</p>
            <div style="background:#f8fafc; border-radius:10px; padding:4px 12px; border:1px solid #e2e8f0;">
              ${itemsListHtml || '<p class="text-muted" style="padding:8px 0;">No items found</p>'}
              <div style="display:flex; justify-content:space-between; padding:8px 0; font-size:13px; color:var(--muted-blue);">
                <span>Delivery service charge</span>
                <span>${escapeHtml(formatPeso(order.service_charge || 0))}</span>
              </div>
              <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 0 6px; font-size:16px; font-weight:800; color:var(--ink-navy); border-top:1.5px solid #cbd5e1;">
                <span>Total ${isCancelled ? '(Cancelled)' : '(Cash on delivery)'}</span>
                <span style="color:${isCancelled ? '#94a3b8' : 'var(--blue-app)'};">
                  ${escapeHtml(isCancelled ? '₱0' : formatPeso(order.total))}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div class="modal-footer" style="flex-direction:row; justify-content:space-between; align-items:center;">
          <a class="btn btn-primary" href="new-order.html" style="font-weight:700;">Order again</a>
          <button type="button" class="btn btn-light" data-close>Close</button>
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);
    const close = () => {
      backdrop.remove();
      if (window.location.search.includes('viewOrder=')) {
        window.history.replaceState({}, '', 'order-history.html');
      }
    };
    backdrop.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close();
    });
  }

  function renderView() {
    const totalCount = orders.length;
    const activeCount = orders.filter(isActiveOrder).length;
    const completedCount = orders.filter((o) => o.status === 'completed').length;
    const cancelledCount = orders.filter((o) => o.status === 'cancelled').length;
    const q = searchQuery.trim().toLowerCase();

    const filtered = orders.filter((order) => {
      if (filterMode === 'active' && !isActiveOrder(order)) return false;
      if (filterMode === 'completed' && order.status !== 'completed') return false;
      if (filterMode === 'cancelled' && order.status !== 'cancelled') return false;

      if (!matchesDateFilter(order.delivery_date || order.delivered_at || order.created_at, dateFilter)) {
        return false;
      }

      if (q) {
        const num = String(order.order_number || '').toLowerCase();
        const items = summarizeOrderItems(order.items).toLowerCase();
        if (!num.includes(q) && !items.includes(q)) return false;
      }

      return true;
    });

    const paged = paginateList(filtered, ordersPage, ordersPageSize);

    const cardsHtml = paged.items.length
      ? paged.items
          .map((order) => {
            const slotWindow = formatSlotWindow(getEffectiveSlot(order));
            const isActive = isActiveOrder(order);

            return `
              <div class="customer-order-card is-clickable" data-order-id="${escapeHtml(order.id)}" data-is-active="${isActive}">
                <div class="customer-order-card-header">
                  <span class="customer-order-card-num">#${escapeHtml(order.order_number)}</span>
                  <span class="pill status-${escapeHtml(order.status)}">
                    ${escapeHtml(STATUS_LABELS[order.status] || order.status)}
                  </span>
                </div>
                <div class="customer-order-card-items">
                  ${escapeHtml(summarizeOrderItems(order.items))}
                </div>
                <div class="customer-order-card-meta">
                  <div class="customer-order-meta-col">
                    <span class="customer-order-meta-label">Delivery Date & Slot</span>
                    <span class="customer-order-meta-val">${escapeHtml(formatDateShort(order.delivery_date || order.created_at))} · ${escapeHtml(slotWindow)}</span>
                  </div>
                  <div class="customer-order-meta-col" style="text-align: right;">
                    <span class="customer-order-meta-label">Total</span>
                    <span class="customer-order-card-total">${escapeHtml(formatPeso(order.total))}</span>
                  </div>
                </div>
                <div class="customer-order-card-actions">
                  ${
                    isActive
                      ? `<a class="btn btn-sm btn-primary" href="track-order.html?id=${encodeURIComponent(order.id)}" onclick="event.stopPropagation();">Track order →</a>`
                      : `<button type="button" class="btn btn-sm btn-light" data-open-receipt="${escapeHtml(order.id)}" onclick="event.stopPropagation();">View receipt</button>`
                  }
                </div>
              </div>
            `;
          })
          .join('')
      : `
        <div class="empty-state" style="padding: 32px 16px; text-align: center; color: #64748b;">
          No orders match your current filters.
        </div>
      `;

    const rowsHtml = paged.items.length
      ? paged.items
          .map((order) => {
            const slotWindow = formatSlotWindow(getEffectiveSlot(order));
            const isActive = isActiveOrder(order);

            return `
              <tr class="is-clickable" data-order-id="${escapeHtml(order.id)}" data-is-active="${isActive}">
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
                <td style="text-align:right;">
                  ${
                    isActive
                      ? `<a class="btn btn-sm btn-primary" href="track-order.html?id=${encodeURIComponent(order.id)}" onclick="event.stopPropagation();">Track order →</a>`
                      : `<button type="button" class="btn btn-sm btn-light" data-open-receipt="${escapeHtml(order.id)}" onclick="event.stopPropagation();">View receipt</button>`
                  }
                </td>
              </tr>
            `;
          })
          .join('')
      : `
        <tr>
          <td colspan="7" class="empty-state" style="padding: 32px 16px; text-align: center; color: #64748b;">
            No orders match your current filters.
          </td>
        </tr>
      `;

    content.innerHTML = `
      <div class="card" style="border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
        <div class="card-header" style="border-bottom: 1px solid #e2e8f0; padding: 14px 18px; flex-wrap: wrap; gap: 12px; display: flex; justify-content: space-between; align-items: center;">
          <div class="card-title-group">
            <span class="card-icon">${CLOCK_ICON}</span>
            <h2 class="card-title" style="margin: 0; font-size: 15px; font-weight: 700; color: #0f172a;">Order history</h2>
          </div>
          <div class="filter-pills" role="tablist" aria-label="Filter orders" style="margin-bottom: 0;">
            <button type="button" class="filter-pill ${filterMode === 'all' ? 'is-active' : ''}" data-filter="all">
              All (${totalCount})
            </button>
            <button type="button" class="filter-pill ${filterMode === 'active' ? 'is-active' : ''}" data-filter="active">
              Active (${activeCount})
            </button>
            <button type="button" class="filter-pill ${filterMode === 'completed' ? 'is-active' : ''}" data-filter="completed">
              Completed (${completedCount})
            </button>
            <button type="button" class="filter-pill ${filterMode === 'cancelled' ? 'is-active' : ''}" data-filter="cancelled">
              Cancelled (${cancelledCount})
            </button>
          </div>
        </div>

        <div class="table-filter-toolbar">
          <div class="table-search-box">
            <span class="table-search-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            </span>
            <input type="search" id="customer-order-search" placeholder="Search order #, items..." value="${escapeHtml(searchQuery)}">
          </div>

          <div class="table-filter-group">
            <select class="table-filter-select" id="customer-date-filter">
              <option value="all"${dateFilter === 'all' ? ' selected' : ''}>All Dates</option>
              <option value="today"${dateFilter === 'today' ? ' selected' : ''}>Today</option>
              <option value="yesterday"${dateFilter === 'yesterday' ? ' selected' : ''}>Yesterday</option>
              <option value="week"${dateFilter === 'week' ? ' selected' : ''}>Past 7 Days</option>
              <option value="month"${dateFilter === 'month' ? ' selected' : ''}>This Month</option>
            </select>

            ${
              searchQuery || dateFilter !== 'all' || filterMode !== 'all'
                ? `<button type="button" class="btn btn-light btn-sm" id="btn-reset-customer-filters" style="font-size: 12px; height: 36px;">Reset</button>`
                : ''
            }
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
                <th style="text-align:right;">Action</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
        </div>

        ${renderPaginationHtml(paged)}
      </div>
    `;

    // Category filter tabs
    content.querySelectorAll('[data-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        filterMode = btn.dataset.filter;
        ordersPage = 1;
        renderView();
      });
    });

    // Search input
    content.querySelector('#customer-order-search')?.addEventListener('input', (e) => {
      searchQuery = e.target.value;
      ordersPage = 1;
      renderView();
    });

    // Date filter
    content.querySelector('#customer-date-filter')?.addEventListener('change', (e) => {
      dateFilter = e.target.value;
      ordersPage = 1;
      renderView();
    });

    content.querySelector('#btn-reset-customer-filters')?.addEventListener('click', () => {
      searchQuery = '';
      dateFilter = 'all';
      filterMode = 'all';
      ordersPage = 1;
      renderView();
    });

    content.querySelector('#btn-reset-customer-search')?.addEventListener('click', () => {
      searchQuery = '';
      ordersPage = 1;
      renderView();
    });

    // Pagination buttons
    content.querySelectorAll('.pagination-btn[data-page]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const p = Number(btn.dataset.page);
        if (!isNaN(p) && p >= 1 && p !== ordersPage) {
          ordersPage = p;
          renderView();
        }
      });
    });

    // Row clicks
    content.querySelectorAll('tr[data-order-id]').forEach((row) => {
      row.addEventListener('click', () => {
        const orderId = row.dataset.orderId;
        const isActive = row.dataset.isActive === 'true';
        if (isActive) {
          navigateCustomerSpa(`track-order.html?id=${encodeURIComponent(orderId)}`);
        } else {
          const target = orders.find((o) => o.id === orderId);
          if (target) openOrderReceiptModal(target);
        }
      });
    });

    // Receipt buttons
    content.querySelectorAll('[data-open-receipt]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const orderId = btn.dataset.openReceipt;
        const target = orders.find((o) => o.id === orderId);
        if (target) openOrderReceiptModal(target);
      });
    });

    // Check if initialViewId requested auto-open
    if (initialViewId && autoOpenedId !== initialViewId) {
      autoOpenedId = initialViewId;
      const target = orders.find((o) => o.id === initialViewId);
      if (target) {
        if (isActiveOrder(target)) {
          navigateCustomerSpa(`track-order.html?id=${encodeURIComponent(target.id)}`);
        } else {
          openOrderReceiptModal(target);
        }
      }
    }
  }

  async function loadOrders() {
    try {
      orders = await getCustomerOrders(me.id, { limit: 100, forceRefresh: true });
      renderView();
    } catch (err) {
      showToast(err.message || 'Could not load order history.', 'error');
    }
  }

  await loadOrders();
  const unsub = subscribeCustomerOrders(me.id, loadOrders);
  const pollTimer = setInterval(() => {
    if (document.visibilityState === 'visible') {
      loadOrders();
    }
  }, 4000);

  return () => {
    clearInterval(pollTimer);
    unsub();
  };
}

bootCustomerPage('order-history', mount);
