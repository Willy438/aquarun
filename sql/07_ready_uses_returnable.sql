-- =====================================================================
-- AquaRun - Returnable bottle counts at Ready & Rider balance lookup
-- Run in the Supabase SQL Editor AFTER 06_returnable_products.sql.
-- Safe to run more than once.
-- =====================================================================

-- 1. Ensure authenticated users can read order_returnable_qty
grant select on public.order_returnable_qty to authenticated;

-- 2. Staff marks Ready: use returnable_qty instead of total order quantity
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

  -- The ledger row is created here with the returnable refilled count.
  -- The rider fills in delivered and empties collected at the door.
  insert into bottle_ledger (customer_id, order_id, bottles_refilled)
  values (o.customer_id, o.id, v_qty)
  on conflict (order_id) do update set bottles_refilled = excluded.bottles_refilled;

  update orders set status = 'ready' where id = o.id;
  perform log_status(o.id, 'ready');
end;
$$;

revoke all on function public.mark_ready(uuid) from public, anon;
grant execute on function public.mark_ready(uuid) to authenticated;

-- 3. Helper RPC for rider expected-empties hint:
--    Returns the customer's bottle balance (total delivered minus total empties
--    collected across ALL riders) for the customer of p_order_id.
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
