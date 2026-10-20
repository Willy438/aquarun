-- 04_functions.sql: Status changes and delivery record (Sections 4 and 8).
-- Run after 03_views.sql. Safe to run again (uses create or replace).
--
-- Every change to an order goes through one of these functions. Each one checks WHO is
-- calling and WHAT status the order is in, so the rules in Section 4.3 hold even if
-- someone bypasses the page. The pages call them with supabase.rpc('function_name', {...}).

-- The rider can add a note when the counts differ (Section 8.3).
alter table bottle_ledger add column if not exists note text;

-- ---------- internal helpers (not callable from the website) ----------
create or replace function require_role(roles text[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not coalesce(auth_is_active(), false) or not (auth_role()::text = any (roles)) then
    raise exception 'You are not allowed to do this.';
  end if;
end;
$$;

create or replace function lock_order(p_id uuid) returns orders
language plpgsql security definer set search_path = public as $$
declare o orders;
begin
  select * into o from orders where id = p_id for update;
  if not found then raise exception 'Order not found.'; end if;
  return o;
end;
$$;

create or replace function log_status(p_order uuid, p_status order_status) returns void
language sql security definer set search_path = public as $$
  insert into order_status_log (order_id, status, changed_by, changed_at)
  values (p_order, p_status, auth.uid(), clock_timestamp());
$$;

-- ---------- slot availability for the customer's New order page ----------
create or replace function slot_availability(p_date date)
returns table (slot_id uuid, label text, start_time time, end_time time, max_orders int,
               orders_count int, is_closed boolean, is_full boolean)
language sql stable security definer set search_path = public as $$
  select t.*, (t.orders_count >= t.max_orders) as is_full
  from (
    select s.id, s.label, s.start_time, s.end_time, s.max_orders,
      (select count(*) from orders o
        where o.delivery_date = p_date
          and coalesce(o.scheduled_slot_id, o.preferred_slot_id) = s.id
          and o.status <> 'cancelled')::int as orders_count,
      exists (select 1 from slot_closures c where c.time_slot_id = s.id and c.closure_date = p_date) as is_closed
    from time_slots s
    where s.is_active
  ) t
  order by t.start_time;
$$;

-- ---------- 1. Customer places an order (Submitted) ----------
-- p_items example: [{"product_id": "...", "quantity": 2}]
create or replace function create_order(p_address_id uuid, p_delivery_date date, p_slot_id uuid,
                                        p_notes text, p_items jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_slot time_slots;
  v_subtotal numeric(10,2);
  v_charge numeric(10,2);
  v_count int;
  v_valid int;
  v_today date := (now() at time zone 'Asia/Manila')::date;
begin
  perform require_role(array['customer']);
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one product to your order.';
  end if;
  if p_delivery_date < v_today then raise exception 'Choose today or a later date.'; end if;
  if not exists (select 1 from addresses where id = p_address_id and customer_id = auth.uid()) then
    raise exception 'Choose one of your saved addresses.';
  end if;

  select * into v_slot from time_slots where id = p_slot_id and is_active;
  if not found then raise exception 'That time slot is not available.'; end if;
  if exists (select 1 from slot_closures where time_slot_id = p_slot_id and closure_date = p_delivery_date) then
    raise exception 'That time slot is closed for the selected date.';
  end if;
  select count(*) into v_count from orders
    where delivery_date = p_delivery_date
      and coalesce(scheduled_slot_id, preferred_slot_id) = p_slot_id
      and status <> 'cancelled';
  if v_count >= v_slot.max_orders then raise exception 'That time slot is full. Please pick another.'; end if;

  -- Prices come from the products table, never from the page (Section 8.2).
  select count(*), coalesce(sum(p.price * x.qty), 0) into v_valid, v_subtotal
  from (select (i ->> 'product_id')::uuid as product_id, sum((i ->> 'quantity')::int) as qty
        from jsonb_array_elements(p_items) i group by 1) x
  join products p on p.id = x.product_id and p.is_active
  where x.qty > 0;
  select count(distinct i ->> 'product_id') into v_count from jsonb_array_elements(p_items) i;
  if v_valid <> v_count then raise exception 'Check the products and quantities in your order.'; end if;

  select coalesce(value::numeric, 0) into v_charge from settings where key = 'service_charge';
  v_charge := coalesce(v_charge, 0);

  insert into orders (customer_id, address_id, delivery_date, preferred_slot_id, notes,
                      subtotal, service_charge, total)
  values (auth.uid(), p_address_id, p_delivery_date, p_slot_id, p_notes,
          v_subtotal, v_charge, v_subtotal + v_charge)
  returning id into v_id;

  insert into order_items (order_id, product_id, quantity, unit_price)
  select v_id, p.id, x.qty, p.price
  from (select (i ->> 'product_id')::uuid as product_id, sum((i ->> 'quantity')::int) as qty
        from jsonb_array_elements(p_items) i group by 1) x
  join products p on p.id = x.product_id;

  perform log_status(v_id, 'submitted');
  return v_id;
end;
$$;

-- ---------- 2. Customer cancels (only while Submitted) ----------
create or replace function cancel_order(p_order_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare o orders;
begin
  perform require_role(array['customer']);
  o := lock_order(p_order_id);
  if o.customer_id <> auth.uid() then raise exception 'This is not your order.'; end if;
  if o.status <> 'submitted' then
    raise exception 'This order was already confirmed. Please contact the station to cancel.';
  end if;
  update orders set status = 'cancelled' where id = o.id;
  perform log_status(o.id, 'cancelled');
end;
$$;

-- ---------- 3. Staff confirms (keeps the preferred slot or sets a new window) ----------
create or replace function confirm_order(p_order_id uuid, p_slot_id uuid default null, p_slot_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare o orders; v_slot uuid; v_changed boolean;
begin
  perform require_role(array['staff']);
  o := lock_order(p_order_id);
  if o.status <> 'submitted' then raise exception 'Only a Submitted order can be confirmed.'; end if;
  v_slot := coalesce(p_slot_id, o.preferred_slot_id);
  if not exists (select 1 from time_slots where id = v_slot) then raise exception 'Time slot not found.'; end if;
  v_changed := v_slot <> o.preferred_slot_id;
  update orders set
    status = 'confirmed',
    scheduled_slot_id = v_slot,
    slot_adjusted_by = case when v_changed then auth.uid() end,
    slot_note = case when v_changed then p_slot_note end
  where id = o.id;
  perform log_status(o.id, 'confirmed');
end;
$$;

-- ---------- Staff adjusts the delivery window (from Confirmed until the rider starts) ----------
create or replace function adjust_delivery_slot(p_order_id uuid, p_slot_id uuid, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare o orders;
begin
  perform require_role(array['staff']);
  o := lock_order(p_order_id);
  if o.status not in ('confirmed', 'refilling', 'ready', 'rider_assigned') then
    raise exception 'The delivery window can only be changed from Confirmed until the rider starts delivery.';
  end if;
  if not exists (select 1 from time_slots where id = p_slot_id) then raise exception 'Time slot not found.'; end if;
  update orders set scheduled_slot_id = p_slot_id, slot_adjusted_by = auth.uid(), slot_note = p_note
  where id = o.id;
end;
$$;

-- ---------- 4. Staff starts the refill ----------
create or replace function start_refill(p_order_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare o orders;
begin
  perform require_role(array['staff']);
  o := lock_order(p_order_id);
  if o.status <> 'confirmed' then raise exception 'Only a Confirmed order can be refilled.'; end if;
  update orders set status = 'refilling' where id = o.id;
  perform log_status(o.id, 'refilling');
end;
$$;

-- ---------- 5. Staff marks Ready (bottles refilled is set automatically, Section 8.3) ----------
create or replace function mark_ready(p_order_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare o orders; v_qty int;
begin
  perform require_role(array['staff']);
  o := lock_order(p_order_id);
  if o.status <> 'refilling' then raise exception 'Only an order being refilled can be marked Ready.'; end if;
  select coalesce(sum(quantity), 0) into v_qty from order_items where order_id = o.id;
  -- The ledger row is created here with the refilled count. The rider fills in
  -- delivered and empties collected at the door, so there is still one entry per order.
  insert into bottle_ledger (customer_id, order_id, bottles_refilled)
  values (o.customer_id, o.id, v_qty)
  on conflict (order_id) do update set bottles_refilled = excluded.bottles_refilled;
  update orders set status = 'ready' where id = o.id;
  perform log_status(o.id, 'ready');
end;
$$;

-- ---------- 6. Staff assigns an available rider ----------
create or replace function assign_rider(p_order_id uuid, p_rider_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare o orders;
begin
  perform require_role(array['staff']);
  o := lock_order(p_order_id);
  if o.status <> 'ready' then raise exception 'A rider can only be assigned to a Ready order.'; end if;
  if not exists (select 1 from profiles where id = p_rider_id and role = 'rider' and is_active and is_available) then
    raise exception 'That rider is not available.';
  end if;
  update orders set status = 'rider_assigned', rider_id = p_rider_id where id = o.id;
  perform log_status(o.id, 'rider_assigned');
end;
$$;

-- ---------- 7. Rider starts delivery ----------
create or replace function start_delivery(p_order_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare o orders;
begin
  perform require_role(array['rider']);
  o := lock_order(p_order_id);
  if o.rider_id is distinct from auth.uid() then raise exception 'This delivery is not assigned to you.'; end if;
  if o.status <> 'rider_assigned' then raise exception 'This delivery cannot be started right now.'; end if;
  update orders set status = 'out_for_delivery' where id = o.id;
  perform log_status(o.id, 'out_for_delivery');
end;
$$;

-- ---------- 8. Rider records the delivery (and payment if cash was collected) ----------
create or replace function record_delivery(p_order_id uuid, p_delivered int, p_empties int,
                                           p_note text default null, p_payment_received boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare o orders;
begin
  perform require_role(array['rider']);
  o := lock_order(p_order_id);
  if o.rider_id is distinct from auth.uid() then raise exception 'This delivery is not assigned to you.'; end if;
  if o.status <> 'out_for_delivery' then raise exception 'Start the delivery before recording it.'; end if;
  if p_delivered is null or p_empties is null or p_delivered < 0 or p_empties < 0 then
    raise exception 'Enter the bottle counts.';
  end if;

  insert into bottle_ledger (customer_id, order_id, bottles_delivered, empties_collected, recorded_by, note)
  values (o.customer_id, o.id, p_delivered, p_empties, auth.uid(), p_note)
  on conflict (order_id) do update set
    bottles_delivered = excluded.bottles_delivered,
    empties_collected = excluded.empties_collected,
    recorded_by = excluded.recorded_by,
    note = excluded.note;

  update orders set status = 'delivered', delivered_at = now() where id = o.id;
  perform log_status(o.id, 'delivered');

  if p_payment_received then
    update orders set status = 'completed', payment_status = 'paid', paid_at = now(),
                      payment_confirmed_by = auth.uid()
    where id = o.id;
    perform log_status(o.id, 'completed');
  end if;
end;
$$;

-- ---------- 9. Staff confirms payment for a Delivered order ----------
create or replace function confirm_payment(p_order_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare o orders;
begin
  perform require_role(array['staff']);
  o := lock_order(p_order_id);
  if o.status <> 'delivered' or o.payment_status <> 'unpaid' then
    raise exception 'Only a delivered, unpaid order can be confirmed.';
  end if;
  update orders set status = 'completed', payment_status = 'paid', paid_at = now(),
                    payment_confirmed_by = auth.uid()
  where id = o.id;
  perform log_status(o.id, 'completed');
end;
$$;

-- ---------- Access ----------
-- Signed-in users can call the functions above. Each one checks the role itself.
-- Signed-out visitors and the internal helpers are closed.
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on function require_role(text[]), lock_order(uuid), log_status(uuid, order_status) from authenticated;