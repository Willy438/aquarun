-- =====================================================================
-- AquaRun - 10: Rider Remittance, Attempted Delivery & Empty Containers
-- Safe to re-run in Supabase SQL Editor.
-- =====================================================================

-- 1. Add 'attempted' status to order_status enum
do $$
begin
  alter type public.order_status add value if not exists 'attempted';
exception
  when duplicate_object then null;
end $$;

-- 2. Add columns for Rider Remittance and Delivery Attempt Reason to orders table
alter table public.orders
  add column if not exists rider_remitted boolean not null default false,
  add column if not exists remitted_at timestamptz,
  add column if not exists remitted_by uuid references public.profiles(id),
  add column if not exists delivery_attempt_reason text;

create index if not exists orders_rider_remitted_idx on public.orders (rider_id, payment_status, rider_remitted);

-- 2b. Add update policy for orders if not already present
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'orders' and policyname = 'orders_update') then
    create policy orders_update on public.orders for update to authenticated
      using (auth_role() in ('staff', 'admin') or rider_id = auth.uid())
      with check (auth_role() in ('staff', 'admin') or rider_id = auth.uid());
  end if;
end $$;

-- 3. Function to record delivery attempt (for Rider when customer cannot be reached)
create or replace function public.record_delivery_attempt(
  p_order_id uuid,
  p_reason text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders;
  v_note text;
begin
  if auth.uid() is null then
    raise exception 'Please sign in first.';
  end if;

  select * into v_order from public.orders where id = p_order_id;
  if not found then
    raise exception 'Order not found.';
  end if;

  if v_order.status not in ('rider_assigned', 'out_for_delivery') then
    raise exception 'Only an active delivery can be marked Attempted.';
  end if;

  v_note := coalesce(p_reason, 'Customer unavailable');
  if p_note is not null and trim(p_note) <> '' then
    v_note := v_note || ' - ' || trim(p_note);
  end if;

  update public.orders
     set status = 'attempted',
         delivery_attempt_reason = v_note,
         slot_note = '[ATTEMPTED]: ' || v_note
   where id = p_order_id;

  perform log_status(p_order_id, 'attempted');
end;
$$;

revoke all on function public.record_delivery_attempt(uuid, text, text) from public, anon;
grant execute on function public.record_delivery_attempt(uuid, text, text) to authenticated;

-- 4. Function for Customer or Staff to Reschedule an Attempted Delivery
create or replace function public.reschedule_attempted_order(
  p_order_id uuid,
  p_delivery_date date,
  p_slot_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders;
begin
  if auth.uid() is null then
    raise exception 'Please sign in first.';
  end if;

  select * into v_order from public.orders where id = p_order_id;
  if not found then
    raise exception 'Order not found.';
  end if;

  -- Customers can reschedule their own orders; staff/admin can reschedule any order
  if auth.uid() <> v_order.customer_id and auth_role() not in ('staff', 'admin') then
    raise exception 'Not authorized to reschedule this order.';
  end if;

  update public.orders
     set status = 'ready',
         rider_id = null,
         delivery_date = p_delivery_date,
         scheduled_slot_id = p_slot_id,
         slot_adjusted_by = auth.uid(),
         slot_note = 'Rescheduled after delivery attempt to ' || to_char(p_delivery_date, 'Mon DD, YYYY')
   where id = p_order_id;

  perform log_status(p_order_id, 'ready');
end;
$$;

revoke all on function public.reschedule_attempted_order(uuid, date, uuid) from public, anon;
grant execute on function public.reschedule_attempted_order(uuid, date, uuid) to authenticated;

-- 5. Function for Staff/Cashier or Rider to Accept/Record Cash Remittance
create or replace function public.accept_rider_remittance(
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

  -- Allowed for the assigned rider themselves, or staff/admin
  if auth.uid() <> p_rider_id and auth_role() not in ('staff', 'admin') then
    raise exception 'Not authorized to remit cash for this rider.';
  end if;

  -- Calculate total unremitted COD cash collected by this rider
  select coalesce(sum(total), 0)
    into v_total
    from public.orders
   where rider_id = p_rider_id
     and status in ('delivered', 'completed')
     and (rider_remitted is false or rider_remitted is null);

  -- Mark all these delivered/completed cash orders as remitted and paid
  update public.orders
     set rider_remitted = true,
         remitted_at = now(),
         remitted_by = auth.uid(),
         status = 'completed',
         payment_status = 'paid',
         slot_note = coalesce(slot_note || ' ', '') || '[REMITTED]'
   where rider_id = p_rider_id
     and status in ('delivered', 'completed')
     and (rider_remitted is false or rider_remitted is null);

  return v_total;
end;
$$;

revoke all on function public.accept_rider_remittance(uuid) from public, anon;
grant execute on function public.accept_rider_remittance(uuid) to authenticated;

-- 6. Seed Empty Gallon Container Products (Sold Outright / Clean spare bottles)
insert into public.products (name, unit, price, new_container_price, is_returnable, is_active)
select v.name, v.unit, v.price, v.new_container_price, v.is_returnable, true
from (values
  ('Empty 5-Gallon Container (Round)', 'container', 125.00, 125.00, false),
  ('Empty 5-Gallon Container (Slim)',  'container', 125.00, 125.00, false)
) as v(name, unit, price, new_container_price, is_returnable)
where not exists (select 1 from public.products p where p.name = v.name);

-- 7. Update create_order to subtract active committed swaps (prevents double-swap balance exploit)
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
  v_active_swaps int := 0;
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

  -- Identify earliest non-cancelled order for legacy fallback if no orders delivered yet
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

  -- Count returnable swaps already committed in active (undelivered) orders
  select coalesce(sum(oi.quantity), 0)::int
    into v_active_swaps
    from orders o
    join order_items oi on oi.order_id = o.id
    join products p on p.id = oi.product_id
   where o.customer_id = auth.uid()
     and o.status in ('submitted', 'confirmed', 'refilling', 'ready', 'rider_assigned', 'out_for_delivery')
     and p.is_returnable = true
     and oi.unit_price <= p.price
     and (v_first_order_id is null or o.id <> v_first_order_id);

  -- Available swaps = physical bottles held minus swaps already committed in active orders
  v_swap_avail := greatest(0, v_ledger_balance - v_active_swaps);

  -- First pass: compute v_subtotal using swap vs. new_container_price vs. empty_only
  for rec in
    select (i ->> 'product_id')::uuid as product_id,
           coalesce(i ->> 'mode', 'refill') as item_mode,
           p.price as swap_price,
           coalesce(p.new_container_price, p.price) as container_price,
           p.is_returnable,
           sum((i ->> 'quantity')::int) as qty
      from jsonb_array_elements(p_items) i
      join products p on p.id = (i ->> 'product_id')::uuid and p.is_active
     group by 1, 2, 3, 4, 5
     order by p.price desc, product_id asc
  loop
    if rec.item_mode = 'empty_only' then
      v_new_price := greatest(25, rec.container_price - rec.swap_price);
      v_subtotal := v_subtotal + (rec.qty * v_new_price);
    elsif rec.is_returnable then
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

  -- Second pass: insert order_items rows (separate lines for swap vs. new gallon + water vs. empty_only)
  v_swap_avail := greatest(0, v_ledger_balance - v_active_swaps);
  for rec in
    select (i ->> 'product_id')::uuid as product_id,
           coalesce(i ->> 'mode', 'refill') as item_mode,
           p.price as swap_price,
           coalesce(p.new_container_price, p.price) as container_price,
           p.is_returnable,
           sum((i ->> 'quantity')::int) as qty
      from jsonb_array_elements(p_items) i
      join products p on p.id = (i ->> 'product_id')::uuid and p.is_active
     group by 1, 2, 3, 4, 5
     order by p.price desc, product_id asc
  loop
    if rec.item_mode = 'empty_only' then
      v_new_price := greatest(25, rec.container_price - rec.swap_price);
      insert into order_items (order_id, product_id, quantity, unit_price)
      values (v_id, rec.product_id, rec.qty, v_new_price);
    elsif rec.is_returnable then
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

  insert into bottle_ledger (customer_id, order_id, bottles_refilled)
  values (auth.uid(), v_id, 0)
  on conflict (order_id) do nothing;

  perform log_status(v_id, 'submitted');
  return v_id;
end;
$$;

revoke all on function public.create_order(uuid, date, uuid, text, jsonb) from public, anon;
grant execute on function public.create_order(uuid, date, uuid, text, jsonb) to authenticated;

-- Refresh schema cache
notify pgrst, 'reload schema';
