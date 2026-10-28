// Saved addresses. Pages never call Supabase directly, they call this file.
import { supabase } from '../config/supabaseClient.js';
import { cachedQuery, invalidateDataCache } from '../core/ui.js';

export async function getCustomerAddresses(customerId) {
  return cachedQuery(`addresses:${customerId}`, async () => {
    let { data, error } = await supabase
      .from('addresses')
      .select('id, customer_id, label, street, barangay, city, landmark, latitude, longitude, is_default, created_at')
      .eq('customer_id', customerId)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true });

    if (error && (/latitude|longitude|column|schema cache/i.test(error.message || '') || error.code === 'PGRST204')) {
      ({ data, error } = await supabase
        .from('addresses')
        .select('id, customer_id, label, street, barangay, city, landmark, is_default, created_at')
        .eq('customer_id', customerId)
        .order('is_default', { ascending: false })
        .order('created_at', { ascending: true }));
    }

    if (error) throw error;
    let list = data ?? [];

    // Filter out addresses that were deleted/hidden locally (e.g. preserved in DB only for past order history)
    try {
      const hidden = JSON.parse(localStorage.getItem(`hidden_addresses_${customerId}`) || '[]');
      if (Array.isArray(hidden) && hidden.length > 0) {
        list = list.filter((a) => !hidden.includes(a.id));
      }
    } catch {}

    // Augment with localStorage backup if database doesn't have latitude/longitude column yet
    return list.map((addr) => {
      if (addr.latitude == null || addr.longitude == null) {
        try {
          const cached = JSON.parse(localStorage.getItem(`addr_coords_${addr.id}`) || 'null');
          if (cached && typeof cached.lat === 'number' && typeof cached.lng === 'number') {
            return { ...addr, latitude: cached.lat, longitude: cached.lng };
          }
        } catch {}
      }
      return addr;
    });
  });
}

export async function saveCustomerAddress(
  customerId,
  { id, label, street, barangay, city, landmark, latitude = null, longitude = null, isDefault }
) {
  const cleanLabel = String(label ?? '').trim();
  const cleanStreet = String(street ?? '').trim();
  const cleanBarangay = String(barangay ?? '').trim() || 'Barangay 171';
  const cleanCity = String(city ?? '').trim() || 'Caloocan';
  const cleanLandmark = String(landmark ?? '').trim() || null;
  const numLat = Number.isFinite(Number(latitude)) ? Number(latitude) : null;
  const numLng = Number.isFinite(Number(longitude)) ? Number(longitude) : null;

  if (!cleanLabel) throw new Error('Enter an address label (e.g. Home, Work).');
  if (!cleanStreet) throw new Error('Enter the house number and street.');

  const existing = await getCustomerAddresses(customerId);
  const shouldBeDefault = Boolean(isDefault) || existing.length === 0 || (existing.length === 1 && existing[0].id === id);

  if (shouldBeDefault) {
    await supabase
      .from('addresses')
      .update({ is_default: false })
      .eq('customer_id', customerId)
      .eq('is_default', true);
  }

  const payload = {
    label: cleanLabel,
    street: cleanStreet,
    barangay: cleanBarangay,
    city: cleanCity,
    landmark: cleanLandmark,
    is_default: shouldBeDefault,
  };
  if (numLat !== null && numLng !== null) {
    payload.latitude = numLat;
    payload.longitude = numLng;
  }

  if (id) {
    let { data, error } = await supabase
      .from('addresses')
      .update(payload)
      .eq('id', id)
      .eq('customer_id', customerId)
      .select()
      .single();

    if (error && (/latitude|longitude|column|schema cache/i.test(error.message || '') || error.code === 'PGRST204')) {
      delete payload.latitude;
      delete payload.longitude;
      ({ data, error } = await supabase
        .from('addresses')
        .update(payload)
        .eq('id', id)
        .eq('customer_id', customerId)
        .select()
        .single());
    }

    if (error && (/one_default_address|unique constraint/i.test(error.message || '') || error.code === '23505')) {
      await supabase
        .from('addresses')
        .update({ is_default: false })
        .eq('customer_id', customerId);
      ({ data, error } = await supabase
        .from('addresses')
        .update(payload)
        .eq('id', id)
        .eq('customer_id', customerId)
        .select()
        .single());
    }

    if (error) throw new Error(error.message || 'Could not update address.');

    // Save to localStorage fallback as well
    if (numLat !== null && numLng !== null && id) {
      try {
        localStorage.setItem(`addr_coords_${id}`, JSON.stringify({ lat: numLat, lng: numLng }));
      } catch {}
    }

    invalidateDataCache(`addresses:${customerId}`);
    return { ...data, latitude: data?.latitude ?? numLat, longitude: data?.longitude ?? numLng };
  }

  let { data, error } = await supabase
    .from('addresses')
    .insert({
      customer_id: customerId,
      ...payload,
    })
    .select()
    .single();

  if (error && (/latitude|longitude|column|schema cache/i.test(error.message || '') || error.code === 'PGRST204')) {
    delete payload.latitude;
    delete payload.longitude;
    ({ data, error } = await supabase
      .from('addresses')
      .insert({
        customer_id: customerId,
        ...payload,
      })
      .select()
      .single());
  }

  if (error && (/one_default_address|unique constraint/i.test(error.message || '') || error.code === '23505')) {
    await supabase
      .from('addresses')
      .update({ is_default: false })
      .eq('customer_id', customerId);
    ({ data, error } = await supabase
      .from('addresses')
      .insert({
        customer_id: customerId,
        ...payload,
      })
      .select()
      .single());
  }

  if (error) throw new Error(error.message || 'Could not save address.');

  // Save to localStorage fallback as well
  if (numLat !== null && numLng !== null && data?.id) {
    try {
      localStorage.setItem(`addr_coords_${data.id}`, JSON.stringify({ lat: numLat, lng: numLng }));
    } catch {}
  }

  invalidateDataCache(`addresses:${customerId}`);
  return { ...data, latitude: data?.latitude ?? numLat, longitude: data?.longitude ?? numLng };
}

