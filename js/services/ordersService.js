// Create, cancel, advance status, assign rider. Pages never call Supabase directly, they call this file.
import { supabase } from '../config/supabaseClient.js';
import {
  CUSTOMER_STEPS,
  CUSTOMER_STEP_OF,
  CUSTOMER_STATUS_HEADINGS,
  STAFF_STEPS,
  STAFF_STEP_OF,
  STATUS_LABELS,
} from '../core/constants.js';
import {
  cachedQuery,
  escapeHtml,
  formatDateShort,
  formatPeso,
  formatTimeShort,
  getTodayManila,
  invalidateDataCache,
} from '../core/ui.js';

const ORDER_SELECT = `
  id,
  order_number,
  customer_id,
  address_id,
  delivery_date,
  preferred_slot_id,
  scheduled_slot_id,
  slot_adjusted_by,
  slot_note,
  rider_id,
  status,
  payment_method,
  payment_status,
  paid_at,
  subtotal,
  service_charge,
  total,
  notes,
  created_at,
  delivered_at,
  customer:profiles!customer_id(id, full_name, phone),
  address:addresses!address_id(id, label, street, barangay, city, landmark),
  preferred_slot:time_slots!preferred_slot_id(id, label, start_time, end_time),
  scheduled_slot:time_slots!scheduled_slot_id(id, label, start_time, end_time),
  rider:profiles!rider_id(id, full_name, phone),
  items:order_items(id, product_id, quantity, unit_price, product:products(id, name, unit, price, is_returnable)),
  status_log:order_status_log(status, changed_at)
`;

export function isOrderItemEmptyContainer(item) {
  if (!item) return false;
  const name = String(item.product?.name || '').toLowerCase();
  if (name.includes('empty')) return true;
  const unitPrice = Number(item.unit_price ?? 0);
  const baseSwapPrice = Number(item.product?.price ?? unitPrice);
  return item.product?.is_returnable && unitPrice > baseSwapPrice + 0.005 && unitPrice <= 135;
}

export function isOrderItemNewContainer(item) {
  if (!item || item.product?.is_returnable === false) return false;
  if (isOrderItemEmptyContainer(item)) return false;
  const unitPrice = Number(item.unit_price ?? 0);
  const baseSwapPrice = Number(item.product?.price ?? unitPrice);
  return unitPrice > baseSwapPrice + 0.005;
}

export function getOrderItemPricingTag(item) {
  if (isOrderItemEmptyContainer(item)) return 'Empty container only';
  if (isOrderItemNewContainer(item)) return 'New gallon + water';
  if (item?.product?.is_returnable === false) return 'Sold outright';
  return 'Swap refill';
}

export function summarizeOrderItems(items = []) {
  if (!items || items.length === 0) return 'Water refill';
  return items
    .map((item) => {
      const name = item.product?.name || 'Gallon Refill';
      const shortName = name
        .replace(/Purified Water Refill\s*\((.+)\)/i, '$1')
        .replace(/Mineral Water Refill\s*\((.+)\)/i, 'Mineral $1')
        .replace(/refill/i, '')
        .trim();
      const qty = Number(item.quantity || 0);
      const baseText = `${qty} ${shortName}${qty > 1 && !/s$/i.test(shortName) ? 's' : ''}`;
      if (item.product?.is_returnable === false) {
        return baseText;
      }
      if (isOrderItemEmptyContainer(item)) {
        return `${baseText} (empty container only)`;
      }
      if (isOrderItemNewContainer(item)) {
        return `${baseText} (new gallon + water)`;
      }
      return `${baseText} (swap)`;
    })
    .join(', ');
}

export function getOrderTotalGallons(items = []) {
  return (items || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0);
}

export function formatSlotWindow(slot) {
  if (!slot?.label) return 'Scheduled slot';
  return slot.label.replace(/\s*-\s*/g, '–');
}

export function formatSlotCompact(slot) {
  if (!slot?.label) return '—';
  return slot.label
    .replace(/:00/g, '')
    .replace(/\s*-\s*/g, '–')
    .replace(/(\d+)\s*(AM|PM)\s*–\s*(\d+)\s*\2/i, '$1–$3 $2');
}

export function getEffectiveSlot(order) {
  return order?.scheduled_slot || order?.preferred_slot || null;
}

export function isSlotAdjusted(order) {
  return Boolean(
    order?.scheduled_slot_id &&
      order?.preferred_slot_id &&
      order.scheduled_slot_id !== order.preferred_slot_id
  );
}

export function formatAddressLine(addr) {
  if (!addr) return 'Saved address';
  const brgy =
    addr.barangay && addr.barangay !== 'N/A'
      ? `Brgy. ${addr.barangay.replace(/^Brgy\.?\s*/i, '')}`
      : null;
  const parts = [addr.label, brgy, addr.city].filter(Boolean);
  return parts.length > 1 ? parts.join(', ') : `${addr.label} · ${addr.street}`;
}

export function formatAddressFull(addr) {
  if (!addr) return 'Saved address';
  const brgy =
    addr.barangay && addr.barangay !== 'N/A'
      ? `Brgy. ${addr.barangay.replace(/^Brgy\.?\s*/i, '')}`
      : null;
  return [addr.street, brgy, addr.city].filter(Boolean).join(', ');
}

/**
 * Checks whether the current time is ahead of, within, or after the order's scheduled delivery window.
 */
export function checkOrderDeliveryTiming(order) {
  const today = getTodayManila();
  const deliveryDate = order?.delivery_date || today;
  const slot = getEffectiveSlot(order);
  const slotWindow = formatSlotWindow(slot);
  const isToday = deliveryDate === today;
  const isFutureDate = deliveryDate > today;
  const isPastDate = deliveryDate < today;

  if (!slot?.start_time || !slot?.end_time) {
    return {
      isEarly: isFutureDate,
      isCurrentWindow: isToday,
      isLate: isPastDate,
      isFutureDate,
      isPastDate,
      minutesDiff: 0,
      slotWindow,
      warningText: isFutureDate
        ? `Scheduled for future date (${deliveryDate})`
        : isPastDate
          ? `Scheduled for past date (${deliveryDate})`
          : '',
      deliveryDate,
      slotStartMinutes: 0,
      slotEndMinutes: 0,
      currentMinutes: 0,
    };
  }

  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const [sH, sM] = slot.start_time.split(':').map(Number);
  const slotStartMinutes = sH * 60 + (sM || 0);

  const [eH, eM] = slot.end_time.split(':').map(Number);
  const slotEndMinutes = eH * 60 + (eM || 0);

  // Strict check: early if before slot start, late if after slot end
  const isEarly = isFutureDate || (isToday && currentMinutes < slotStartMinutes);
  const isLate = isPastDate || (isToday && currentMinutes > slotEndMinutes);
  const isCurrentWindow = isToday && !isEarly && !isLate;

  let minutesDiff = 0;
  let warningText = '';

  if (isFutureDate) {
    warningText = `Order is scheduled for future date ${deliveryDate} (${slotWindow}).`;
  } else if (isPastDate) {
    warningText = `Order was scheduled for past date ${deliveryDate} (${slotWindow}).`;
  } else if (isEarly) {
    minutesDiff = slotStartMinutes - currentMinutes;
    const hoursEarly = Math.floor(minutesDiff / 60);
    const minsEarly = minutesDiff % 60;
    const diffStr = hoursEarly > 0 ? `${hoursEarly}h ${minsEarly}m` : `${minsEarly}m`;
    warningText = `Scheduled for ${slotWindow} (currently ${diffStr} ahead of scheduled window).`;
  } else if (isLate) {
    minutesDiff = currentMinutes - slotEndMinutes;
    const hoursLate = Math.floor(minutesDiff / 60);
    const minsLate = minutesDiff % 60;
    const diffStr = hoursLate > 0 ? `${hoursLate}h ${minsLate}m` : `${minsLate}m`;
    warningText = `Scheduled for ${slotWindow} (currently ${diffStr} past scheduled window).`;
  }

  return {
    isEarly,
    isCurrentWindow,
    isLate,
    isFutureDate,
    isPastDate,
    minutesDiff,
    slotWindow,
    warningText,
    deliveryDate,
    slotStartMinutes,
    slotEndMinutes,
    currentMinutes,
  };
}

