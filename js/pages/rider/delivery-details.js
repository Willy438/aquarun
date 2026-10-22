import { bootRiderPage, navigateRiderSpa, renderNav } from '../../core/nav.js';
import { STATUS_LABELS } from '../../core/constants.js';
import { subscribeRiderWorkspace } from '../../core/realtime.js';
import {
  escapeHtml,
  formatDateShort,
  formatPeso,
  getTodayManila,
  setBusy,
  showToast,
} from '../../core/ui.js';
import {
  formatAddressFull,
  formatSlotWindow,
  getEffectiveSlot,
  isSlotAdjusted,
} from '../../services/ordersService.js';
import { getRiderCurrentOrder, riderStartDelivery } from '../../services/deliveryService.js';

const CHECK_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

export async function mount(me) {
  const pageTitle = document.querySelector('#page-title') || document.querySelector('.topbar h1');
  const pageSub = document.querySelector('#page-sub') || document.querySelector('.topbar-sub');
  const topbarRight = document.querySelector('#topbar-right');
  const content = document.querySelector('#content');

  const params = new URLSearchParams(window.location.search);
  let targetOrderId = params.get('id');

  if (topbarRight) {
    topbarRight.innerHTML = `<a class="btn btn-light btn-sm" href="my-deliveries.html">← My deliveries</a>`;
  }

  async function renderPage() {
    try {
      const order = await getRiderCurrentOrder(me.id, targetOrderId);
      if (!order) {
        if (pageTitle) pageTitle.textContent = 'Current delivery';
        if (pageSub) pageSub.textContent = 'No active delivery assigned right now.';
        content.innerHTML = `
          <div class="card empty-state">
            <h3>No active delivery selected</h3>
            <p>When station staff assign a ready order to you, its details and address will appear here.</p>
            <div style="margin-top: 16px;">
              <a class="btn btn-primary" href="my-deliveries.html">Back to My deliveries</a>
            </div>
          </div>
        `;
        return;
      }

      targetOrderId = order.id;
      const isToday = order.delivery_date === getTodayManila();
      const dateLabel = isToday ? 'Today' : formatDateShort(order.delivery_date);

      if (pageTitle) pageTitle.textContent = `Order #${order.order_number}`;
      if (pageSub) {
        pageSub.textContent = `${STATUS_LABELS[order.status] || order.status} · ${dateLabel}`;
      }

      const customerName = order.customer?.full_name || 'Customer';
      const customerPhone = order.customer?.phone || '—';
      const fullAddress = formatAddressFull(order.address);
      const barangayBadge =
        order.address?.barangay && order.address.barangay !== 'N/A'
          ? `Brgy. ${order.address.barangay.replace(/^Brgy\.?\s*/i, '')}`
          : order.address?.city || 'Delivery';

      const effectiveSlotText = formatSlotWindow(getEffectiveSlot(order));
      const preferredSlotText = formatSlotWindow(order.preferred_slot);
      const adjusted = isSlotAdjusted(order);

      const itemsRowsHtml = (order.items || [])
        .map((item) => {
          const name = (item.product?.name || 'Gallon Refill')
            .replace(/Purified Water Refill\s*\((.+)\)/i, '$1 Refill')
            .replace(/Mineral Water Refill\s*\((.+)\)/i, 'Mineral $1 Refill');
          const qty = Number(item.quantity || 0);
          const unitPrice = Number(item.unit_price || 0);
          return `
            <tr>
              <td>${escapeHtml(name)} · ${escapeHtml(formatPeso(unitPrice))} each</td>
              <td>${escapeHtml(qty)}</td>
              <td class="table-strong" style="text-align:right;">${escapeHtml(formatPeso(qty * unitPrice))}</td>
            </tr>
          `;
        })
        .join('');

      const step1Done = ['rider_assigned', 'out_for_delivery', 'delivered', 'completed'].includes(
        order.status
      );
      const step2Done = ['out_for_delivery', 'delivered', 'completed'].includes(order.status);
      const step3Done = ['delivered', 'completed'].includes(order.status);

      let actionBtnHtml = '';
      if (order.status === 'rider_assigned') {
        actionBtnHtml = `
          <button type="button" class="btn btn-primary btn-block" id="start-delivery-btn">Start delivery</button>
          <p class="proc-action-hint" style="text-align:center; margin-top:8px;">Changes the status to Out for delivery</p>
        `;
      } else if (order.status === 'out_for_delivery') {
        actionBtnHtml = `
          <a class="btn btn-primary btn-block" href="complete-delivery.html?id=${encodeURIComponent(order.id)}">Complete delivery</a>
          <p class="proc-action-hint" style="text-align:center; margin-top:8px;">Enter bottle counts and cash payment at the door</p>
        `;
      } else {
        actionBtnHtml = `
          <button type="button" class="btn btn-primary btn-block" disabled>Delivery completed</button>
        `;
      }

      content.innerHTML = `
        <div class="grid-split">
          <div class="stack">
            <div class="card">
              <div class="card-header">
                <h2 class="card-title">Customer</h2>
                <span class="pill pill-blue">${escapeHtml(barangayBadge)}</span>
              </div>

              <div class="rider-cust-grid">
                <div>
                  <p class="rider-field-caption">Name</p>
                  <p class="rider-field-value">${escapeHtml(customerName)}</p>
                </div>
                <div>
                  <p class="rider-field-caption">Contact</p>
                  <p class="rider-field-value">${escapeHtml(customerPhone)}</p>
                </div>
              </div>

              <div>
                <p class="rider-field-caption">Address</p>
                <p class="rider-field-value">${escapeHtml(fullAddress)}</p>
                ${
                  order.address?.landmark
                    ? `<p class="rider-landmark">Landmark: ${escapeHtml(order.address.landmark)}</p>`
                    : ''
                }
              </div>
            </div>

            <div class="card">
              <div class="card-header">
                <h2 class="card-title">Items</h2>
              </div>

              <div class="table-wrap">
                <table class="table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Qty</th>
                      <th style="text-align:right;">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${itemsRowsHtml}
                    <tr>
                      <td>Delivery service charge</td>
                      <td>1</td>
                      <td class="table-strong" style="text-align:right;">${escapeHtml(formatPeso(order.service_charge))}</td>
                    </tr>
                    <tr>
                      <td class="table-strong" colspan="2">Cash to collect</td>
                      <td class="rider-cash-total" style="text-align:right;">${escapeHtml(formatPeso(order.total))}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div class="card">
              <div class="card-header">
                <h2 class="card-title">Customer note</h2>
              </div>
              <p style="font-size:13.5px; color:var(--muted-blue); line-height:1.5;">
                ${escapeHtml(order.notes || 'No special delivery instructions provided.')}
              </p>
            </div>
          </div>

          <div class="stack">
            <div class="card">
              <div class="card-header">
                <h2 class="card-title">Delivery window</h2>
              </div>
              <p class="rider-window-big">${escapeHtml(effectiveSlotText)}</p>
              ${
                adjusted
                  ? `<div class="notice notice-warning">Staff adjusted this window. Customer preferred ${escapeHtml(preferredSlotText)}.</div>`
                  : `<div class="notice">Scheduled delivery window for ${escapeHtml(dateLabel.toLowerCase())}.</div>`
              }
            </div>

            <div class="card">
              <div class="card-header">
                <h2 class="card-title">Progress</h2>
              </div>

              <div class="rider-progress-list">
                <div class="rider-progress-step ${step1Done ? 'is-done' : ''}">
                  <span class="checklist-circle" style="${step1Done ? 'background:var(--blue-app);border-color:var(--blue-app);color:#fff;' : ''}">${CHECK_SVG}</span>
                  <span>Rider assigned</span>
                </div>
                <div class="rider-progress-step ${step2Done ? 'is-done' : ''}">
                  <span class="checklist-circle" style="${step2Done ? 'background:var(--blue-app);border-color:var(--blue-app);color:#fff;' : ''}">${CHECK_SVG}</span>
                  <span>Out for delivery</span>
                </div>
                <div class="rider-progress-step ${step3Done ? 'is-done' : ''}">
                  <span class="checklist-circle" style="${step3Done ? 'background:var(--blue-app);border-color:var(--blue-app);color:#fff;' : ''}">${CHECK_SVG}</span>
                  <span>Delivered</span>
                </div>
              </div>

              ${actionBtnHtml}
            </div>
          </div>
        </div>
      `;

      document.querySelector('#start-delivery-btn')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        setBusy(btn, true, 'Starting delivery...');
        try {
          await riderStartDelivery(order.id);
          showToast('Status updated to Out for delivery!', 'success');
          await renderNav(me, 'delivery-details');
          await renderPage();
        } catch (err) {
          showToast(err.message || 'Could not start delivery.', 'error');
          setBusy(btn, false);
        }
      });
    } catch (err) {
      showToast(err.message || 'Could not load delivery details.', 'error');
    }
  }

  await renderPage();
  return subscribeRiderWorkspace(me.id, renderPage);
}

bootRiderPage('delivery-details', mount);
