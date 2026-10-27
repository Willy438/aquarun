// Ledger entries and bottle balance. Pages never call Supabase directly, they call this file.
import { supabase } from '../config/supabaseClient.js';
import { cachedQuery } from '../core/ui.js';

export async function getCustomerBottleBalance(customerId, { forceRefresh = false } = {}) {
  return cachedQuery(`ledger:balance:${customerId}`, async () => {
    const { data, error } = await supabase
      .from('customer_bottle_balance')
      .select('customer_id, orders_count, bottles_delivered, empties_collected, balance')
      .eq('customer_id', customerId)
      .maybeSingle();

    if (error || !data) {
      return {
        customer_id: customerId,
        orders_count: 0,
        bottles_delivered: 0,
        empties_collected: 0,
        balance: 0,
      };
    }
    return data;
  }, { forceRefresh });
}

export async function getCustomerLedgerActivity(customerId) {
  return cachedQuery(`ledger:activity:${customerId}`, async () => {
    const { data, error } = await supabase
      .from('bottle_ledger')
      .select(`
        id,
        order_id,
        bottles_refilled,
        bottles_delivered,
        empties_collected,
        note,
        created_at,
        order:orders!order_id(id, order_number, status, delivered_at, created_at)
      `)
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data ?? []).filter(
      (entry) =>
        entry.order?.status === 'delivered' ||
        entry.order?.status === 'completed' ||
        entry.bottles_delivered > 0 ||
        entry.empties_collected > 0
    );
  });
}

export async function getStaffLedgerEntries({ limit = 100 } = {}) {
  return cachedQuery(`ledger:staff:${limit}`, async () => {
    const { data, error } = await supabase
      .from('bottle_ledger')
      .select(`
        id,
        customer_id,
        order_id,
        bottles_refilled,
        bottles_delivered,
        empties_collected,
        recorded_by,
        note,
        created_at,
        customer:profiles!customer_id(id, full_name, phone),
        recorder:profiles!recorded_by(id, full_name),
        order:orders!order_id(id, order_number, status, delivered_at, created_at)
      `)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data ?? [];
  });
}

export async function getAllCustomerBalances() {
  return cachedQuery('ledger:all_customers', async () => {
    const { data, error } = await supabase
      .from('customer_bottle_balance')
      .select('customer_id, full_name, phone, orders_count, bottles_delivered, empties_collected, balance')
      .order('full_name', { ascending: true });

    if (error) throw error;
    return data ?? [];
  });
}

export async function getOrderReturnableQty(orderId) {
  const { data, error } = await supabase
    .from('order_returnable_qty')
    .select('order_id, returnable_qty, non_returnable_qty')
    .eq('order_id', orderId)
    .maybeSingle();

  if (error) throw new Error(error.message || 'Could not load returnable item counts.');
  if (!data) {
    throw new Error('Could not read returnable item counts for this order (no row returned).');
  }
  return {
    order_id: data.order_id,
    returnable_qty: Number(data.returnable_qty),
    non_returnable_qty: Number(data.non_returnable_qty),
  };
}

export async function getCustomerBalanceForOrder(orderId) {
  const { data, error } = await supabase.rpc('get_customer_balance_for_order', {
    p_order_id: orderId,
  });

  if (error) throw error;
  return Number(data ?? 0);
}