/**
 * Interactive confirmation modal for Early or Late departure/delivery.
 * Features scheduled window breakdown, quick reason selection presets, and a required custom reason field.
 */
export function promptDeliveryTimingModal({
  actionType = 'depart', // 'depart' | 'deliver' | 'batch_depart'
  timing,
  order,
  batchCount = 1,
}) {
  return new Promise((resolve) => {
    const isEarly = timing?.isEarly;
    const isLate = timing?.isLate;

    let title = '';
    let badgeLabel = '';
    let themeColor = '';
    let themeBg = '';
    let themeBorder = '';

    if (actionType === 'batch_depart') {
      title = isEarly
        ? 'Early Batch Departure Confirmation'
        : 'Late Batch Departure Schedule Alert';
      badgeLabel = isEarly ? 'Early Batch Departure' : 'Late Batch Departure';
    } else if (actionType === 'depart') {
      title = isEarly
        ? 'Early Departure Confirmation'
        : 'Late Departure Schedule Alert';
      badgeLabel = isEarly ? 'Departing Ahead of Window' : 'Departing Past Window';
    } else {
      title = isEarly
        ? 'Early Delivery Completion'
        : 'Late Delivery Completion';
      badgeLabel = isEarly ? 'Delivered Ahead of Window' : 'Delivered Past Window';
    }

    if (isEarly) {
      themeColor = '#92400e';
      themeBg = '#fef3c7';
      themeBorder = '#fde68a';
    } else {
      themeColor = '#991b1b';
      themeBg = '#fee2e2';
      themeBorder = '#fecaca';
    }

    let presets = [];
    if (actionType === 'depart' || actionType === 'batch_depart') {
      if (isEarly) {
        presets = [
          'Customer requested early delivery',
          'Batch route optimization (nearby customer)',
          'Station early dispatch schedule',
          'Other reason (specify below)',
        ];
      } else {
        presets = [
          'Refilling queue / station production delay',
          'Vehicle inspection or maintenance delay',
          'Heavy rain / adverse weather conditions',
          'Other reason (specify below)',
        ];
      }
    } else {
      if (isEarly) {
        presets = [
          'Customer confirmed present and received early',
          'Customer contacted station to deliver immediately',
          'Customer requested drop-off ahead of schedule',
          'Other reason (specify below)',
        ];
      } else {
        presets = [
          'Heavy road traffic / route congestion',
          'Customer took time to answer gate or phone',
          'Difficulty locating address / unit access delay',
          'Other reason (specify below)',
        ];
      }
    }

    const defaultPreset = presets[0] || 'Schedule timing adjustment';
    const orderNumberText = order?.order_number
      ? `Order #${order.order_number}`
      : `${batchCount} Orders in Batch`;
    const customerText = order?.customer?.full_name ? ` · ${order.customer.full_name}` : '';

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.style.cssText =
      'position:fixed;inset:0;background:rgba(15,23,42,0.6);backdrop-filter:blur(3px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;';

    backdrop.innerHTML = `
      <div class="modal-card" role="dialog" aria-modal="true" style="max-width: 480px; width: 100%; border-radius: 12px; background: #ffffff; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.25); overflow: hidden; border: 1px solid #e2e8f0; display:flex; flex-direction:column;">
        <div style="padding: 16px 20px; background: ${themeBg}; border-bottom: 1px solid ${themeBorder}; display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;">
          <div>
            <span style="display: inline-block; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; padding: 3px 8px; border-radius: 6px; background: #ffffff; color: ${themeColor}; border: 1px solid ${themeBorder}; margin-bottom: 6px;">
              ${escapeHtml(badgeLabel)}
            </span>
            <h3 style="margin: 0; font-size: 17px; font-weight: 800; color: #0f172a; line-height: 1.3;">
              ${escapeHtml(title)}
            </h3>
            <p style="margin: 3px 0 0 0; font-size: 12.5px; color: ${themeColor}; font-weight: 600;">
              ${escapeHtml(orderNumberText)}${escapeHtml(customerText)}
            </p>
          </div>
          <button type="button" class="modal-close" data-action="cancel" style="background: none; border: none; font-size: 22px; line-height: 1; cursor: pointer; color: ${themeColor}; padding: 0 4px;">&times;</button>
        </div>

        <div style="padding: 18px 20px; display: flex; flex-direction: column; gap: 14px; max-height: 75vh; overflow-y: auto;">
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 14px; font-size: 13px;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
              <span style="color: #64748b; font-weight: 600;">Scheduled Window:</span>
              <span style="font-weight: 700; color: #0f172a;">${escapeHtml(timing?.slotWindow || 'Flexible')} (${escapeHtml(timing?.deliveryDate || 'Today')})</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span style="color: #64748b; font-weight: 600;">Schedule Gap:</span>
              <span style="font-weight: 700; color: ${themeColor};">${escapeHtml(timing?.warningText || 'Outside window')}</span>
            </div>
          </div>

          <p style="margin: 0; font-size: 13px; color: #475569; line-height: 1.5;">
            ${
              isEarly
                ? 'Departing or delivering ahead of the scheduled window requires an operational reason note for station records and customer tracking.'
                : 'Departing or delivering after the scheduled window requires a schedule delay reason for station quality assurance.'
            }
          </p>

          <div>
            <label style="display: block; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #475569; margin-bottom: 6px;">
              Select Reason
            </label>
            <div style="display: flex; flex-direction: column; gap: 6px;" id="timing-presets-container">
              ${presets
                .map(
                  (p, idx) => `
                <label style="display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 6px; border: 1px solid ${idx === 0 ? '#3b82f6' : '#e2e8f0'}; background: ${idx === 0 ? '#eff6ff' : '#ffffff'}; font-size: 13px; cursor: pointer; color: #1e293b; transition: all 0.15s ease;">
                  <input type="radio" name="timing-preset-choice" value="${escapeHtml(p)}" ${idx === 0 ? 'checked' : ''} style="margin: 0;">
                  <span>${escapeHtml(p)}</span>
                </label>
              `
                )
                .join('')}
            </div>
          </div>

          <div>
            <label for="timing-custom-reason" style="display: block; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #475569; margin-bottom: 4px;">
              Reason Details / Dispatch Note <span style="color: #dc2626;">*</span>
            </label>
            <textarea id="timing-custom-reason" rows="2" class="form-input" style="width: 100%; box-sizing: border-box; font-size: 13px; padding: 8px 10px; border: 1px solid #cbd5e1; border-radius: 6px;" placeholder="Provide specific reason or details...">${escapeHtml(defaultPreset)}</textarea>
            <div id="timing-reason-err" style="display: none; font-size: 12px; color: #dc2626; margin-top: 4px; font-weight: 600;">
              Please select or enter a reason before proceeding.
            </div>
          </div>
        </div>

        <div style="padding: 12px 20px; background: #f8fafc; border-top: 1px solid #e2e8f0; display: flex; justify-content: flex-end; gap: 10px;">
          <button type="button" class="btn btn-light" data-action="cancel" style="font-size: 13px;">
            Wait for Window / Cancel
          </button>
          <button type="button" class="btn btn-primary" id="btn-confirm-timing" style="font-size: 13px; font-weight: 700; background: ${isEarly ? '#d97706' : '#dc2626'}; border-color: ${isEarly ? '#d97706' : '#dc2626'};">
            ${isEarly ? (actionType === 'deliver' ? 'Confirm Early Delivery' : 'Confirm Early Departure') : (actionType === 'deliver' ? 'Confirm Late Delivery' : 'Confirm Late Departure')}
          </button>
        </div>
      </div>
    `;

    const close = (result) => {
      backdrop.remove();
      resolve(result);
    };

    const textarea = backdrop.querySelector('#timing-custom-reason');
    const errBox = backdrop.querySelector('#timing-reason-err');

    backdrop.querySelectorAll('input[name="timing-preset-choice"]').forEach((radio) => {
      radio.addEventListener('change', (e) => {
        backdrop.querySelectorAll('#timing-presets-container label').forEach((lbl) => {
          lbl.style.borderColor = '#e2e8f0';
          lbl.style.background = '#ffffff';
        });
        const parentLabel = e.target.closest('label');
        if (parentLabel) {
          parentLabel.style.borderColor = '#3b82f6';
          parentLabel.style.background = '#eff6ff';
        }
        if (e.target.value.includes('Other')) {
          textarea.value = '';
          textarea.focus();
        } else {
          textarea.value = e.target.value;
        }
        errBox.style.display = 'none';
      });
    });

    backdrop.querySelector('#btn-confirm-timing')?.addEventListener('click', () => {
      const reasonVal = textarea.value.trim();
      if (!reasonVal) {
        errBox.style.display = 'block';
        textarea.focus();
        return;
      }
      close({ confirmed: true, reason: reasonVal });
    });

    backdrop.querySelectorAll('[data-action="cancel"]').forEach((b) => {
      b.addEventListener('click', () => close({ confirmed: false }));
    });

    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close({ confirmed: false });
    });

    document.body.appendChild(backdrop);
    textarea.focus();
  });
}

