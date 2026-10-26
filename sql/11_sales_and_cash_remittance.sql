-- =====================================================================
-- AquaRun - 11: Dedicated Cash Remittance & Sales Settlement
-- Safe to run in Supabase SQL Editor.
-- =====================================================================

-- 1. Add remittance status and timestamp columns to orders table
alter table public.orders
  add column if not exists remittance_status text not null default 'unremitted',
  add column if not exists rider_remitted boolean not null default false,
  add column if not exists remitted_at timestamptz,
  add column if not exists remitted_by uuid references public.profiles(id),
  add column if not exists remittance_submitted_at timestamptz;

create index if not exists orders_remittance_status_idx on public.orders (rider_id, remittance_status, rider_remitted);

-- 2. Add orders update policy for staff, admin, and assigned rider if not present
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'orders' and policyname = 'orders_update') then
    create policy orders_update on public.orders for update to authenticated
      using (auth_role()::text in ('staff', 'admin') or rider_id = auth.uid())
      with check (auth_role()::text in ('staff', 'admin') or rider_id = auth.uid());
  end if;
end $$;

-- 3. Function: Rider Submits Cash Remittance / Handover
create or replace function public.rider_submit_remittance(
  p_rider_id uuid default null
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rider_id uuid;
  v_total numeric(10,2) := 0;
begin
  if auth.uid() is null then
    raise exception 'Please sign in first.';
  end if;

  v_rider_id := coalesce(p_rider_id, auth.uid());

  -- Ensure caller is either the rider themselves or staff/admin
  if auth.uid() <> v_rider_id and auth_role()::text not in ('staff', 'admin') then
    raise exception 'Not authorized to submit remittance for this rider.';
  end if;

  -- Calculate total unremitted cash to submit
  select coalesce(sum(total), 0)
    into v_total
    from public.orders
   where rider_id = v_rider_id
     and status in ('delivered', 'completed')
     and (rider_remitted is false or rider_remitted is null)
     and remittance_status <> 'approved';

  if v_total > 0 then
    update public.orders
       set remittance_status = 'submitted',
           remittance_submitted_at = now(),
           slot_note = case
             when coalesce(slot_note, '') like '%[REMITTANCE_SUBMITTED]%' then slot_note
             else trim(coalesce(slot_note, '') || ' [REMITTANCE_SUBMITTED]')
           end
     where rider_id = v_rider_id
       and status in ('delivered', 'completed')
       and (rider_remitted is false or rider_remitted is null)
       and remittance_status <> 'approved';
  end if;

  return v_total;
end;
$$;

revoke all on function public.rider_submit_remittance(uuid) from public, anon;
grant execute on function public.rider_submit_remittance(uuid) to authenticated;

-- 4. Function: Staff Approves & Reconciles Cash Remittance
create or replace function public.staff_approve_remittance(
  p_rider_id uuid
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total numeric(10,2) := 0;
begin
  if auth.uid() is null then
    raise exception 'Please sign in first.';
  end if;

  -- Allowed for staff, admin, or the rider themselves if station allows immediate self-remittance
  if auth_role()::text not in ('staff', 'admin') and auth.uid() <> p_rider_id then
    raise exception 'Only station staff or admin can approve cash remittances.';
  end if;

  -- Calculate total unremitted COD cash
  select coalesce(sum(total), 0)
    into v_total
    from public.orders
   where rider_id = p_rider_id
     and status in ('delivered', 'completed')
     and (rider_remitted is false or rider_remitted is null);

  -- Mark orders as approved and settled
  update public.orders
     set rider_remitted = true,
         remitted_at = now(),
         remitted_by = auth.uid(),
         remittance_status = 'approved',
         status = 'completed',
         payment_status = 'paid',
         slot_note = trim(replace(replace(coalesce(slot_note, ''), '[REMITTANCE_SUBMITTED]', ''), '[REMITTED]', '')) || ' [REMITTED]'
   where rider_id = p_rider_id
     and status in ('delivered', 'completed')
     and (rider_remitted is false or rider_remitted is null);

  return v_total;
end;
$$;

revoke all on function public.staff_approve_remittance(uuid) from public, anon;
grant execute on function public.staff_approve_remittance(uuid) to authenticated;

-- Backwards-compatible alias for existing accept_rider_remittance calls
create or replace function public.accept_rider_remittance(
  p_rider_id uuid
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.staff_approve_remittance(p_rider_id);
end;
$$;

revoke all on function public.accept_rider_remittance(uuid) from public, anon;
grant execute on function public.accept_rider_remittance(uuid) to authenticated;

-- 5. Ensure Realtime Publication includes orders and profiles
do $$
begin
  begin
    alter publication supabase_realtime add table public.orders;
  exception when duplicate_object then null; when undefined_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.profiles;
  exception when duplicate_object then null; when undefined_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.bottle_ledger;
  exception when duplicate_object then null; when undefined_object then null;
  end;
end $$;
