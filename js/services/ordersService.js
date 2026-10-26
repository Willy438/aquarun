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

function getCustomerStepSubtitle(order) {
  const slotLabel = formatSlotWindow(getEffectiveSlot(order));
  const riderName = order?.rider?.full_name || 'Your rider';
  switch (order?.status) {
    case 'submitted':
      return 'We have received your order. Waiting for station confirmation.';
    case 'confirmed':
    case 'refilling':
    case 'ready':
      return `The station is preparing your clean gallons. Expected window: ${slotLabel}.`;
    case 'rider_assigned':
      return `Order prepared! ${riderName} is assigned and will depart soon. Expected window: ${slotLabel}.`;
    case 'out_for_delivery':
      return `${riderName} is on the way to your delivery address. Arriving between ${slotLabel.replace('–', ' and ')}.`;
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
      'id, order_number, total, payment_status, status, slot_note, delivered_at, paid_at, rider_remitted, remitted_at, remittance_status, customer:profiles!customer_id(full_name)'
    )
    .eq('rider_id', riderId)
    .in('status', ['delivered', 'completed']);

  if (error) {
    // If relation join fails or columns don't exist yet, fallback gracefully
    const fallback = await supabase
      .from('orders')
      .select('id, order_number, total, payment_status, status, slot_note, delivered_at, paid_at')
      .eq('rider_id', riderId)
      .in('status', ['delivered', 'completed']);
    if (fallback.error) throw fallback.error;
    data = fallback.data || [];
  } else {
    data = res || [];
  }

  // Filter and classify orders
  const unremittedOrders = [];
  const submittedOrders = [];
  const unsubmittedOrders = [];

  for (const o of data) {
    const note = String(o.slot_note || '');
    const isSettled =
      Boolean(o.rider_remitted) ||
      note.includes('[REMITTED]') ||
      o.remittance_status === 'approved';

    if (!isSettled) {
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

  const totalCash = unremittedOrders.reduce((sum, o) => sum + Number(o.total || 0), 0);
  const submittedCash = submittedOrders.reduce((sum, o) => sum + Number(o.total || 0), 0);
  const unsubmittedCash = unsubmittedOrders.reduce((sum, o) => sum + Number(o.total || 0), 0);

  return {
    unremittedOrders,
    submittedOrders,
    unsubmittedOrders,
    totalCash,
    submittedCash,
    unsubmittedCash,
    count: unremittedOrders.length,
    submittedCount: submittedOrders.length,
    unsubmittedCount: unsubmittedOrders.length,
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

