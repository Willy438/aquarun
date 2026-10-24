import { bootCustomerPage } from '../../core/nav.js';
import { subscribeCustomerOrders } from '../../core/realtime.js';
import { escapeHtml, formatDateShort, showToast } from '../../core/ui.js';
import {
  getCustomerBottleBalance,
  getCustomerLedgerActivity,
} from '../../services/ledgerService.js';

const ICONS = {
  drop: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3s6 6.7 6 11a6 6 0 1 1-12 0c0-4.3 6-11 6-11Z"/></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
  bookmark: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1Z"/></svg>`,
  clock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`,
};

export async function mount(me) {
  const content = document.querySelector('#content');

  async function loadAndRender() {
    try {
      const [summary, activity] = await Promise.all([
        getCustomerBottleBalance(me.id),
        getCustomerLedgerActivity(me.id),
      ]);

      const rowsHtml = activity.length
        ? activity
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
              <p class="stat-label">Bottles with you</p>
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

          <div class="table-wrap">
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
        </div>
      `;
    } catch (err) {
      showToast(err.message || 'Could not load bottle balance.', 'error');
    }
  }

  await loadAndRender();
  return subscribeCustomerOrders(me.id, loadAndRender);
}

bootCustomerPage('bottle-balance', mount);