/**
 * Records an early or late timing reason note into the order's slot_note.
 */
export async function recordDeliveryTimingNote(orderId, actionType, reason, timing) {
  if (!orderId || !reason) return;
  const isEarly = timing?.isEarly ?? true;
  const tag = isEarly
    ? (actionType === 'deliver' ? 'EARLY_DELIVERY' : 'EARLY_DEPART')
    : (actionType === 'deliver' ? 'LATE_DELIVERY' : 'LATE_DEPART');

  const formattedTag = `[${tag}: ${reason.trim()}]`;

  try {
    const { data } = await supabase
      .from('orders')
      .select('slot_note')
      .eq('id', orderId)
      .maybeSingle();

    const existing = String(data?.slot_note || '').trim();
    const updated = existing ? `${existing} ${formattedTag}` : formattedTag;

    await supabase.from('orders').update({ slot_note: updated }).eq('id', orderId);
    invalidateDataCache();
  } catch (err) {
    console.warn('Could not record delivery timing note:', err);
  }
}

function getCustomerStepSubtitle(order) {
  const slotLabel = formatSlotWindow(getEffectiveSlot(order));
  const riderName = order?.rider?.full_name || 'Your rider';
  const timing = checkOrderDeliveryTiming(order);

  switch (order?.status) {
    case 'submitted':
      return 'We have received your order. Waiting for station confirmation.';
    case 'confirmed':
    case 'refilling':
    case 'ready':
      return `The station is preparing your clean gallons. Expected window: ${slotLabel}.`;
    case 'rider_assigned':
      return `Order prepared! ${riderName} is assigned and will depart for your ${slotLabel} window.`;
    case 'out_for_delivery':
      if (timing.isEarly) {
        return `${riderName} is on the way for an early delivery to your address. Scheduled window was ${slotLabel}.`;
      }
      return `${riderName} is on the way to your delivery address now. Arriving during your ${slotLabel} window.`;
    case 'delivered':
      return 'Your order has been delivered. Waiting for payment confirmation.';
    case 'completed':
      return 'Payment confirmed. Thank you for ordering with AquaRun!';
    case 'cancelled':
      return 'This order was cancelled.';
    default:
      return '';
  }
}

