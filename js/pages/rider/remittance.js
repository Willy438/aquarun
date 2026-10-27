import { bootRiderPage, updateRiderRemittanceBadge } from '../../core/nav.js';
import { subscribeRiderWorkspace } from '../../core/realtime.js';
import {
  escapeHtml,
  formatDateShort,
  formatPeso,
  getPesoIconSvg,
  formatTimeShort,
  getTodayManila,
  matchesDateFilter,
  paginateList,
  renderPaginationHtml,
  setBusy,
  showToast,
} from '../../core/ui.js';
import {
  getRiderRemittanceSummary,
  riderSubmitRemittance,
} from '../../services/ordersService.js';

export async function mount(me) {
  const content = document.querySelector('#content');
  let remittance = {
    totalCash: 0,
    submittedCash: 0,
    unsubmittedCash: 0,
    settledCash: 0,
    count: 0,
    submittedCount: 0,
    unsubmittedCount: 0,
    settledCount: 0,
    unremittedOrders: [],
    submittedOrders: [],
    unsubmittedOrders: [],
    settledOrders: [],
    allOrders: [],
  };

  let filterTab = 'all'; // 'all' | 'settled' | 'submitted' | 'unsubmitted'
  let searchQuery = '';
  let dateFilter = 'all'; // 'all' | 'today' | 'yesterday' | 'week' | 'month'
  let currentPage = 1;
  const pageSize = 10;

  async function loadData() {
    try {
      remittance = await getRiderRemittanceSummary(me.id).catch(() => ({
        totalCash: 0,
        submittedCash: 0,
        unsubmittedCash: 0,
        settledCash: 0,
        count: 0,
        submittedCount: 0,
        unsubmittedCount: 0,
        settledCount: 0,
        unremittedOrders: [],
        submittedOrders: [],
        unsubmittedOrders: [],
        settledOrders: [],
        allOrders: [],
      }));
      renderView();
      updateRiderRemittanceBadge(me.id, remittance?.count ?? 0).catch(() => {});
    } catch (err) {
      showToast(err.message || 'Could not load cash records.', 'error');
    }
  }

  function getFilteredOrders() {
    const all = remittance.allOrders || [];
    const q = searchQuery.trim().toLowerCase();
    const today = getTodayManila();
    const now = Date.now();

    return all.filter((o) => {
      const note = String(o.slot_note || '');
      const isSettled =
        Boolean(o.rider_remitted) ||
        note.includes('[REMITTED]') ||
        o.remittance_status === 'approved';
      const isSubmitted =
        !isSettled &&
        (o.remittance_status === 'submitted' || note.includes('[REMITTANCE_SUBMITTED]'));
      const isUnsubmitted = !isSettled && !isSubmitted;

      // 1. Tab filter
      if (filterTab === 'settled' && !isSettled) return false;
      if (filterTab === 'submitted' && !isSubmitted) return false;
      if (filterTab === 'unsubmitted' && !isUnsubmitted) return false;

      // 2. Date filter
      if (!matchesDateFilter(o.remitted_at || o.delivered_at || o.delivery_date || o.created_at, dateFilter)) return false;

      // 3. Search query
      if (q) {
        const num = String(o.order_number || '').toLowerCase();
        const cust = String(o.customer?.full_name || '').toLowerCase();
        if (!num.includes(q) && !cust.includes(q)) return false;
      }

      return true;
    });
  }

  function renderView() {
    const all = remittance.allOrders || [];
    const filtered = getFilteredOrders();
    const totalFilteredAmount = filtered.reduce((sum, o) => sum + Number(o.total || 0), 0);
    const paged = paginateList(filtered, currentPage, pageSize);

    const rowsHtml = paged.items.length
      ? paged.items
          .map((o) => {
            const orderNum = o.order_number || '—';
            const custName = o.customer?.full_name || 'Customer';
            const note = String(o.slot_note || '');

            const isSettled =
              Boolean(o.rider_remitted) ||
              note.includes('[REMITTED]') ||
              o.remittance_status === 'approved';
            const isSubmitted =
              !isSettled &&
              (o.remittance_status === 'submitted' || note.includes('[REMITTANCE_SUBMITTED]'));

            const deliveredTime = o.delivered_at
              ? `${formatDateShort(o.delivered_at)} ${formatTimeShort(o.delivered_at)}`
              : '—';

            const turnedOverTime = o.remitted_at || o.remittance_submitted_at
              ? `${formatDateShort(o.remitted_at || o.remittance_submitted_at)} ${formatTimeShort(o.remitted_at || o.remittance_submitted_at)}`
              : isSubmitted
                ? 'Turnover sent'
                : '—';

            const statusBadge = isSettled
              ? `<span class="pill pill-green" style="font-size: 11px;">Approved</span>`
              : isSubmitted
                ? `<span class="pill pill-amber" style="font-size: 11px;">Waiting for check</span>`
                : `<span class="pill pill-neutral" style="font-size: 11px;">In pocket</span>`;

            return `
              <tr style="font-size: 13px;">
                <td style="font-weight: 700; color: var(--blue-app);">#${escapeHtml(orderNum)}</td>
                <td style="font-weight: 600; color: #0f172a;">${escapeHtml(custName)}</td>
                <td style="font-weight: 600; color: #0f172a;">${escapeHtml(formatPeso(o.total))}</td>
                <td>${statusBadge}</td>
                <td style="color: #64748b;">${escapeHtml(deliveredTime)}</td>
                <td style="color: #64748b;">${escapeHtml(turnedOverTime)}</td>
              </tr>
            `;
          })
          .join('')
      : `
        <tr>
          <td colspan="6" class="empty-state" style="padding: 36px 16px; text-align: center; color: #64748b;">
            No cash records match your current filters.
          </td>
        </tr>
      `;

    content.innerHTML = `
      <!-- Action Banner -->
      <div class="card" style="padding: 16px 20px; margin-bottom: 16px;">
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap;">
          <div style="display: flex; align-items: center; gap: 14px;">
            <div style="width: 42px; height: 42px; border-radius: 10px; background: var(--brand-soft, #ebf2ff); color: var(--blue-app, #1d5bd6); display: flex; align-items: center; justify-content: center;">
              ${getPesoIconSvg({ size: 20, strokeWidth: 1.4 })}
            </div>
            <div>
              <p style="margin: 0; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: var(--muted-blue);">
                Cash on Hand &amp; Turnovers
              </p>
              <div style="display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin-top: 3px;">
                <span style="font-size: 19px; font-weight: 600; color: var(--ink-navy);">
                  ${formatPeso(remittance.unsubmittedCash || 0)}
                  <span style="font-size: 12.5px; font-weight: 500; color: var(--muted-blue);">in pocket (${remittance.unsubmittedCount || 0} ${remittance.unsubmittedCount === 1 ? 'order' : 'orders'})</span>
                </span>
                ${
                  remittance.submittedCash > 0
                    ? `<span class="pill pill-amber" style="font-size: 11px; font-weight: 700;">${formatPeso(remittance.submittedCash)} waiting for check</span>`
                    : ''
                }
                ${
                  remittance.settledCash > 0
                    ? `<span style="font-size: 12.5px; color: #166534; font-weight: 600;">· ${formatPeso(remittance.settledCash)} approved</span>`
                    : ''
                }
              </div>
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            ${
              remittance.unsubmittedCount > 0
                ? `<button type="button" class="btn btn-primary btn-sm" id="btn-open-remit-modal" style="font-weight: 700;">Turn over cash (${formatPeso(remittance.unsubmittedCash)}) &rarr;</button>`
                : remittance.submittedCount > 0
                  ? `<span class="pill pill-amber" style="font-size: 12px; padding: 5px 12px; font-weight: 700;">Turnover Submitted · Waiting for cashier</span>`
                  : `<span class="pill pill-neutral" style="font-size: 12px; padding: 5px 12px;">All cash approved</span>`
            }
          </div>
        </div>
      </div>

      <!-- Stat Cards -->
      <div class="remittance-stat-grid" style="margin-bottom: 16px;">
        <div class="remittance-stat-card">
          <div>
            <p class="remittance-stat-label">Cash in hand</p>
            <p class="remittance-stat-value">${formatPeso(remittance.unsubmittedCash || 0)}</p>
            <p class="remittance-stat-sub">
              ${remittance.unsubmittedCount || 0} ${remittance.unsubmittedCount === 1 ? 'order' : 'orders'} in your pocket
            </p>
          </div>
          <div class="remittance-stat-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:20px;height:20px;display:block;"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/></svg>
          </div>
        </div>

        <div class="remittance-stat-card">
          <div>
            <p class="remittance-stat-label">Waiting for cashier</p>
            <p class="remittance-stat-value">${formatPeso(remittance.submittedCash || 0)}</p>
            <p class="remittance-stat-sub">
              ${remittance.submittedCount || 0} ${remittance.submittedCount === 1 ? 'order' : 'orders'} turned over
            </p>
          </div>
          <div class="remittance-stat-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:20px;height:20px;display:block;"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          </div>
        </div>

        <div class="remittance-stat-card">
          <div>
            <p class="remittance-stat-label">Approved cash</p>
            <p class="remittance-stat-value">${formatPeso(remittance.settledCash || 0)}</p>
            <p class="remittance-stat-sub">
              ${remittance.settledCount || 0} ${remittance.settledCount === 1 ? 'order' : 'orders'} checked &amp; cleared
            </p>
          </div>
          <div class="remittance-stat-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:20px;height:20px;display:block;"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
        </div>
      </div>

      <!-- Main History Card -->
      <div class="card" style="border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
        <div class="card-header" style="border-bottom: 1px solid #e2e8f0; padding: 14px 18px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
          <div class="filter-pills" style="margin-bottom: 0;">
            <button type="button" class="filter-pill ${filterTab === 'all' ? 'is-active' : ''}" data-tab="all">
              All records (${all.length})
            </button>
            <button type="button" class="filter-pill ${filterTab === 'settled' ? 'is-active' : ''}" data-tab="settled">
              Approved (${remittance.settledCount || 0})
            </button>
            <button type="button" class="filter-pill ${filterTab === 'submitted' ? 'is-active' : ''}" data-tab="submitted">
              Waiting for cashier (${remittance.submittedCount || 0})
            </button>
            <button type="button" class="filter-pill ${filterTab === 'unsubmitted' ? 'is-active' : ''}" data-tab="unsubmitted">
              Cash in hand (${remittance.unsubmittedCount || 0})
            </button>
          </div>
          <span class="pill pill-neutral" style="font-size: 11.5px; font-weight: 700;">
            ${filtered.length} ${filtered.length === 1 ? 'record' : 'records'} · ${formatPeso(totalFilteredAmount)}
          </span>
        </div>

        <div class="table-filter-toolbar">
          <div class="table-search-box">
            <span class="table-search-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:18px;height:18px;display:block;"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            </span>
            <input type="search" id="rider-remittance-search" placeholder="Search order #, customer..." value="${escapeHtml(searchQuery)}">
          </div>

          <div class="table-filter-group">
            <select class="table-filter-select" id="rider-remittance-date">
              <option value="all"${dateFilter === 'all' ? ' selected' : ''}>All Dates</option>
              <option value="today"${dateFilter === 'today' ? ' selected' : ''}>Today</option>
              <option value="yesterday"${dateFilter === 'yesterday' ? ' selected' : ''}>Yesterday</option>
              <option value="week"${dateFilter === 'week' ? ' selected' : ''}>Past 7 Days</option>
              <option value="month"${dateFilter === 'month' ? ' selected' : ''}>This Month</option>
            </select>

            ${
              searchQuery || dateFilter !== 'all' || filterTab !== 'all'
                ? `<button type="button" class="btn btn-light btn-sm" id="btn-reset-remittance-filters" style="font-size: 12px; height: 36px;">Reset</button>`
                : ''
            }
          </div>
        </div>

        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th style="width: 110px;">Order</th>
                <th>Customer</th>
                <th style="width: 120px;">Amount</th>
                <th style="width: 140px;">Status</th>
                <th style="width: 160px;">Delivered</th>
                <th style="width: 160px;">Turned over</th>
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

    // Filter pills
    content.querySelectorAll('[data-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        filterTab = btn.dataset.tab;
        currentPage = 1;
        renderView();
      });
    });

    // Search and date filters
    content.querySelector('#rider-remittance-search')?.addEventListener('input', (e) => {
      searchQuery = e.target.value;
      currentPage = 1;
      renderView();
    });

    content.querySelector('#rider-remittance-date')?.addEventListener('change', (e) => {
      dateFilter = e.target.value;
      currentPage = 1;
      renderView();
    });

    content.querySelector('#btn-reset-remittance-filters')?.addEventListener('click', () => {
      searchQuery = '';
      dateFilter = 'all';
      filterTab = 'all';
      currentPage = 1;
      renderView();
    });

    // Pagination buttons
    content.querySelectorAll('.pagination-btn[data-page]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const p = Number(btn.dataset.page);
        if (!isNaN(p) && p >= 1 && p !== currentPage) {
          currentPage = p;
          renderView();
        }
      });
    });

    // Turn over cash modal trigger
    content.querySelector('#btn-open-remit-modal')?.addEventListener('click', () => {
      openTurnoverModal();
    });
  }

  function openTurnoverModal() {
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
            <td style="padding: 9px 8px; text-align: right; font-weight: 700; color: #0f172a;">${escapeHtml(formatPeso(o.total))}</td>
          </tr>
        `;
      })
      .join('');

    backdrop.innerHTML = `
      <div class="modal-card" style="max-width: 520px; width: 100%; border-radius: 12px; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1); background: #ffffff;">
        <div class="modal-header" style="display: flex; align-items: center; justify-content: space-between; padding: 18px 22px; border-bottom: 1px solid #e2e8f0;">
          <div>
            <h3 class="modal-title" style="margin: 0; font-size: 17px; font-weight: 600; color: #0f172a;">Turn Over Cash</h3>
            <p style="margin: 2px 0 0; font-size: 12.5px; color: #64748b;">Turn over cash collections to station cashier</p>
          </div>
          <button type="button" class="modal-close" data-action="cancel" style="border: none; background: transparent; font-size: 22px; line-height: 1; cursor: pointer; color: #94a3b8; padding: 4px;">×</button>
        </div>
        <div class="modal-body stack" style="gap: 14px; padding: 18px 22px;">
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 18px; display: flex; justify-content: space-between; align-items: center;">
            <div>
              <p style="margin: 0; font-size: 11px; text-transform: uppercase; font-weight: 700; color: var(--muted-blue); letter-spacing: 0.5px;">Total Cash to Turn Over</p>
              <p style="margin: 2px 0 0; font-size: 24px; font-weight: 600; color: var(--ink-navy);">${formatPeso(cashToRemit)}</p>
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
          <button type="button" class="btn btn-primary" id="btn-confirm-turnover-submit" style="font-weight: 700;">
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

    backdrop.querySelector('#btn-confirm-turnover-submit')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      setBusy(btn, true, 'Submitting...');
      try {
        await riderSubmitRemittance(me.id);
        showToast(`Cash turnover of ${formatPeso(cashToRemit)} submitted to cashier!`, 'success');
        close();
        await loadData();
      } catch (err) {
        showToast(err.message || 'Could not submit cash turnover.', 'error');
        setBusy(btn, false);
      }
    });
  }

  await loadData();
  const unsub = subscribeRiderWorkspace(me.id, loadData);
  const pollTimer = setInterval(() => {
    if (document.visibilityState === 'visible') {
      loadData();
    }
  }, 35000);

  return () => {
    clearInterval(pollTimer);
    unsub();
  };
}

bootRiderPage('remittance', mount);
