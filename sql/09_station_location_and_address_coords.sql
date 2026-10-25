-- =====================================================================
-- AquaRun - 09: Station Location & Address Coordinates
-- Adds lat/lng to addresses and default station settings.
-- =====================================================================

-- 1. Add coordinates to addresses table
alter table public.addresses
  add column if not exists latitude double precision,
  add column if not exists longitude double precision;

-- 2. Seed default station location settings if not present
insert into public.settings (key, value)
values
  ('station_lat', '14.7565'),
  ('station_lng', '121.0437'),
  ('station_address', 'University of Caloocan City (Congress Campus), Caloocan City'),
  ('station_radius_km', '3.5')
on conflict (key) do nothing;

-- 3. Notify PostgREST to reload schema
notify pgrst, 'reload schema';