export function renderCustomerOrderHero(order, { showTrackButton = false } = {}) {
  const activeStepKey = CUSTOMER_STEP_OF[order.status] || 'submitted';
  const activeIdx = CUSTOMER_STEPS.findIndex((s) => s.key === activeStepKey);
  const logByStep = {};
  for (const row of order.status_log || []) {
    const mapped = CUSTOMER_STEP_OF[row.status];
    if (mapped && !logByStep[mapped]) {
      logByStep[mapped] = row.changed_at;
    }
  }
  if (!logByStep.submitted && order.created_at) {
    logByStep.submitted = order.created_at;
  }

  const slotLabel = formatSlotWindow(getEffectiveSlot(order));
  const isToday = order.delivery_date === getTodayManila();
  const deliveryDisplay = `${isToday ? 'Today' : formatDateShort(order.delivery_date)}, ${slotLabel}`;
  const isLive = !['completed', 'cancelled'].includes(order.status);

  const checkSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

  if (order.status === 'cancelled') {
    return `
      <div class="hero-banner hero-cancelled" style="background: linear-gradient(135deg, #334155 0%, #1e293b 100%);">
        <div class="hero-top">
          <div>
            <div class="hero-meta-line">
              <span>Order #${escapeHtml(order.order_number)}</span>
              <span class="pill" style="background: #ef4444; color: #fff; font-weight: 700;">Cancelled</span>
            </div>
            <h2 class="hero-status-title">Order cancelled</h2>
            <p class="hero-status-sub">${escapeHtml(order.slot_note || 'This order was cancelled while Submitted. No payment was collected.')}</p>
          </div>
          ${
            showTrackButton
              ? `<a class="btn btn-white btn-sm" href="order-history.html?viewOrder=${encodeURIComponent(order.id)}">View receipt</a>`
              : ''
          }
        </div>

        <div class="hero-strip">
          <div class="hero-strip-item">
            <p class="hero-strip-label">Items</p>
            <p class="hero-strip-value">${escapeHtml(summarizeOrderItems(order.items))}</p>
          </div>
          <div class="hero-strip-item">
            <p class="hero-strip-label">Delivery</p>
            <p class="hero-strip-value">${escapeHtml(deliveryDisplay)}</p>
          </div>
          <div class="hero-strip-item">
            <p class="hero-strip-label">Address</p>
            <p class="hero-strip-value">${escapeHtml(formatAddressLine(order.address))}</p>
          </div>
          <div class="hero-strip-item">
            <p class="hero-strip-label">Status</p>
            <p class="hero-strip-value" style="color: #fca5a5;">Cancelled (₱0 paid)</p>
          </div>
        </div>
      </div>
    `;
  }

  const stepsHtml = CUSTOMER_STEPS.map((step, index) => {
    const isDone = order.status === 'completed' || index < activeIdx;
    const isActive = order.status !== 'completed' && index === activeIdx;
    const stateClass = isDone ? ' is-done' : isActive ? ' is-active' : '';
    const dotContent = isDone ? checkSvg : String(index + 1);
    let timeText = logByStep[step.key] ? formatTimeShort(logByStep[step.key]) : '';
    if (!timeText && index === CUSTOMER_STEPS.length - 1 && isLive) {
      timeText = `Est. ${slotLabel}`;
    }

    return `
      <div class="tracker-step${stateClass}">
        <span class="tracker-dot">${dotContent}</span>
        <span class="tracker-label">${escapeHtml(step.label)}</span>
        <span class="tracker-time">${escapeHtml(timeText)}</span>
      </div>
    `;
  }).join('');

  return `
    <div class="hero-banner">
      <div class="hero-top">
        <div>
          <div class="hero-meta-line">
            <span>Order #${escapeHtml(order.order_number)}</span>
            ${isLive ? `<span class="pill pill-live">Live</span>` : ''}
          </div>
          <h2 class="hero-status-title">${escapeHtml(CUSTOMER_STATUS_HEADINGS[order.status] || 'Order status')}</h2>
          <p class="hero-status-sub">${escapeHtml(getCustomerStepSubtitle(order))}</p>
        </div>
        ${
          showTrackButton
            ? `<a class="btn btn-white btn-sm" href="track-order.html?id=${encodeURIComponent(order.id)}">Track order</a>`
            : ''
        }
      </div>

      <div class="tracker">
        ${stepsHtml}
      </div>

      <div class="hero-strip">
        <div class="hero-strip-item">
          <p class="hero-strip-label">Items</p>
          <p class="hero-strip-value">${escapeHtml(summarizeOrderItems(order.items))}</p>
        </div>
        <div class="hero-strip-item">
          <p class="hero-strip-label">Delivery</p>
          <p class="hero-strip-value">${escapeHtml(deliveryDisplay)}</p>
        </div>
        <div class="hero-strip-item">
          <p class="hero-strip-label">Address</p>
          <p class="hero-strip-value">${escapeHtml(formatAddressLine(order.address))}</p>
        </div>
        <div class="hero-strip-item">
          <p class="hero-strip-label">Rider</p>
          <p class="hero-strip-value">${escapeHtml(order.rider?.full_name || 'Awaiting assignment')}</p>
        </div>
        <div class="hero-strip-item">
          <p class="hero-strip-label">Payment</p>
          <p class="hero-strip-value">${escapeHtml(formatPeso(order.total))} · Cash on delivery</p>
        </div>
      </div>
    </div>
  `;
}

export function renderStaffOrderHero(order) {
  const activeStepKey = STAFF_STEP_OF[order.status] || 'submitted';
  const activeIdx = STAFF_STEPS.findIndex((s) => s.key === activeStepKey);
  const logByStatus = {};
  for (const row of order.status_log || []) {
    if (!logByStatus[row.status]) {
      logByStatus[row.status] = row.changed_at;
    }
  }
  if (!logByStatus.submitted && order.created_at) {
    logByStatus.submitted = order.created_at;
  }

  const checkSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

  const customerName = order.customer?.full_name || 'Customer';
  const addressText = formatAddressFull(order.address);
  const prefSlotText = formatSlotWindow(order.preferred_slot);
  const schedSlotText = formatSlotWindow(getEffectiveSlot(order));

  if (order.status === 'cancelled') {
    return `
      <div class="hero-banner hero-cancelled" style="background: linear-gradient(135deg, #334155 0%, #1e293b 100%);">
        <div class="hero-top">
          <div>
            <div class="hero-meta-line">
              <span>Order #${escapeHtml(order.order_number)} · ${escapeHtml(customerName)}</span>
              <span class="pill" style="background: #ef4444; color: #fff; font-weight: 700;">Cancelled</span>
            </div>
            <h2 class="hero-status-title">Order cancelled</h2>
            <p class="hero-status-sub">${escapeHtml(addressText)} · ${escapeHtml(order.slot_note || 'Order was cancelled.')}</p>
          </div>
          <a class="btn btn-white btn-sm" href="orders.html">Back to orders</a>
        </div>

        <div class="hero-strip">
          <div class="hero-strip-item">
            <p class="hero-strip-label">Items</p>
            <p class="hero-strip-value">${escapeHtml(summarizeOrderItems(order.items))} refills</p>
          </div>
          <div class="hero-strip-item">
            <p class="hero-strip-label">Delivery address</p>
            <p class="hero-strip-value">${escapeHtml(addressText)}</p>
          </div>
          <div class="hero-strip-item">
            <p class="hero-strip-label">Status</p>
            <p class="hero-strip-value" style="color: #fca5a5;">Cancelled</p>
          </div>
        </div>
      </div>
    `;
  }

  const stepsHtml = STAFF_STEPS.map((step, index) => {
    const isDone = order.status === 'completed' || (activeIdx >= 0 && index < activeIdx);
    const isActive = order.status !== 'completed' && index === activeIdx;
    const stateClass = isDone ? ' is-done' : isActive ? ' is-active' : '';
    const dotContent = isDone ? checkSvg : String(index + 1);
    let timeText = '';
    if (isDone && logByStatus[step.key]) {
      timeText = formatTimeShort(logByStatus[step.key]);
    } else if (isActive) {
      timeText = 'Now';
    }

    return `
      <div class="tracker-step${stateClass}">
        <span class="tracker-dot">${dotContent}</span>
        <span class="tracker-label">${escapeHtml(step.label)}</span>
        <span class="tracker-time">${escapeHtml(timeText)}</span>
      </div>
    `;
  }).join('');

  return `
    <div class="hero-banner">
      <div class="hero-top">
        <div>
          <div class="hero-meta-line">
            <span>Order #${escapeHtml(order.order_number)} · ${escapeHtml(customerName)}</span>
          </div>
          <h2 class="hero-status-title">${escapeHtml(STATUS_LABELS[order.status] || order.status)}</h2>
          <p class="hero-status-sub">${escapeHtml(addressText)} · Preferred slot ${escapeHtml(prefSlotText)}</p>
        </div>
        <a class="btn btn-white btn-sm" href="orders.html">Back to orders</a>
      </div>

      <div class="tracker tracker-8">
        ${stepsHtml}
      </div>

      <div class="hero-strip">
        <div class="hero-strip-item">
          <p class="hero-strip-label">Items</p>
          <p class="hero-strip-value">${escapeHtml(summarizeOrderItems(order.items))} refills</p>
        </div>
        <div class="hero-strip-item">
          <p class="hero-strip-label">Scheduled slot</p>
          <p class="hero-strip-value">${escapeHtml(schedSlotText)}</p>
        </div>
        <div class="hero-strip-item">
          <p class="hero-strip-label">Assigned rider</p>
          <p class="hero-strip-value">${escapeHtml(order.rider?.full_name || 'Not assigned')}</p>
        </div>
        <div class="hero-strip-item">
          <p class="hero-strip-label">Payment</p>
          <p class="hero-strip-value">Cash on delivery${order.payment_status === 'paid' ? ' · Paid' : ''}</p>
        </div>
        <div class="hero-strip-item">
          <p class="hero-strip-label">Order total</p>
          <p class="hero-strip-value">${escapeHtml(formatPeso(order.total))}</p>
        </div>
      </div>
    </div>
  `;
}

