// Subscribe helpers for the events in Section 6
import { supabase } from '../config/supabaseClient.js';
import { invalidateDataCache } from './ui.js';

export function subscribeCustomerOrders(customerId, onUpdate) {
  if (!customerId || typeof onUpdate !== 'function') return () => {};
  const handle = (payload) => {
    invalidateDataCache();
    onUpdate(payload);
  };
  const channel = supabase
    .channel(`customer-orders-${customerId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'orders',
        filter: `customer_id=eq.${customerId}`,
      },
      handle
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'bottle_ledger',
        filter: `customer_id=eq.${customerId}`,
      },
      handle
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

export function subscribeStaffWorkspace(onUpdate) {
  if (typeof onUpdate !== 'function') return () => {};
  const handle = (p) => {
    invalidateDataCache();
    onUpdate(p);
  };
  const channel = supabase
    .channel('staff-workspace-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, handle)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'bottle_ledger' }, handle)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, handle)
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

export function subscribeRiderWorkspace(riderId, onUpdate) {
  if (!riderId || typeof onUpdate !== 'function') return () => {};
  const handle = (p) => {
    invalidateDataCache();
    onUpdate(p);
  };
  const channel = supabase
    .channel(`rider-workspace-${riderId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'orders',
        filter: `rider_id=eq.${riderId}`,
      },
      handle
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'bottle_ledger',
      },
      handle
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

export function subscribeAdminWorkspace(onUpdate) {
  if (typeof onUpdate !== 'function') return () => {};
  const handle = (p) => {
    invalidateDataCache();
    onUpdate(p);
  };
  const channel = supabase
    .channel('admin-workspace-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, handle)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, handle)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, handle)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'time_slots' }, handle)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'slot_closures' }, handle)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'settings' }, handle)
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
