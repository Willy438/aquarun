import { bootRiderPage, navigateRiderSpa, renderNav } from '../../core/nav.js';
import { setCachedProfile } from '../../core/auth.js';
import { STATUS_LABELS } from '../../core/constants.js';
import { subscribeRiderWorkspace } from '../../core/realtime.js';
import {
  confirmModal,
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
  checkOrderDeliveryTiming,
  formatAddressLine,
  formatSlotWindow,
  getEffectiveSlot,
  getRiderRemittanceSummary,
  isOrderItemNewContainer,
  openRiderRemittanceProofModal,
  promptDeliveryTimingModal,
  recordDeliveryTimingNote,
  riderRemitCash,
  riderSubmitRemittance,
  summarizeOrderItems,
} from '../../services/ordersService.js';
import {
  getRiderDeliveries,
  riderStartBatchDelivery,
  riderStartDelivery,
  sortDeliveriesByScheduledSlot,
} from '../../services/deliveryService.js';
import { getCustomerBalanceForOrder } from '../../services/ledgerService.js';
import { setRiderAvailability } from '../../services/usersService.js';
import { calculateDistanceKm, getStationLocationSettings } from '../../services/settingsService.js';

const ICONS = {
  truck: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px;"><rect x="1" y="4" width="15" height="12" rx="1"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>`,
  clock: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`,
  cube: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/></svg>`,
  drop: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3s6 6.7 6 11a6 6 0 1 1-12 0c0-4.3 6-11 6-11Z"/></svg>`,
  check: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
  pin: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:2px;"><path d="M12 21s-7-5.6-7-11a7 7 0 1 1 14 0c0 5.4-7 11-7 11Z"/><circle cx="12" cy="10" r="2.5"/></svg>`,
  map: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px;"><polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/><line x1="9" y1="3" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="21"/></svg>`,
};

const CHECKLIST_ITEMS = [
  'Load gallons and check the seals',
  'Confirm the address and delivery window',
  'Collect empty bottles at the door',
  'Collect cash, then tick Payment received',
];