export async function getCustomerActiveOrders(customerId) {
  return cachedQuery(`orders:activeList:${customerId}`, async () => {
    const { data, error } = await supabase
      .from('orders')
      .select(ORDER_SELECT)
      .eq('customer_id', customerId)
      .not('status', 'in', '("completed","cancelled")')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data ?? [];
  });
}

export async function getCustomerActiveOrder(customerId) {
  const list = await getCustomerActiveOrders(customerId);
  return list[0] || null;
}

export async function getCustomerOrderById(customerId, orderId) {
  return cachedQuery(`orders:byId:${customerId}:${orderId}`, async () => {
    const { data, error } = await supabase
      .from('orders')
      .select(ORDER_SELECT)
      .eq('customer_id', customerId)
      .eq('id', orderId)
      .maybeSingle();

    if (error) throw error;
    return data;
  });
}

export async function getCustomerOrders(customerId, { limit = 50 } = {}) {
  return cachedQuery(`orders:cust:${customerId}:${limit}`, async () => {
    let query = supabase
      .from('orders')
      .select(ORDER_SELECT)
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false });

    if (limit) query = query.limit(limit);

    const { data, error } = await query;
    if (error) throw error;
    return data ?? [];
  });
}

export async function getAllOrdersForStaff({ limit = 200 } = {}) {
  return cachedQuery(`orders:staff:${limit}`, async () => {
    let query = supabase
      .from('orders')
      .select(ORDER_SELECT)
      .order('created_at', { ascending: false });

    if (limit) query = query.limit(limit);

    const { data, error } = await query;
    if (error) throw error;
    return data ?? [];
  });
}

export async function getStaffOrderById(orderId) {
  return cachedQuery(`orders:staffById:${orderId}`, async () => {
    const { data, error } = await supabase
      .from('orders')
      .select(ORDER_SELECT)
      .eq('id', orderId)
      .maybeSingle();

    if (error) throw error;
    return data;
  });
}

export async function getNextOrderForProcessing() {
  return cachedQuery('orders:nextProcessing', async () => {
    const { data, error } = await supabase
      .from('orders')
      .select(ORDER_SELECT)
      .in('status', ['submitted', 'confirmed', 'refilling', 'ready', 'delivered'])
      .order('created_at', { ascending: true })
      .limit(10);

    if (error) throw error;
    const actionable = (data || []).find(
      (o) =>
        ['submitted', 'confirmed', 'refilling', 'ready'].includes(o.status) ||
        (o.status === 'delivered' && o.payment_status === 'unpaid')
    );
    if (actionable) return actionable;

    const { data: latest } = await supabase
      .from('orders')
      .select(ORDER_SELECT)
      .neq('status', 'cancelled')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    return latest || null;
  });
}

export async function createOrder({ addressId, deliveryDate, slotId, notes, items }) {
  const { data, error } = await supabase.rpc('create_order', {
    p_address_id: addressId,
    p_delivery_date: deliveryDate,
    p_slot_id: slotId,
    p_notes: notes || null,
    p_items: items,
  });
  if (error) throw new Error(error.message || 'Could not place your order.');
  invalidateDataCache();
  return data;
}

export async function cancelOrder(orderId) {
  const { error } = await supabase.rpc('cancel_order', {
    p_order_id: orderId,
  });
  if (error) throw new Error(error.message || 'Could not cancel this order.');
  invalidateDataCache();
}

export async function staffConfirmOrder(orderId, slotId = null, slotNote = null) {
  const { error } = await supabase.rpc('confirm_order', {
    p_order_id: orderId,
    p_slot_id: slotId || null,
    p_slot_note: slotNote || null,
  });
  if (error) throw new Error(error.message || 'Could not confirm order.');
  invalidateDataCache();
}

export async function staffAdjustDeliverySlot(orderId, slotId, note = null) {
  const { error } = await supabase.rpc('adjust_delivery_slot', {
    p_order_id: orderId,
    p_slot_id: slotId,
    p_note: note || null,
  });
  if (error) throw new Error(error.message || 'Could not adjust delivery window.');
  invalidateDataCache();
}

export async function staffStartRefill(orderId) {
  const { error } = await supabase.rpc('start_refill', {
    p_order_id: orderId,
  });
  if (error) throw new Error(error.message || 'Could not start refill.');
  invalidateDataCache();
}

export async function staffMarkReady(orderId) {
  const { error } = await supabase.rpc('mark_ready', {
    p_order_id: orderId,
  });
  if (error) throw new Error(error.message || 'Could not mark order as Ready.');
  invalidateDataCache();
}

export async function staffAssignRider(orderId, riderId) {
  if (!riderId) throw new Error('Select an available rider first.');
  const { error } = await supabase.rpc('assign_rider', {
    p_order_id: orderId,
    p_rider_id: riderId,
  });
  if (error) throw new Error(error.message || 'Could not assign rider.');
  invalidateDataCache();
}

/**
 * 1-Click Fast-Track Order Processing:
 * Takes an order in any station prep state (submitted, confirmed, refilling, ready)
 * and directly accepts, prepares, and assigns it to the rider in a single action.
 */
export async function staffFastTrackAssignRider(orderId, riderId) {
  if (!riderId) throw new Error('Please select an available rider first.');

  // 1. Try atomic fast-track RPC if installed in Supabase
  const { error: rpcErr } = await supabase.rpc('staff_fast_track_order', {
    p_order_id: orderId,
    p_rider_id: riderId,
  });

  if (!rpcErr) {
    invalidateDataCache();
    return;
  }

  // 2. Automated fallback: sequence through required statuses
  const { data: order } = await supabase.from('orders').select('status').eq('id', orderId).maybeSingle();
  const status = order?.status;

  if (status === 'submitted') {
    await staffConfirmOrder(orderId);
  }
  if (status === 'submitted' || status === 'confirmed') {
    await staffStartRefill(orderId);
  }
  if (status === 'submitted' || status === 'confirmed' || status === 'refilling') {
    await staffMarkReady(orderId);
  }
  await staffAssignRider(orderId, riderId);
  invalidateDataCache();
}

