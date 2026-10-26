import { bootStaffPage } from '../../core/nav.js';
import { subscribeStaffWorkspace } from '../../core/realtime.js';
import {
  confirmModal,
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
  getRiderRemittanceSummary,
  staffApproveRemittance,
  getRemittanceSalesHistory,
} from '../../services/ordersService.js';
import { getAllActiveRiders } from '../../services/usersService.js';

export async function mount(me) {
  const content = document.querySelector('#content');
  let activeRiders = [];
  let riderSummaries = [];
  let salesHistory = [];
  let activeTab = 'awaiting'; // 'awaiting' | 'holding' | 'history'

  // History filtering & pagination state
  let historySearch = '';
  let historyRider = 'all';
  let historyDate = 'all'; // 'all' | 'today' | 'yesterday' | 'week' | 'month'
  let historyPage = 1;
  const historyPageSize = 10;

  async function loadData() {
    try {
      const [riders, history] = await Promise.all([
        getAllActiveRiders().catch(() => []),
        getRemittanceSalesHistory(200).catch(() => []),
      ]);

      activeRiders = riders;
      salesHistory = history;

      riderSummaries = await Promise.all(
        activeRiders.map(async (rider) => {
          const sum = await getRiderRemittanceSummary(rider.id).catch(() => ({
            totalCash: 0,
            submittedCash: 0,
            unsubmittedCash: 0,
            count: 0,
            submittedCount: 0,
            unsubmittedCount: 0,
            hasSubmitted: false,
            allSettled: true,
            unremittedOrders: [],
            submittedOrders: [],
            unsubmittedOrders: [],
          }));
          return { rider, ...sum };
        })
      );

      renderView();
    } catch (err) {
      showToast(err.message || 'Could not load remittance data.', 'error');
    }
  }

  function renderView() {
    const today = getTodayManila();
    const todaySettledTotal = salesHistory
      .filter((o) => {
        const d = String(o.remitted_at || o.delivered_at || '');
        return d.startsWith(today);
      })
      .reduce((sum, o) => sum + Number(o.total || 0), 0);

    const pendingApprovalTotal = riderSummaries.reduce(
      (sum, s) => sum + Number(s.submittedCash || 0),
      0
    );

    const holdingCashTotal = riderSummaries.reduce(
      (sum, s) => sum + Number(s.unsubmittedCash || 0),
      0
    );

    const awaitingRiders = riderSummaries.filter((s) => s.submittedCash > 0);
    const holdingRiders = riderSummaries.filter(
      (s) => s.submittedCash === 0 && s.unsubmittedCash > 0
    );

    content.innerHTML = `
      <div class="remittance-stat-grid">
        <div class="remittance-stat-card">
          <div>
            <p class="remittance-stat-label">Awaiting Approval</p>
            <p class="remittance-stat-value">${formatPeso(pendingApprovalTotal)}</p>
            <p class="remittance-stat-sub">
              ${awaitingRiders.length} ${awaitingRiders.length === 1 ? 'turnover' : 'turnovers'} submitted by riders
            </p>
          </div>
          <div class="remittance-stat-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          </div>
        </div>

        <div class="remittance-stat-card">
          <div>
            <p class="remittance-stat-label">On-Duty Cash in Pocket</p>
            <p class="remittance-stat-value">${formatPeso(holdingCashTotal)}</p>
            <p class="remittance-stat-sub">
              With ${holdingRiders.length} active ${holdingRiders.length === 1 ? 'rider' : 'riders'} on the road
            </p>
          </div>
          <div class="remittance-stat-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><line x1="6" y1="12" x2="6.01" y2="12"/><line x1="18" y1="12" x2="18.01" y2="12"/></svg>
          </div>
        </div>

        <div class="remittance-stat-card">
          <div>
            <p class="remittance-stat-label">Settled Today</p>
            <p class="remittance-stat-value">${formatPeso(todaySettledTotal)}</p>
            <p class="remittance-stat-sub">
              Reconciled station revenue
            </p>
          </div>
          <div class="remittance-stat-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
        </div>
      </div>

      <div class="remittance-tabs-bar">
        <button type="button" class="remittance-tab-btn ${activeTab === 'awaiting' ? 'is-active' : ''}" data-tab="awaiting">
          Awaiting Cashier Check
          <span class="remittance-tab-badge">${awaitingRiders.length}</span>
        </button>
        <button type="button" class="remittance-tab-btn ${activeTab === 'holding' ? 'is-active' : ''}" data-tab="holding">
          On-Duty in Pocket (Unsubmitted)
          <span class="remittance-tab-badge">${holdingRiders.length}</span>
        </button>
        <button type="button" class="remittance-tab-btn ${activeTab === 'history' ? 'is-active' : ''}" data-tab="history">
          Settled Sales History
          <span class="remittance-tab-badge">${salesHistory.length}</span>
        </button>
      </div>

      <div id="remittance-tab-content">
        ${
          activeTab === 'awaiting'
            ? renderAwaitingHtml(awaitingRiders)
            : activeTab === 'holding'
              ? renderHoldingHtml(holdingRiders)
              : renderHistoryHtml(salesHistory)
        }
      </div>
    `;

    content.querySelectorAll('[data-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        activeTab = btn.dataset.tab;
        renderView();
      });
    });

    attachActionListeners();
  }

  function renderOrderRow(o) {
    const cust = o.customer?.full_name || 'Customer';
    const orderDate = o.delivered_at
      ? `${formatDateShort(o.delivered_at)} · ${formatTimeShort(o.delivered_at)}`
      : 'Delivered';
    const note = String(o.slot_note || '');
    const isSub =
      o.remittance_status === 'submitted' || note.includes('[REMITTANCE_SUBMITTED]');

    const earlyDepartMatch = note.match(/\[EARLY_DEPART:\s*([^\]]+)\]/i);
    const lateDepartMatch = note.match(/\[LATE_DEPART:\s*([^\]]+)\]/i);
    const earlyDeliveryMatch = note.match(/\[EARLY_DELIVERY:\s*([^\]]+)\]/i);
    const lateDeliveryMatch = note.match(/\[LATE_DELIVERY:\s*([^\]]+)\]/i);

    let timingBadgesHtml = '';
    if (earlyDepartMatch) {
      timingBadgesHtml += `<span class="pill pill-amber" style="font-size:10px; padding: 2px 6px;" title="${escapeHtml(earlyDepartMatch[1])}">Early Depart: ${escapeHtml(earlyDepartMatch[1])}</span>`;
    }
    if (lateDepartMatch) {
      timingBadgesHtml += `<span class="pill pill-rose" style="font-size:10px; padding: 2px 6px;" title="${escapeHtml(lateDepartMatch[1])}">Late Depart: ${escapeHtml(lateDepartMatch[1])}</span>`;
    }
    if (earlyDeliveryMatch) {
      timingBadgesHtml += `<span class="pill pill-amber" style="font-size:10px; padding: 2px 6px;" title="${escapeHtml(earlyDeliveryMatch[1])}">Early Deliv: ${escapeHtml(earlyDeliveryMatch[1])}</span>`;
    }
    if (lateDeliveryMatch) {
      timingBadgesHtml += `<span class="pill pill-rose" style="font-size:10px; padding: 2px 6px;" title="${escapeHtml(lateDeliveryMatch[1])}">Late Deliv: ${escapeHtml(lateDeliveryMatch[1])}</span>`;
    }

    return `
      <div class="remittance-order-row">
        <div class="remittance-order-info">
          <div class="remittance-order-headline">
            <span class="remittance-order-id">#${escapeHtml(o.order_number)}</span>
            <span class="remittance-order-dot">·</span>
            <span class="remittance-order-customer">${escapeHtml(cust)}</span>
          </div>
          <div class="remittance-order-meta">
            <span>${escapeHtml(orderDate)}</span>
            ${timingBadgesHtml}
          </div>
        </div>
        <div class="remittance-order-end">
          <span class="remittance-order-amount">${escapeHtml(formatPeso(o.total))}</span>
          <span class="pill ${isSub ? 'pill-amber' : 'pill-neutral'}" style="font-size: 11px;">
            ${isSub ? 'Submitted' : 'In Pocket'}
          </span>
        </div>
      </div>
    `;
  }

  function renderAwaitingHtml(awaitingRiders) {
    if (!awaitingRiders.length) {
      return `
        <div class="card empty-state" style="padding: 48px 24px; text-align: center;">
          <div style="width: 48px; height: 48px; border-radius: 50%; background: #f1f5f9; display: flex; align-items: center; justify-content: center; margin: 0 auto 12px; color: #64748b;">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
          <h3 style="margin: 0 0 6px; font-size: 16px; font-weight: 700; color: #0f172a;">All cash turnovers cleared</h3>
          <p style="margin: 0; font-size: 13px; color: #64748b; max-width: 400px; margin: 0 auto;">
            No cash remittances awaiting cashier verification right now. Any rider turnover will appear here when submitted.
          </p>
        </div>
      `;
    }

    const cardsHtml = awaitingRiders
      .map((s) => {
        const ordersHtml = (s.submittedOrders || s.unremittedOrders || [])
          .map(renderOrderRow)
          .join('');

        return `
          <div class="remittance-rider-card is-submitted">
            <div class="remittance-rider-header">
              <div>
                <h3 class="remittance-rider-name">${escapeHtml(s.rider.full_name)}</h3>
                <p class="remittance-rider-meta">${escapeHtml(s.rider.phone || 'No phone')} · Delivery Rider</p>
              </div>
              <span class="pill pill-amber" style="font-weight: 700;">
                Awaiting Approval
              </span>
            </div>

            <div class="remittance-metrics-strip">
              <div class="remittance-metric-item">
                <span class="remittance-metric-label">Cash to Receive</span>
                <span class="remittance-metric-val is-highlight">${formatPeso(s.submittedCash)}</span>
              </div>
              <div class="remittance-metric-item">
                <span class="remittance-metric-label">Orders Submitted</span>
                <span class="remittance-metric-val">${s.submittedCount} ${s.submittedCount === 1 ? 'order' : 'orders'}</span>
              </div>
              ${
                s.unsubmittedCash > 0
                  ? `<div class="remittance-metric-item">
                      <span class="remittance-metric-label">Still in Pocket</span>
                      <span class="remittance-metric-val" style="color: #64748b;">${formatPeso(s.unsubmittedCash)}</span>
                    </div>`
                  : ''
              }
            </div>

            <div class="remittance-orders-box">
              <div class="remittance-orders-header">
                <span class="remittance-orders-title">Orders for Verification</span>
                <span class="remittance-orders-total">${formatPeso(s.submittedCash)}</span>
              </div>
              <div class="remittance-orders-list">
                ${ordersHtml}
              </div>
            </div>

            <div class="remittance-action-box">
              <button
                type="button"
                class="btn btn-primary btn-block"
                data-approve-remittance="${escapeHtml(s.rider.id)}"
                data-rider-name="${escapeHtml(s.rider.full_name)}"
                data-amount="${s.submittedCash}"
                style="font-weight: 700; font-size: 14px; padding: 10px 16px;"
              >
                Verify &amp; Accept Cash (${formatPeso(s.submittedCash)})
              </button>
            </div>
          </div>
        `;
      })
      .join('');

    return `
      <div class="remittance-grid">
        ${cardsHtml}
      </div>
    `;
  }

  function renderHoldingHtml(holdingRiders) {
    if (!holdingRiders.length) {
      return `
        <div class="card empty-state" style="padding: 48px 24px; text-align: center;">
          <div style="width: 48px; height: 48px; border-radius: 50%; background: #f1f5f9; display: flex; align-items: center; justify-content: center; margin: 0 auto 12px; color: #64748b;">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/></svg>
          </div>
          <h3 style="margin: 0 0 6px; font-size: 16px; font-weight: 700; color: #0f172a;">No unsubmitted cash on duty</h3>
          <p style="margin: 0; font-size: 13px; color: #64748b; max-width: 400px; margin: 0 auto;">
            All delivery collections have either been turned over to the station cashier or no active cash orders are out.
          </p>
        </div>
      `;
    }

    const cardsHtml = holdingRiders
      .map((s) => {
        const ordersHtml = (s.unsubmittedOrders || s.unremittedOrders || [])
          .map(renderOrderRow)
          .join('');

        return `
          <div class="remittance-rider-card">
            <div class="remittance-rider-header">
              <div>
                <h3 class="remittance-rider-name">${escapeHtml(s.rider.full_name)}</h3>
                <p class="remittance-rider-meta">${escapeHtml(s.rider.phone || 'No phone')} · Delivery Rider</p>
              </div>
              <span class="pill pill-neutral">
                In Rider's Pocket
              </span>
            </div>

            <div class="remittance-metrics-strip">
              <div class="remittance-metric-item">
                <span class="remittance-metric-label">Cash on Hand</span>
                <span class="remittance-metric-val">${formatPeso(s.unsubmittedCash)}</span>
              </div>
              <div class="remittance-metric-item">
                <span class="remittance-metric-label">Delivered Orders</span>
                <span class="remittance-metric-val">${s.unsubmittedCount} ${s.unsubmittedCount === 1 ? 'order' : 'orders'}</span>
              </div>
              <div class="remittance-metric-item">
                <span class="remittance-metric-label">Status</span>
                <span class="remittance-metric-val" style="font-size: 13px; color: #64748b; font-weight: 600;">Shift in progress</span>
              </div>
            </div>

            <div class="remittance-orders-box">
              <div class="remittance-orders-header">
                <span class="remittance-orders-title">Delivered Orders (Cash Held)</span>
                <span class="remittance-orders-total">${formatPeso(s.unsubmittedCash)}</span>
              </div>
              <div class="remittance-orders-list">
                ${ordersHtml}
              </div>
            </div>

            <div class="remittance-action-box">
              <div class="remittance-waiting-notice">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                <div>
                  <span style="font-weight: 600; color: #334155;">Cash not turned over yet.</span>
                  <span style="color: #64748b;"> Rider is carrying collections. Settlement unlocks once rider submits turnover.</span>
                </div>
              </div>
            </div>
          </div>
        `;
      })
      .join('');

    return `
      <div class="remittance-grid">
        ${cardsHtml}
      </div>
    `;
  }

  function renderHistoryHtml(history) {
    const q = historySearch.trim().toLowerCase();
    const today = getTodayManila();
    const now = Date.now();

    const filtered = (history || []).filter((o) => {
      // 1. Rider filter
      if (historyRider !== 'all') {
        const rid = o.rider?.id || o.rider_id;
        if (rid !== historyRider) return false;
      }

      // 2. Date filter
      if (historyDate !== 'all') {
        const dStr = String(o.remitted_at || o.delivered_at || '');
        if (historyDate === 'today') {
          if (!dStr.startsWith(today)) return false;
        } else if (historyDate === 'yesterday') {
          const yDate = new Date();
          yDate.setDate(yDate.getDate() - 1);
          const yStr = yDate.toISOString().slice(0, 10);
          if (!dStr.startsWith(yStr)) return false;
        } else if (historyDate === 'week') {
          const t = new Date(dStr).getTime();
          if (isNaN(t) || now - t > 7 * 86400000) return false;
        } else if (historyDate === 'month') {
          if (!dStr.startsWith(today.slice(0, 7))) return false;
        }
      }

      // 3. Search query
      if (q) {
        const num = String(o.order_number || '').toLowerCase();
        const rider = String(o.rider?.full_name || '').toLowerCase();
        const cust = String(o.customer?.full_name || '').toLowerCase();
        if (!num.includes(q) && !rider.includes(q) && !cust.includes(q)) return false;
      }

      return true;
    });

    const totalFilteredAmount = filtered.reduce((sum, o) => sum + Number(o.total || 0), 0);
    const paged = paginateList(filtered, historyPage, historyPageSize);

    const rowsHtml = paged.items.length
      ? paged.items
          .map((o) => {
            const orderNum = o.order_number || '—';
            const riderName = o.rider?.full_name || 'Assigned Rider';
            const custName = o.customer?.full_name || 'Customer';
            const dateStr = formatDateShort(o.remitted_at || o.delivered_at || new Date());
            const timeStr = o.remitted_at
              ? formatTimeShort(o.remitted_at)
              : o.delivered_at
                ? formatTimeShort(o.delivered_at)
                : '';

            const note = String(o.slot_note || '');
            const earlyDepartMatch = note.match(/\[EARLY_DEPART:\s*([^\]]+)\]/i);
            const lateDepartMatch = note.match(/\[LATE_DEPART:\s*([^\]]+)\]/i);
            const earlyDeliveryMatch = note.match(/\[EARLY_DELIVERY:\s*([^\]]+)\]/i);
            const lateDeliveryMatch = note.match(/\[LATE_DELIVERY:\s*([^\]]+)\]/i);

            let timingBadgesHtml = '';
            if (earlyDepartMatch) {
              timingBadgesHtml += `<span class="pill pill-amber" style="font-size:10px; padding: 2px 6px; display:inline-block; margin-top:2px;" title="${escapeHtml(earlyDepartMatch[1])}">Early Depart</span>`;
            }
            if (lateDepartMatch) {
              timingBadgesHtml += `<span class="pill pill-rose" style="font-size:10px; padding: 2px 6px; display:inline-block; margin-top:2px;" title="${escapeHtml(lateDepartMatch[1])}">Late Depart</span>`;
            }
            if (earlyDeliveryMatch) {
              timingBadgesHtml += `<span class="pill pill-amber" style="font-size:10px; padding: 2px 6px; display:inline-block; margin-top:2px;" title="${escapeHtml(earlyDeliveryMatch[1])}">Early Deliv</span>`;
            }
            if (lateDeliveryMatch) {
              timingBadgesHtml += `<span class="pill pill-rose" style="font-size:10px; padding: 2px 6px; display:inline-block; margin-top:2px;" title="${escapeHtml(lateDeliveryMatch[1])}">Late Deliv</span>`;
            }

            return `
              <tr style="font-size: 13px;">
                <td style="font-weight: 700; color: var(--blue-app);">
                  #${escapeHtml(orderNum)}
                  ${timingBadgesHtml}
                </td>
                <td style="font-weight: 600; color: #0f172a;">${escapeHtml(riderName)}</td>
                <td>${escapeHtml(custName)}</td>
                <td style="color: #64748b;">${escapeHtml(dateStr)} ${escapeHtml(timeStr)}</td>
                <td>
                  <span class="pill pill-green" style="font-size: 11px;">Settled &amp; Reconciled</span>
                </td>
                <td style="text-align: right; font-weight: 800; color: #0f172a;">
                  ${escapeHtml(formatPeso(o.total))}
                </td>
              </tr>
            `;
          })
          .join('')
      : `
        <tr>
          <td colspan="6" class="empty-state" style="padding: 32px 16px; text-align: center; color: #64748b;">
            No settled sales match your current search or filter criteria.
          </td>
        </tr>
      `;

    return `
      <div class="card" style="border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
        <div class="card-header" style="border-bottom: 1px solid #e2e8f0; padding: 14px 18px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
          <div>
            <h2 class="card-title" style="margin: 0; font-size: 15px; font-weight: 700; color: #0f172a;">Settled Remittances &amp; Sales Log</h2>
            <p style="margin: 2px 0 0; font-size: 12.5px; color: #64748b;">Reconciled station sales and rider turnover records</p>
          </div>
          <span class="pill pill-neutral" style="font-size: 11.5px; font-weight: 700;">
            ${filtered.length} ${filtered.length === 1 ? 'record' : 'records'} · ${formatPeso(totalFilteredAmount)}
          </span>
        </div>

        <div class="table-filter-toolbar">
          <div class="table-search-box">
            <span class="table-search-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            </span>
            <input type="search" id="history-search-input" placeholder="Search order #, rider, customer..." value="${escapeHtml(historySearch)}">
          </div>

          <div class="table-filter-group">
            <select class="table-filter-select" id="history-rider-select">
              <option value="all">All Riders</option>
              ${activeRiders
                .map(
                  (r) =>
                    `<option value="${escapeHtml(r.id)}"${r.id === historyRider ? ' selected' : ''}>${escapeHtml(r.full_name)}</option>`
                )
                .join('')}
            </select>

            <select class="table-filter-select" id="history-date-select">
              <option value="all"${historyDate === 'all' ? ' selected' : ''}>All Dates</option>
              <option value="today"${historyDate === 'today' ? ' selected' : ''}>Today</option>
              <option value="yesterday"${historyDate === 'yesterday' ? ' selected' : ''}>Yesterday</option>
              <option value="week"${historyDate === 'week' ? ' selected' : ''}>Past 7 Days</option>
              <option value="month"${historyDate === 'month' ? ' selected' : ''}>This Month</option>
            </select>

            ${
              historySearch || historyRider !== 'all' || historyDate !== 'all'
                ? `<button type="button" class="btn btn-light btn-sm" id="btn-reset-history-filters" style="font-size: 12px; height: 36px;">Reset</button>`
                : ''
            }
          </div>
        </div>

        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Rider</th>
                <th>Customer</th>
                <th>Date Settled</th>
                <th>Status</th>
                <th style="text-align: right;">Amount</th>
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
  }

  function attachActionListeners() {
    // History search & filter listeners
    const searchInput = content.querySelector('#history-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        historySearch = e.target.value;
        historyPage = 1;
        refreshHistoryTab();
      });
    }

    const riderSelect = content.querySelector('#history-rider-select');
    if (riderSelect) {
      riderSelect.addEventListener('change', (e) => {
        historyRider = e.target.value;
        historyPage = 1;
        refreshHistoryTab();
      });
    }

    const dateSelect = content.querySelector('#history-date-select');
    if (dateSelect) {
      dateSelect.addEventListener('change', (e) => {
        historyDate = e.target.value;
        historyPage = 1;
        refreshHistoryTab();
      });
    }

    const resetBtn = content.querySelector('#btn-reset-history-filters');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        historySearch = '';
        historyRider = 'all';
        historyDate = 'all';
        historyPage = 1;
        refreshHistoryTab();
      });
    }

    // Numbered pagination buttons
    content.querySelectorAll('.pagination-btn[data-page]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const p = Number(btn.dataset.page);
        if (!isNaN(p) && p >= 1 && p !== historyPage) {
          historyPage = p;
          refreshHistoryTab();
        }
      });
    });

    content.querySelectorAll('[data-approve-remittance]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const riderId = btn.dataset.approveRemittance;
        const riderName = btn.dataset.riderName;
        const amount = Number(btn.dataset.amount || 0);

        const confirmed = await confirmModal({
          title: `Confirm Cash Acceptance from ${riderName}?`,
          message: `Have you physically counted and received ${formatPeso(
            amount
          )} in cash from ${riderName}? This action will record the cash in the station register and clear the rider's pending remittance.`,
          confirmText: 'Yes, verify & accept cash',
          cancelText: 'Cancel',
        });
        if (!confirmed) return;

        setBusy(btn, true, 'Accepting cash...');
        try {
          await staffApproveRemittance(riderId);
          showToast(`Cash remittance of ${formatPeso(amount)} from ${riderName} verified and settled!`, 'success');
          await loadData();
        } catch (err) {
          showToast(err.message || 'Could not approve remittance.', 'error');
          setBusy(btn, false);
        }
      });
    });
  }

  function refreshHistoryTab() {
    const tabContent = content.querySelector('#remittance-tab-content');
    if (tabContent && activeTab === 'history') {
      tabContent.innerHTML = renderHistoryHtml(salesHistory);
      attachActionListeners();
    }
  }

  await loadData();
  return subscribeStaffWorkspace(loadData);
}

bootStaffPage('remittance', mount);
