import { bootStaffPage } from '../../core/nav.js';
import { subscribeStaffWorkspace } from '../../core/realtime.js';
import { escapeHtml, formatTimeShort, paginateList, renderPaginationHtml, showToast } from '../../core/ui.js';
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
  let rawEntries = [];
  let searchQuery = '';
  let ledgerPage = 1;
  const ledgerPageSize = 10;

  async function loadData() {
    try {
      rawEntries = await getStaffLedgerEntries({ limit: 150 });
      renderView();
    } catch (err) {
      showToast(err.message || 'Could not load container ledger.', 'error');
    }
  }

  function renderView() {
    const totalEmpties = rawEntries.reduce((sum, e) => sum + Number(e.empties_collected || 0), 0);
    const totalRefilled = rawEntries.reduce((sum, e) => sum + Number(e.bottles_refilled || 0), 0);
    const totalDelivered = rawEntries.reduce((sum, e) => sum + Number(e.bottles_delivered || 0), 0);
    const totalCount = rawEntries.length;

    const q = searchQuery.trim().toLowerCase();
    const filtered = rawEntries.filter((entry) => {
      if (!q) return true;
      const orderNum = String(entry.order?.order_number || '').toLowerCase();
      const customerName = String(entry.customer?.full_name || '').toLowerCase();
      const recorderName = String(entry.recorder?.full_name || '').toLowerCase();
      return orderNum.includes(q) || customerName.includes(q) || recorderName.includes(q);
    });

    const paged = paginateList(filtered, ledgerPage, ledgerPageSize);

    const rowsHtml = paged.items.length
      ? paged.items
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
                <td style="font-weight: 600; color: #0f172a;">${escapeHtml(customerName)}</td>
                <td style="font-weight: 700; color: #0f766e;">${escapeHtml(entry.empties_collected)}</td>
                <td style="font-weight: 700; color: #1d5bd6;">${escapeHtml(entry.bottles_refilled)}</td>
                <td style="font-weight: 700; color: #0f172a;">${escapeHtml(entry.bottles_delivered)}</td>
                <td style="color: #64748b;">${escapeHtml(recorderName)}</td>
                <td style="color: #64748b; font-size: 13px;">${escapeHtml(formatTimeShort(timeVal))}</td>
              </tr>
            `;
          })
          .join('')
      : `
        <tr>
          <td colspan="7" class="empty-state" style="padding: 32px 16px; text-align: center; color: #64748b;">
            No container ledger entries match your search.
          </td>
        </tr>
      `;

    content.innerHTML = `
      <div class="grid-4" style="margin-bottom: 16px;">
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
            <p class="stat-label">Containers refilled</p>
          </div>
        </div>

        <div class="stat-card">
          <span class="stat-icon">${ICONS.pin}</span>
          <div>
            <p class="stat-value">${escapeHtml(totalDelivered)}</p>
            <p class="stat-label">Containers delivered</p>
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

      <div class="card" style="border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
        <div class="card-header" style="border-bottom: 1px solid #e2e8f0; padding: 14px 18px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
          <div class="card-title-group">
            <span class="card-icon">${ICONS.clock}</span>
            <h2 class="card-title" style="margin: 0; font-size: 15px; font-weight: 700; color: #0f172a;">Recent container transactions</h2>
          </div>
          <span class="pill pill-neutral" style="font-size: 11.5px; font-weight: 700;">
            ${filtered.length} ${filtered.length === 1 ? 'entry' : 'entries'}
          </span>
        </div>

        <div class="table-filter-toolbar">
          <div class="table-search-box">
            <span class="table-search-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            </span>
            <input type="search" id="ledger-search-input" placeholder="Search order #, customer, recorder..." value="${escapeHtml(searchQuery)}">
          </div>

          ${
            searchQuery
              ? `<button type="button" class="btn btn-light btn-sm" id="btn-reset-ledger-search" style="font-size: 12px; height: 36px;">Clear search</button>`
              : ''
          }
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

        ${renderPaginationHtml(paged)}
      </div>
    `;

    content.querySelector('#ledger-search-input')?.addEventListener('input', (e) => {
      searchQuery = e.target.value;
      ledgerPage = 1;
      renderView();
    });

    content.querySelector('#btn-reset-ledger-search')?.addEventListener('click', () => {
      searchQuery = '';
      ledgerPage = 1;
      renderView();
    });

    content.querySelectorAll('.pagination-btn[data-page]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const p = Number(btn.dataset.page);
        if (!isNaN(p) && p >= 1 && p !== ledgerPage) {
          ledgerPage = p;
          renderView();
        }
      });
    });
  }

  await loadData();
  return subscribeStaffWorkspace(loadData);
}

bootStaffPage('bottle-ledger', mount);