export async function staffAssignBatchToRider(orderIds, riderId) {
  if (!riderId) throw new Error('Select a rider for this batch.');
  if (!Array.isArray(orderIds) || !orderIds.length) {
    throw new Error('No orders selected for this batch.');
  }
  for (const orderId of orderIds) {
    const { error } = await supabase.rpc('assign_rider', {
      p_order_id: orderId,
      p_rider_id: riderId,
    });
    if (error) throw new Error(error.message || `Could not assign order ${orderId}.`);
  }
  invalidateDataCache();
}

export async function staffConfirmPayment(orderId) {
  const { error } = await supabase.rpc('confirm_payment', {
    p_order_id: orderId,
  });
  if (error) throw new Error(error.message || 'Could not confirm payment.');
  invalidateDataCache();
}

export async function markDeliveryAttempted({ orderId, reason, note }) {
  const reasonText = (reason || 'Customer unavailable').trim();
  const fullNote = note ? `${reasonText} - ${note.trim()}` : reasonText;

  // Try RPC first
  const { error: rpcErr } = await supabase.rpc('record_delivery_attempt', {
    p_order_id: orderId,
    p_reason: reasonText,
    p_note: note || null,
  });

  if (rpcErr) {
    // Graceful fallback to direct update
    const updatePayload = {
      status: 'attempted',
      slot_note: `[ATTEMPTED]: ${fullNote}`,
    };
    try {
      const { error: tableErr } = await supabase
        .from('orders')
        .update(updatePayload)
        .eq('id', orderId);
      if (tableErr) throw tableErr;
    } catch {
      // If status enum rejects 'attempted', fallback to keeping order out_for_delivery but tagging slot_note
      await supabase
        .from('orders')
        .update({ slot_note: `[ATTEMPTED]: ${fullNote}` })
        .eq('id', orderId);
    }
  }

  invalidateDataCache();
}

export async function rescheduleOrder({ orderId, newDate, newSlotId }) {
  if (!newDate || !newSlotId) throw new Error('Please pick a date and time slot.');

  // Try RPC first
  const { error: rpcErr } = await supabase.rpc('reschedule_attempted_order', {
    p_order_id: orderId,
    p_delivery_date: newDate,
    p_slot_id: newSlotId,
  });

  if (rpcErr) {
    // Direct table fallback
    const { error: tableErr } = await supabase
      .from('orders')
      .update({
        status: 'ready',
        rider_id: null,
        delivery_date: newDate,
        scheduled_slot_id: newSlotId,
        slot_note: `Rescheduled to ${newDate}`,
      })
      .eq('id', orderId);

    if (tableErr) throw new Error(tableErr.message || 'Could not reschedule order.');
  }

  invalidateDataCache();
}

export async function getRiderRemittanceSummary(riderId) {
  // Query all delivered or completed orders assigned to this rider
  let data = null;
  let { data: res, error } = await supabase
    .from('orders')
    .select(
      'id, order_number, total, payment_status, status, slot_note, delivered_at, paid_at, rider_remitted, remitted_at, remittance_status, remittance_submitted_at, customer:profiles!customer_id(full_name)'
    )
    .eq('rider_id', riderId)
    .in('status', ['delivered', 'completed'])
    .order('delivered_at', { ascending: false });

  if (error) {
    // If relation join fails or columns don't exist yet, fallback gracefully
    const fallback = await supabase
      .from('orders')
      .select('id, order_number, total, payment_status, status, slot_note, delivered_at, paid_at, remitted_at, remittance_status, remittance_submitted_at')
      .eq('rider_id', riderId)
      .in('status', ['delivered', 'completed'])
      .order('delivered_at', { ascending: false });
    if (fallback.error) {
      const bareFallback = await supabase
        .from('orders')
        .select('id, order_number, total, payment_status, status, slot_note, delivered_at, paid_at')
        .eq('rider_id', riderId)
        .in('status', ['delivered', 'completed'])
        .order('delivered_at', { ascending: false });
      if (bareFallback.error) throw bareFallback.error;
      data = bareFallback.data || [];
    } else {
      data = fallback.data || [];
    }
  } else {
    data = res || [];
  }

  // Filter and classify orders
  const unremittedOrders = [];
  const submittedOrders = [];
  const unsubmittedOrders = [];
  const settledOrders = [];

  for (const o of data) {
    const note = String(o.slot_note || '');
    const isSettled =
      Boolean(o.rider_remitted) ||
      note.includes('[REMITTED]') ||
      o.remittance_status === 'approved';

    if (isSettled) {
      settledOrders.push(o);
    } else {
      unremittedOrders.push(o);
      const isSubmitted =
        o.remittance_status === 'submitted' ||
        note.includes('[REMITTANCE_SUBMITTED]');
      if (isSubmitted) {
        submittedOrders.push(o);
      } else {
        unsubmittedOrders.push(o);
      }
    }
  }

  const today = getTodayManila();
  const totalCash = unremittedOrders.reduce((sum, o) => sum + Number(o.total || 0), 0);
  const submittedCash = submittedOrders.reduce((sum, o) => sum + Number(o.total || 0), 0);
  const unsubmittedCash = unsubmittedOrders.reduce((sum, o) => sum + Number(o.total || 0), 0);
  const settledCash = settledOrders.reduce((sum, o) => sum + Number(o.total || 0), 0);
  const todaySettledCash = settledOrders
    .filter((o) => {
      const d = String(o.remitted_at || o.delivered_at || '');
      return d.startsWith(today);
    })
    .reduce((sum, o) => sum + Number(o.total || 0), 0);
  const totalLifetimeSales = totalCash + settledCash;

  return {
    unremittedOrders,
    submittedOrders,
    unsubmittedOrders,
    settledOrders,
    allOrders: data,
    totalCash,
    submittedCash,
    unsubmittedCash,
    settledCash,
    todaySettledCash,
    totalLifetimeSales,
    count: unremittedOrders.length,
    submittedCount: submittedOrders.length,
    unsubmittedCount: unsubmittedOrders.length,
    settledCount: settledOrders.length,
    hasSubmitted: submittedOrders.length > 0,
    allSettled: unremittedOrders.length === 0,
  };
}

export async function riderSubmitRemittance(riderId) {
  // 1. Try RPC rider_submit_remittance
  const { data: rpcData, error: rpcErr } = await supabase.rpc('rider_submit_remittance', {
    p_rider_id: riderId,
  });

  if (!rpcErr) {
    invalidateDataCache();
    return Number(rpcData || 0);
  }

  // 2. Fallback to direct table update tagging [REMITTANCE_SUBMITTED]
  const summary = await getRiderRemittanceSummary(riderId);
  if (!summary.unremittedOrders.length) return 0;

  let anyUpdated = false;
  let lastErr = null;

  for (const o of summary.unremittedOrders) {
    const existingNote = String(o.slot_note || '');
    if (!existingNote.includes('[REMITTANCE_SUBMITTED]')) {
      const payload = {
        slot_note: `${existingNote} [REMITTANCE_SUBMITTED]`.trim(),
        remittance_status: 'submitted',
        remittance_submitted_at: new Date().toISOString(),
      };
      let { error: updateErr } = await supabase.from('orders').update(payload).eq('id', o.id);
      if (updateErr && /remittance_status|remittance_submitted_at/i.test(updateErr.message || '')) {
        delete payload.remittance_status;
        delete payload.remittance_submitted_at;
        const res = await supabase.from('orders').update(payload).eq('id', o.id);
        updateErr = res.error;
      }
      if (updateErr) {
        lastErr = updateErr;
      } else {
        anyUpdated = true;
      }
    }
  }

  if (!anyUpdated && lastErr) {
    throw new Error(
      'Could not submit remittance. Please execute sql/11_sales_and_cash_remittance.sql in your Supabase SQL Editor to grant database permissions.'
    );
  }

  invalidateDataCache();
  return summary.totalCash;
}

