// Start delivery, record counts, confirm payment. Pages never call Supabase directly, they call this file.
import { supabase } from '../config/supabaseClient.js';
import { cachedQuery, invalidateDataCache } from '../core/ui.js';
import { getEffectiveSlot } from './ordersService.js';

const RIDER_ORDER_SELECT = `
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
  items:order_items(id, product_id, quantity, unit_price, product:products(id, name, unit, price, is_returnable)),
  ledger:bottle_ledger(id, bottles_refilled, bottles_delivered, empties_collected, note)
`;

export function sortDeliveriesByScheduledSlot(orders = []) {
  return [...orders].sort((a, b) => {
    const rankA = a.status === 'out_for_delivery' ? 0 : a.status === 'rider_assigned' ? 1 : 2;
    const rankB = b.status === 'out_for_delivery' ? 0 : b.status === 'rider_assigned' ? 1 : 2;
    if (rankA !== rankB) return rankA - rankB;

    const dateCmp = String(a.delivery_date || '').localeCompare(String(b.delivery_date || ''));
    if (dateCmp !== 0) return dateCmp;

    const slotA = getEffectiveSlot(a)?.start_time || '99:99';
    const slotB = getEffectiveSlot(b)?.start_time || '99:99';
    return String(slotA).localeCompare(String(slotB));
  });
}

export async function getRiderDeliveries(riderId) {
  return cachedQuery(`rider:deliveries:${riderId}`, async () => {
    const { data, error } = await supabase
      .from('orders')
      .select(RIDER_ORDER_SELECT)
      .eq('rider_id', riderId)
      .order('delivery_date', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data ?? [];
  });
}

export async function getRiderCurrentOrder(riderId, orderId = null) {
  if (orderId) {
    return cachedQuery(`rider:order:${riderId}:${orderId}`, async () => {
      const { data, error } = await supabase
        .from('orders')
        .select(RIDER_ORDER_SELECT)
        .eq('rider_id', riderId)
        .eq('id', orderId)
        .maybeSingle();
      if (error) throw error;
      return data || null;
    });
  }

  const all = await getRiderDeliveries(riderId);
  const active = sortDeliveriesByScheduledSlot(
    all.filter((o) => ['rider_assigned', 'out_for_delivery'].includes(o.status))
  );
  return active[0] || null;
}

export async function riderStartDelivery(orderId) {
  const { error } = await supabase.rpc('start_delivery', {
    p_order_id: orderId,
  });
  if (error) throw new Error(error.message || 'Could not start delivery.');
  invalidateDataCache();
}

export async function riderRecordDelivery({
  orderId,
  bottlesDelivered,
  emptiesCollected,
  note,
  paymentReceived,
}) {
  const { error } = await supabase.rpc('record_delivery', {
    p_order_id: orderId,
    p_delivered: Number(bottlesDelivered),
    p_empties: Number(emptiesCollected),
    p_note: note ? String(note).trim() : null,
    p_payment_received: Boolean(paymentReceived),
  });
  if (error) throw new Error(error.message || 'Could not record delivery.');
  invalidateDataCache();
}
