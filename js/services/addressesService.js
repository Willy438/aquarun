// Saved addresses. Pages never call Supabase directly, they call this file.
import { supabase } from '../config/supabaseClient.js';
import { cachedQuery, invalidateDataCache } from '../core/ui.js';

export async function getCustomerAddresses(customerId) {
  return cachedQuery(`addresses:${customerId}`, async () => {
    const { data, error } = await supabase
      .from('addresses')
      .select('id, customer_id, label, street, barangay, city, landmark, is_default, created_at')
      .eq('customer_id', customerId)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true });

    if (error) throw error;
    return data ?? [];
  });
}

export async function saveCustomerAddress(customerId, { id, label, street, barangay, city, landmark, isDefault }) {
  const cleanLabel = String(label ?? '').trim();
  const cleanStreet = String(street ?? '').trim();
  const cleanBarangay = String(barangay ?? '').trim();
  const cleanCity = String(city ?? '').trim();
  const cleanLandmark = String(landmark ?? '').trim() || null;

  if (!cleanLabel) throw new Error('Enter an address label (e.g. Home, Work).');
  if (!cleanStreet) throw new Error('Enter the house number and street.');
  if (!cleanBarangay) throw new Error('Enter the barangay.');
  if (!cleanCity) throw new Error('Enter the city.');

  const existing = await getCustomerAddresses(customerId);
  const shouldBeDefault = Boolean(isDefault) || existing.length === 0 || (existing.length === 1 && existing[0].id === id);

  if (shouldBeDefault) {
    await supabase
      .from('addresses')
      .update({ is_default: false })
      .eq('customer_id', customerId)
      .eq('is_default', true);
  }

  if (id) {
    const { data, error } = await supabase
      .from('addresses')
      .update({
        label: cleanLabel,
        street: cleanStreet,
        barangay: cleanBarangay,
        city: cleanCity,
        landmark: cleanLandmark,
        is_default: shouldBeDefault,
      })
      .eq('id', id)
      .eq('customer_id', customerId)
      .select()
      .single();

    if (error) throw new Error(error.message || 'Could not update address.');
    invalidateDataCache(`addresses:${customerId}`);
    return data;
  }

  const { data, error } = await supabase
    .from('addresses')
    .insert({
      customer_id: customerId,
      label: cleanLabel,
      street: cleanStreet,
      barangay: cleanBarangay,
      city: cleanCity,
      landmark: cleanLandmark,
      is_default: shouldBeDefault,
    })
    .select()
    .single();

  if (error) throw new Error(error.message || 'Could not save address.');
  invalidateDataCache(`addresses:${customerId}`);
  return data;
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
  const { error } = await supabase
    .from('addresses')
    .delete()
    .eq('id', addressId)
    .eq('customer_id', customerId);

  if (error) {
    if (/foreign key|orders/i.test(error.message)) {
      throw new Error('This address is linked to an existing order and cannot be deleted. You can edit it instead.');
    }
    throw new Error(error.message || 'Could not delete address.');
  }

  invalidateDataCache(`addresses:${customerId}`);
  const remaining = await getCustomerAddresses(customerId);
  if (remaining.length > 0 && !remaining.some((a) => a.is_default)) {
    await setDefaultCustomerAddress(customerId, remaining[0].id);
  }
}
