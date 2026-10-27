// Products, service charge, and station open status. Pages never call Supabase directly, they call this file.
import { supabase } from '../config/supabaseClient.js';
import { cachedQuery, invalidateDataCache } from '../core/ui.js';

const STATION_OPEN_LOCAL_KEY = 'aquarun_station_open';

function normalizeProductRow(row) {
  const price = Number(row?.price ?? 25);
  const rawContainerPrice = row?.new_container_price;
  const newContainerPrice =
    rawContainerPrice !== undefined && rawContainerPrice !== null && Number(rawContainerPrice) > 0
      ? Number(rawContainerPrice)
      : row?.is_returnable === false
        ? price
        : price + 125;
  return {
    ...row,
    price,
    new_container_price: newContainerPrice,
  };
}

export async function getActiveProducts({ forceRefresh = false } = {}) {
  return cachedQuery('products:active', async () => {
    let { data, error } = await supabase
      .from('products')
      .select('id, name, unit, photo_url, price, new_container_price, is_active, is_returnable')
      .eq('is_active', true)
      .order('price', { ascending: true })
      .order('name', { ascending: true });

    if (error && /new_container_price/i.test(error.message || '')) {
      ({ data, error } = await supabase
        .from('products')
        .select('id, name, unit, photo_url, price, is_active, is_returnable')
        .eq('is_active', true)
        .order('price', { ascending: true })
        .order('name', { ascending: true }));
    }

    if (error) throw error;
    return (data ?? []).map(normalizeProductRow);
  }, { ttlMs: 3000, forceRefresh });
}

export async function getAllProductsForAdmin() {
  return cachedQuery('products:all', async () => {
    let { data, error } = await supabase
      .from('products')
      .select('id, name, unit, photo_url, price, new_container_price, is_active, is_returnable')
      .order('is_active', { ascending: false })
      .order('price', { ascending: true })
      .order('name', { ascending: true });

    if (error && /new_container_price/i.test(error.message || '')) {
      ({ data, error } = await supabase
        .from('products')
        .select('id, name, unit, photo_url, price, is_active, is_returnable')
        .order('is_active', { ascending: false })
        .order('price', { ascending: true })
        .order('name', { ascending: true }));
    }

    if (error) throw error;
    return (data ?? []).map(normalizeProductRow);
  });
}

