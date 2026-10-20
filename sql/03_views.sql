-- 03_views.sql: Calculated values from Section 7 (bottle balance, sales, orders per slot).
-- Run after 02_rls_policies.sql. Safe to run again (uses create or replace).
-- Dates and hours use the Philippine time zone (Asia/Manila).

-- ---------- Customer bottle balance = bottles delivered - empties collected ----------
-- Every customer gets a row, even with no deliveries yet (balance 0).
-- Customers see only their own row, staff and admin see all (RLS applies).
create or replace view customer_bottle_balance with (security_invoker = true) as
select
  p.id as customer_id,
  p.full_name,
  p.phone,
  (select count(*) from orders o where o.customer_id = p.id and o.status <> 'cancelled')::int as orders_count,
  coalesce(sum(l.bottles_delivered), 0)::int as bottles_delivered,
  coalesce(sum(l.empties_collected), 0)::int as empties_collected,
  (coalesce(sum(l.bottles_delivered), 0) - coalesce(sum(l.empties_collected), 0))::int as balance
from profiles p
left join bottle_ledger l on l.customer_id = p.id
where p.role = 'customer'
group by p.id, p.full_name, p.phone;

-- ---------- Daily report ----------
-- Recorded sales = paid orders only (by the day payment was confirmed).
-- Refill sales and service charges are split from the same rows.
-- Pending payment = Delivered orders still unpaid (by delivery day).
create or replace view daily_report with (security_invoker = true) as
with paid as (
  select
    (paid_at at time zone 'Asia/Manila')::date as report_date,
    count(*) as orders_paid,
    sum(subtotal) as refill_sales,
    sum(service_charge) as service_charges,
    sum(total) as recorded_sales
  from orders
  where payment_status = 'paid'
  group by 1
),
pending as (
  select
    (delivered_at at time zone 'Asia/Manila')::date as report_date,
    sum(total) as pending_payment
  from orders
  where status = 'delivered' and payment_status = 'unpaid'
  group by 1
)
select
  coalesce(paid.report_date, pending.report_date) as report_date,
  coalesce(paid.orders_paid, 0)::int as orders,
  coalesce(paid.refill_sales, 0)::numeric(12,2) as refill_sales,
  coalesce(paid.service_charges, 0)::numeric(12,2) as service_charges,
  coalesce(pending.pending_payment, 0)::numeric(12,2) as pending_payment,
  coalesce(paid.recorded_sales, 0)::numeric(12,2) as recorded_sales
from paid
full join pending on paid.report_date = pending.report_date
where auth_role() in ('staff', 'admin');

create or replace view monthly_report with (security_invoker = true) as
select
  date_trunc('month', report_date)::date as report_month,
  sum(orders)::int as orders,
  sum(refill_sales)::numeric(12,2) as refill_sales,
  sum(service_charges)::numeric(12,2) as service_charges,
  sum(pending_payment)::numeric(12,2) as pending_payment,
  sum(recorded_sales)::numeric(12,2) as recorded_sales
from daily_report
group by 1;

-- ---------- Order activity by hour (admin dashboard chart) ----------
create or replace view order_activity_by_hour with (security_invoker = true) as
select
  (created_at at time zone 'Asia/Manila')::date as order_date,
  extract(hour from created_at at time zone 'Asia/Manila')::int as hour_of_day,
  count(*)::int as orders
from orders
where status <> 'cancelled' and auth_role() in ('staff', 'admin')
group by 1, 2;

-- ---------- Orders per time slot per day ----------
-- A slot is Full when orders_count reaches max_orders. Cancelled orders do not count.
-- This view shows counts only (no customer details), and it must see ALL orders,
-- so customers can find out that a slot is full. That is why it does not use security_invoker.
create or replace view orders_per_slot as
select
  o.delivery_date,
  s.id as slot_id,
  s.label,
  s.start_time,
  s.end_time,
  s.max_orders,
  count(*)::int as orders_count,
  (count(*) >= s.max_orders) as is_full
from orders o
join time_slots s on s.id = coalesce(o.scheduled_slot_id, o.preferred_slot_id)
where o.status <> 'cancelled'
group by o.delivery_date, s.id, s.label, s.start_time, s.end_time, s.max_orders;

-- ---------- Access: signed-in users only ----------
revoke all on customer_bottle_balance, daily_report, monthly_report, order_activity_by_hour, orders_per_slot from anon;
grant select on customer_bottle_balance, daily_report, monthly_report, order_activity_by_hour, orders_per_slot to authenticated;