export async function staffApproveRemittance(riderId) {
  // 1. Try RPC staff_approve_remittance
  let { data: rpcData, error: rpcErr } = await supabase.rpc('staff_approve_remittance', {
    p_rider_id: riderId,
  });

  if (rpcErr && /function.*does not exist/i.test(rpcErr.message || '')) {
    // Try legacy RPC accept_rider_remittance
    const legacy = await supabase.rpc('accept_rider_remittance', { p_rider_id: riderId });
    if (!legacy.error) {
      invalidateDataCache();
      return Number(legacy.data || 0);
    }
    rpcErr = legacy.error;
  } else if (!rpcErr) {
    invalidateDataCache();
    return Number(rpcData || 0);
  }

  // 2. Direct table fallback
  const summary = await getRiderRemittanceSummary(riderId);
  if (!summary.unremittedOrders.length) return 0;

  let anyUpdated = false;
  let lastErr = null;

  for (const o of summary.unremittedOrders) {
    const rawNote = String(o.slot_note || '');
    const cleanNote = rawNote
      .replace(/\[REMITTANCE_SUBMITTED\]/g, '')
      .replace(/\[REMITTED\]/g, '')
      .trim();

    const payload = {
      slot_note: `${cleanNote} [REMITTED]`.trim(),
      status: 'completed',
      payment_status: 'paid',
      paid_at: o.paid_at || new Date().toISOString(),
      remitted_at: new Date().toISOString(),
      rider_remitted: true,
      remittance_status: 'approved',
    };

    let { error: updateErr } = await supabase.from('orders').update(payload).eq('id', o.id);
    if (updateErr && /rider_remitted|remitted_at|remittance_status/i.test(updateErr.message || '')) {
      delete payload.rider_remitted;
      delete payload.remitted_at;
      delete payload.remittance_status;
      const res = await supabase.from('orders').update(payload).eq('id', o.id);
      updateErr = res.error;
    }

    if (updateErr) {
      lastErr = updateErr;
    } else {
      anyUpdated = true;
    }
  }

  if (!anyUpdated && lastErr) {
    throw new Error(
      'Could not approve remittance. Please execute sql/11_sales_and_cash_remittance.sql in your Supabase SQL Editor to grant database permissions.'
    );
  }

  invalidateDataCache();
  return summary.totalCash;
}

export const staffAcceptRiderRemittance = staffApproveRemittance;
export const riderRemitCash = riderSubmitRemittance;

export async function getRemittanceSalesHistory(limit = 40) {
  let { data, error } = await supabase
    .from('orders')
    .select(
      'id, order_number, total, payment_status, status, slot_note, delivered_at, paid_at, remitted_at, remittance_status, rider_remitted, rider:profiles!rider_id(id, full_name, phone), customer:profiles!customer_id(full_name)'
    )
    .in('status', ['delivered', 'completed'])
    .order('delivered_at', { ascending: false })
    .limit(limit);

  if (error) {
    const fallback = await supabase
      .from('orders')
      .select('id, order_number, total, payment_status, status, slot_note, delivered_at, paid_at')
      .in('status', ['delivered', 'completed'])
      .order('delivered_at', { ascending: false })
      .limit(limit);
    data = fallback.data || [];
  }

  const settled = (data || []).filter((o) => {
    const note = String(o.slot_note || '');
    return (
      Boolean(o.rider_remitted) ||
      note.includes('[REMITTED]') ||
      o.remittance_status === 'approved'
    );
  });

  return settled;
}

/**
 * Interactive Rider Remittance & Sales Audit Record Modal.
 * Shows official proof of all COD collections, turnovers, and station cashier reconciliations.
 */