export async function processProductPhotoFile(file) {
  if (!file || !file.type.startsWith('image/')) {
    throw new Error('Please choose a valid image file (PNG, JPG, or WEBP).');
  }

  // Resize & compress image onto canvas so it fits cleanly and loads in <1ms
  const optimizedDataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the selected image file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Invalid image file.'));
      img.onload = () => {
        const maxW = 900;
        const maxH = 675;
        let width = img.naturalWidth || img.width || 600;
        let height = img.naturalHeight || img.height || 450;

        if (width > maxW || height > maxH) {
          const ratio = Math.min(maxW / width, maxH / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        // Try WebP first for compact size, fallback to JPEG
        let out = canvas.toDataURL('image/webp', 0.86);
        if (!out || !out.startsWith('data:image/webp')) {
          out = canvas.toDataURL('image/jpeg', 0.86);
        }
        resolve(out);
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });

  return optimizedDataUrl;
}

export async function saveProduct({
  id,
  name,
  unit = 'gallon',
  price,
  newContainerPrice = undefined,
  photoUrl = null,
  isActive = true,
  isReturnable = undefined,
}) {
  const cleanName = String(name ?? '').trim();
  const cleanUnit = String(unit ?? 'gallon').trim() || 'gallon';
  const numPrice = Number(price);
  const numContainerPrice =
    newContainerPrice !== undefined && newContainerPrice !== null && String(newContainerPrice).trim() !== ''
      ? Number(newContainerPrice)
      : undefined;

  if (!cleanName) throw new Error('Enter a product name.');
  if (!Number.isFinite(numPrice) || numPrice < 0) throw new Error('Enter a valid refill price.');
  if (numContainerPrice !== undefined && (!Number.isFinite(numContainerPrice) || numContainerPrice < 0)) {
    throw new Error('Enter a valid new gallon + water price.');
  }

  if (id) {
    const updatePayload = {
      name: cleanName,
      unit: cleanUnit,
      price: numPrice,
      photo_url: photoUrl || null,
      is_active: Boolean(isActive),
    };
    if (isReturnable !== undefined) {
      updatePayload.is_returnable = Boolean(isReturnable);
    }
    if (numContainerPrice !== undefined) {
      updatePayload.new_container_price = numContainerPrice;
    }

    let { data, error } = await supabase
      .from('products')
      .update(updatePayload)
      .eq('id', id)
      .select();

    if (
      error &&
      (/column|schema cache|new_container_price|is_returnable|PGRST204/i.test(error.message || '') ||
        error.code === 'PGRST204')
    ) {
      delete updatePayload.new_container_price;
      delete updatePayload.is_returnable;
      ({ data, error } = await supabase
        .from('products')
        .update(updatePayload)
        .eq('id', id)
        .select());
    }

    if (error) {
      const { data: rpcData, error: rpcErr } = await supabase.rpc('admin_update_product', {
        p_id: id,
        p_name: cleanName,
        p_unit: cleanUnit,
        p_price: numPrice,
        p_new_container_price: numContainerPrice ?? null,
        p_is_returnable: isReturnable ?? true,
        p_is_active: Boolean(isActive),
        p_photo_url: photoUrl || null,
      });
      if (!rpcErr && rpcData) {
        invalidateDataCache('products:');
        return normalizeProductRow(rpcData);
      }
      throw new Error(error.message || 'Could not update product.');
    }
    
    let updatedRow = data?.[0];
    if (!updatedRow) {
      // If select was filtered or returned 0 rows, attempt to fetch the product
      const { data: fetchRow } = await supabase.from('products').select().eq('id', id).maybeSingle();
      if (fetchRow) {
        updatedRow = fetchRow;
      } else {
        throw new Error('Product not found or update permission denied.');
      }
    }

    invalidateDataCache('products:');
    return normalizeProductRow(updatedRow);
  }

  const returnableBool = isReturnable === undefined ? true : Boolean(isReturnable);
  const insertPayload = {
    name: cleanName,
    unit: cleanUnit,
    price: numPrice,
    new_container_price:
      numContainerPrice !== undefined
        ? numContainerPrice
        : returnableBool
          ? numPrice + 125
          : numPrice,
    photo_url: photoUrl || null,
    is_active: Boolean(isActive),
    is_returnable: returnableBool,
  };

  let { data, error } = await supabase
    .from('products')
    .insert(insertPayload)
    .select();

  if (
    error &&
    (/column|schema cache|new_container_price|is_returnable|PGRST204/i.test(error.message || '') ||
      error.code === 'PGRST204')
  ) {
    delete insertPayload.new_container_price;
    delete insertPayload.is_returnable;
    ({ data, error } = await supabase
      .from('products')
      .insert(insertPayload)
      .select());
  }

  if (error) throw new Error(error.message || 'Could not add product.');
  invalidateDataCache('products:');
  return normalizeProductRow(data?.[0]);
}

export async function toggleProductActive(productId, isActive) {
  let { data, error } = await supabase
    .from('products')
    .update({ is_active: Boolean(isActive) })
    .eq('id', productId)
    .select();

  if (error) throw new Error(error.message || 'Could not update product status.');
  invalidateDataCache('products:');
  return data?.[0];
}

export async function getServiceCharge() {
  return cachedQuery('settings:service_charge', async () => {
    const { data, error } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'service_charge')
      .maybeSingle();

    if (error) return 20;
    const val = Number(data?.value);
    return Number.isFinite(val) ? val : 20;
  });
}

export async function saveServiceCharge(amount) {
  const num = Number(amount);
  if (!Number.isFinite(num) || num < 0) {
    throw new Error('Enter a valid delivery service charge.');
  }
  const formatted = num.toFixed(2);
  const { error } = await supabase
    .from('settings')
    .upsert({ key: 'service_charge', value: formatted }, { onConflict: 'key' });

  if (error) throw new Error(error.message || 'Could not save service charge.');
  invalidateDataCache('settings:');
  return Number(formatted);
}

export function getCachedStationOpenStatus() {
  try {
    const raw = localStorage.getItem(STATION_OPEN_LOCAL_KEY);
    if (raw === 'false') return false;
  } catch {}
  return true;
}

export async function getStationOpenStatus() {
  return cachedQuery('settings:station_open', async () => {
    const { data, error } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'station_open')
      .maybeSingle();

    if (error || !data) {
      return getCachedStationOpenStatus();
    }
    const isOpen = String(data.value).toLowerCase() !== 'false';
    try {
      localStorage.setItem(STATION_OPEN_LOCAL_KEY, isOpen ? 'true' : 'false');
    } catch {}
    return isOpen;
  });
}

export async function saveStationOpenStatus(isOpen) {
  const val = Boolean(isOpen);
  try {
    localStorage.setItem(STATION_OPEN_LOCAL_KEY, val ? 'true' : 'false');
  } catch {}
  const { error } = await supabase
    .from('settings')
    .upsert({ key: 'station_open', value: val ? 'true' : 'false' }, { onConflict: 'key' });

  invalidateDataCache('settings:');
  if (error) {
    // Even if settings table denies or has no row yet, keep optimistic local state
    return val;
  }
  return val;
}
