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
  matchesDateFilter,
  setBusy,
  showToast,
} from '../../core/ui.js';
import {
  checkOrderDeliveryTiming,
  formatAddressForNavigation,
  formatAddressLine,
  formatSlotWindow,
  getAddressMapUrl,
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
  wallet: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/></svg>`,
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
  let slotFilter = 'all';
  let sortBy = 'time_first';
  let riderView = 'active';

  async function loadAndRender({ forceRefresh = false } = {}) {
    try {
      const today = getTodayManila();
      const [allDeliveries, stationSettings, remittance] = await Promise.all([
        getRiderDeliveries(me.id, { forceRefresh }),
        getStationLocationSettings().catch(() => ({
          lat: 14.7565,
          lng: 121.0437,
          address: 'University of Caloocan City, Caloocan',
        })),
        getRiderRemittanceSummary(me.id).catch(() => ({ totalCash: 0, count: 0, unremittedOrders: [] })),
      ]);

      const stLat = stationSettings.lat || 14.7565;
      const stLng = stationSettings.lng || 121.0437;

      // Extract active deliveries and all orders today
      const rawActive = allDeliveries.filter((o) =>
        ['rider_assigned', 'out_for_delivery'].includes(o.status)
      );

      const todayOrders = allDeliveries.filter((o) =>
        matchesDateFilter(o.delivered_at || o.delivery_date, 'today')
      );

      // Extract unique time slots across active orders
      const slotMap = new Map();
      rawActive.forEach((o) => {
        const slot = getEffectiveSlot(o);
        const sId = slot?.id || 'standard';
        const label = formatSlotWindow(slot);
        const startTime = slot?.start_time || '99:99';
        if (!slotMap.has(sId)) {
          slotMap.set(sId, { id: sId, label, startTime, count: 0 });
        }
        slotMap.get(sId).count += 1;
      });
      const activeTimeSlots = Array.from(slotMap.values()).sort((a, b) =>
        a.startTime.localeCompare(b.startTime)
      );

      // Filter active orders by selected time window
      let filteredActive = rawActive;
      if (slotFilter !== 'all') {
        const hasSlot = rawActive.some((o) => (getEffectiveSlot(o)?.id || 'standard') === slotFilter);
        if (hasSlot) {
          filteredActive = rawActive.filter(
            (o) => (getEffectiveSlot(o)?.id || 'standard') === slotFilter
          );
        } else {
          slotFilter = 'all';
        }
      }

      // Add distance from station hub
      const mappedActive = filteredActive.map((order) => {
        const dist = calculateDistanceKm(
          stLat,
          stLng,
          order.address?.latitude,
          order.address?.longitude
        );
        return { ...order, _distFromHub: dist };
      });

      // Sort: Time window first (recommended default) vs Shortest distance
      if (sortBy === 'time_first') {
        mappedActive.sort((a, b) => {
          const slotA = getEffectiveSlot(a);
          const slotB = getEffectiveSlot(b);
          const timeA = slotA?.start_time || '99:99';
          const timeB = slotB?.start_time || '99:99';
          if (timeA !== timeB) return timeA.localeCompare(timeB);
          if (a._distFromHub !== null && b._distFromHub !== null) {
            return a._distFromHub - b._distFromHub;
          }
          if (a._distFromHub !== null) return -1;
          if (b._distFromHub !== null) return 1;
          return 0;
        });
      } else {
        mappedActive.sort((a, b) => {
          if (a._distFromHub !== null && b._distFromHub !== null) {
            return a._distFromHub - b._distFromHub;
          }
          if (a._distFromHub !== null) return -1;
          if (b._distFromHub !== null) return 1;
          return 0;
        });
      }

      const activeDeliveries = mappedActive;

      const completedToday = allDeliveries.filter(
        (o) =>
          ['delivered', 'completed'].includes(o.status) &&
          matchesDateFilter(o.delivered_at || o.delivery_date, 'today')
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

      const activeSlotObj = activeTimeSlots.find((x) => x.id === slotFilter);
      const activeSlotLabel = activeSlotObj ? activeSlotObj.label : 'All Windows';

      let timeFilterBarHtml = '';
      if (rawActive.length > 0) {
        timeFilterBarHtml = `
          <div class="card" style="border: 1px solid var(--border-color, #e2e8f0); background: #ffffff; padding: 12px 16px; margin-bottom: 14px;">
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;">
              <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                <span style="font-size: 11.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b; display: inline-flex; align-items: center; gap: 5px;">
                  ${ICONS.clock} Filter by Window:
                </span>
                <button type="button" class="btn btn-sm ${slotFilter === 'all' ? 'btn-primary' : 'btn-light'}" data-slot-filter="all" style="font-weight: 600; font-size: 12px; padding: 4px 10px;">
                  All Windows (${rawActive.length})
                </button>
                ${activeTimeSlots
                  .map(
                    (slot) => `
                  <button type="button" class="btn btn-sm ${slotFilter === slot.id ? 'btn-primary' : 'btn-light'}" data-slot-filter="${escapeHtml(slot.id)}" style="font-weight: 600; font-size: 12px; padding: 4px 10px;">
                    ${escapeHtml(slot.label)} (${slot.count})
                  </button>
                `
                  )
                  .join('')}
              </div>

              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 12px; font-weight: 600; color: #64748b;">Route order:</span>
                <select class="select" id="rider-sort-select" style="font-size: 12px; height: 32px; padding: 2px 24px 2px 8px; width: auto; border-radius: 6px;">
                  <option value="time_first" ${sortBy === 'time_first' ? 'selected' : ''}>Time window first</option>
                  <option value="distance" ${sortBy === 'distance' ? 'selected' : ''}>Shortest distance from station</option>
                </select>
              </div>
            </div>
          </div>
        `;
      }

      // Batch Trip Manifest Card - only shown if batch has multiple stops
      let tripManifestHtml = '';
      if (activeDeliveries.length > 1) {
        const breakdownParts = [];
        if (roundRefills > 0) breakdownParts.push(`${roundRefills} Round Refills`);
        if (slimRefills > 0) breakdownParts.push(`${slimRefills} Slim Refills`);
        if (newGallons > 0) breakdownParts.push(`${newGallons} New Containers`);

        tripManifestHtml = `
          <div class="trip-manifest-card">
            <div class="trip-manifest-top">
              <div class="trip-manifest-title">
                ${ICONS.truck}
                <span>Batch Run Manifest (${activeDeliveries.length} Stops${slotFilter !== 'all' ? ` · ${activeTimeSlots.find((x) => x.id === slotFilter)?.label || ''}` : ''})</span>
              </div>
              <span class="pill pill-neutral" style="font-weight: 700; font-size: 11.5px;">Nearest-Stop Route</span>
            </div>

            <div class="trip-manifest-stats">
              <div class="trip-stat-block">
                <span class="trip-stat-label">Total Gallons to Load</span>
                <span class="trip-stat-val">${totalGallonsToLoad} Gallons</span>
                <small style="font-size:11px;color:#64748b;margin-top:2px;">
                  ${breakdownParts.join(' · ') || 'Refills'}
                </small>
              </div>

              <div class="trip-stat-block">
                <span class="trip-stat-label">Total COD Cash to Collect</span>
                <span class="trip-stat-val" style="color:var(--blue-app, #1d5bd6);">${formatPeso(totalCashToCollect)}</span>
                <small style="font-size:11px;color:#64748b;margin-top:2px;">Cash on Delivery (COD)</small>
              </div>

              <div class="trip-stat-block">
                <span class="trip-stat-label">Hub Location</span>
                <span class="trip-stat-val" style="font-size:13px;font-weight:600;">${escapeHtml(stationSettings.address || 'Caloocan Station')}</span>
                <small style="font-size:11px;color:#64748b;margin-top:2px;">Starting depot</small>
              </div>
            </div>
          </div>
        `;
      }

      let heroHtml = '';
      if (nextDelivery) {
        const customerName = nextDelivery.customer?.full_name || 'Customer';
        const customerPhone = nextDelivery.customer?.phone || '';
        const addressLine = formatAddressLine(nextDelivery.address);
        const slotWindow = formatSlotWindow(getEffectiveSlot(nextDelivery));
        const isToday = nextDelivery.delivery_date === today;
        const deliveryWindowLabel = `${isToday ? 'Today' : formatDateShort(nextDelivery.delivery_date)}, ${slotWindow}`;
        const bottlesQty = expectedEmptiesByOrder.get(nextDelivery.id) ?? 0;
        const isOut = nextDelivery.status === 'out_for_delivery';
        const stopDistText = nextDelivery._distFromHub !== null ? `${nextDelivery._distFromHub} km from hub` : 'First stop';
        const timing = checkOrderDeliveryTiming(nextDelivery);

        const mapUrl = getAddressMapUrl(nextDelivery.address, { navigate: true });

        heroHtml = `
          <div class="rider-active-card">
            <div class="rider-active-header">
              <div class="rider-active-badges">
                <span class="stop-sequence-badge is-first">${ICONS.pin} Stop 1 of ${activeDeliveries.length} (${stopDistText})</span>
                <span class="pill pill-neutral" style="font-weight:700;">#${escapeHtml(nextDelivery.order_number)}</span>
                <span class="pill pill-blue" style="font-weight:700;">
                  ${escapeHtml(STATUS_LABELS[nextDelivery.status] || nextDelivery.status)}
                </span>
                ${
                  timing.isEarly
                    ? `<span class="pill pill-amber" style="font-weight:700;">Ahead of window (${escapeHtml(timing.slotWindow)})</span>`
                    : timing.isLate
                      ? `<span class="pill pill-rose" style="font-weight:700;">Past window (${escapeHtml(timing.slotWindow)})</span>`
                      : ''
                }
              </div>
              <span style="font-size: 12.5px; color: #64748b; font-weight: 500;">
                Window: <strong style="color: #0f172a;">${escapeHtml(deliveryWindowLabel)}</strong>
              </span>
            </div>

            <div class="rider-active-customer">
              <h2 class="rider-customer-name">
                <a href="delivery-details.html?id=${encodeURIComponent(nextDelivery.id)}">${escapeHtml(customerName)}</a>
              </h2>
              <p class="rider-customer-address">
                ${escapeHtml(addressLine)}${
                  customerPhone
                    ? ` <span class="rider-customer-phone-meta">· Phone: <strong>${escapeHtml(customerPhone)}</strong></span>`
                    : ''
                }
              </p>
              <div class="rider-quick-actions">
                <a class="rider-action-chip is-primary" href="${mapUrl}" target="_blank" rel="noopener">
                  ${ICONS.map} Open in Google Maps
                </a>
              </div>
            </div>

            <div class="rider-metrics-grid">
              <div class="rider-metric-cell">
                <span class="rider-metric-label">Cash to Collect</span>
                <span class="rider-metric-value is-amount">${escapeHtml(formatPeso(nextDelivery.total))}</span>
                <small style="font-size: 11px; color: #64748b; margin-top: 2px;">Cash on delivery (COD)</small>
              </div>
              <div class="rider-metric-cell">
                <span class="rider-metric-label">Items to Deliver</span>
                <span class="rider-metric-value">${escapeHtml(summarizeOrderItems(nextDelivery.items))}</span>
                <small style="font-size: 11px; color: #64748b; margin-top: 2px;">Check container seals</small>
              </div>
              <div class="rider-metric-cell">
                <span class="rider-metric-label">Empties to Collect</span>
                <span class="rider-metric-value">${escapeHtml(bottlesQty)} ${bottlesQty === 1 ? 'bottle' : 'bottles'}</span>
                <small style="font-size: 11px; color: #64748b; margin-top: 2px;">Bottle swap at door</small>
              </div>
            </div>

            <div class="rider-active-footer">
              ${
                isOut
                  ? `<a class="rider-primary-btn" href="complete-delivery.html?id=${encodeURIComponent(nextDelivery.id)}">
                      ${ICONS.check} Complete Delivery &amp; Record Handover
                    </a>`
                  : `<button type="button" class="rider-primary-btn" id="hero-start-delivery-btn" data-order-id="${escapeHtml(nextDelivery.id)}">
                      ${ICONS.truck} ${unstartedOrders.length > 1 ? `Start Batch Run (${unstartedOrders.length} stops)` : 'Start Delivery to Customer'}
                    </button>`
              }
            </div>
          </div>
        `;
      } else if (completedToday > 0) {
        heroHtml = `
          <div class="card" style="padding: 32px 24px; text-align: center; background: #ffffff; border: 1px solid var(--border-color, #e2e8f0); border-radius: 14px;">
            <div style="width: 48px; height: 48px; border-radius: 50%; background: #dcfce7; display: flex; align-items: center; justify-content: center; margin: 0 auto 12px; color: #15803d;">
              ${ICONS.check}
            </div>
            <h2 style="font-size: 18px; font-weight: 800; color: #0f172a; margin: 0 0 6px 0;">All assigned deliveries completed today</h2>
            <p style="font-size: 13.5px; color: #64748b; max-width: 440px; margin: 0 auto 18px auto; line-height: 1.5;">
              You have completed all ${completedToday} ${completedToday === 1 ? 'delivery' : 'deliveries'} assigned to you today. Review your cash record or remain available for incoming dispatch.
            </p>
            <div>
              <a class="btn btn-primary btn-sm" href="remittance.html" style="font-weight: 700;">Review cash record</a>
            </div>
          </div>
        `;
      } else {
        heroHtml = `
          <div class="card" style="padding: 36px 24px; text-align: center; background: #ffffff; border: 1px solid var(--border-color, #e2e8f0); border-radius: 14px;">
            <div style="width: 48px; height: 48px; border-radius: 50%; background: #f1f5f9; display: flex; align-items: center; justify-content: center; margin: 0 auto 12px; color: #64748b;">
              ${ICONS.truck}
            </div>
            <h2 style="font-size: 18px; font-weight: 800; color: #0f172a; margin: 0 0 6px 0;">No assigned deliveries right now</h2>
            <p style="font-size: 13.5px; color: #64748b; max-width: 440px; margin: 0 auto; line-height: 1.5;">
              You are ready for assignments. Station staff will dispatch customer orders to you as refill orders come in.
            </p>
          </div>
        `;
      }

      const allTodayRowsHtml = todayOrders.length
        ? todayOrders
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
              const statusPill = STATUS_LABELS[order.status] || order.status;
              const statusClass =
                order.status === 'completed'
                  ? 'pill-green'
                  : order.status === 'out_for_delivery'
                  ? 'pill-blue'
                  : order.status === 'attempted'
                  ? 'pill-amber'
                  : 'pill-neutral';

              return `
                <tr class="is-clickable" data-order-id="${escapeHtml(order.id)}">
                  <td>
                    <span class="pill ${statusClass}" style="font-size: 11px; font-weight: 700;">
                      ${escapeHtml(statusPill)}
                    </span>
                  </td>
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
            <td colspan="6" class="empty-state">No orders assigned to you yet today.</td>
          </tr>
        `;

      const upNextCardsHtml = upNextList.length
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
              const mapUrl = getAddressMapUrl(order.address, { navigate: true });

              return `
                <div class="route-mobile-card is-clickable" data-order-id="${escapeHtml(order.id)}">
                  <div class="route-mobile-card-top">
                    <span class="stop-sequence-badge">${ICONS.pin} Stop #${stopNumber} (${distText})</span>
                    <span class="pill pill-neutral" style="font-size: 11px;">${escapeHtml(slotText)}</span>
                  </div>
                  <div class="route-mobile-card-main">
                    <div class="route-mobile-cust">${escapeHtml(custName)}</div>
                    ${brgyCity ? `<div class="route-mobile-address">${escapeHtml(brgyCity)}</div>` : ''}
                    <div class="route-mobile-items">${escapeHtml(summarizeOrderItems(order.items))}</div>
                  </div>
                  <div class="route-mobile-card-footer">
                    <div class="route-mobile-order-num">#${escapeHtml(order.order_number)} · <strong style="color: var(--blue-app);">${escapeHtml(formatPeso(order.total))}</strong></div>
                    <a class="btn btn-sm btn-outline-blue" href="${mapUrl}" target="_blank" rel="noopener" onclick="event.stopPropagation();" style="font-size: 11.5px; padding: 4px 10px;">
                      ${ICONS.map} Open Maps
                    </a>
                  </div>
                </div>
              `;
            })
            .join('')
        : `
          <div class="empty-state" style="padding: 24px 16px; text-align: center; color: #64748b;">
            No other deliveries queued behind your current one.
          </div>
        `;

      const allTodayCardsHtml = todayOrders.length
        ? todayOrders
            .map((order) => {
              const slotText = formatSlotWindow(getEffectiveSlot(order));
              const custName = order.customer?.full_name || 'Customer';
              const statusClass =
                order.status === 'delivered' || order.status === 'completed'
                  ? 'pill-green'
                  : order.status === 'out_for_delivery'
                  ? 'pill-blue'
                  : order.status === 'attempted'
                  ? 'pill-amber'
                  : 'pill-neutral';

              return `
                <div class="route-mobile-card is-clickable" data-order-id="${escapeHtml(order.id)}">
                  <div class="route-mobile-card-top">
                    <span class="pill ${statusClass}" style="font-size: 11px; font-weight: 700;">
                      ${escapeHtml(STATUS_LABELS[order.status] || order.status)}
                    </span>
                    <span class="pill pill-neutral" style="font-size: 11px;">${escapeHtml(slotText)}</span>
                  </div>
                  <div class="route-mobile-card-main">
                    <div class="route-mobile-cust">${escapeHtml(custName)}</div>
                    <div class="route-mobile-items">${escapeHtml(summarizeOrderItems(order.items))}</div>
                  </div>
                  <div class="route-mobile-card-footer">
                    <span class="route-mobile-order-num">#${escapeHtml(order.order_number)}</span>
                    <strong style="color: var(--blue-app);">${escapeHtml(formatPeso(order.total))}</strong>
                  </div>
                </div>
              `;
            })
            .join('')
        : `
          <div class="empty-state" style="padding: 24px 16px; text-align: center; color: #64748b;">
            No orders assigned to you yet today.
          </div>
        `;

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
              const mapUrl = getAddressMapUrl(order.address, { navigate: true });

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

        <div class="card" style="border: 1px solid var(--border-color, #e2e8f0); background: #ffffff; padding: 14px 18px; margin-bottom: 14px;">
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap;">
            <div style="display: flex; align-items: center; gap: 14px;">
              <div style="width: 40px; height: 40px; border-radius: 10px; background: #f8fafc; border: 1px solid #e2e8f0; color: var(--blue-app, #1d5bd6); display: flex; align-items: center; justify-content: center;">
                ${ICONS.wallet}
              </div>
              <div>
                <p style="margin: 0; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b;">
                  Cash on Hand &amp; Shift Turnover
                </p>
                <div style="display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin-top: 3px;">
                  <span style="font-size: 19px; font-weight: 800; color: #0f172a;">
                    ${formatPeso(remittance.unsubmittedCash || 0)}
                    <span style="font-size: 12.5px; font-weight: 500; color: #64748b;">in pocket (${remittance.unsubmittedCount || 0} ${remittance.unsubmittedCount === 1 ? 'order' : 'orders'})</span>
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
              <a href="remittance.html" class="btn btn-light btn-sm" style="font-weight: 600; font-size: 12px;">
                Cash Record
              </a>
              ${
                remittance.unsubmittedCount > 0
                  ? `<button type="button" class="btn btn-primary btn-sm" id="btn-rider-remit" style="font-weight: 700;">Turn over cash (${formatPeso(remittance.unsubmittedCash)})</button>`
                  : remittance.submittedCount > 0
                    ? `<span class="pill pill-amber" style="font-size: 12px; padding: 5px 12px; font-weight: 700;">Turnover Submitted · Waiting for cashier</span>`
                    : `<span class="pill pill-neutral" style="font-size: 12px; padding: 5px 12px;">All cash approved</span>`
              }
            </div>
          </div>
        </div>

        ${timeFilterBarHtml}
        ${tripManifestHtml}

        <div class="grid-split">
          <div class="stack">
            ${heroHtml}

            <div class="card">
              <div class="card-header" style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px;">
                <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                  <h2 class="card-title" style="margin: 0;">Route sequence</h2>
                  <div style="display: inline-flex; background: #f1f5f9; padding: 2px; border-radius: 8px; gap: 2px;">
                    <button type="button" class="btn btn-sm ${riderView === 'active' ? 'btn-primary' : 'btn-light'}" data-rider-tab="active" style="border: none; font-size: 11.5px; padding: 3px 10px; border-radius: 6px;">
                      Active (${rawActive.length})
                    </button>
                    <button type="button" class="btn btn-sm ${riderView === 'all_today' ? 'btn-primary' : 'btn-light'}" data-rider-tab="all_today" style="border: none; font-size: 11.5px; padding: 3px 10px; border-radius: 6px;">
                      All Today (${todayOrders.length})
                    </button>
                  </div>
                </div>
                <a class="card-link" href="delivery-history.html">Delivery history</a>
              </div>
              ${
                riderView === 'all_today'
                  ? `
                    <div class="table-wrap desktop-only-table">
                      <table class="table">
                        <thead>
                          <tr>
                            <th>Status</th>
                            <th>Time slot</th>
                            <th>Customer</th>
                            <th>Items</th>
                            <th>Order</th>
                            <th>Cash</th>
                          </tr>
                        </thead>
                        <tbody>
                          ${allTodayRowsHtml}
                        </tbody>
                      </table>
                    </div>
                    <div class="route-mobile-cards mobile-only-cards">
                      ${allTodayCardsHtml}
                    </div>
                  `
                  : upNextList.length > 0
                  ? `
                    <div class="table-wrap desktop-only-table">
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
                    <div class="route-mobile-cards mobile-only-cards">
                      ${upNextCardsHtml}
                    </div>
                  `
                  : `
                    <div class="empty-state" style="padding: 28px 20px; text-align: center;">
                      <p style="margin: 0; font-size: 13.5px; color: #64748b;">
                        ${
                          nextDelivery
                            ? 'You are currently on your final assigned stop for this run.'
                            : 'No deliveries queued right now. New dispatch stops will appear here once assigned.'
                        }
                      </p>
                    </div>
                  `
              }
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

      // Single unified Start Delivery button (handles both single & batch trips)
      content.querySelector('#hero-start-delivery-btn')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        const orderId = btn.dataset.orderId;

        // If batch has multiple unstarted orders, prompt and start all
        if (unstartedOrders.length > 1) {
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
              title: 'Start Batch Delivery?',
              message: `Depart station with all ${unstartedOrders.length} assigned orders? They will transition to "Out for delivery".`,
              confirmText: 'Yes, start trip',
              cancelText: 'Cancel',
            });
            if (!confirmed) return;
          }

          setBusy(btn, true, 'Starting trip...');
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
          return;
        }

        // Single order start
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
          await loadAndRender();
        } catch (err) {
          showToast(err.message || 'Could not start delivery.', 'error');
          setBusy(btn, false);
        }
      });

      content.querySelectorAll('[data-slot-filter]').forEach((btn) => {
        btn.addEventListener('click', () => {
          slotFilter = btn.dataset.slotFilter;
          loadAndRender();
        });
      });

      content.querySelector('#rider-sort-select')?.addEventListener('change', (e) => {
        sortBy = e.target.value;
        loadAndRender();
      });

      content.querySelectorAll('[data-rider-tab]').forEach((btn) => {
        btn.addEventListener('click', () => {
          riderView = btn.dataset.riderTab;
          loadAndRender();
        });
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
            <div style="max-height: 220px; overflow: auto; border: 1px solid #e2e8f0; border-radius: 8px;">
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
  const unsub = subscribeRiderWorkspace(me.id, () => {
    loadAndRender({ forceRefresh: true });
    renderNav(me, 'my-deliveries');
  });

  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      loadAndRender({ forceRefresh: true });
      renderNav(me, 'my-deliveries');
    }
  };
  document.addEventListener('visibilitychange', onVisibilityChange);

  const pollTimer = setInterval(() => {
    if (document.visibilityState === 'visible') {
      loadAndRender({ forceRefresh: true });
    }
  }, 6000);

  return () => {
    clearInterval(pollTimer);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    unsub();
  };
}

bootRiderPage('my-deliveries', mount);
