-- =====================================================================
-- AquaRun - 08: New Gallon + Water vs. 1-to-1 Swap Refill Pricing
-- Includes 07 (mark_ready + get_customer_balance_for_order) so you can
-- run this single file in the Supabase SQL Editor. Safe to re-run.
-- =====================================================================

-- 1. Add new_container_price to products (price when customer buys gallon + water)
alter table public.products
  add column if not exists new_container_price numeric(10,2) not null default 150.00
  check (new_container_price >= 0);

-- Set a sensible default (refill price + 125) for any existing returnable product still at default
update public.products
   set new_container_price = price + 125.00
 where is_returnable = true
   and new_container_price = 150.00
   and price <> 25.00;

-- 2. Ensure authenticated users can read order_returnable_qty and staff/admin can manage settings
grant select on public.order_returnable_qty to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where policyname = 'settings_staff_update' and tablename = 'settings') then
    create policy settings_staff_update on public.settings for all to authenticated
      using (auth_role() in ('staff', 'admin'))
      with check (auth_role() in ('staff', 'admin'));
  end if;
end $$;

-- 3. Staff marks Ready: use returnable_qty instead of total order quantity
create or replace function public.mark_ready(p_order_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  o orders;
  v_qty int;
begin
  perform require_role(array['staff']);
  o := lock_order(p_order_id);
  if o.status <> 'refilling' then
    raise exception 'Only an order being refilled can be marked Ready.';
  end if;

  select coalesce(returnable_qty, 0)::int
    into v_qty
    from public.order_returnable_qty
   where order_id = o.id;

  v_qty := coalesce(v_qty, 0);

  insert into bottle_ledger (customer_id, order_id, bottles_refilled)
  values (o.customer_id, o.id, v_qty)
  on conflict (order_id) do update set bottles_refilled = excluded.bottles_refilled;

  update orders set status = 'ready' where id = o.id;
  perform log_status(o.id, 'ready');
end;
$$;

revoke all on function public.mark_ready(uuid) from public, anon;
grant execute on function public.mark_ready(uuid) to authenticated;

-- 4. Helper RPC for rider expected-empties hint
create or replace function public.get_customer_balance_for_order(p_order_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders;
  v_role text;
  v_balance integer;
begin
  if auth.uid() is null then
    raise exception 'Please sign in first.';
  end if;

  select * into v_order
    from public.orders
   where id = p_order_id;

  if not found then
    raise exception 'Order not found.';
  end if;

  select role::text into v_role
    from public.profiles
   where id = auth.uid()
     and is_active = true;

  if v_role is null then
    raise exception 'Your account cannot perform this action.';
  end if;

  if v_role not in ('staff', 'admin') and v_order.rider_id is distinct from auth.uid() then
    raise exception 'Not authorized to view balance for this order.';
  end if;

  select (coalesce(sum(bottles_delivered), 0) - coalesce(sum(empties_collected), 0))::integer
    into v_balance
    from public.bottle_ledger
   where customer_id = v_order.customer_id;

  return coalesce(v_balance, 0);
end;
$$;

revoke all on function public.get_customer_balance_for_order(uuid) from public, anon;
grant execute on function public.get_customer_balance_for_order(uuid) to authenticated;

-- 5. Customer places an order:
--    Applies 1-to-1 Swap Refill price (products.price) up to the customer's
--    available bottle balance, and New Gallon + Water price (products.new_container_price)
--    for any returnable gallons above their available balance (including 1st order).
create or replace function public.create_order(
  p_address_id uuid,
  p_delivery_date date,
  p_slot_id uuid,
  p_notes text,
  p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_slot time_slots;
  v_subtotal numeric(10,2) := 0;
  v_charge numeric(10,2);
  v_count int;
  v_valid int;
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_station_open text;
  v_ledger_balance int := 0;
  v_active_new_containers int := 0;
  v_first_order_id uuid := null;
  v_swap_avail int := 0;
  v_swap_qty int;
  v_new_qty int;
  v_new_price numeric(10,2);
  rec record;
begin
  perform require_role(array['customer']);

  select value into v_station_open from settings where key = 'station_open';
  if v_station_open is not null and lower(v_station_open) = 'false' then
    raise exception 'The station is currently closed for new orders.';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one product to your order.';
  end if;
  if p_delivery_date < v_today then
    raise exception 'Choose today or a later date.';
  end if;
  if not exists (select 1 from addresses where id = p_address_id and customer_id = auth.uid()) then
    raise exception 'Choose one of your saved addresses.';
  end if;

  select * into v_slot from time_slots where id = p_slot_id and is_active;
  if not found then
    raise exception 'That time slot is not available.';
  end if;
  if exists (select 1 from slot_closures where time_slot_id = p_slot_id and closure_date = p_delivery_date) then
    raise exception 'That time slot is closed for the selected date.';
  end if;

  select count(*) into v_count
    from orders
   where delivery_date = p_delivery_date
     and coalesce(scheduled_slot_id, preferred_slot_id) = p_slot_id
     and status <> 'cancelled';
  if v_count >= v_slot.max_orders then
    raise exception 'That time slot is full. Please pick another.';
  end if;

  -- Validate that all requested products exist, are active, and have qty > 0
  select count(*) into v_valid
    from (
      select (i ->> 'product_id')::uuid as product_id,
             sum((i ->> 'quantity')::int) as qty
        from jsonb_array_elements(p_items) i
       group by 1
    ) x
    join products p on p.id = x.product_id and p.is_active
   where x.qty > 0;

  select count(distinct i ->> 'product_id') into v_count
    from jsonb_array_elements(p_items) i;
  if v_valid <> v_count then
    raise exception 'Check the products and quantities in your order.';
  end if;

  -- Calculate how many returnable gallons the customer holds from delivered orders
  select greatest(0, coalesce(sum(bottles_delivered), 0) - coalesce(sum(empties_collected), 0))::int
    into v_ledger_balance
    from bottle_ledger
   where customer_id = auth.uid();

  -- Identify earliest non-cancelled order for legacy 1st-order fallback when no orders are delivered yet
  if v_ledger_balance = 0 and not exists (
    select 1 from orders
     where customer_id = auth.uid()
       and status in ('delivered', 'completed')
  ) then
    select id into v_first_order_id
      from orders
     where customer_id = auth.uid()
       and status <> 'cancelled'
     order by created_at asc
     limit 1;
  end if;

  -- Count only NEW returnable containers in active (undelivered) orders
  -- (or the earliest order if it was a legacy 1st order before new_container_price existed),
  -- so swap-only active orders never inflate the customer's swap allowance.
  select coalesce(sum(oi.quantity), 0)::int
    into v_active_new_containers
    from orders o
    join order_items oi on oi.order_id = o.id
    join products p on p.id = oi.product_id
   where o.customer_id = auth.uid()
     and o.status in ('submitted', 'confirmed', 'refilling', 'ready', 'rider_assigned', 'out_for_delivery')
     and p.is_returnable = true
     and (
       oi.unit_price > p.price
       or (v_first_order_id is not null and o.id = v_first_order_id)
     );

  v_swap_avail := greatest(0, v_ledger_balance + v_active_new_containers);

  -- First pass: compute v_subtotal using swap vs. new_container_price
  for rec in
    select p.id as product_id,
           p.price as swap_price,
           coalesce(p.new_container_price, p.price) as container_price,
           p.is_returnable,
           x.qty
      from (
        select (i ->> 'product_id')::uuid as product_id,
               sum((i ->> 'quantity')::int) as qty
          from jsonb_array_elements(p_items) i
         group by 1
      ) x
      join products p on p.id = x.product_id and p.is_active
     order by p.price desc, p.id asc
  loop
    if rec.is_returnable then
      v_swap_qty := least(rec.qty, v_swap_avail);
      v_new_qty := rec.qty - v_swap_qty;
      v_swap_avail := v_swap_avail - v_swap_qty;
      v_new_price := greatest(rec.swap_price, rec.container_price);
      v_subtotal := v_subtotal + (v_swap_qty * rec.swap_price) + (v_new_qty * v_new_price);
    else
      v_subtotal := v_subtotal + (rec.qty * rec.swap_price);
    end if;
  end loop;

  select coalesce(value::numeric, 0) into v_charge from settings where key = 'service_charge';
  v_charge := coalesce(v_charge, 0);

  insert into orders (
    customer_id, address_id, delivery_date, preferred_slot_id, notes,
    subtotal, service_charge, total
  )
  values (
    auth.uid(), p_address_id, p_delivery_date, p_slot_id, p_notes,
    v_subtotal, v_charge, v_subtotal + v_charge
  )
  returning id into v_id;

  -- Second pass: insert order_items rows (separate lines for swap vs. new gallon + water)
  v_swap_avail := greatest(0, v_ledger_balance + v_active_new_containers);
  for rec in
    select p.id as product_id,
           p.price as swap_price,
           coalesce(p.new_container_price, p.price) as container_price,
           p.is_returnable,
           x.qty
      from (
        select (i ->> 'product_id')::uuid as product_id,
               sum((i ->> 'quantity')::int) as qty
          from jsonb_array_elements(p_items) i
         group by 1
      ) x
      join products p on p.id = x.product_id and p.is_active
     order by p.price desc, p.id asc
  loop
    if rec.is_returnable then
      v_swap_qty := least(rec.qty, v_swap_avail);
      v_new_qty := rec.qty - v_swap_qty;
      v_swap_avail := v_swap_avail - v_swap_qty;
      v_new_price := greatest(rec.swap_price, rec.container_price);

      if v_swap_qty > 0 then
        insert into order_items (order_id, product_id, quantity, unit_price)
        values (v_id, rec.product_id, v_swap_qty, rec.swap_price);
      end if;

      if v_new_qty > 0 then
        insert into order_items (order_id, product_id, quantity, unit_price)
        values (v_id, rec.product_id, v_new_qty, v_new_price);
      end if;
    else
      insert into order_items (order_id, product_id, quantity, unit_price)
      values (v_id, rec.product_id, rec.qty, rec.swap_price);
    end if;
  end loop;

  perform log_status(v_id, 'submitted');
  return v_id;
end;
$$;

revoke all on function public.create_order(uuid, date, uuid, text, jsonb) from public, anon;
grant execute on function public.create_order(uuid, date, uuid, text, jsonb) to authenticated;

-- 6. Rider records the delivery: enforces automatic 1-to-1 swap bottle counts on the backend
create or replace function public.record_delivery(
  p_order_id uuid,
  p_delivered int,
  p_empties int,
  p_note text default null,
  p_payment_received boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  o orders;
  v_returnable_qty int := 0;
  v_new_containers int := 0;
  v_swap_qty int := 0;
  v_balance_before int := 0;
  v_delivered int := 0;
  v_empties int := 0;
begin
  perform require_role(array['rider']);
  o := lock_order(p_order_id);
  if o.rider_id is distinct from auth.uid() then
    raise exception 'This delivery is not assigned to you.';
  end if;
  if o.status <> 'out_for_delivery' then
    raise exception 'Start the delivery before recording it.';
  end if;

  -- Compute returnable gallons and new containers in this order
  select coalesce(sum(oi.quantity), 0)::int,
         coalesce(sum(case when oi.unit_price > p.price then oi.quantity else 0 end), 0)::int
    into v_returnable_qty, v_new_containers
    from order_items oi
    join products p on p.id = oi.product_id
   where oi.order_id = o.id
     and p.is_returnable = true;

  v_swap_qty := greatest(0, v_returnable_qty - v_new_containers);

  -- Customer's bottle balance prior to this order
  select greatest(0, coalesce(sum(bottles_delivered), 0) - coalesce(sum(empties_collected), 0))::int
    into v_balance_before
    from bottle_ledger
   where customer_id = o.customer_id
     and order_id <> o.id;

  -- Authoritative automatic 1-to-1 swap counts
  v_delivered := v_returnable_qty;
  v_empties := least(v_swap_qty, v_balance_before);

  insert into bottle_ledger (customer_id, order_id, bottles_delivered, empties_collected, recorded_by, note)
  values (o.customer_id, o.id, v_delivered, v_empties, auth.uid(), p_note)
  on conflict (order_id) do update set
    bottles_delivered = excluded.bottles_delivered,
    empties_collected = excluded.empties_collected,
    recorded_by = excluded.recorded_by,
    note = excluded.note;

  update orders set status = 'delivered', delivered_at = now() where id = o.id;
  perform log_status(o.id, 'delivered');

  if p_payment_received then
    update orders
       set status = 'completed',
           payment_status = 'paid',
           paid_at = now(),
           payment_confirmed_by = auth.uid()
     where id = o.id;
    perform log_status(o.id, 'completed');
  end if;
end;
$$;

revoke all on function public.record_delivery(uuid, int, int, text, boolean) from public, anon;
grant execute on function public.record_delivery(uuid, int, int, text, boolean) to authenticated;

-- Refresh PostgREST schema cache
notify pgrst, 'reload schema';