export function openRiderRemittanceProofModal(remittance, me = {}) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.style.cssText =
    'position:fixed;inset:0;background:rgba(15,23,42,0.6);backdrop-filter:blur(3px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;';

  let currentTab = 'settled'; // 'settled' | 'submitted' | 'unsubmitted'

  function renderModalContent() {
    const riderName = me?.full_name || 'Rider';

    const settledList = remittance?.settledOrders || [];
    const submittedList = remittance?.submittedOrders || [];
    const unsubmittedList = remittance?.unsubmittedOrders || [];

    let activeList = [];
    let emptyMessage = '';
    let badgeClass = '';

    if (currentTab === 'settled') {
      activeList = settledList;
      emptyMessage =
        'No reconciled remittances yet. Completed orders approved by the station cashier will appear here.';
      badgeClass = 'pill-green';
    } else if (currentTab === 'submitted') {
      activeList = submittedList;
      emptyMessage = 'No remittances currently awaiting cashier review.';
      badgeClass = 'pill-amber';
    } else {
      activeList = unsubmittedList;
      emptyMessage = 'No unremitted cash in hand. All delivered orders have been turned over.';
      badgeClass = 'pill-blue';
    }

    const rowsHtml = activeList.length
      ? activeList
          .map((o) => {
            const custName = o.customer?.full_name || 'Customer';
            const deliveredDate = o.delivered_at
              ? `${formatDateShort(o.delivered_at)} ${formatTimeShort(o.delivered_at)}`
              : 'Delivered';
            const remittedDate = o.remitted_at
              ? `${formatDateShort(o.remitted_at)} ${formatTimeShort(o.remitted_at)}`
              : o.remittance_submitted_at
                ? `${formatDateShort(o.remittance_submitted_at)} ${formatTimeShort(o.remittance_submitted_at)}`
                : 'Pending';

            const note = String(o.slot_note || '');
            const hasEarlyDepart = note.includes('[EARLY_DEPART');
            const hasEarlyDeliv = note.includes('[EARLY_DELIVERY');
            const hasLateDepart = note.includes('[LATE_DEPART');
            const hasLateDeliv = note.includes('[LATE_DELIVERY');

            let noteTags = '';
            if (hasEarlyDepart)
              noteTags +=
                '<span class="pill pill-amber" style="font-size:10px;margin-left:4px;">Early Depart</span>';
            if (hasEarlyDeliv)
              noteTags +=
                '<span class="pill pill-amber" style="font-size:10px;margin-left:4px;">Early Deliv</span>';
            if (hasLateDepart)
              noteTags +=
                '<span class="pill pill-rose" style="font-size:10px;margin-left:4px;">Late Depart</span>';
            if (hasLateDeliv)
              noteTags +=
                '<span class="pill pill-rose" style="font-size:10px;margin-left:4px;">Late Deliv</span>';

            let statusLabel = '';
            if (currentTab === 'settled') {
              statusLabel = 'Reconciled &amp; Settled';
            } else if (currentTab === 'submitted') {
              statusLabel = 'Awaiting Cashier';
            } else {
              statusLabel = 'Cash in Hand';
            }

            return `
              <tr style="border-bottom: 1px solid #f1f5f9; font-size: 13px;">
                <td style="padding: 10px 8px; font-weight: 700; color: var(--blue-app);">
                  #${escapeHtml(o.order_number)}
                  ${noteTags}
                </td>
                <td style="padding: 10px 8px;">${escapeHtml(custName)}</td>
                <td style="padding: 10px 8px; color: #64748b; font-size: 12px;">${escapeHtml(deliveredDate)}</td>
                <td style="padding: 10px 8px; color: #64748b; font-size: 12px;">${escapeHtml(remittedDate)}</td>
                <td style="padding: 10px 8px;">
                  <span class="pill ${badgeClass}" style="font-size: 11px;">
                    ${statusLabel}
                  </span>
                </td>
                <td style="padding: 10px 8px; text-align: right; font-weight: 700; color: #15803d;">
                  ${escapeHtml(formatPeso(o.total))}
                </td>
              </tr>
            `;
          })
          .join('')
      : `
        <tr>
          <td colspan="6" style="padding: 32px 16px; text-align: center; color: #94a3b8; font-size: 13px;">
            ${escapeHtml(emptyMessage)}
          </td>
        </tr>
      `;

    backdrop.innerHTML = `
      <div class="modal-card" role="dialog" aria-modal="true" style="max-width: 720px; width: 100%; border-radius: 12px; background: #ffffff; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.25); overflow: hidden; border: 1px solid #e2e8f0; display:flex; flex-direction:column; max-height: 90vh;">
        <div style="padding: 18px 22px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; display: flex; align-items: center; justify-content: space-between;">
          <div>
            <span style="font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; color: #0284c7;">
              Rider Financial Ledger &amp; Proof
            </span>
            <h3 style="margin: 2px 0 0 0; font-size: 18px; font-weight: 800; color: #0f172a;">
              Sales &amp; Cash Remittance Record
            </h3>
            <p style="margin: 2px 0 0 0; font-size: 12.5px; color: #64748b;">
              Official delivery turnover records for ${escapeHtml(riderName)}
            </p>
          </div>
          <button type="button" class="modal-close" data-action="close" style="background: none; border: none; font-size: 24px; line-height: 1; cursor: pointer; color: #64748b; padding: 0 6px;">&times;</button>
        </div>

        <div style="padding: 16px 22px; display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; background: #ffffff; border-bottom: 1px solid #f1f5f9;">
          <div style="padding: 12px 14px; border-radius: 8px; background: #eff6ff; border: 1px solid #dbeafe;">
            <p style="margin:0; font-size:11px; font-weight:700; text-transform:uppercase; color:#1d4ed8;">Cash in Hand to Remit</p>
            <p style="margin:3px 0 0; font-size:17px; font-weight:800; color:#1e40af;">${formatPeso(remittance?.unsubmittedCash || 0)}</p>
            <p style="margin:1px 0 0; font-size:11px; color:#3b82f6;">${remittance?.unsubmittedCount || 0} ${remittance?.unsubmittedCount === 1 ? 'order' : 'orders'} in pocket</p>
          </div>
          <div style="padding: 12px 14px; border-radius: 8px; background: #fffbeb; border: 1px solid #fef3c7;">
            <p style="margin:0; font-size:11px; font-weight:700; text-transform:uppercase; color:#b45309;">Awaiting Cashier Check</p>
            <p style="margin:3px 0 0; font-size:17px; font-weight:800; color:#92400e;">${formatPeso(remittance?.submittedCash || 0)}</p>
            <p style="margin:1px 0 0; font-size:11px; color:#d97706;">${remittance?.submittedCount || 0} ${remittance?.submittedCount === 1 ? 'order' : 'orders'} turned over</p>
          </div>
          <div style="padding: 12px 14px; border-radius: 8px; background: #f0fdf4; border: 1px solid #dcfce7;">
            <p style="margin:0; font-size:11px; font-weight:700; text-transform:uppercase; color:#15803d;">Settled &amp; Reconciled</p>
            <p style="margin:3px 0 0; font-size:17px; font-weight:800; color:#14532d;">${formatPeso(remittance?.settledCash || 0)}</p>
            <p style="margin:1px 0 0; font-size:11px; color:#16a34a;">${remittance?.settledCount || 0} ${remittance?.settledCount === 1 ? 'order' : 'orders'} verified</p>
          </div>
        </div>

        <div style="padding: 10px 22px 0; background: #ffffff;">
          <div style="display: flex; gap: 8px; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; flex-wrap: wrap;">
            <button type="button" class="btn btn-sm ${currentTab === 'settled' ? 'btn-primary' : 'btn-light'}" data-tab="settled" style="font-size: 12px;">
              Reconciled Proof (${settledList.length})
            </button>
            <button type="button" class="btn btn-sm ${currentTab === 'submitted' ? 'btn-primary' : 'btn-light'}" data-tab="submitted" style="font-size: 12px;">
              Awaiting Cashier (${submittedList.length})
            </button>
            <button type="button" class="btn btn-sm ${currentTab === 'unsubmitted' ? 'btn-primary' : 'btn-light'}" data-tab="unsubmitted" style="font-size: 12px;">
              Cash in Hand (${unsubmittedList.length})
            </button>
          </div>
        </div>

        <div style="padding: 12px 22px 18px; overflow-y: auto; flex: 1;">
          <div style="border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
            <table style="width: 100%; border-collapse: collapse; text-align: left;">
              <thead style="background: #f8fafc; font-size: 11px; text-transform: uppercase; color: #64748b; border-bottom: 1px solid #e2e8f0;">
                <tr>
                  <th style="padding: 9px 8px;">Order #</th>
                  <th style="padding: 9px 8px;">Customer</th>
                  <th style="padding: 9px 8px;">Delivered</th>
                  <th style="padding: 9px 8px;">Turned Over</th>
                  <th style="padding: 9px 8px;">Status</th>
                  <th style="padding: 9px 8px; text-align: right;">Amount</th>
                </tr>
              </thead>
              <tbody>
                ${rowsHtml}
              </tbody>
            </table>
          </div>
        </div>

        <div style="padding: 12px 22px; background: #f8fafc; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
          <span style="font-size: 12px; color: #64748b;">
            Total rider collection history: <strong>${formatPeso(remittance?.totalLifetimeSales || 0)}</strong>
          </span>
          <button type="button" class="btn btn-primary" data-action="close" style="font-size: 13px;">
            Close Record
          </button>
        </div>
      </div>
    `;

    backdrop.querySelectorAll('[data-action="close"]').forEach((b) => {
      b.addEventListener('click', () => backdrop.remove());
    });

    backdrop.querySelectorAll('[data-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        currentTab = btn.dataset.tab;
        renderModalContent();
      });
    });
  }

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) backdrop.remove();
  });

  renderModalContent();
  document.body.appendChild(backdrop);
}

