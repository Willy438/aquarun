-- =====================================================================
-- AquaRun - 18: Auto-expire unaccepted submitted orders past time slot
-- Automatically marks submitted orders as cancelled when their delivery
-- window has elapsed without station confirmation.
-- =====================================================================

create or replace function public.expire_unaccepted_orders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_manila_date date := (timezone('Asia/Manila', now()))::date;
  v_manila_time time := (timezone('Asia/Manila', now()))::time;
  v_count integer := 0;
  r record;
begin
  for r in
    select o.id, o.order_number, o.notes
    from orders o
    left join time_slots ts on ts.id = coalesce(o.scheduled_slot_id, o.preferred_slot_id)
    where o.status = 'submitted'
      and (
        o.delivery_date < v_manila_date
        or (
          o.delivery_date = v_manila_date
          and ts.end_time is not null
          and ts.end_time <= v_manila_time
        )
      )
  loop
    update orders set
      status = 'cancelled',
      notes = case
        when r.notes is not null and trim(r.notes) <> '' then r.notes || E'\nExpired: Scheduled delivery window ended before station confirmation.'
        else 'Expired: Scheduled delivery window ended before station confirmation.'
      end
    where id = r.id;

    delete from bottle_ledger where order_id = r.id;

    insert into order_status_log (order_id, status)
    values (r.id, 'cancelled');

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- Guard confirm_order to prevent staff from accepting expired submitted orders
create or replace function public.confirm_order(
  p_order_id uuid,
  p_slot_id uuid default null,
  p_slot_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  o orders;
  v_slot uuid;
  v_changed boolean;
  v_manila_date date := (timezone('Asia/Manila', now()))::date;
  v_manila_time time := (timezone('Asia/Manila', now()))::time;
  v_slot_rec time_slots;
begin
  perform require_role(array['staff', 'admin']);
  o := lock_order(p_order_id);

  if o.status <> 'submitted' then
    raise exception 'Only a Submitted order can be confirmed.';
  end if;

  v_slot := coalesce(p_slot_id, o.preferred_slot_id);
  select * into v_slot_rec from time_slots where id = v_slot;
  if not found then
    raise exception 'Time slot not found.';
  end if;

  -- Disallow confirmation if scheduled delivery window has already ended
  if o.delivery_date < v_manila_date or (
    o.delivery_date = v_manila_date and v_slot_rec.end_time is not null and v_slot_rec.end_time <= v_manila_time
  ) then
    -- Auto-expire the order
    update orders set
      status = 'cancelled',
      notes = case
        when o.notes is not null and trim(o.notes) <> '' then o.notes || E'\nExpired: Scheduled delivery window ended before station confirmation.'
        else 'Expired: Scheduled delivery window ended before station confirmation.'
      end
    where id = o.id;

    delete from bottle_ledger where order_id = o.id;
    perform log_status(o.id, 'cancelled');

    raise exception 'Cannot accept order: Scheduled delivery window has already ended.';
  end if;

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

grant execute on function public.expire_unaccepted_orders() to authenticated, anon;
grant execute on function public.confirm_order(uuid, uuid, text) to authenticated;
