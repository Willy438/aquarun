-- =====================================================================
-- AquaRun - 17: Staff Order Cancellation and Rider Re-assignment
-- Adds staff capabilities to cancel active orders and re-assign riders.
-- =====================================================================

-- ---------- 1. Staff cancels active order ----------
create or replace function public.staff_cancel_order(
  p_order_id uuid,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  o orders;
  v_reason text;
begin
  perform require_role(array['staff', 'admin']);
  o := lock_order(p_order_id);

  if o.status in ('completed', 'cancelled') then
    raise exception 'Order is already % and cannot be cancelled.', o.status;
  end if;

  v_reason := coalesce(nullif(trim(p_reason), ''), 'Cancelled by station staff');

  update orders set
    status = 'cancelled',
    notes = case
      when o.notes is not null and trim(o.notes) <> '' then o.notes || E'\n' || v_reason
      else v_reason
    end
  where id = o.id;

  -- Delete refilled bottle ledger placeholder if present so bottle balance is untouched
  delete from bottle_ledger where order_id = o.id;

  perform log_status(o.id, 'cancelled');
end;
$$;

-- ---------- 2. Staff re-assigns order to another rider ----------
create or replace function public.staff_reassign_rider(
  p_order_id uuid,
  p_rider_id uuid,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  o orders;
  v_rider profiles;
  v_qty int;
begin
  perform require_role(array['staff', 'admin']);
  o := lock_order(p_order_id);

  if o.status in ('completed', 'cancelled', 'delivered') then
    raise exception 'Cannot re-assign rider for % orders.', o.status;
  end if;

  select * into v_rider from profiles where id = p_rider_id and role = 'rider' and is_active;
  if not found then
    raise exception 'Selected rider not found or inactive.';
  end if;

  -- If order was submitted, confirmed, or refilling, ensure bottle ledger is ready
  if o.status in ('submitted', 'confirmed', 'refilling') then
    select coalesce(sum(quantity), 0) into v_qty from order_items where order_id = o.id;
    insert into bottle_ledger (customer_id, order_id, bottles_refilled)
    values (o.customer_id, o.id, v_qty)
    on conflict (order_id) do update set bottles_refilled = excluded.bottles_refilled;
  end if;

  update orders set
    status = 'rider_assigned',
    rider_id = p_rider_id,
    slot_note = case
      when p_note is not null and trim(p_note) <> '' then
        case
          when o.slot_note is not null and trim(o.slot_note) <> '' then o.slot_note || E'\n' || trim(p_note)
          else trim(p_note)
        end
      else o.slot_note
    end
  where id = o.id;

  perform log_status(o.id, 'rider_assigned');
end;
$$;

grant execute on function public.staff_cancel_order(uuid, text) to authenticated;
grant execute on function public.staff_reassign_rider(uuid, uuid, text) to authenticated;
