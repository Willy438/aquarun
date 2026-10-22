-- 06_returnable_products.sql
-- Adds a returnable flag so only gallons (swap items) count toward the bottle ledger.

-- 1. Flag on products. Default true so existing gallon products stay returnable.
alter table public.products
  add column if not exists is_returnable boolean not null default true;

comment on column public.products.is_returnable is
  'true = customer returns the empty container (gallon swap). false = sold outright (e.g. small bottles by the dozen).';

-- 2. Returnable quantity per order (used for expected empties, bottles delivered, bottles refilled).
create or replace view public.order_returnable_qty
with (security_invoker = true) as
select
  oi.order_id,
  coalesce(sum(oi.quantity) filter (where p.is_returnable), 0) as returnable_qty,
  coalesce(sum(oi.quantity) filter (where not p.is_returnable), 0) as non_returnable_qty
from public.order_items oi
join public.products p on p.id = oi.product_id
group by oi.order_id;

-- 3. Optional: after running, mark small-bottle products as non-returnable, for example:
-- update public.products set is_returnable = false where name ilike '%dozen%';