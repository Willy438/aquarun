import { bootRiderPage, navigateRiderSpa, renderNav } from '../../core/nav.js';
import { STATUS_LABELS } from '../../core/constants.js';
import { subscribeRiderWorkspace } from '../../core/realtime.js';
import {
  escapeHtml,
  formatDateHeading,
  formatDateShort,
  formatPeso,
  getGreeting,
  getTodayManila,
  setBusy,
  showToast,
} from '../../core/ui.js';
import {
  formatAddressLine,
  formatSlotWindow,
  getEffectiveSlot,
  getOrderTotalGallons,
  summarizeOrderItems,
} from '../../services/ordersService.js';
import {
  getRiderDeliveries,
  riderStartDelivery,
  sortDeliveriesByScheduledSlot,
} from '../../services/deliveryService.js';

const ICONS = {
  truck: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="15" height="12" rx="1"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>`,
  clock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`,
  cube: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/></svg>`,
  drop: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3s6 6.7 6 11a6 6 0 1 1-12 0c0-4.3 6-11 6-11Z"/></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
};

const CHECKLIST_ITEMS = [
  'Load gallons and check the seals',
  'Confirm the address and delivery window',
  'Collect empty bottles at the door',
  'Collect cash, then tick Payment received',
];

export async function mount(me) {
  const pageTitle = document.querySelector('#page-title') || document.querySelector('.topbar h1');
  const pageSub = document.querySelector('#page-sub') || document.querySelector('.topbar-sub');
  const topbarRight = document.querySelector('#topbar-right');
  const content = document.querySelector('#content');

  if (pageTitle) pageTitle.textContent = getGreeting(me.full_name);
  if (pageSub) pageSub.textContent = formatDateHeading();
  if (topbarRight) {
    topbarRight.innerHTML = `
      <a href="profile.html" class="avail-pill ${me.is_available ? 'is-on' : 'is-off'}">
        ${me.is_available ? 'Available for assignment' : 'Unavailable'}
      </a>
    `;
  }

  const checkedSet = new Set([0]);

  async function loadAndRender() {
    try {
      const today = getTodayManila();
      const allDeliveries = await getRiderDeliveries(me.id);

      const activeDeliveries = sortDeliveriesByScheduledSlot(
        allDeliveries.filter((o) => ['rider_assigned', 'out_for_delivery'].includes(o.status))
      );

      const completedToday = allDeliveries.filter(
        (o) =>
          ['delivered', 'completed'].includes(o.status) &&
          (o.delivery_date === today || (o.delivered_at && o.delivered_at.startsWith(today)))
      ).length;

      const assignedTodayCount = activeDeliveries.length + completedToday;

      const nextDelivery = activeDeliveries[0] || null;
      const upNextList = activeDeliveries.slice(1);

      const bottlesToCollect = activeDeliveries.reduce(
        (sum, o) => sum + getOrderTotalGallons(o.items),
        0
      );

      let nextSlotBig = '—';
      let nextSlotSmall = '';
      if (nextDelivery) {
        const slot = getEffectiveSlot(nextDelivery);
        const parts = String(slot?.label || '').split(/\s*-\s*/);
        if (parts.length === 2) {
          nextSlotBig = parts[0].trim();
          nextSlotSmall = ` – ${parts[1].replace(/\s*(AM|PM)/i, '').trim()}`;
        } else {
          nextSlotBig = formatSlotWindow(slot);
        }
      }

      let heroHtml = '';
      if (nextDelivery) {
        const customerName = nextDelivery.customer?.full_name || 'Customer';
        const customerPhone = nextDelivery.customer?.phone ? ` · ${nextDelivery.customer.phone}` : '';
        const addressLine = formatAddressLine(nextDelivery.address);
        const slotWindow = formatSlotWindow(getEffectiveSlot(nextDelivery));
        const isToday = nextDelivery.delivery_date === today;
        const deliveryWindowLabel = `${isToday ? 'Today' : formatDateShort(nextDelivery.delivery_date)}, ${slotWindow}`;
        const bottlesQty = getOrderTotalGallons(nextDelivery.items);
        const isOut = nextDelivery.status === 'out_for_delivery';

        heroHtml = `
          <div class="hero-banner">
            <div class="hero-top">
              <div>
                <div class="hero-meta-line">
                  <span class="hero-pill-tag">Next delivery</span>
                  <span>Order #${escapeHtml(nextDelivery.order_number)} · ${escapeHtml(STATUS_LABELS[nextDelivery.status] || nextDelivery.status)}</span>
                </div>
                <h2 class="hero-status-title">
                  <a href="delivery-details.html?id=${encodeURIComponent(nextDelivery.id)}">${escapeHtml(customerName)}</a>
                </h2>
                <p class="hero-status-sub">${escapeHtml(addressLine)}${escapeHtml(customerPhone)}</p>
              </div>
              ${
                isOut
                  ? `<a class="btn btn-white btn-sm" href="complete-delivery.html?id=${encodeURIComponent(nextDelivery.id)}">Complete delivery</a>`
                  : `<button type="button" class="btn btn-white btn-sm" id="hero-start-delivery-btn" data-order-id="${escapeHtml(nextDelivery.id)}">Start delivery</button>`
              }
            </div>

            <div class="hero-strip hero-strip-4">
              <div class="hero-strip-item">
                <p class="hero-strip-label">Items</p>
                <p class="hero-strip-value">${escapeHtml(summarizeOrderItems(nextDelivery.items))}</p>
              </div>
              <div class="hero-strip-item">
                <p class="hero-strip-label">Delivery window</p>
                <p class="hero-strip-value">${escapeHtml(deliveryWindowLabel)}</p>
              </div>
              <div class="hero-strip-item">
                <p class="hero-strip-label">Empties to collect</p>
                <p class="hero-strip-value">${escapeHtml(bottlesQty)} ${bottlesQty === 1 ? 'bottle' : 'bottles'}</p>
              </div>
              <div class="hero-strip-item">
                <p class="hero-strip-label">Cash to collect</p>
                <p class="hero-strip-value">${escapeHtml(formatPeso(nextDelivery.total))} · Cash on delivery</p>
              </div>
            </div>
          </div>
        `;
      } else {
        heroHtml = `
          <div class="hero-banner">
            <div class="hero-top">
              <div>
                <div class="hero-meta-line">
                  <span class="hero-pill-tag">My deliveries</span>
                </div>
                <h2 class="hero-status-title">No assigned deliveries right now</h2>
                <p class="hero-status-sub">Make sure you are marked Available for assignment so station staff can assign orders to you.</p>
              </div>
              <a class="btn btn-white btn-sm" href="profile.html">Availability settings</a>
            </div>
          </div>
        `;
      }

      const upNextRowsHtml = upNextList.length
        ? upNextList
            .map((order) => {
              const slotText = formatSlotWindow(getEffectiveSlot(order));
              const custName = order.customer?.full_name || 'Customer';
              const brgyCity = [
                order.address?.barangay && order.address.barangay !== 'N/A'
                  ? order.address.barangay
                  : null,
                order.address?.city,
              ]
                .filter(Boolean)
                .join(', ');

              return `
                <tr class="is-clickable" data-order-id="${escapeHtml(order.id)}">
                  <td class="table-strong">${escapeHtml(slotText)}</td>
                  <td>
                    <div class="table-strong">${escapeHtml(custName)}</div>
                    ${brgyCity ? `<div class="table-sub">${escapeHtml(brgyCity)}</div>` : ''}
                  </td>
                  <td>${escapeHtml(summarizeOrderItems(order.items))}</td>
                  <td>#${escapeHtml(order.order_number)}</td>
                  <td class="table-strong">${escapeHtml(formatPeso(order.total))}</td>
                </tr>
              `;
            })
            .join('')
        : `
          <tr>
            <td colspan="5" class="empty-state">No other deliveries queued behind your current one.</td>
          </tr>
        `;

      const checklistHtml = CHECKLIST_ITEMS.map(
        (label, idx) => `
        <div class="checklist-item${checkedSet.has(idx) ? ' is-checked' : ''}" data-check-idx="${idx}">
          <span class="checklist-circle">${ICONS.check}</span>
          <span>${escapeHtml(label)}</span>
        </div>
      `
      ).join('');

      content.innerHTML = `
        <div class="grid-4">
          <div class="stat-card stat-card-between">
            <div>
              <p class="stat-label-top">Assigned today</p>
              <p class="stat-value">${escapeHtml(assignedTodayCount)}</p>
            </div>
            <span class="stat-icon">${ICONS.truck}</span>
          </div>

          <div class="stat-card stat-card-between">
            <div>
              <p class="stat-label-top">Next time slot</p>
              <p class="stat-value-slot">${escapeHtml(nextSlotBig)}<small>${escapeHtml(nextSlotSmall)}</small></p>
            </div>
            <span class="stat-icon">${ICONS.clock}</span>
          </div>

          <div class="stat-card stat-card-between">
            <div>
              <p class="stat-label-top">Completed today</p>
              <p class="stat-value">${escapeHtml(completedToday)}</p>
            </div>
            <span class="stat-icon">${ICONS.cube}</span>
          </div>

          <div class="stat-card stat-card-between">
            <div>
              <p class="stat-label-top">Bottles to collect</p>
              <p class="stat-value">${escapeHtml(bottlesToCollect)}</p>
            </div>
            <span class="stat-icon">${ICONS.drop}</span>
          </div>
        </div>

        <div class="grid-split">
          <div class="stack">
            ${heroHtml}

            <div class="card">
              <div class="card-header">
                <h2 class="card-title">Up next</h2>
                <a class="card-link" href="delivery-history.html">View all</a>
              </div>
              <div class="table-wrap">
                <table class="table">
                  <thead>
                    <tr>
                      <th>Time slot</th>
                      <th>Customer</th>
                      <th>Items</th>
                      <th>Order</th>
                      <th>Cash</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${upNextRowsHtml}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div class="card">
            <div class="card-header">
              <h2 class="card-title">Delivery checklist</h2>
            </div>
            <div class="checklist" id="rider-checklist">
              ${checklistHtml}
            </div>
            <div class="notice notice-tint">
              Customers see status updates only. There is no live GPS.
            </div>
          </div>
        </div>
      `;

      content.querySelectorAll('[data-check-idx]').forEach((item) => {
        item.addEventListener('click', () => {
          const idx = Number(item.dataset.checkIdx);
          if (checkedSet.has(idx)) {
            checkedSet.delete(idx);
          } else {
            checkedSet.add(idx);
          }
          item.classList.toggle('is-checked', checkedSet.has(idx));
        });
      });

      content.querySelectorAll('tr[data-order-id]').forEach((row) => {
        row.addEventListener('click', () => {
          navigateRiderSpa(`delivery-details.html?id=${encodeURIComponent(row.dataset.orderId)}`);
        });
      });

      content.querySelector('#hero-start-delivery-btn')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        const orderId = btn.dataset.orderId;
        setBusy(btn, true, 'Starting...');
        try {
          await riderStartDelivery(orderId);
          showToast('Delivery started! Status is now Out for delivery.', 'success');
          navigateRiderSpa(`delivery-details.html?id=${encodeURIComponent(orderId)}`);
        } catch (err) {
          showToast(err.message || 'Could not start delivery.', 'error');
          setBusy(btn, false);
        }
      });
    } catch (err) {
      showToast(err.message || 'Could not load deliveries.', 'error');
    }
  }

  await loadAndRender();
  return subscribeRiderWorkspace(me.id, () => {
    loadAndRender();
    renderNav(me, 'my-deliveries');
  });
}

bootRiderPage('my-deliveries', mount);
