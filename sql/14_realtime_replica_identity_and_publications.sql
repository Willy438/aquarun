-- 14_realtime_replica_identity_and_publications.sql
-- Enables REPLICA IDENTITY FULL and Realtime publication on all interactive tables.
-- This ensures PostgreSQL sends complete row data on UPDATE and DELETE events,
-- allowing Supabase Realtime and Row Level Security (RLS) policies to deliver live updates to connected browsers.

-- 1. Set REPLICA IDENTITY FULL so UPDATE WAL records contain all columns for RLS evaluation
alter table public.orders replica identity full;
alter table public.bottle_ledger replica identity full;
alter table public.profiles replica identity full;
alter table public.products replica identity full;
alter table public.order_items replica identity full;
alter table public.order_status_log replica identity full;
alter table public.settings replica identity full;
alter table public.time_slots replica identity full;

-- 2. Add all key tables to the supabase_realtime publication
do $$
begin
  begin
    alter publication supabase_realtime add table public.orders;
  exception when duplicate_object then null; when undefined_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.bottle_ledger;
  exception when duplicate_object then null; when undefined_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.profiles;
  exception when duplicate_object then null; when undefined_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.products;
  exception when duplicate_object then null; when undefined_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.order_items;
  exception when duplicate_object then null; when undefined_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.order_status_log;
  exception when duplicate_object then null; when undefined_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.settings;
  exception when duplicate_object then null; when undefined_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.time_slots;
  exception when duplicate_object then null; when undefined_object then null;
  end;
end $$;

-- 3. Notify PostgREST to reload schema cache
notify pgrst, 'reload schema';
