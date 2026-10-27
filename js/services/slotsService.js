// Slots, capacity, closures, adjust window. Pages never call Supabase directly, they call this file.
import { supabase } from '../config/supabaseClient.js';
import { cachedQuery, invalidateDataCache } from '../core/ui.js';

export async function getSlotAvailability(dateStr, { forceRefresh = false } = {}) {
  return cachedQuery(`slots:avail:${dateStr}`, async () => {
    const { data, error } = await supabase.rpc('slot_availability', {
      p_date: dateStr,
    });
    if (error) throw error;
    return data ?? [];
  }, { forceRefresh });
}

export async function getAllTimeSlotsForAdmin(dateStr) {
  return cachedQuery(`slots:admin:${dateStr}`, async () => {
    const [{ data: slots, error: slotsErr }, { data: closures }, { data: counts }] = await Promise.all([
      supabase
        .from('time_slots')
        .select('id, label, start_time, end_time, max_orders, is_active')
        .order('start_time', { ascending: true }),
      supabase
        .from('slot_closures')
        .select('id, time_slot_id, closure_date, reason')
        .eq('closure_date', dateStr),
      supabase
        .from('orders_per_slot')
        .select('slot_id, orders_count, is_full')
        .eq('delivery_date', dateStr),
    ]);

    if (slotsErr) throw slotsErr;

    const closureBySlot = new Map((closures || []).map((c) => [c.time_slot_id, c]));
    const countBySlot = new Map((counts || []).map((c) => [c.slot_id, Number(c.orders_count || 0)]));

    return (slots || []).map((s) => {
      const ordersCount = countBySlot.get(s.id) || 0;
      const isClosedToday = closureBySlot.has(s.id);
      const isFull = ordersCount >= Number(s.max_orders);
      return {
        ...s,
        orders_count: ordersCount,
        is_closed_today: isClosedToday,
        closure: closureBySlot.get(s.id) || null,
        is_full: isFull,
      };
    });
  });
}

export async function saveTimeSlot({ id, label, startTime, endTime, maxOrders, isActive = true }) {
  const cleanLabel = String(label ?? '').trim();
  const numMax = Number(maxOrders);

  if (!cleanLabel) throw new Error('Enter a slot label (e.g. 9:00 AM - 10:00 AM).');
  if (!startTime || !endTime) throw new Error('Enter start and end times.');
  if (endTime <= startTime) throw new Error('End time must be later than start time.');
  if (!Number.isInteger(numMax) || numMax <= 0) throw new Error('Capacity must be at least 1 order.');

  if (id) {
    const { data, error } = await supabase
      .from('time_slots')
      .update({
        label: cleanLabel,
        start_time: startTime,
        end_time: endTime,
        max_orders: numMax,
        is_active: Boolean(isActive),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(error.message || 'Could not update time slot.');
    invalidateDataCache('slots:');
    return data;
  }

  const { data, error } = await supabase
    .from('time_slots')
    .insert({
      label: cleanLabel,
      start_time: startTime,
      end_time: endTime,
      max_orders: numMax,
      is_active: Boolean(isActive),
    })
    .select()
    .single();

  if (error) throw new Error(error.message || 'Could not add time slot.');
  invalidateDataCache('slots:');
  return data;
}

export async function toggleTimeSlotActive(slotId, isActive) {
  const { data, error } = await supabase
    .from('time_slots')
    .update({ is_active: Boolean(isActive) })
    .eq('id', slotId)
    .select()
    .single();

  if (error) throw new Error(error.message || 'Could not update slot status.');
  invalidateDataCache('slots:');
  return data;
}

export async function toggleSlotClosureToday(slotId, dateStr, shouldClose, reason = 'Closed for today by admin') {
  if (shouldClose) {
    const { error } = await supabase
      .from('slot_closures')
      .upsert(
        { time_slot_id: slotId, closure_date: dateStr, reason },
        { onConflict: 'time_slot_id,closure_date' }
      );
    if (error) throw new Error(error.message || 'Could not close slot for today.');
  } else {
    const { error } = await supabase
      .from('slot_closures')
      .delete()
      .eq('time_slot_id', slotId)
      .eq('closure_date', dateStr);
    if (error) throw new Error(error.message || 'Could not reopen slot for today.');
  }
  invalidateDataCache('slots:');
}
export async function deleteTimeSlot(slotId) {
  if (!slotId) return;
  const { error } = await supabase
    .from('time_slots')
    .delete()
    .eq('id', slotId);

  if (error) {
    if (error.code === '23503' || /foreign key/i.test(error.message || '')) {
      await toggleTimeSlotActive(slotId, false);
      invalidateDataCache('slots:');
      return { disabled: true };
    }
    throw new Error(error.message || 'Could not delete time slot.');
  }
  invalidateDataCache('slots:');
  return { deleted: true };
}
