-- 05_seed.sql
-- Starter data: service charge, products, delivery time slots.
-- Safe to run more than once: each row is only inserted if it is not already there.
-- Column names follow Section 7 of the system plan. If your 01_schema.sql
-- names differ (for example photo vs photo_url), change them here to match.

-- ---------- Settings ----------
insert into settings (key, value)
select 'service_charge', '20.00'
where not exists (select 1 from settings where key = 'service_charge');

-- ---------- Products ----------
insert into products (name, unit, price, is_active)
select v.name, v.unit, v.price, true
from (values
  ('Purified Water Refill (Slim Gallon)',  'gallon', 25.00),
  ('Purified Water Refill (Round Gallon)', 'gallon', 25.00),
  ('Mineral Water Refill (Slim Gallon)',   'gallon', 30.00)
) as v(name, unit, price)
where not exists (select 1 from products p where p.name = v.name);

-- ---------- Time slots (matches the prototype: 9, 10, 1 and 4) ----------
insert into time_slots (label, start_time, end_time, max_orders, is_active)
select v.label, v.start_time::time, v.end_time::time, v.max_orders, true
from (values
  ('9:00 AM - 10:00 AM',  '09:00', '10:00', 10),
  ('10:00 AM - 11:00 AM', '10:00', '11:00', 10),
  ('1:00 PM - 2:00 PM',   '13:00', '14:00', 10),
  ('4:00 PM - 5:00 PM',   '16:00', '17:00', 10)
) as v(label, start_time, end_time, max_orders)
where not exists (select 1 from time_slots t where t.label = v.label);

-- ---------- Check: should return 1, 3 and 4 ----------
select
  (select count(*) from settings   where key = 'service_charge') as service_charge_rows,
  (select count(*) from products)                                as products,
  (select count(*) from time_slots)                              as time_slots;