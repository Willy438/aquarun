// Create, cancel, advance status, assign rider. Pages never call Supabase directly, they call this file.
import { supabase } from '../config/supabaseClient.js';
import {
  CUSTOMER_STEPS,
  CUSTOMER_STEP_OF,
  CUSTOMER_STATUS_HEADINGS,
  STAFF_STEPS,
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
  items:order_items(id, product_id, quantity, unit_price, product:products(id, name, unit, is_returnable)),
  status_log:order_status_log(status, changed_at)
`;

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
      return `${qty} ${shortName}${qty > 1 && !/s$/i.test(shortName) ? 's' : ''}`;
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
      return `The station accepted your order. Expected delivery window: ${slotLabel}.`;
    case 'refilling':
      return 'Your gallons are currently being refilled at the station.';
    case 'ready':
      return `Your order is ready for dispatch. Expected window: ${slotLabel}.`;
    case 'rider_assigned':
      return `${riderName} is assigned to your order. Expected window: ${slotLabel}.`;
    case 'out_for_delivery':
      return `${riderName} is on the way. Arriving between ${slotLabel.replace('–', ' and ')}.`;
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
  const activeIdx = STAFF_STEPS.findIndex((s) => s.key === order.status);
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

  const customerName = order.customer?.full_name || 'Customer';
  const addressText = formatAddressFull(order.address);
  const prefSlotText = formatSlotWindow(order.preferred_slot);
  const schedSlotText = formatSlotWindow(getEffectiveSlot(order));

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

export async function staffConfirmPayment(orderId) {
  const { error } = await supabase.rpc('confirm_payment', {
    p_order_id: orderId,
  });
  if (error) throw new Error(error.message || 'Could not confirm payment.');
  invalidateDataCache();
}
