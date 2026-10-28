import { bootCustomerPage } from '../../core/nav.js';
import { subscribeCustomerOrders } from '../../core/realtime.js';
import {
  escapeHtml,
  formatDateShort,
  paginateList,
  renderPaginationHtml,
  showToast,
} from '../../core/ui.js';
import {
  getCustomerBottleBalance,
  getCustomerLedgerActivity,
  getCustomerShapeBalance,
} from '../../services/ledgerService.js';

const ICONS = {
  drop: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3s6 6.7 6 11a6 6 0 1 1-12 0c0-4.3 6-11 6-11Z"/></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
  bookmark: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1Z"/></svg>`,
  clock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`,
};

export async function mount(me) {
  if (!document.querySelector('link[data-page-css="bottle-balance"]') && !document.querySelector('link[href*="bottle-balance.css"]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.dataset.pageCss = 'bottle-balance';
    link.href = '../css/pages/customer/bottle-balance.css?v=20261028';
    document.head.appendChild(link);
  }

  const content = document.querySelector('#content');
  let isDisposed = false;
  let summary = { bottles_delivered: 0, empties_collected: 0, balance: 0 };
  let activity = [];
  let shapeBalance = null;
  let activityPage = 1;
  const activityPageSize = 10;

  function renderView() {
    if (isDisposed || !content) return;

    const paged = paginateList(activity, activityPage, activityPageSize);

    const mobileCardsHtml = paged.items.length
      ? paged.items
          .map((entry) => {
            const delivered = Number(entry.bottles_delivered || 0);
            const empties = Number(entry.empties_collected || 0);
            const diff = delivered - empties;
            const changeStr = diff > 0 ? `+${diff}` : String(diff);
            const dateVal = entry.order?.delivered_at || entry.created_at;
            const orderNum = entry.order?.order_number || '—';

            return `
              <div class="bottle-card-item">
                <div class="bottle-card-head">
                  <span class="bottle-card-date">${escapeHtml(formatDateShort(dateVal))}</span>
                  <span class="bottle-card-order">Order #${escapeHtml(orderNum)}</span>
                </div>
                <div class="bottle-card-body">
                  <div class="bottle-card-stat">
                    <span class="bottle-card-label">Delivered</span>
                    <span class="bottle-card-val">${escapeHtml(delivered)}</span>
                  </div>
                  <div class="bottle-card-stat">
                    <span class="bottle-card-label">Returned</span>
                    <span class="bottle-card-val">${escapeHtml(empties)}</span>
                  </div>
                  <div class="bottle-card-stat">
                    <span class="bottle-card-label">Net change</span>
                    <span class="bottle-card-val ${diff !== 0 ? 'balance-change-pos' : ''}">${escapeHtml(changeStr)}</span>
                  </div>
                </div>
              </div>
            `;
          })
          .join('')
      : `
        <div class="empty-state" style="padding: 24px 14px; text-align: center; color: #64748b;">
          No bottle activity yet. Records appear after your first delivery.
        </div>
      `;

    const rowsHtml = paged.items.length
      ? paged.items
          .map((entry) => {
            const delivered = Number(entry.bottles_delivered || 0);
            const empties = Number(entry.empties_collected || 0);
            const diff = delivered - empties;
            const changeStr = diff > 0 ? `+${diff}` : String(diff);
            const dateVal = entry.order?.delivered_at || entry.created_at;
            const orderNum = entry.order?.order_number || '—';

            return `
              <tr>
                <td class="table-strong">${escapeHtml(formatDateShort(dateVal))}</td>
                <td>#${escapeHtml(orderNum)}</td>
                <td>${escapeHtml(delivered)}</td>
                <td>${escapeHtml(empties)}</td>
                <td class="${diff !== 0 ? 'balance-change-pos' : ''}">${escapeHtml(changeStr)}</td>
              </tr>
            `;
          })
          .join('')
      : `
        <tr>
          <td colspan="5" class="empty-state">No bottle activity yet. Records appear after your first delivery.</td>
        </tr>
      `;

    content.innerHTML = `
      <div class="grid-3">
        <div class="stat-card">
          <span class="stat-icon">${ICONS.drop}</span>
          <div>
            <p class="stat-value">${escapeHtml(summary.bottles_delivered)}</p>
            <p class="stat-label">Bottles delivered</p>
          </div>
        </div>

        <div class="stat-card">
          <span class="stat-icon">${ICONS.check}</span>
          <div>
            <p class="stat-value">${escapeHtml(summary.empties_collected)}</p>
            <p class="stat-label">Empties returned</p>
          </div>
        </div>

        <div class="stat-card">
          <span class="stat-icon">${ICONS.bookmark}</span>
          <div>
            <p class="stat-value">${escapeHtml(summary.balance)}</p>
            <p class="stat-label">Bottles with you ${shapeBalance && (shapeBalance.held_round > 0 || shapeBalance.held_slim > 0) ? `(${shapeBalance.held_round} Round, ${shapeBalance.held_slim} Slim)` : ''}</p>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title-group">
            <span class="card-icon">${ICONS.clock}</span>
            <h2 class="card-title">Balance activity</h2>
          </div>
        </div>

        <div class="notice balance-how-notice">
          <strong>1-to-1 Swap:</strong> Swap up to <strong>${escapeHtml(summary.balance)}</strong> ${Number(summary.balance) === 1 ? 'gallon' : 'gallons'} at the refill price. Extra gallons include a new container and add to your balance on delivery.
        </div>

        <div class="table-wrap desktop-only-table">
          <table class="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Order</th>
                <th>Delivered</th>
                <th>Empties collected</th>
                <th>Change</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
        </div>
        <div class="bottle-cards-list mobile-only-cards">
          ${mobileCardsHtml}
        </div>

        ${renderPaginationHtml(paged)}
      </div>
    `;

    content.querySelectorAll('.pagination-btn[data-page]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        const p = Number(btn.dataset.page);
        if (!isNaN(p) && p >= 1 && p <= paged.totalPages && p !== activityPage) {
          activityPage = p;
          renderView();
        }
      });
    });
  }

  async function loadData() {
    if (isDisposed) return;
    try {
      const [sum, act, shape] = await Promise.all([
        getCustomerBottleBalance(me.id),
        getCustomerLedgerActivity(me.id),
        getCustomerShapeBalance(me.id).catch(() => null),
      ]);
      if (isDisposed) return;
      summary = sum || { bottles_delivered: 0, empties_collected: 0, balance: 0 };
      activity = act || [];
      shapeBalance = shape;
      renderView();
    } catch (err) {
      if (isDisposed) return;
      showToast(err.message || 'Could not load bottle balance.', 'error');
    }
  }

  loadData();
  const unsub = subscribeCustomerOrders(me.id, () => {
    if (!isDisposed) loadData();
  });
  return () => {
    isDisposed = true;
    unsub();
  };
}

bootCustomerPage('bottle-balance', mount);
