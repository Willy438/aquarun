// Subscribe helpers for the events in Section 6
import { supabase } from '../config/supabaseClient.js';
import { invalidateDataCache } from './ui.js';

function triggerNavBadgeUpdate(fnName, ...args) {
  try {
    import('./nav.js')
      .then((mod) => {
        if (typeof mod[fnName] === 'function') {
          mod[fnName](...args).catch(() => {});
        }
      })
      .catch(() => {});
  } catch {}
}

export function subscribeCustomerOrders(customerId, onUpdate) {
  if (!customerId || typeof onUpdate !== 'function') return () => {};
  const handle = (payload) => {
    invalidateDataCache();
    triggerNavBadgeUpdate('updateCustomerActiveOrderBadge', customerId);
    onUpdate(payload);
  };
  const channelName = `customer-orders-${customerId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const channel = supabase
    .channel(channelName)
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
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'products',
      },
      handle
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'settings',
      },
      handle
    )
    .subscribe((status, err) => {
      if (err) console.warn('[Realtime Customer error]:', err);
    });

  return () => {
    supabase.removeChannel(channel);
  };
}

export function subscribeStaffWorkspace(onUpdate) {
  if (typeof onUpdate !== 'function') return () => {};
  const handle = (p) => {
    invalidateDataCache();
    triggerNavBadgeUpdate('updateStaffOrdersBadge');
    triggerNavBadgeUpdate('updateStaffRemittanceBadge');
    onUpdate(p);
  };
  const channelName = `staff-workspace-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const channel = supabase
    .channel(channelName)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, handle)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'bottle_ledger' }, handle)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, handle)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, handle)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'settings' }, handle)
    .subscribe((status, err) => {
      if (err) console.warn('[Realtime Staff error]:', err);
    });

  return () => {
    supabase.removeChannel(channel);
  };
}

export function subscribeRiderWorkspace(riderId, onUpdate) {
  if (!riderId || typeof onUpdate !== 'function') return () => {};
  const handle = (p) => {
    invalidateDataCache();
    triggerNavBadgeUpdate('updateRiderCurrentBadge', riderId);
    triggerNavBadgeUpdate('updateRiderRemittanceBadge', riderId);
    onUpdate(p);
  };
  // Listen without restrictive SQL filter on orders so assignment transitions from null -> riderId fire immediately
  const channelName = `rider-workspace-${riderId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const channel = supabase
    .channel(channelName)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'orders',
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
    .subscribe((status, err) => {
      if (err) console.warn('[Realtime Rider error]:', err);
    });

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
  const channelName = `admin-workspace-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const channel = supabase
    .channel(channelName)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, handle)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, handle)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, handle)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'time_slots' }, handle)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'slot_closures' }, handle)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'settings' }, handle)
    .subscribe((status, err) => {
      if (err) console.warn('[Realtime Admin error]:', err);
    });

  return () => {
    supabase.removeChannel(channel);
  };
}
