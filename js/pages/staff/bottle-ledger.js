import { bootStaffPage } from '../../core/nav.js';
import { subscribeStaffWorkspace } from '../../core/realtime.js';
import { escapeHtml, formatTimeShort, showToast } from '../../core/ui.js';
import { getStaffLedgerEntries } from '../../services/ledgerService.js';

const ICONS = {
  bookmark: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1Z"/></svg>`,
  drop: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3s6 6.7 6 11a6 6 0 1 1-12 0c0-4.3 6-11 6-11Z"/></svg>`,
  pin: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-5.6-7-11a7 7 0 1 1 14 0c0 5.4-7 11-7 11Z"/><circle cx="12" cy="10" r="2.5"/></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
  clock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`,
};

function formatRecorderShort(fullName = '') {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'Station';
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

export async function mount() {
  const content = document.querySelector('#content');

  async function loadAndRender() {
    try {
      const entries = await getStaffLedgerEntries({ limit: 100 });

      const totalEmpties = entries.reduce((sum, e) => sum + Number(e.empties_collected || 0), 0);
      const totalRefilled = entries.reduce((sum, e) => sum + Number(e.bottles_refilled || 0), 0);
      const totalDelivered = entries.reduce((sum, e) => sum + Number(e.bottles_delivered || 0), 0);
      const totalCount = entries.length;

      const rowsHtml = entries.length
        ? entries
            .map((entry) => {
              const orderNum = entry.order?.order_number || '—';
              const customerName = entry.customer?.full_name || 'Customer';
              const recorderName = entry.recorder?.full_name
                ? formatRecorderShort(entry.recorder.full_name)
                : 'Station';
              const timeVal = entry.order?.delivered_at || entry.created_at;

              return `
                <tr>
                  <td class="table-order-id">#${escapeHtml(orderNum)}</td>
                  <td>${escapeHtml(customerName)}</td>
                  <td>${escapeHtml(entry.empties_collected)}</td>
                  <td>${escapeHtml(entry.bottles_refilled)}</td>
                  <td>${escapeHtml(entry.bottles_delivered)}</td>
                  <td>${escapeHtml(recorderName)}</td>
                  <td>${escapeHtml(formatTimeShort(timeVal))}</td>
                </tr>
              `;
            })
            .join('')
        : `
          <tr>
            <td colspan="7" class="empty-state">No bottle ledger entries recorded yet.</td>
          </tr>
        `;

      content.innerHTML = `
        <div class="grid-4">
          <div class="stat-card">
            <span class="stat-icon">${ICONS.bookmark}</span>
            <div>
              <p class="stat-value">${escapeHtml(totalEmpties)}</p>
              <p class="stat-label">Empties received</p>
            </div>
          </div>

          <div class="stat-card">
            <span class="stat-icon">${ICONS.drop}</span>
            <div>
              <p class="stat-value">${escapeHtml(totalRefilled)}</p>
              <p class="stat-label">Bottles refilled</p>
            </div>
          </div>

          <div class="stat-card">
            <span class="stat-icon">${ICONS.pin}</span>
            <div>
              <p class="stat-value">${escapeHtml(totalDelivered)}</p>
              <p class="stat-label">Bottles delivered</p>
            </div>
          </div>

          <div class="stat-card">
            <span class="stat-icon">${ICONS.check}</span>
            <div>
              <p class="stat-value">${escapeHtml(totalCount)}</p>
              <p class="stat-label">Ledger entries</p>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div class="card-title-group">
              <span class="card-icon">${ICONS.clock}</span>
              <h2 class="card-title">Recent entries</h2>
            </div>
          </div>

          <div class="notice balance-how-notice">
            <strong>Balance rule:</strong> A customer's balance is bottles delivered minus empties collected.
          </div>

          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Customer</th>
                  <th>Empties</th>
                  <th>Refilled</th>
                  <th>Delivered</th>
                  <th>Recorded by</th>
                  <th>Time</th>
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
      showToast(err.message || 'Could not load bottle ledger.', 'error');
    }
  }

  await loadAndRender();
  return subscribeStaffWorkspace(loadAndRender);
}

bootStaffPage('bottle-ledger', mount);