export async function setDefaultCustomerAddress(customerId, addressId) {
  await supabase
    .from('addresses')
    .update({ is_default: false })
    .eq('customer_id', customerId)
    .eq('is_default', true);

  const { error } = await supabase
    .from('addresses')
    .update({ is_default: true })
    .eq('id', addressId)
    .eq('customer_id', customerId);

  if (error) throw new Error(error.message || 'Could not set default address.');
  invalidateDataCache(`addresses:${customerId}`);
}

export async function deleteCustomerAddress(customerId, addressId) {
  try {
    localStorage.removeItem(`addr_coords_${addressId}`);
  } catch {}

  const { error } = await supabase
    .from('addresses')
    .delete()
    .eq('id', addressId)
    .eq('customer_id', customerId);

  if (error) {
    // If the address cannot be physically deleted because it's referenced in past orders (foreign key constraint),
    // safely hide it from the customer's active list while preserving past order history.
    if (/foreign key constraint|orders_address_id_fkey|violates/i.test(error.message || '')) {
      try {
        const hidden = JSON.parse(localStorage.getItem(`hidden_addresses_${customerId}`) || '[]');
        if (!hidden.includes(addressId)) {
          hidden.push(addressId);
          localStorage.setItem(`hidden_addresses_${customerId}`, JSON.stringify(hidden));
        }
      } catch {}

      // If the deleted address was default, set another active address as default
      const all = await getCustomerAddresses(customerId);
      const remaining = all.filter((a) => a.id !== addressId);
      if (remaining.length > 0 && !remaining.some((a) => a.is_default)) {
        await setDefaultCustomerAddress(customerId, remaining[0].id).catch(() => {});
      }

      invalidateDataCache(`addresses:${customerId}`);
      return;
    }
    throw new Error(error.message || 'Could not delete address.');
  }

  invalidateDataCache(`addresses:${customerId}`);
}
