// Station settings service: location, delivery radius, distance calculation.
import { supabase } from '../config/supabaseClient.js';
import { cachedQuery, invalidateDataCache } from '../core/ui.js';

export const DEFAULT_STATION_COORDS = {
  lat: 14.7565,
  lng: 121.0437,
  address: 'University of Caloocan City (Congress Campus), Caloocan City',
  radiusKm: 3.5,
};

// Earth radius in km for Haversine distance formula
export function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  const p1 = Number(lat1);
  const q1 = Number(lon1);
  const p2 = Number(lat2);
  const q2 = Number(lon2);
  if (!Number.isFinite(p1) || !Number.isFinite(q1) || !Number.isFinite(p2) || !Number.isFinite(q2)) {
    return null;
  }
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(p2 - p1);
  const dLon = toRad(q2 - q1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(p1)) * Math.cos(toRad(p2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const d = 6371 * c; // Earth radius in km
  return Math.round(d * 100) / 100; // Round to 2 decimals
}

export async function getStationLocationSettings() {
  return cachedQuery('settings:station_location', async () => {
    const { data, error } = await supabase
      .from('settings')
      .select('key, value')
      .in('key', ['station_lat', 'station_lng', 'station_address', 'station_radius_km']);

    if (error || !data || data.length === 0) {
      return { ...DEFAULT_STATION_COORDS };
    }

    const map = new Map(data.map((r) => [r.key, r.value]));
    const lat = Number(map.get('station_lat'));
    const lng = Number(map.get('station_lng'));
    const radiusKm = Number(map.get('station_radius_km'));

    return {
      lat: Number.isFinite(lat) ? lat : DEFAULT_STATION_COORDS.lat,
      lng: Number.isFinite(lng) ? lng : DEFAULT_STATION_COORDS.lng,
      address: map.get('station_address') || DEFAULT_STATION_COORDS.address,
      radiusKm: Number.isFinite(radiusKm) && radiusKm > 0 ? radiusKm : DEFAULT_STATION_COORDS.radiusKm,
    };
  });
}

export async function saveStationLocationSettings({ lat, lng, address, radiusKm }) {
  const rows = [
    { key: 'station_lat', value: String(Number(lat)) },
    { key: 'station_lng', value: String(Number(lng)) },
    { key: 'station_address', value: String(address || '').trim() || DEFAULT_STATION_COORDS.address },
    { key: 'station_radius_km', value: String(Math.max(0.5, Number(radiusKm) || 3.5)) },
  ];

  const { error } = await supabase.from('settings').upsert(rows, { onConflict: 'key' });
  if (error) throw new Error(error.message || 'Could not save station location.');
  invalidateDataCache('settings:');
  return getStationLocationSettings();
}

export async function checkAddressWithinDeliveryRadius(address) {
  const station = await getStationLocationSettings();
  const customerLat = Number(address?.latitude);
  const customerLng = Number(address?.longitude);

  if (!Number.isFinite(customerLat) || !Number.isFinite(customerLng)) {
    // If address has no GPS coordinates yet, allow with null distance
    return {
      hasCoordinates: false,
      isWithin: true,
      distanceKm: null,
      maxRadiusKm: station.radiusKm,
      stationAddress: station.address,
    };
  }

  const distanceKm = calculateDistanceKm(station.lat, station.lng, customerLat, customerLng);
  const isWithin = distanceKm !== null && distanceKm <= station.radiusKm;

  return {
    hasCoordinates: true,
    isWithin,
    distanceKm,
    maxRadiusKm: station.radiusKm,
    stationAddress: station.address,
  };
}
