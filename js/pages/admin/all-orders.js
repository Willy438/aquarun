// Read-only station-wide order list for Admin with interactive Order Details modal and URL filter support.
import { STATUS_LABELS, STATUS_PILL_TONE } from '../../core/constants.js';
import { bootAdminPage } from '../../core/nav.js';
import { subscribeAdminWorkspace } from '../../core/realtime.js';
import {
  escapeHtml,
  formatDateHeading,
  formatDateShort,
  formatPeso,
  formatTimeShort,
  getInitials,
  getTodayManila,
  showToast,
} from '../../core/ui.js';
import {
  formatAddressFull,
  formatSlotCompact,
  formatSlotWindow,
  getAllOrdersForStaff,
  getEffectiveSlot,
  getOrderItemPricingTag,
  summarizeOrderItems,
} from '../../services/ordersService.js';

export async function mount() {
  const titleEl = document.getElementById('page-title');
  const subEl = document.getElementById('page-sub');
  const rightEl = document.getElementById('topbar-right');
  const content = document.getElementById('content');

  if (titleEl) titleEl.textContent = 'All orders';
  if (rightEl) {
    rightEl.innerHTML = `<span class="pill pill-neutral">Read-only</span>`;
  }

  const params = new URLSearchParams(window.location.search);
  let activeFilter = params.get('filter') || 'all';
  let searchQuery = params.get('search') || '';
  let orders = [];

  async function loadOrders() {
    try {
      orders = await getAllOrdersForStaff({ limit: 300 });
      if (subEl) {
        subEl.textContent = `${formatDateHeading(getTodayManila())} · ${orders.length} order${
          orders.length === 1 ? '' : 's'
        }`;
      }
      renderView();
    } catch (err) {
      showToast(err.message || 'Could not load orders.', 'error');
    }
  }

  function matchesFilter(order, filterKey) {
    switch (filterKey) {
      case 'submitted':
        return order.status === 'submitted';
      case 'refilling':
        return ['confirmed', 'refilling', 'ready'].includes(order.status);
      case 'out_for_delivery':
        return ['rider_assigned', 'out_for_delivery'].includes(order.status);
      case 'completed':
        return ['delivered', 'completed'].includes(order.status);
      default:
        return true;
    }
  }

  function openOrderDetailsModal(order) {
    const tone = STATUS_PILL_TONE[order.status] || 'neutral';
    const statusLabel = STATUS_LABELS[order.status] || order.status;
    const customerName = order.customer?.full_name || 'Customer';
    const customerPhone = order.customer?.phone || '—';
    const addressText = formatAddressFull(order.address);
    const slotText = formatSlotWindow(getEffectiveSlot(order));
    const riderName = order.rider?.full_name || 'Not assigned';
    const itemsListHtml = (order.items || [])
      .map(
        (it) => `
          <div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid #f1f5f9;">
            <span>${escapeHtml(it.quantity)} × ${escapeHtml(it.product?.name || 'Water Refill')} (${escapeHtml(getOrderItemPricingTag(it))} · ${escapeHtml(formatPeso(it.unit_price || 0))})</span>
            <span style="font-weight:700;">${escapeHtml(formatPeso(Number(it.quantity || 0) * Number(it.unit_price || 0)))}</span>
          </div>
        `
      )
      .join('');

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modal-header">
          <div>
            <h3 class="modal-title">Order #${escapeHtml(order.order_number)}</h3>
            <p class="text-muted" style="font-size:12px; margin-top:2px;">
              Placed ${escapeHtml(formatDateShort(order.created_at))} at ${escapeHtml(formatTimeShort(order.created_at))}
            </p>
          </div>
          <span class="pill pill-${escapeHtml(tone)}">${escapeHtml(statusLabel)}</span>
        </div>
        <div class="modal-body stack" style="gap:12px;">
          <div>
            <p class="label" style="margin-bottom:3px;">Customer &amp; Contact</p>
            <p style="color:var(--ink-navy); font-weight:600;">${escapeHtml(customerName)} · ${escapeHtml(customerPhone)}</p>
          </div>
          <div>
            <p class="label" style="margin-bottom:3px;">Delivery Address</p>
            <p style="color:var(--ink-navy);">${escapeHtml(addressText)}</p>
          </div>
          <div class="form-row">
            <div class="field">
              <p class="label">Scheduled Window</p>
              <p style="color:var(--ink-navy); font-weight:600;">${escapeHtml(slotText)}</p>
            </div>
            <div class="field">
              <p class="label">Assigned Rider</p>
              <p style="color:var(--ink-navy); font-weight:600;">${escapeHtml(riderName)}</p>
            </div>
          </div>
          <div>
            <p class="label" style="margin-bottom:4px;">Order Items</p>
            ${itemsListHtml || '<p class="text-muted">No items listed</p>'}
            <div style="display:flex; justify-content:space-between; padding:6px 0; font-size:13px;">
              <span>Delivery service charge</span>
              <span>${escapeHtml(formatPeso(order.service_charge))}</span>
            </div>
            <div style="display:flex; justify-content:space-between; padding-top:8px; font-size:15px; font-weight:800; color:var(--ink-navy);">
              <span>Total (${order.payment_status === 'paid' ? 'Paid COD' : 'Unpaid COD'})</span>
              <span>${escapeHtml(formatPeso(order.total))}</span>
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
    const countAll = orders.length;
    const countSubmitted = orders.filter((o) => matchesFilter(o, 'submitted')).length;
    const countRefilling = orders.filter((o) => matchesFilter(o, 'refilling')).length;
    const countOut = orders.filter((o) => matchesFilter(o, 'out_for_delivery')).length;
    const countCompleted = orders.filter((o) => matchesFilter(o, 'completed')).length;

    const q = searchQuery.trim().toLowerCase();
    const filtered = orders.filter((o) => {
      if (!matchesFilter(o, activeFilter)) return false;
      if (!q) return true;
      const num = String(o.order_number || '').toLowerCase();
      const cust = String(o.customer?.full_name || '').toLowerCase();
      const rider = String(o.rider?.full_name || '').toLowerCase();
      return num.includes(q) || cust.includes(q) || rider.includes(q);
    });

    const avatarTones = [''];

    const rowsHtml =
      filtered.length === 0
        ? `<tr><td colspan="7" class="text-muted" style="text-align:center; padding: 28px;">No orders match your filter.</td></tr>`
        : filtered
            .map((order, idx) => {
              const customerName = order.customer?.full_name || 'Customer';
              const slotText = formatSlotCompact(getEffectiveSlot(order));
              const riderName = order.rider?.full_name || '—';
              const tone = STATUS_PILL_TONE[order.status] || 'neutral';
              const statusLabel = STATUS_LABELS[order.status] || order.status;

              return `
                <tr class="is-clickable" data-view-order="${escapeHtml(order.id)}" title="Click to view order details">
                  <td style="font-weight: 700;">#${escapeHtml(order.order_number)}</td>
                  <td>
                    <div class="admin-customer-cell">
                      <span class="dash-avatar ${avatarTones[idx % avatarTones.length]}">${escapeHtml(
                        getInitials(customerName)
                      )}</span>
                      <span style="font-weight: 600;">${escapeHtml(customerName)}</span>
                    </div>
                  </td>
                  <td>${escapeHtml(summarizeOrderItems(order.items))}</td>
                  <td>${escapeHtml(slotText)}</td>
                  <td>${escapeHtml(riderName)}</td>
                  <td style="font-weight: 700; text-align: right;">${escapeHtml(formatPeso(order.total))}</td>
                  <td style="text-align: center;"><span class="pill pill-${escapeHtml(tone)}">${escapeHtml(statusLabel)}</span></td>
                </tr>
              `;
            })
            .join('');

    content.innerHTML = `
      <section class="card">
        <div class="admin-table-toolbar">
          <input
            type="search"
            class="input admin-search-input"
            id="admin-order-search"
            placeholder="Search order or customer"
            value="${escapeHtml(searchQuery)}"
          />
          <div class="filter-bar">
            <button type="button" class="filter-chip${activeFilter === 'all' ? ' is-active' : ''}" data-filter="all">All ${countAll}</button>
            <button type="button" class="filter-chip${activeFilter === 'submitted' ? ' is-active' : ''}" data-filter="submitted">Submitted ${countSubmitted}</button>
            <button type="button" class="filter-chip${activeFilter === 'refilling' ? ' is-active' : ''}" data-filter="refilling">Refilling ${countRefilling}</button>
            <button type="button" class="filter-chip${activeFilter === 'out_for_delivery' ? ' is-active' : ''}" data-filter="out_for_delivery">Out for delivery ${countOut}</button>
            <button type="button" class="filter-chip${activeFilter === 'completed' ? ' is-active' : ''}" data-filter="completed">Completed ${countCompleted}</button>
          </div>
        </div>

        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Customer</th>
                <th>Items</th>
                <th>Slot</th>
                <th>Rider</th>
                <th style="width: 110px; text-align: right;">Total</th>
                <th style="width: 130px; text-align: center;">Status</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
        </div>
      </section>
    `;

    const searchInput = content.querySelector('#admin-order-search');
    searchInput?.addEventListener('input', (e) => {
      searchQuery = e.target.value;
      const pos = searchInput.selectionStart;
      renderView();
      const nextInput = content.querySelector('#admin-order-search');
      if (nextInput) {
        nextInput.focus();
        nextInput.setSelectionRange(pos, pos);
      }
    });

    content.querySelectorAll('[data-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        activeFilter = btn.getAttribute('data-filter') || 'all';
        renderView();
      });
    });

    content.querySelectorAll('[data-view-order]').forEach((row) => {
      row.addEventListener('click', () => {
        const id = row.getAttribute('data-view-order');
        const found = orders.find((o) => o.id === id);
        if (found) openOrderDetailsModal(found);
      });
    });
  }

  await loadOrders();
  const unsubscribe = subscribeAdminWorkspace(() => {
    loadOrders();
  });
  return () => unsubscribe();
}

bootAdminPage('all-orders', mount);
