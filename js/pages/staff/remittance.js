import { bootStaffPage } from '../../core/nav.js';
import { subscribeStaffWorkspace } from '../../core/realtime.js';
import {
  confirmModal,
  escapeHtml,
  formatDateShort,
  formatPeso,
  formatTimeShort,
  getTodayManila,
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
  let activeTab = 'active'; // 'active' | 'history'

  async function loadData() {
    try {
      const [riders, history] = await Promise.all([
        getAllActiveRiders().catch(() => []),
        getRemittanceSalesHistory(50).catch(() => []),
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

    const totalCashInCirculation = riderSummaries.reduce(
      (sum, s) => sum + Number(s.totalCash || 0),
      0
    );

    const ridersWithCash = riderSummaries.filter((s) => s.totalCash > 0);

    content.innerHTML = `
      <div class="grid-3" style="margin-bottom: 16px;">
        <div class="stat-card stat-card-between" style="border-left: 4px solid #f59e0b;">
          <div>
            <p class="stat-label-top">Awaiting Approval</p>
            <p class="stat-value" style="color: #b45309;">${formatPeso(pendingApprovalTotal)}</p>
            <p class="stat-sub" style="font-size: 12px; color: #78350f; margin-top: 2px;">
              Submitted by riders awaiting cash check
            </p>
          </div>
          <span class="stat-icon" style="color: #d97706;">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          </span>
        </div>

        <div class="stat-card stat-card-between" style="border-left: 4px solid #3b82f6;">
          <div>
            <p class="stat-label-top">Total Cash on Hand</p>
            <p class="stat-value" style="color: #1d4ed8;">${formatPeso(totalCashInCirculation)}</p>
            <p class="stat-sub" style="font-size: 12px; color: #1e40af; margin-top: 2px;">
              Across ${ridersWithCash.length} active ${ridersWithCash.length === 1 ? 'rider' : 'riders'}
            </p>
          </div>
          <span class="stat-icon" style="color: #2563eb;">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><line x1="6" y1="12" x2="6.01" y2="12"/><line x1="18" y1="12" x2="18.01" y2="12"/></svg>
          </span>
        </div>

        <div class="stat-card stat-card-between" style="border-left: 4px solid #10b981;">
          <div>
            <p class="stat-label-top">Settled Today</p>
            <p class="stat-value" style="color: #047857;">${formatPeso(todaySettledTotal)}</p>
            <p class="stat-sub" style="font-size: 12px; color: #065f46; margin-top: 2px;">
              Reconciled &amp; verified sales
            </p>
          </div>
          <span class="stat-icon" style="color: #059669;">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          </span>
        </div>
      </div>

      <div class="card" style="margin-bottom: 16px;">
        <div class="filter-pills" style="margin-bottom: 0;">
          <button type="button" class="filter-pill ${activeTab === 'active' ? 'is-active' : ''}" data-tab="active">
            Active Turnovers &amp; Approval (${ridersWithCash.length})
          </button>
          <button type="button" class="filter-pill ${activeTab === 'history' ? 'is-active' : ''}" data-tab="history">
            Settled Sales History (${salesHistory.length})
          </button>
        </div>
      </div>

      <div id="remittance-tab-content">
        ${activeTab === 'active' ? renderActiveRidersHtml(riderSummaries) : renderHistoryHtml(salesHistory)}
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

  function renderActiveRidersHtml(summaries) {
    if (!summaries.length) {
      return `
        <div class="card empty-state" style="padding: 40px; text-align: center;">
          <p>No active delivery riders found in the station roster.</p>
        </div>
      `;
    }

    const cardsHtml = summaries
      .map((s) => {
        const isSettled = s.totalCash === 0;
        const hasSubmitted = s.hasSubmitted;
        const borderStyle = isSettled
          ? 'border-top: 4px solid #cbd5e1;'
          : hasSubmitted
            ? 'border-top: 4px solid #f59e0b; background: #fffdf5;'
            : 'border-top: 4px solid #10b981;';

        const orderRows = (s.unremittedOrders || [])
          .map((o) => {
            const cust = o.customer?.full_name || 'Customer';
            const orderDate = o.delivered_at
              ? `${formatDateShort(o.delivered_at)} ${formatTimeShort(o.delivered_at)}`
              : 'Delivered';
            const note = String(o.slot_note || '');
            const isSub =
              o.remittance_status === 'submitted' ||
              note.includes('[REMITTANCE_SUBMITTED]');

            return `
              <tr style="border-bottom: 1px solid #f1f5f9; font-size: 13px;">
                <td style="padding: 8px 6px; font-weight: 700; color: var(--blue-app);">#${escapeHtml(o.order_number)}</td>
                <td style="padding: 8px 6px;">${escapeHtml(cust)}</td>
                <td style="padding: 8px 6px; color: #64748b;">${escapeHtml(orderDate)}</td>
                <td style="padding: 8px 6px;">
                  <span class="pill ${isSub ? 'pill-amber' : 'pill-blue'}" style="font-size: 11px;">
                    ${isSub ? 'Submitted' : 'Delivered'}
                  </span>
                </td>
                <td style="padding: 8px 6px; text-align: right; font-weight: 700; color: #15803d;">
                  ${escapeHtml(formatPeso(o.total))}
                </td>
              </tr>
            `;
          })
          .join('');

        return `
          <div class="batch-cluster-card" style="${borderStyle}">
            <div class="batch-cluster-header">
              <div>
                <span class="batch-cluster-title" style="font-size: 15px; font-weight: 700; color: #0f172a;">
                  ${escapeHtml(s.rider.full_name)}
                </span>
                <span class="batch-cluster-meta" style="font-size: 12px; color: #64748b;">
                  ${escapeHtml(s.rider.phone || 'No phone')} · Rider
                </span>
              </div>
              <span class="pill ${
                isSettled
                  ? 'pill-neutral'
                  : hasSubmitted
                    ? 'pill-amber'
                    : 'pill-green'
              }">
                ${
                  isSettled
                    ? '✓ Settled'
                    : hasSubmitted
                      ? '● Awaiting Approval'
                      : '● Cash on Hand'
                }
              </span>
            </div>

            <div class="batch-stats-row" style="margin: 12px 0;">
              <span class="batch-stat-pill is-cash" style="font-size: 15px; font-weight: 800;">
                ${formatPeso(s.totalCash)} Cash Held
              </span>
              <span class="batch-stat-pill">
                ${s.count} ${s.count === 1 ? 'order' : 'orders'}
              </span>
              ${
                hasSubmitted
                  ? `<span class="batch-stat-pill" style="background: #fef3c7; color: #92400e; font-weight: 700;">
                      ${formatPeso(s.submittedCash)} Submitted for Check
                    </span>`
                  : ''
              }
            </div>

            ${
              !isSettled
                ? `
                  <div style="margin: 10px 0; border: 1px solid #e2e8f0; border-radius: 6px; overflow: hidden;">
                    <table style="width: 100%; border-collapse: collapse; font-size: 12px; text-align: left;">
                      <thead style="background: #f8fafc; font-size: 11px; text-transform: uppercase; color: #64748b; border-bottom: 1px solid #e2e8f0;">
                        <tr>
                          <th style="padding: 6px;">Order</th>
                          <th style="padding: 6px;">Customer</th>
                          <th style="padding: 6px;">Time</th>
                          <th style="padding: 6px;">Status</th>
                          <th style="padding: 6px; text-align: right;">Cash</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${orderRows}
                      </tbody>
                    </table>
                  </div>

                  <div style="margin-top: 14px; border-top: 1px solid #f1f5f9; padding-top: 12px;">
                    <button
                      type="button"
                      class="btn btn-primary btn-block"
                      data-approve-remittance="${escapeHtml(s.rider.id)}"
                      data-rider-name="${escapeHtml(s.rider.full_name)}"
                      data-amount="${s.totalCash}"
                      style="font-weight: 700; background: #16a34a; border-color: #16a34a;"
                    >
                      ${
                        hasSubmitted
                          ? `Approve &amp; Accept Cash (${formatPeso(s.totalCash)})`
                          : `Receive &amp; Settle Cash (${formatPeso(s.totalCash)})`
                      }
                    </button>
                  </div>
                `
                : `
                  <div style="margin-top: 12px; font-size: 12.5px; color: #64748b; text-align: center; padding: 10px 0; background: #f8fafc; border-radius: 6px;">
                    All delivery collections for this rider are fully reconciled and settled.
                  </div>
                `
            }
          </div>
        `;
      })
      .join('');

    return `
      <div class="batch-clusters-grid">
        ${cardsHtml}
      </div>
    `;
  }

  function renderHistoryHtml(history) {
    if (!history.length) {
      return `
        <div class="card empty-state" style="padding: 40px; text-align: center;">
          <p>No settled cash remittance transactions found yet.</p>
        </div>
      `;
    }

    const rowsHtml = history
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

        return `
          <tr style="font-size: 13px;">
            <td style="font-weight: 700; color: var(--blue-app);">#${escapeHtml(orderNum)}</td>
            <td style="font-weight: 600;">${escapeHtml(riderName)}</td>
            <td>${escapeHtml(custName)}</td>
            <td style="color: #64748b;">${escapeHtml(dateStr)} ${escapeHtml(timeStr)}</td>
            <td>
              <span class="pill pill-green" style="font-size: 11px;">Settled &amp; Paid</span>
            </td>
            <td style="text-align: right; font-weight: 800; color: #15803d;">
              ${escapeHtml(formatPeso(o.total))}
            </td>
          </tr>
        `;
      })
      .join('');

    return `
      <div class="card">
        <div class="card-header">
          <h2 class="card-title">Settled Remittances &amp; Sales Log</h2>
          <span class="pill pill-neutral">Past 50 records</span>
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
      </div>
    `;
  }

  function attachActionListeners() {
    content.querySelectorAll('[data-approve-remittance]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const riderId = btn.dataset.approveRemittance;
        const riderName = btn.dataset.riderName;
        const amount = Number(btn.dataset.amount || 0);

        const confirmed = await confirmModal({
          title: `Approve Cash Remittance from ${riderName}?`,
          message: `Confirm that ${riderName} has physically handed over ${formatPeso(
            amount
          )} in cash to the station cashier? This will clear the rider's pending balance and record the sale as settled.`,
          confirmText: 'Yes, approve remittance',
          cancelText: 'Cancel',
        });
        if (!confirmed) return;

        setBusy(btn, true, 'Approving...');
        try {
          await staffApproveRemittance(riderId);
          showToast(`Cash remittance of ${formatPeso(amount)} from ${riderName} approved and settled!`, 'success');
          await loadData();
        } catch (err) {
          showToast(err.message || 'Could not approve remittance.', 'error');
          setBusy(btn, false);
        }
      });
    });
  }

  await loadData();
  return subscribeStaffWorkspace(loadData);
}

bootStaffPage('remittance', mount);
