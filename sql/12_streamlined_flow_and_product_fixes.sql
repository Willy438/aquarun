-- =====================================================================
-- AquaRun - 12: Streamlined Order Flow & Product Management Fixes
-- Safe to run in Supabase SQL Editor.
-- =====================================================================

-- 1. Ensure products table has all extended pricing and catalog columns
alter table public.products
  add column if not exists is_returnable boolean not null default true,
  add column if not exists new_container_price numeric(10,2);

-- Update default new_container_price for existing returnable products if unset
update public.products
set new_container_price = price + 125.00
where is_returnable = true
  and (new_container_price is null or new_container_price <= 0);

-- Update non-returnable products (e.g. standalone empty containers)
update public.products
set new_container_price = price
where is_returnable = false
  and (new_container_price is null or new_container_price <= 0);

-- 2. Ensure RLS on products allows admin update and select
grant select, insert, update on public.products to authenticated;

do $$
begin
  -- Drop older strict policy if exists to avoid conflicts
  if exists (select 1 from pg_policies where tablename = 'products' and policyname = 'products_admin') then
    drop policy products_admin on public.products;
  end if;

  create policy products_admin on public.products for all to authenticated
    using (auth_role()::text in ('admin') or auth_role() = 'admin')
    with check (auth_role()::text in ('admin') or auth_role() = 'admin');
end $$;

-- 3. Dedicated Admin Product Update RPC (Bypasses PostgREST single coercion issues)
create or replace function public.admin_update_product(
  p_id uuid,
  p_name text,
  p_unit text default 'gallon',
  p_price numeric default 25,
  p_new_container_price numeric default null,
  p_is_returnable boolean default true,
  p_is_active boolean default true,
  p_photo_url text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prod products;
begin
  if auth_role()::text not in ('admin') and auth_role() <> 'admin' then
    raise exception 'Admin privileges required to update products.';
  end if;

  update public.products
  set
    name = trim(p_name),
    unit = coalesce(nullif(trim(p_unit), ''), 'gallon'),
    price = p_price,
    new_container_price = coalesce(p_new_container_price, case when p_is_returnable then p_price + 125 else p_price end),
    is_returnable = coalesce(p_is_returnable, true),
    is_active = coalesce(p_is_active, true),
    photo_url = p_photo_url
  where id = p_id
  returning * into v_prod;

  if not found then
    raise exception 'Product not found.';
  end if;

  return to_jsonb(v_prod);
end;
$$;

grant execute on function public.admin_update_product to authenticated;

-- 4. 1-Click Fast-Track Order Processing RPC (Consolidates 4 station steps into 1)
create or replace function public.staff_fast_track_order(
  p_order_id uuid,
  p_rider_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  o orders;
  v_qty int := 0;
begin
  if auth_role()::text not in ('staff', 'admin') and auth_role() not in ('staff', 'admin') then
    raise exception 'Staff or admin privileges required.';
  end if;

  o := lock_order(p_order_id);

  if o.status not in ('submitted', 'confirmed', 'refilling', 'ready') then
    raise exception 'Order is already in progress (%s) and cannot be reassigned.', o.status;
  end if;

  if not exists (
    select 1 from public.profiles
    where id = p_rider_id
      and role = 'rider'
      and is_active = true
      and is_available = true
  ) then
    raise exception 'Selected rider is not active or available.';
  end if;

  -- 1. Compute returnable gallons for bottle ledger
  select coalesce(sum(oi.quantity), 0) into v_qty
  from public.order_items oi
  join public.products p on p.id = oi.product_id
  where oi.order_id = o.id
    and p.is_returnable = true;

  if v_qty > 0 then
    insert into public.bottle_ledger (customer_id, order_id, bottles_refilled)
    values (o.customer_id, o.id, v_qty)
    on conflict (order_id) do update set bottles_refilled = excluded.bottles_refilled;
  end if;

  -- 2. Update status straight to rider_assigned
  update public.orders
  set
    status = 'rider_assigned',
    rider_id = p_rider_id
  where id = o.id;

  -- 3. Log transitions for complete audit history
  if o.status = 'submitted' then
    perform log_status(o.id, 'confirmed');
    perform log_status(o.id, 'refilling');
    perform log_status(o.id, 'ready');
  elsif o.status = 'confirmed' then
    perform log_status(o.id, 'refilling');
    perform log_status(o.id, 'ready');
  elsif o.status = 'refilling' then
    perform log_status(o.id, 'ready');
  end if;

  perform log_status(o.id, 'rider_assigned');
end;
$$;

grant execute on function public.staff_fast_track_order to authenticated;