export async function mount(initialMe) {
  let me = initialMe;
  const pageTitle = document.querySelector('#page-title') || document.querySelector('.topbar h1');
  const pageSub = document.querySelector('#page-sub') || document.querySelector('.topbar-sub');
  const topbarRight = document.querySelector('#topbar-right');
  const content = document.querySelector('#content');

  if (pageTitle) pageTitle.textContent = getGreeting(me.full_name, me.role || 'rider');
  if (pageSub) pageSub.textContent = formatDateHeading();

  function renderTopbarShiftToggle() {
    if (!topbarRight) return;
    topbarRight.innerHTML = `
      <div class="avail-topbar-wrap">
        <span class="avail-pill ${me.is_available ? 'is-on' : 'is-off'}" id="topbar-avail-pill">
          ${me.is_available ? 'On shift · Available' : 'Off shift'}
        </span>
        <label class="toggle-switch" title="Toggle shift availability" aria-label="Toggle shift availability">
          <input type="checkbox" id="topbar-avail-toggle" ${me.is_available ? 'checked' : ''}>
          <span class="toggle-slider"></span>
        </label>
      </div>
    `;
    topbarRight.querySelector('#topbar-avail-toggle')?.addEventListener('change', async (e) => {
      const input = e.currentTarget;
      await handleAvailabilityChange(input.checked, input);
    });
  }

  async function handleAvailabilityChange(nextState, sourceInput = null) {
    if (sourceInput) sourceInput.disabled = true;
    try {
      const updated = await setRiderAvailability(me.id, nextState);
      me = { ...me, is_available: updated.is_available };
      setCachedProfile(me);
      renderTopbarShiftToggle();
      await renderNav(me, 'my-deliveries');
      const heroToggleBtn = content.querySelector('#hero-shift-toggle-btn');
      if (heroToggleBtn) {
        heroToggleBtn.textContent = me.is_available ? 'Go off shift' : 'Go on shift';
      }
      showToast(
        me.is_available ? 'Shift is ON — available for assignment.' : 'Shift is OFF — marked unavailable.',
        'success'
      );
    } catch (err) {
      if (sourceInput) sourceInput.checked = !nextState;
      showToast(err.message || 'Could not update shift status.', 'error');
    } finally {
      if (sourceInput) sourceInput.disabled = false;
    }
  }

  renderTopbarShiftToggle();

  const checkedSet = new Set([0]);

  async function loadAndRender() {
    try {
      const today = getTodayManila();
      const [allDeliveries, stationSettings, remittance] = await Promise.all([
        getRiderDeliveries(me.id),
        getStationLocationSettings().catch(() => ({
          lat: 14.7565,
          lng: 121.0437,
          address: 'University of Caloocan City, Caloocan',
        })),
        getRiderRemittanceSummary(me.id).catch(() => ({ totalCash: 0, count: 0, unremittedOrders: [] })),
      ]);

      const stLat = stationSettings.lat || 14.7565;
      const stLng = stationSettings.lng || 121.0437;

      // Extract active deliveries
      const rawActive = allDeliveries.filter((o) =>
        ['rider_assigned', 'out_for_delivery'].includes(o.status)
      );

      // Closeness / Nearest-neighbor sorting:
      // Sort orders by distance from station hub so rider saves gas
      const activeDeliveries = rawActive
        .map((order) => {
          const dist = calculateDistanceKm(
            stLat,
            stLng,
            order.address?.latitude,
            order.address?.longitude
          );
          return { ...order, _distFromHub: dist };
        })
        .sort((a, b) => {
          if (a._distFromHub !== null && b._distFromHub !== null) {
            return a._distFromHub - b._distFromHub;
          }
          if (a._distFromHub !== null) return -1;
          if (b._distFromHub !== null) return 1;
          return 0;
        });

      const completedToday = allDeliveries.filter(
        (o) =>
          ['delivered', 'completed'].includes(o.status) &&
          (o.delivery_date === today || (o.delivered_at && o.delivered_at.startsWith(today)))
      ).length;

      const assignedTodayCount = activeDeliveries.length + completedToday;

      const nextDelivery = activeDeliveries[0] || null;
      const upNextList = activeDeliveries.slice(1);

      // Calculate Trip Vehicle Load Manifest
      let totalGallonsToLoad = 0;
      let roundRefills = 0;
      let slimRefills = 0;
      let newGallons = 0;
      let totalCashToCollect = 0;

      activeDeliveries.forEach((o) => {
        if (o.payment_status !== 'paid') {
          totalCashToCollect += Number(o.total || 0);
        }
        (o.items || []).forEach((it) => {
          const qty = Number(it.quantity || 0);
          totalGallonsToLoad += qty;
          const name = String(it.product?.name || '').toLowerCase();
          if (isOrderItemNewContainer(it)) {
            newGallons += qty;
          } else if (name.includes('slim')) {
            slimRefills += qty;
          } else {
            roundRefills += qty;
          }
        });
      });

      const unstartedOrders = activeDeliveries.filter((o) => o.status === 'rider_assigned');

      // Compute expected empties per active order using swap items & customer balance
      const expectedEmptiesByOrder = new Map();
      await Promise.all(
        activeDeliveries.map(async (o) => {
          const swapQty = (o.items || []).reduce((s, it) => {
            if (it.product?.is_returnable === false || isOrderItemNewContainer(it)) return s;
            return s + Number(it.quantity || 0);
          }, 0);
          if (swapQty === 0) {
            expectedEmptiesByOrder.set(o.id, 0);
            return;
          }
          const bal = await getCustomerBalanceForOrder(o.id).catch(() => 0);
          expectedEmptiesByOrder.set(o.id, Math.min(swapQty, Math.max(0, Number(bal || 0))));
        })
      );

      const bottlesToCollect = activeDeliveries.reduce(
        (sum, o) => sum + (expectedEmptiesByOrder.get(o.id) ?? 0),
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

      // Batch Trip Manifest Card
      let tripManifestHtml = '';
      if (activeDeliveries.length > 0) {
        const breakdownParts = [];
        if (roundRefills > 0) breakdownParts.push(`${roundRefills} Round Refills`);
        if (slimRefills > 0) breakdownParts.push(`${slimRefills} Slim Refills`);
        if (newGallons > 0) breakdownParts.push(`${newGallons} New Containers`);

        tripManifestHtml = `
          <div class="trip-manifest-card">
            <div class="trip-manifest-top">
              <div class="trip-manifest-title">
                ${ICONS.truck}
                <span>Batch Trip Manifest (${activeDeliveries.length} ${activeDeliveries.length === 1 ? 'Stop' : 'Stops'})</span>
              </div>
              ${
                unstartedOrders.length > 0
                  ? `<button type="button" class="trip-depart-btn" id="batch-depart-btn">
                      ${ICONS.truck} Depart Station (${unstartedOrders.length} to start)
                    </button>`
                  : `<span class="pill" style="background:rgba(255,255,255,0.22);color:#fff;font-weight:700;">● Trip in Progress</span>`
              }
            </div>

            <div class="trip-manifest-stats">
              <div class="trip-stat-block">
                <span class="trip-stat-label">Total Gallons to Load</span>
                <span class="trip-stat-val">${totalGallonsToLoad} Gallons</span>
                <small style="font-size:11px;color:#dbeafe;margin-top:2px;">
                  ${breakdownParts.join(' · ') || 'Refill Gallons'}
                </small>
              </div>

              <div class="trip-stat-block">
                <span class="trip-stat-label">Total COD Cash to Collect</span>
                <span class="trip-stat-val">${formatPeso(totalCashToCollect)}</span>
                <small style="font-size:11px;color:#dbeafe;margin-top:2px;">Cash on Delivery (COD)</small>
              </div>

              <div class="trip-stat-block">
                <span class="trip-stat-label">Fuel-Saver Closeness</span>
                <span class="trip-stat-val">Nearest-First</span>
                <small style="font-size:11px;color:#dbeafe;margin-top:2px;">Sorted by station hub distance</small>
              </div>
            </div>

            <div class="trip-manifest-footer">
              <span class="trip-manifest-hub">
                ${ICONS.pin} Reference Hub: <strong>${escapeHtml(stationSettings.address || 'Caloocan Station')}</strong>
              </span>
            </div>
          </div>
        `;
      }

      let heroHtml = '';
      if (nextDelivery) {
        const customerName = nextDelivery.customer?.full_name || 'Customer';
        const customerPhone = nextDelivery.customer?.phone ? ` · ${nextDelivery.customer.phone}` : '';
        const addressLine = formatAddressLine(nextDelivery.address);
        const slotWindow = formatSlotWindow(getEffectiveSlot(nextDelivery));
        const isToday = nextDelivery.delivery_date === today;
        const deliveryWindowLabel = `${isToday ? 'Today' : formatDateShort(nextDelivery.delivery_date)}, ${slotWindow}`;
        const bottlesQty = expectedEmptiesByOrder.get(nextDelivery.id) ?? 0;
        const isOut = nextDelivery.status === 'out_for_delivery';
        const stopDistText = nextDelivery._distFromHub !== null ? `${nextDelivery._distFromHub} km from hub` : 'First stop';
        const timing = checkOrderDeliveryTiming(nextDelivery);

        const mapUrl = nextDelivery.address?.latitude && nextDelivery.address?.longitude
          ? `https://www.google.com/maps/dir/?api=1&destination=${nextDelivery.address.latitude},${nextDelivery.address.longitude}`
          : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(formatAddressLine(nextDelivery.address))}`;

        heroHtml = `
          <div class="hero-banner">
            <div class="hero-top">
              <div>
                <div class="hero-meta-line" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                  <span class="stop-sequence-badge is-first">${ICONS.pin} Stop #1 (${stopDistText})</span>
                  <span>Order #${escapeHtml(nextDelivery.order_number)} · ${escapeHtml(STATUS_LABELS[nextDelivery.status] || nextDelivery.status)}</span>
                  ${
                    timing.isEarly
                      ? `<span class="pill pill-amber" style="background:#fef3c7;color:#92400e;font-weight:700;font-size:11px;">Ahead of window (${escapeHtml(timing.slotWindow)})</span>`
                      : timing.isLate
                        ? `<span class="pill pill-rose" style="background:#fee2e2;color:#991b1b;font-weight:700;font-size:11px;">Past window (${escapeHtml(timing.slotWindow)})</span>`
                        : ''
                  }
                </div>
                <h2 class="hero-status-title">
                  <a href="delivery-details.html?id=${encodeURIComponent(nextDelivery.id)}">${escapeHtml(customerName)}</a>
                </h2>
                <p class="hero-status-sub">${escapeHtml(addressLine)}${escapeHtml(customerPhone)}</p>
                <div>
                  <a class="stop-map-link" href="${mapUrl}" target="_blank" rel="noopener" style="color:#ffffff;text-decoration:underline;">
                    ${ICONS.map} Open in Google Maps
                  </a>
                </div>
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
                <p class="hero-status-sub">Make sure you are marked Available for assignment so station staff can assign batch orders to you.</p>
              </div>
              <button type="button" class="btn btn-white btn-sm" id="hero-shift-toggle-btn">
                ${me.is_available ? 'Go off shift' : 'Go on shift'}
              </button>
            </div>
          </div>
        `;
      }

      const upNextRowsHtml = upNextList.length
        ? upNextList
            .map((order, idx) => {
              const stopNumber = idx + 2;
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

              const distText = order._distFromHub !== null ? `${order._distFromHub} km` : '—';
              const mapUrl = order.address?.latitude && order.address?.longitude
                ? `https://www.google.com/maps/dir/?api=1&destination=${order.address.latitude},${order.address.longitude}`
                : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(formatAddressLine(order.address))}`;

              return `
                <tr class="is-clickable" data-order-id="${escapeHtml(order.id)}">
                  <td>
                    <span class="stop-sequence-badge">${ICONS.pin} Stop #${stopNumber} (${distText})</span>
                  </td>
                  <td class="table-strong">${escapeHtml(slotText)}</td>
                  <td>
                    <div class="table-strong">${escapeHtml(custName)}</div>
                    ${brgyCity ? `<div class="table-sub">${escapeHtml(brgyCity)}</div>` : ''}
                    <div>
                      <a class="stop-map-link" href="${mapUrl}" target="_blank" rel="noopener" onclick="event.stopPropagation();">
                        ${ICONS.map} Open Maps
                      </a>
                    </div>
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
            <td colspan="6" class="empty-state">No other deliveries queued behind your current one.</td>
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

        <div class="card" style="border-left: 4px solid #10b981; background: #f0fdf4; padding: 14px 18px; margin-bottom: 14px;">
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap;">
            <div style="display: flex; align-items: center; gap: 14px;">
              <div style="width: 42px; height: 42px; border-radius: 10px; background: #f1f5f9; color: var(--ink-navy); display: flex; align-items: center; justify-content: center; font-size: 20px; font-weight: 800;">
                ₱
              </div>
              <div>
                <p style="margin: 0; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: var(--muted-blue);">
                  Cash on Hand &amp; Shift Sales
                </p>
                <div style="display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin-top: 3px;">
                  <span style="font-size: 19px; font-weight: 800; color: var(--ink-navy);">
                    ${formatPeso(remittance.unsubmittedCash || 0)}
                    <span style="font-size: 12.5px; font-weight: 500; color: var(--muted-blue);">in pocket (${remittance.unsubmittedCount || 0} ${remittance.unsubmittedCount === 1 ? 'order' : 'orders'})</span>
                  </span>
                  ${
                    remittance.submittedCash > 0
                      ? `<span class="pill pill-amber" style="font-size: 11px; font-weight: 700;">${formatPeso(remittance.submittedCash)} awaiting cashier</span>`
                      : ''
                  }
                  ${
                    remittance.settledCash > 0
                      ? `<span style="font-size: 12.5px; color: #166534; font-weight: 600;">· ${formatPeso(remittance.settledCash)} settled</span>`
                      : ''
                  }
                </div>
              </div>
            </div>
            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
              <button type="button" class="btn btn-light btn-sm" id="btn-view-remittance-proof" style="font-weight: 600; font-size: 12px;">
                Sales &amp; Proof Log
              </button>
              ${
                remittance.unsubmittedCount > 0
                  ? `<button type="button" class="btn btn-primary btn-sm" id="btn-rider-remit" style="font-weight: 700;">Turn over cash (${formatPeso(remittance.unsubmittedCash)}) &rarr;</button>`
                  : remittance.submittedCount > 0
                    ? `<span class="pill pill-amber" style="font-size: 12px; padding: 5px 12px; font-weight: 700;">Turnover Submitted · Awaiting Cashier</span>`
                    : `<span class="pill pill-neutral" style="font-size: 12px; padding: 5px 12px;">All cash reconciled</span>`
              }
            </div>
          </div>
        </div>

        ${tripManifestHtml}

        <div class="grid-split">
          <div class="stack">
            ${heroHtml}

            <div class="card">
              <div class="card-header">
                <h2 class="card-title">Route sequence (Up next)</h2>
                <a class="card-link" href="delivery-history.html">View all</a>
              </div>
              <div class="table-wrap">
                <table class="table">
                  <thead>
                    <tr>
                      <th>Stop</th>
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
              Orders are sequenced by closest stop to station hub to minimize gas usage.
            </div>
          </div>
        </div>
      `;

      // Batch Depart Button Handler
      content.querySelector('#batch-depart-btn')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        if (!unstartedOrders.length) return;

        const timingResults = unstartedOrders.map((o) => ({
          order: o,
          timing: checkOrderDeliveryTiming(o),
        }));
        const earlyOrLate = timingResults.filter((x) => x.timing.isEarly || x.timing.isLate);

        let batchTimingReason = null;
        let referenceTiming = null;

        if (earlyOrLate.length > 0) {
          referenceTiming = earlyOrLate[0].timing;
          const res = await promptDeliveryTimingModal({
            actionType: 'batch_depart',
            timing: referenceTiming,
            order: earlyOrLate[0].order,
            batchCount: earlyOrLate.length,
          });
          if (!res.confirmed) return;
          batchTimingReason = res.reason;
        } else {
          const confirmed = await confirmModal({
            title: 'Depart Station with Batch?',
            message: `Start delivery for all ${unstartedOrders.length} assigned orders? They will all transition to "Out for delivery".`,
            confirmText: 'Yes, depart station',
            cancelText: 'Cancel',
          });
          if (!confirmed) return;
        }

        setBusy(btn, true, 'Starting...');
        try {
          if (batchTimingReason && referenceTiming) {
            for (const item of earlyOrLate) {
              await recordDeliveryTimingNote(
                item.order.id,
                'depart',
                batchTimingReason,
                item.timing
              );
            }
          }
          const orderIds = unstartedOrders.map((o) => o.id);
          await riderStartBatchDelivery(orderIds);
          showToast(`Trip started! ${orderIds.length} orders are now Out for delivery.`, 'success');
          await loadAndRender();
        } catch (err) {
          showToast(err.message || 'Could not start batch delivery.', 'error');
          setBusy(btn, false);
        }
      });

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

      content.querySelector('#btn-rider-remit')?.addEventListener('click', () => {
        openRiderRemittanceModal(remittance);
      });

      content.querySelector('#btn-view-remittance-proof')?.addEventListener('click', () => {
        openRiderRemittanceProofModal(remittance, me);
      });

      content.querySelector('#hero-shift-toggle-btn')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        await handleAvailabilityChange(!me.is_available);
        btn.disabled = false;
      });

      content.querySelector('#hero-start-delivery-btn')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        const orderId = btn.dataset.orderId;
        const targetOrder = allDeliveries.find((o) => o.id === orderId);
        let timingReason = null;
        let timing = null;

        if (targetOrder) {
          timing = checkOrderDeliveryTiming(targetOrder);
          if (timing.isEarly || timing.isLate) {
            const res = await promptDeliveryTimingModal({
              actionType: 'depart',
              timing,
              order: targetOrder,
            });
            if (!res.confirmed) return;
            timingReason = res.reason;
          }
        }
        setBusy(btn, true, 'Starting...');
        try {
          if (timingReason && timing) {
            await recordDeliveryTimingNote(orderId, 'depart', timingReason, timing);
          }
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

  function openRiderRemittanceModal(remittance) {
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
            <td style="padding: 9px 8px; text-align: right; font-weight: 700; color: #15803d;">${escapeHtml(formatPeso(o.total))}</td>
          </tr>
        `;
      })
      .join('');

    backdrop.innerHTML = `
      <div class="modal-card" style="max-width: 520px; width: 100%; border-radius: 12px; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1); background: #ffffff;">
        <div class="modal-header" style="display: flex; align-items: center; justify-content: space-between; padding: 18px 22px; border-bottom: 1px solid #e2e8f0;">
          <div>
            <h3 class="modal-title" style="margin: 0; font-size: 17px; font-weight: 800; color: #0f172a;">Turn Over &amp; Remit Cash</h3>
            <p style="margin: 2px 0 0; font-size: 12.5px; color: #64748b;">Turn over Cash on Delivery (COD) collections to station cashier</p>
          </div>
          <button type="button" class="modal-close" data-action="cancel" style="border: none; background: transparent; font-size: 22px; line-height: 1; cursor: pointer; color: #94a3b8; padding: 4px;">×</button>
        </div>
        <div class="modal-body stack" style="gap: 14px; padding: 18px 22px;">
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 18px; display: flex; justify-content: space-between; align-items: center;">
            <div>
              <p style="margin: 0; font-size: 11px; text-transform: uppercase; font-weight: 700; color: var(--muted-blue); letter-spacing: 0.5px;">Total Cash to Turn Over</p>
              <p style="margin: 2px 0 0; font-size: 24px; font-weight: 800; color: var(--ink-navy);">${formatPeso(cashToRemit)}</p>
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
          <button type="button" class="btn btn-primary" id="btn-confirm-remit-modal" style="font-weight: 700;">
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

    backdrop.querySelector('#btn-confirm-remit-modal')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      setBusy(btn, true, 'Submitting remittance...');
      try {
        await riderSubmitRemittance(me.id);
        showToast(`Cash remittance of ${formatPeso(cashToRemit)} submitted to station! Cashier can now approve.`, 'success');
        close();
        await loadAndRender();
      } catch (err) {
        showToast(err.message || 'Could not submit cash remittance.', 'error');
        setBusy(btn, false);
      }
    });
  }

  await loadAndRender();
  return subscribeRiderWorkspace(me.id, () => {
    loadAndRender();
    renderNav(me, 'my-deliveries');
  });
}

bootRiderPage('my-deliveries', mount);
