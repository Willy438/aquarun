-- =====================================================================
-- AquaRun - 16: Enforce Time Slot Remaining Capacity Limit on create_order
-- Ensures that an order cannot be placed if the requested item quantity
-- exceeds the remaining spots/capacity of the selected delivery time slot.
-- =====================================================================

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
  v_total_order_qty int := 0;
  v_remaining_spots int := 0;

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

  v_remaining_spots := greatest(0, v_slot.max_orders - v_count);

  -- Validate total requested quantity against remaining slot capacity
  select coalesce(sum((i ->> 'quantity')::int), 0) into v_total_order_qty
    from jsonb_array_elements(p_items) i;

  if v_total_order_qty > v_remaining_spots then
    raise exception 'Order quantity (% items) exceeds the % remaining delivery spots for this time slot (capacity: %).',
      v_total_order_qty, v_remaining_spots, v_slot.max_orders;
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

  -- 2. Swaps currently committed to active (in-flight) orders
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

  v_swap_avail_slim := greatest(0, v_held_slim - v_active_slim_swaps);
  v_swap_avail_round := greatest(0, v_held_round - v_active_round_swaps);

  select coalesce(value::numeric, 20.00) into v_charge from settings where key = 'service_charge';
  v_charge := coalesce(v_charge, 20.00);

  insert into orders (
    customer_id, address_id, delivery_date, preferred_slot_id, notes,
    subtotal, service_charge, total
  )
  values (
    auth.uid(), p_address_id, p_delivery_date, p_slot_id, p_notes,
    0, v_charge, v_charge
  )
  returning id into v_id;

  -- 3. Insert order items with shape-specific swap allocation
  for rec in
    select (i ->> 'product_id')::uuid as product_id,
           sum((i ->> 'quantity')::int) as qty,
           (i ->> 'mode') as item_mode,
           p.price as base_price,
           p.new_container_price,
           p.is_returnable,
           p.name as product_name
      from jsonb_array_elements(p_items) i
      join products p on p.id = (i ->> 'product_id')::uuid
     group by (i ->> 'product_id')::uuid, (i ->> 'mode'), p.price, p.new_container_price, p.is_returnable, p.name
     order by p.is_returnable desc, p.price desc
  loop
    v_new_price := coalesce(rec.new_container_price, rec.base_price + 125.00);

    if rec.item_mode = 'empty_only' or rec.is_returnable = false then
      v_subtotal := v_subtotal + (rec.qty * rec.base_price);
      insert into order_items (order_id, product_id, quantity, unit_price)
      values (v_id, rec.product_id, rec.qty, rec.base_price);

    else
      v_item_shape := public.get_product_shape(rec.product_name);

      if v_item_shape = 'slim' then
        v_swap_qty := least(rec.qty, v_swap_avail_slim);
        v_swap_avail_slim := v_swap_avail_slim - v_swap_qty;
      else
        v_swap_qty := least(rec.qty, v_swap_avail_round);
        v_swap_avail_round := v_swap_avail_round - v_swap_qty;
      end if;

      v_new_qty := rec.qty - v_swap_qty;

      if v_swap_qty > 0 then
        v_subtotal := v_subtotal + (v_swap_qty * rec.base_price);
        insert into order_items (order_id, product_id, quantity, unit_price)
        values (v_id, rec.product_id, v_swap_qty, rec.base_price);
      end if;

      if v_new_qty > 0 then
        v_subtotal := v_subtotal + (v_new_qty * v_new_price);
        insert into order_items (order_id, product_id, quantity, unit_price)
        values (v_id, rec.product_id, v_new_qty, v_new_price);
      end if;
    end if;
  end loop;

  update orders
     set subtotal = v_subtotal,
         total = v_subtotal + v_charge
   where id = v_id;

  perform log_status(v_id, 'submitted');
  return v_id;
end;
$$;

revoke all on function public.create_order(uuid, date, uuid, text, jsonb) from public, anon;
grant execute on function public.create_order(uuid, date, uuid, text, jsonb) to authenticated;
