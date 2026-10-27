-- =====================================================================
-- AquaRun - 15: Separate Shape-Specific Swap Balances (Round vs. Slim)
-- Enforces 1-to-1 bottle swaps strictly per container shape.
-- A Round gallon held only allows a Round refill swap.
-- A Slim gallon held only allows a Slim refill swap.
-- If the customer does not have an empty container of the matching shape,
-- the refill is billed as New Gallon + Water (new_container_price).
-- =====================================================================

-- 1. Helper function to classify product container shape
create or replace function public.get_product_shape(p_name text)
returns text
language sql
immutable
as $$
  select case
    when p_name ilike '%slim%' then 'slim'
    when p_name ilike '%round%' then 'round'
    else 'round'
  end;
$$;

revoke all on function public.get_product_shape(text) from public, anon;
grant execute on function public.get_product_shape(text) to authenticated;

-- 2. Helper RPC to inspect a customer's physical containers held and available swaps by shape
create or replace function public.get_customer_shape_balance(p_customer_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_held_slim int := 0;
  v_held_round int := 0;
  v_active_slim int := 0;
  v_active_round int := 0;
  v_avail_slim int := 0;
  v_avail_round int := 0;
begin
  v_uid := coalesce(p_customer_id, auth.uid());
  if v_uid is null then
    return jsonb_build_object(
      'held_slim', 0,
      'held_round', 0,
      'active_slim', 0,
      'active_round', 0,
      'avail_slim', 0,
      'avail_round', 0
    );
  end if;

  -- Physical containers in customer's possession from delivered/completed orders
  select coalesce(sum(case when public.get_product_shape(p.name) = 'slim' then oi.quantity else 0 end), 0)::int,
         coalesce(sum(case when public.get_product_shape(p.name) = 'round' then oi.quantity else 0 end), 0)::int
    into v_held_slim, v_held_round
    from orders o
    join order_items oi on oi.order_id = o.id
    join products p on p.id = oi.product_id
   where o.customer_id = v_uid
     and o.status in ('delivered', 'completed')
     and (
       (p.is_returnable and oi.unit_price > p.price)
       or (not p.is_returnable and (p.name ilike '%container%' or p.name ilike '%empty%' or oi.unit_price >= 100))
     );

  -- Legacy fallback: If customer has delivered orders from before new container pricing was introduced
  if (v_held_slim + v_held_round = 0) and exists (
    select 1 from orders where customer_id = v_uid and status in ('delivered', 'completed')
  ) then
    select coalesce(sum(case when public.get_product_shape(p.name) = 'slim' then oi.quantity else 0 end), 0)::int,
           coalesce(sum(case when public.get_product_shape(p.name) = 'round' then oi.quantity else 0 end), 0)::int
      into v_held_slim, v_held_round
      from orders o
      join order_items oi on oi.order_id = o.id
      join products p on p.id = oi.product_id
     where o.id = (
       select id from orders
        where customer_id = v_uid
          and status in ('delivered', 'completed')
        order by created_at asc
        limit 1
     )
     and p.is_returnable;
  end if;

  -- Swaps currently committed to active (in-flight) orders
  select coalesce(sum(case when public.get_product_shape(p.name) = 'slim' then oi.quantity else 0 end), 0)::int,
         coalesce(sum(case when public.get_product_shape(p.name) = 'round' then oi.quantity else 0 end), 0)::int
    into v_active_slim, v_active_round
    from orders o
    join order_items oi on oi.order_id = o.id
    join products p on p.id = oi.product_id
   where o.customer_id = v_uid
     and o.status in ('submitted', 'confirmed', 'refilling', 'ready', 'rider_assigned', 'out_for_delivery')
     and p.is_returnable = true
     and oi.unit_price <= p.price;

  v_avail_slim := greatest(0, v_held_slim - v_active_slim);
  v_avail_round := greatest(0, v_held_round - v_active_round);

  return jsonb_build_object(
    'held_slim', v_held_slim,
    'held_round', v_held_round,
    'active_slim', v_active_slim,
    'active_round', v_active_round,
    'avail_slim', v_avail_slim,
    'avail_round', v_avail_round
  );
end;
$$;

revoke all on function public.get_customer_shape_balance(uuid) from public, anon;
grant execute on function public.get_customer_shape_balance(uuid) to authenticated;

-- 3. Replace create_order with shape-specific swap allocation
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

  -- Shape-specific balances
  v_held_slim int := 0;
  v_held_round int := 0;
  v_active_slim_swaps int := 0;
  v_active_round_swaps int := 0;
  v_swap_avail_slim int := 0;
  v_swap_avail_round int := 0;

  v_item_shape text;
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

  -- 1. Calculate physical containers held from delivered or completed orders
  select coalesce(sum(case when public.get_product_shape(p.name) = 'slim' then oi.quantity else 0 end), 0)::int,
         coalesce(sum(case when public.get_product_shape(p.name) = 'round' then oi.quantity else 0 end), 0)::int
    into v_held_slim, v_held_round
    from orders o
    join order_items oi on oi.order_id = o.id
    join products p on p.id = oi.product_id
   where o.customer_id = auth.uid()
     and o.status in ('delivered', 'completed')
     and (
       (p.is_returnable and oi.unit_price > p.price)
       or (not p.is_returnable and (p.name ilike '%container%' or p.name ilike '%empty%' or oi.unit_price >= 100))
     );

  -- Legacy fallback: If customer has delivered orders from before new container pricing was introduced
  if (v_held_slim + v_held_round = 0) and exists (
    select 1 from orders where customer_id = auth.uid() and status in ('delivered', 'completed')
  ) then
    select coalesce(sum(case when public.get_product_shape(p.name) = 'slim' then oi.quantity else 0 end), 0)::int,
           coalesce(sum(case when public.get_product_shape(p.name) = 'round' then oi.quantity else 0 end), 0)::int
      into v_held_slim, v_held_round
      from orders o
      join order_items oi on oi.order_id = o.id
      join products p on p.id = oi.product_id
     where o.id = (
       select id from orders
        where customer_id = auth.uid()
          and status in ('delivered', 'completed')
        order by created_at asc
        limit 1
     )
     and p.is_returnable;
  end if;

  -- 2. Count returnable swaps already committed in active (undelivered) orders
  select coalesce(sum(case when public.get_product_shape(p.name) = 'slim' then oi.quantity else 0 end), 0)::int,
         coalesce(sum(case when public.get_product_shape(p.name) = 'round' then oi.quantity else 0 end), 0)::int
    into v_active_slim_swaps, v_active_round_swaps
    from orders o
    join order_items oi on oi.order_id = o.id
    join products p on p.id = oi.product_id
   where o.customer_id = auth.uid()
     and o.status in ('submitted', 'confirmed', 'refilling', 'ready', 'rider_assigned', 'out_for_delivery')
     and p.is_returnable = true
     and oi.unit_price <= p.price;

  -- 3. Available swaps per shape
  v_swap_avail_slim := greatest(0, v_held_slim - v_active_slim_swaps);
  v_swap_avail_round := greatest(0, v_held_round - v_active_round_swaps);

  -- First pass: compute v_subtotal using shape-isolated swap availability
  for rec in
    select (i ->> 'product_id')::uuid as product_id,
           coalesce(i ->> 'mode', 'refill') as item_mode,
           p.name as product_name,
           p.price as swap_price,
           coalesce(p.new_container_price, p.price) as container_price,
           p.is_returnable,
           sum((i ->> 'quantity')::int) as qty
      from jsonb_array_elements(p_items) i
      join products p on p.id = (i ->> 'product_id')::uuid and p.is_active
     group by 1, 2, 3, 4, 5, 6
     order by p.price desc, product_id asc
  loop
    v_item_shape := public.get_product_shape(rec.product_name);
    if rec.item_mode = 'empty_only' then
      v_new_price := greatest(25, rec.container_price - rec.swap_price);
      v_subtotal := v_subtotal + (rec.qty * v_new_price);
    elsif rec.is_returnable then
      if v_item_shape = 'slim' then
        v_swap_qty := least(rec.qty, v_swap_avail_slim);
        v_swap_avail_slim := v_swap_avail_slim - v_swap_qty;
      else
        v_swap_qty := least(rec.qty, v_swap_avail_round);
        v_swap_avail_round := v_swap_avail_round - v_swap_qty;
      end if;

      v_new_qty := rec.qty - v_swap_qty;
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

  -- Second pass: insert order_items rows
  v_swap_avail_slim := greatest(0, v_held_slim - v_active_slim_swaps);
  v_swap_avail_round := greatest(0, v_held_round - v_active_round_swaps);

  for rec in
    select (i ->> 'product_id')::uuid as product_id,
           coalesce(i ->> 'mode', 'refill') as item_mode,
           p.name as product_name,
           p.price as swap_price,
           coalesce(p.new_container_price, p.price) as container_price,
           p.is_returnable,
           sum((i ->> 'quantity')::int) as qty
      from jsonb_array_elements(p_items) i
      join products p on p.id = (i ->> 'product_id')::uuid and p.is_active
     group by 1, 2, 3, 4, 5, 6
     order by p.price desc, product_id asc
  loop
    v_item_shape := public.get_product_shape(rec.product_name);
    if rec.item_mode = 'empty_only' then
      v_new_price := greatest(25, rec.container_price - rec.swap_price);
      insert into order_items (order_id, product_id, quantity, unit_price)
      values (v_id, rec.product_id, rec.qty, v_new_price);
    elsif rec.is_returnable then
      if v_item_shape = 'slim' then
        v_swap_qty := least(rec.qty, v_swap_avail_slim);
        v_swap_avail_slim := v_swap_avail_slim - v_swap_qty;
      else
        v_swap_qty := least(rec.qty, v_swap_avail_round);
        v_swap_avail_round := v_swap_avail_round - v_swap_qty;
      end if;

      v_new_qty := rec.qty - v_swap_qty;
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

-- Refresh PostgREST schema cache
notify pgrst, 'reload schema';
