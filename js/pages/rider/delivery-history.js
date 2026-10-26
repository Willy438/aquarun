import { bootRiderPage } from '../../core/nav.js';
import { STATUS_LABELS } from '../../core/constants.js';
import { subscribeRiderWorkspace } from '../../core/realtime.js';
import {
  escapeHtml,
  formatDateShort,
  formatPeso,
  formatTimeShort,
  getTodayManila,
  paginateList,
  renderPaginationHtml,
  setBusy,
  showToast,
} from '../../core/ui.js';
import {
  formatAddressFull,
  getOrderItemPricingTag,
  getOrderTotalGallons,
  getRiderRemittanceSummary,
  openRiderRemittanceProofModal,
  riderRemitCash,
  riderSubmitRemittance,
} from '../../services/ordersService.js';
import { getRiderDeliveries } from '../../services/deliveryService.js';

const ICONS = {
  truck: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="15" height="12" rx="1"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>`,
  drop: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3s6 6.7 6 11a6 6 0 1 1-12 0c0-4.3 6-11 6-11Z"/></svg>`,
  cube: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/></svg>`,
};

export async function mount(me) {
  const content = document.querySelector('#content');
  let historyOrders = [];
  let filterMode = 'all'; // 'all' | 'completed' | 'pending'
  let searchQuery = '';
  let dateFilter = 'all'; // 'all' | 'today' | 'yesterday' | 'week' | 'month'
  let historyPage = 1;
  const historyPageSize = 10;
  let remittance = { totalCash: 0, count: 0, unremittedOrders: [] };

  function getLedgerEntry(order) {
    if (Array.isArray(order.ledger)) return order.ledger[0] || null;
    return order.ledger || null;
  }

  function openDeliveryModal(order) {
    const l = getLedgerEntry(order);
    const delivered = l?.bottles_delivered ?? getOrderTotalGallons(order.items);
    const empties = l?.empties_collected ?? 0;
    const isPaid = order.payment_status === 'paid';
    const customerName = order.customer?.full_name || 'Customer';
    const customerPhone = order.customer?.phone || '—';
    const addressText = formatAddressFull(order.address);

    const itemsHtml = (order.items || [])
      .map((it) => {
        const qty = Number(it.quantity || 0);
        const unitPrice = Number(it.unit_price || 0);
        return `
          <div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid #f1f5f9; font-size:13px;">
            <span>${escapeHtml(qty)} × ${escapeHtml(it.product?.name || 'Refill')} (${escapeHtml(getOrderItemPricingTag(it))})</span>
            <span style="font-weight:700;">${escapeHtml(formatPeso(qty * unitPrice))}</span>
          </div>
        `;
      })
      .join('');

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" style="max-width:480px;">
        <div class="modal-header">
          <div>
            <h3 class="modal-title">Delivery #${escapeHtml(order.order_number)}</h3>
            <p class="text-muted" style="font-size:12px; margin-top:2px;">
              ${escapeHtml(formatDateShort(order.delivered_at || order.delivery_date))} · ${order.delivered_at ? escapeHtml(formatTimeShort(order.delivered_at)) : ''}
            </p>
          </div>
          <span class="pill ${isPaid ? 'pill-green' : 'pill-amber'}">
            ${isPaid ? 'Paid' : 'Pending payment'}
          </span>
        </div>

        <div class="modal-body stack" style="gap:12px;">
          <div>
            <p class="label" style="font-size:11px; text-transform:uppercase; color:var(--muted-blue); margin-bottom:3px;">Customer</p>
            <p style="color:var(--ink-navy); font-weight:700; margin:0;">${escapeHtml(customerName)}</p>
            <p style="font-size:13px; color:var(--muted-blue); margin:2px 0 0;">${escapeHtml(customerPhone)} · ${escapeHtml(addressText)}</p>
          </div>

          <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; background:#f8fafc; padding:12px; border-radius:10px; border:1px solid #e2e8f0;">
            <div>
              <p style="font-size:11px; text-transform:uppercase; color:var(--muted-blue); margin:0 0 2px;">Delivered Gallons</p>
              <p style="font-size:18px; font-weight:800; color:#1d5bd6; margin:0;">${escapeHtml(delivered)}</p>
            </div>
            <div>
              <p style="font-size:11px; text-transform:uppercase; color:var(--muted-blue); margin:0 0 2px;">Empties Collected</p>
              <p style="font-size:18px; font-weight:800; color:#0f766e; margin:0;">${escapeHtml(empties)}</p>
            </div>
          </div>

          <div>
            <p class="label" style="font-size:11px; text-transform:uppercase; color:var(--muted-blue); margin-bottom:4px;">Items Delivered</p>
            ${itemsHtml || '<p class="text-muted">No items</p>'}
            <div style="display:flex; justify-content:space-between; padding-top:8px; font-size:15px; font-weight:800; color:var(--ink-navy);">
              <span>Cash collected:</span>
              <span style="color:var(--blue-app);">${escapeHtml(formatPeso(order.total))}</span>
            </div>
          </div>
        </div>

        <div class="modal-footer">
          <button type="button" class="btn btn-primary" data-close>Done</button>
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);
    const close = () => backdrop.remove();
    backdrop.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close();
    });
  }

  function renderView() {
    const q = searchQuery.trim().toLowerCase();
    const today = getTodayManila();
    const now = Date.now();

    const filtered = historyOrders.filter((o) => {
      // 1. Status Filter
      if (filterMode === 'completed' && !(o.status === 'completed' || o.payment_status === 'paid')) return false;
      if (filterMode === 'pending' && !(o.status === 'delivered' && o.payment_status === 'unpaid')) return false;

      // 2. Date Filter
      if (dateFilter !== 'all') {
        const dStr = String(o.delivered_at || o.delivery_date || '');
        if (dateFilter === 'today') {
          if (!dStr.startsWith(today)) return false;
        } else if (dateFilter === 'yesterday') {
          const yDate = new Date();
          yDate.setDate(yDate.getDate() - 1);
          const yStr = yDate.toISOString().slice(0, 10);
          if (!dStr.startsWith(yStr)) return false;
        } else if (dateFilter === 'week') {
          const t = new Date(dStr).getTime();
          if (isNaN(t) || now - t > 7 * 86400000) return false;
        } else if (dateFilter === 'month') {
          if (!dStr.startsWith(today.slice(0, 7))) return false;
        }
      }

      // 3. Search Query
      if (q) {
        const orderNum = String(o.order_number || '').toLowerCase();
        const custName = String(o.customer?.full_name || '').toLowerCase();
        if (!orderNum.includes(q) && !custName.includes(q)) return false;
      }

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

    const paged = paginateList(filtered, historyPage, historyPageSize);

    const rowsHtml = paged.items.length
      ? paged.items
          .map((o) => {
            const l = getLedgerEntry(o);
            const delivered = l?.bottles_delivered ?? getOrderTotalGallons(o.items);
            const empties = l?.empties_collected ?? 0;
            const isPaid = o.payment_status === 'paid';

            return `
              <tr class="is-clickable" data-delivery-id="${escapeHtml(o.id)}">
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
                <td style="text-align:right;">
                  <button type="button" class="btn btn-sm btn-light" data-view-delivery="${escapeHtml(o.id)}" onclick="event.stopPropagation();">
                    Details
                  </button>
                </td>
              </tr>
            `;
          })
          .join('')
      : `
        <tr>
          <td colspan="8" class="empty-state" style="padding: 32px 16px; text-align: center; color: #64748b;">
            No past deliveries match your current filters.
          </td>
        </tr>
      `;

    content.innerHTML = `
      <div class="card" style="padding: 16px 20px; margin-bottom: 16px;">
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap;">
          <div style="display: flex; align-items: center; gap: 14px;">
            <div style="width: 42px; height: 42px; border-radius: 10px; background: #f1f5f9; color: var(--ink-navy); display: flex; align-items: center; justify-content: center; font-size: 20px; font-weight: 800;">
              ₱
            </div>
            <div>
              <p style="margin: 0; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: var(--muted-blue);">
                Cash on Hand &amp; Turnovers
              </p>
              <div style="display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin-top: 3px;">
                <span style="font-size: 19px; font-weight: 800; color: var(--ink-navy);">
                  ${formatPeso(remittance.unsubmittedCash || 0)}
                  <span style="font-size: 12.5px; font-weight: 500; color: var(--muted-blue);">in pocket (${remittance.unsubmittedCount || 0} ${remittance.unsubmittedCount === 1 ? 'order' : 'orders'})</span>
                </span>
                ${
                  remittance.submittedCash > 0
                    ? `<span class="pill pill-amber" style="font-size: 11px; font-weight: 700;">${formatPeso(remittance.submittedCash)} awaiting cashier</span>`
                    : ''
                }
                ${
                  remittance.settledCash > 0
                    ? `<span style="font-size: 12.5px; color: #166534; font-weight: 600;">· ${formatPeso(remittance.settledCash)} settled</span>`
                    : ''
                }
              </div>
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            <a href="remittance.html" class="btn btn-light btn-sm" style="font-weight: 600; font-size: 12px;">
              Cash Record &rarr;
            </a>
            ${
              remittance.unsubmittedCount > 0
                ? `<button type="button" class="btn btn-primary btn-sm" id="btn-history-remit" style="font-weight: 700;">Turn over cash (${formatPeso(remittance.unsubmittedCash)}) &rarr;</button>`
                : remittance.submittedCount > 0
                  ? `<span class="pill pill-amber" style="font-size: 12px; padding: 5px 12px; font-weight: 700;">Turnover Submitted · Waiting for cashier</span>`
                  : `<span class="pill pill-neutral" style="font-size: 12px; padding: 5px 12px;">All cash approved</span>`
            }
          </div>
        </div>
      </div>

      <div class="grid-4" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 16px;">
        <div class="stat-card stat-card-between">
          <div>
            <p class="stat-label-top">Deliveries Completed</p>
            <p class="stat-value">${escapeHtml(totalDeliveries)}</p>
          </div>
          <span class="stat-icon">${ICONS.truck}</span>
        </div>

        <div class="stat-card stat-card-between">
          <div>
            <p class="stat-label-top">Reconciled Sales</p>
            <p class="stat-value" style="color: var(--ink-navy); font-size: 20px;">${formatPeso(remittance.settledCash || 0)}</p>
          </div>
          <span class="stat-icon" style="font-size: 18px; font-weight: 800; color: var(--muted-blue);">₱</span>
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

      <div class="card" style="border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
        <div class="card-header" style="border-bottom: 1px solid #e2e8f0; padding: 14px 18px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
          <div class="filter-pills" style="margin-bottom: 0;">
            <button type="button" class="filter-pill ${filterMode === 'all' ? 'is-active' : ''}" data-filter="all">All (${historyOrders.length})</button>
            <button type="button" class="filter-pill ${filterMode === 'completed' ? 'is-active' : ''}" data-filter="completed">Completed</button>
            <button type="button" class="filter-pill ${filterMode === 'pending' ? 'is-active' : ''}" data-filter="pending">Payment pending</button>
          </div>
          <span class="pill pill-neutral" style="font-size: 11.5px; font-weight: 700;">
            ${filtered.length} ${filtered.length === 1 ? 'delivery' : 'deliveries'}
          </span>
        </div>

        <div class="table-filter-toolbar">
          <div class="table-search-box">
            <span class="table-search-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            </span>
            <input type="search" id="rider-history-search" placeholder="Search order #, customer..." value="${escapeHtml(searchQuery)}">
          </div>

          <div class="table-filter-group">
            <select class="table-filter-select" id="rider-history-date">
              <option value="all"${dateFilter === 'all' ? ' selected' : ''}>All Dates</option>
              <option value="today"${dateFilter === 'today' ? ' selected' : ''}>Today</option>
              <option value="yesterday"${dateFilter === 'yesterday' ? ' selected' : ''}>Yesterday</option>
              <option value="week"${dateFilter === 'week' ? ' selected' : ''}>Past 7 Days</option>
              <option value="month"${dateFilter === 'month' ? ' selected' : ''}>This Month</option>
            </select>

            ${
              searchQuery || dateFilter !== 'all' || filterMode !== 'all'
                ? `<button type="button" class="btn btn-light btn-sm" id="btn-reset-rider-filters" style="font-size: 12px; height: 36px;">Reset</button>`
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
                <th>Date</th>
                <th>Delivered</th>
                <th>Empties</th>
                <th>Payment</th>
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

    // Filter pill buttons
    content.querySelectorAll('[data-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        filterMode = btn.dataset.filter;
        historyPage = 1;
        renderView();
      });
    });

    // Search and date filters
    content.querySelector('#rider-history-search')?.addEventListener('input', (e) => {
      searchQuery = e.target.value;
      historyPage = 1;
      renderView();
    });

    content.querySelector('#rider-history-date')?.addEventListener('change', (e) => {
      dateFilter = e.target.value;
      historyPage = 1;
      renderView();
    });

    content.querySelector('#btn-reset-rider-filters')?.addEventListener('click', () => {
      searchQuery = '';
      dateFilter = 'all';
      filterMode = 'all';
      historyPage = 1;
      renderView();
    });

    // Pagination buttons
    content.querySelectorAll('.pagination-btn[data-page]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const p = Number(btn.dataset.page);
        if (!isNaN(p) && p >= 1 && p !== historyPage) {
          historyPage = p;
          renderView();
        }
      });
    });

    content.querySelectorAll('tr[data-delivery-id]').forEach((row) => {
      row.addEventListener('click', () => {
        const id = row.dataset.deliveryId;
        const target = historyOrders.find((o) => o.id === id);
        if (target) openDeliveryModal(target);
      });
    });

    content.querySelectorAll('[data-view-delivery]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.viewDelivery;
        const target = historyOrders.find((o) => o.id === id);
        if (target) openDeliveryModal(target);
      });
    });

    content.querySelector('#btn-history-remit')?.addEventListener('click', () => {
      openRiderRemittanceModal(remittance);
    });

    content.querySelector('#btn-view-history-proof')?.addEventListener('click', () => {
      openRiderRemittanceProofModal(remittance, me);
    });
  }

  function openRiderRemittanceModal(remittance) {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';

    const ordersToRemit = remittance.unsubmittedOrders || remittance.unremittedOrders || [];
    const cashToRemit = remittance.unsubmittedCash || remittance.totalCash || 0;

    const ordersRows = ordersToRemit
      .map((o) => {
        const custName = o.customer?.full_name || 'Customer';
        const orderDate = formatDateShort(o.delivered_at || o.paid_at || new Date());
        return `
          <tr style="border-bottom: 1px solid #f1f5f9; font-size: 13px;">
            <td style="padding: 9px 8px; font-weight: 700; color: var(--blue-app);">#${escapeHtml(o.order_number)}</td>
            <td style="padding: 9px 8px;">${escapeHtml(custName)}</td>
            <td style="padding: 9px 8px; color: #64748b;">${escapeHtml(orderDate)}</td>
            <td style="padding: 9px 8px; text-align: right; font-weight: 700; color: #15803d;">${escapeHtml(formatPeso(o.total))}</td>
          </tr>
        `;
      })
      .join('');

    backdrop.innerHTML = `
      <div class="modal-card" style="max-width: 520px; width: 100%; border-radius: 12px; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1); background: #ffffff;">
        <div class="modal-header" style="display: flex; align-items: center; justify-content: space-between; padding: 18px 22px; border-bottom: 1px solid #e2e8f0;">
          <div>
            <h3 class="modal-title" style="margin: 0; font-size: 17px; font-weight: 800; color: #0f172a;">Turn Over &amp; Remit Cash</h3>
            <p style="margin: 2px 0 0; font-size: 12.5px; color: #64748b;">Turn over Cash on Delivery (COD) collections to station cashier</p>
          </div>
          <button type="button" class="modal-close" data-action="cancel" style="border: none; background: transparent; font-size: 22px; line-height: 1; cursor: pointer; color: #94a3b8; padding: 4px;">×</button>
        </div>
        <div class="modal-body stack" style="gap: 14px; padding: 18px 22px;">
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 18px; display: flex; justify-content: space-between; align-items: center;">
            <div>
              <p style="margin: 0; font-size: 11px; text-transform: uppercase; font-weight: 700; color: var(--muted-blue); letter-spacing: 0.5px;">Total Cash to Turn Over</p>
              <p style="margin: 2px 0 0; font-size: 24px; font-weight: 800; color: var(--ink-navy);">${formatPeso(cashToRemit)}</p>
            </div>
            <span class="pill pill-blue" style="font-weight: 700; font-size: 12px; padding: 6px 14px;">${ordersToRemit.length} ${ordersToRemit.length === 1 ? 'Order' : 'Orders'}</span>
          </div>

          <div>
            <p style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: #64748b; margin-bottom: 6px; letter-spacing: 0.5px;">Orders Breakdown</p>
            <div style="max-height: 220px; overflow-y: auto; border: 1px solid #e2e8f0; border-radius: 8px;">
              <table style="width: 100%; border-collapse: collapse; text-align: left;">
                <thead style="background: #f8fafc; font-size: 11px; text-transform: uppercase; color: #64748b; border-bottom: 1px solid #e2e8f0;">
                  <tr>
                    <th style="padding: 8px;">Order</th>
                    <th style="padding: 8px;">Customer</th>
                    <th style="padding: 8px;">Delivered</th>
                    <th style="padding: 8px; text-align: right;">Cash</th>
                  </tr>
                </thead>
                <tbody>
                  ${ordersRows}
                </tbody>
              </table>
            </div>
          </div>

          <div class="notice notice-tint" style="font-size: 12px; margin: 0; line-height: 1.45;">
            Submitting records that you are turning over this physical cash collection to the station cashier. Hand over the physical cash to the cashier, who will verify and approve the settlement.
          </div>
        </div>
        <div class="modal-footer" style="display: flex; justify-content: flex-end; gap: 10px; padding: 14px 22px; border-top: 1px solid #e2e8f0; background: #f8fafc; border-bottom-left-radius: 12px; border-bottom-right-radius: 12px;">
          <button type="button" class="btn btn-light" data-action="cancel">Cancel</button>
          <button type="button" class="btn btn-primary" id="btn-confirm-remit-modal" style="font-weight: 700;">
            Submit Cash Remittance (${formatPeso(cashToRemit)})
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);
    const close = () => backdrop.remove();

    backdrop.querySelectorAll('[data-action="cancel"]').forEach((el) => {
      el.addEventListener('click', close);
    });
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close();
    });

    backdrop.querySelector('#btn-confirm-remit-modal')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      setBusy(btn, true, 'Submitting remittance...');
      try {
        await riderSubmitRemittance(me.id);
        showToast(`Cash remittance of ${formatPeso(cashToRemit)} submitted to station! Cashier can now approve.`, 'success');
        close();
        await loadHistory();
      } catch (err) {
        showToast(err.message || 'Could not submit cash remittance.', 'error');
        setBusy(btn, false);
      }
    });
  }

  async function loadHistory() {
    try {
      const [all, rem] = await Promise.all([
        getRiderDeliveries(me.id),
        getRiderRemittanceSummary(me.id).catch(() => ({ totalCash: 0, count: 0, unremittedOrders: [] })),
      ]);
      historyOrders = all.filter((o) => ['delivered', 'completed'].includes(o.status));
      remittance = rem;
      renderView();
    } catch (err) {
      showToast(err.message || 'Could not load delivery history.', 'error');
    }
  }

  await loadHistory();
  return subscribeRiderWorkspace(me.id, loadHistory);
}

bootRiderPage('delivery-history', mount);
