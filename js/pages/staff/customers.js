import { bootStaffPage } from '../../core/nav.js';
import { subscribeStaffWorkspace } from '../../core/realtime.js';
import { escapeHtml, showToast } from '../../core/ui.js';
import { getAllCustomerBalances } from '../../services/ledgerService.js';

const USER_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20a8 8 0 0 1 16 0"/></svg>`;

function getBalancePillClass(balance) {
  const num = Number(balance || 0);
  if (num <= 0) return 'pill-green';
  if (num >= 4) return 'pill-amber';
  return 'pill-blue';
}

export async function mount() {
  const content = document.querySelector('#content');
  let customers = [];
  let searchQuery = '';

  function renderTableBody() {
    const tbody = document.querySelector('#staff-customers-tbody');
    if (!tbody) return;

    const q = searchQuery.trim().toLowerCase();
    const filtered = customers.filter((c) => {
      if (!q) return true;
      const name = String(c.full_name || '').toLowerCase();
      const phone = String(c.phone || '').toLowerCase();
      return name.includes(q) || phone.includes(q);
    });

    if (!filtered.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" class="empty-state">No matching customer records found.</td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = filtered
      .map((c) => {
        const bal = Number(c.balance || 0);
        return `
          <tr>
            <td class="table-strong">${escapeHtml(c.full_name || 'Customer')}</td>
            <td>${escapeHtml(c.phone || '—')}</td>
            <td>${escapeHtml(c.orders_count)}</td>
            <td>${escapeHtml(c.bottles_delivered)}</td>
            <td>${escapeHtml(c.empties_collected)}</td>
            <td>
              <span class="pill ${getBalancePillClass(bal)}">${escapeHtml(bal)} held</span>
            </td>
          </tr>
        `;
      })
      .join('');
  }

  content.innerHTML = `
    <div class="card">
      <div class="card-header">
        <div class="card-title-group">
          <span class="card-icon">${USER_ICON}</span>
          <h2 class="card-title">Customer records</h2>
        </div>
      </div>

      <div class="filter-bar-single">
        <div class="field">
          <label class="field-label" for="customer-search">Search customer</label>
          <input class="input" id="customer-search" type="search" placeholder="Name or contact number" value="${escapeHtml(searchQuery)}">
        </div>
      </div>

      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Customer</th>
              <th>Contact</th>
              <th>Orders</th>
              <th>Delivered</th>
              <th>Empties collected</th>
              <th>Balance</th>
            </tr>
          </thead>
          <tbody id="staff-customers-tbody"></tbody>
        </table>
      </div>
    </div>
  `;

  document.querySelector('#customer-search')?.addEventListener('input', (e) => {
    searchQuery = e.target.value;
    renderTableBody();
  });

  async function loadCustomers() {
    try {
      customers = await getAllCustomerBalances();
      renderTableBody();
    } catch (err) {
      showToast(err.message || 'Could not load customer records.', 'error');
    }
  }

  await loadCustomers();
  return subscribeStaffWorkspace(loadCustomers);
}

bootStaffPage('customers', mount);
