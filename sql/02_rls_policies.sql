-- 02_rls_policies.sql: Row Level Security rules from Section 8.1.
-- Run after 01_schema.sql. Run it once only (policies cannot be created twice).
--
-- Design: these policies decide who can READ and who can edit their own details.
-- Creating orders, changing order status, recording deliveries and payments are done
-- by database functions in 04_functions.sql, so the flow rules in Section 4.3 are
-- enforced by the database and not only by the buttons on the page.

-- ---------- helpers (security definer, so they do not loop back into RLS) ----------
create or replace function auth_role() returns user_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function auth_is_active() returns boolean
language sql stable security definer set search_path = public as $$
  select is_active from public.profiles where id = auth.uid()
$$;

-- Signed-in users only. Signed-out visitors get nothing.
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

-- ---------- profiles ----------
-- Read: own profile, staff and admin see everyone, and people see each other
-- only through a shared order (rider <-> customer).
create policy profiles_select on profiles for select to authenticated using (
  id = auth.uid()
  or auth_role() in ('staff', 'admin')
  or exists (select 1 from orders o where o.customer_id = profiles.id or o.rider_id = profiles.id)
);

-- Edit own details, but never your own role or active flag.
create policy profiles_update_own on profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and role = auth_role() and is_active = auth_is_active());

-- Admin manages staff and rider accounts.
create policy profiles_admin_update on profiles for update to authenticated
  using (auth_role() = 'admin') with check (auth_role() = 'admin');

-- ---------- addresses ----------
create policy addresses_select on addresses for select to authenticated using (
  customer_id = auth.uid()
  or auth_role() in ('staff', 'admin')
  or exists (select 1 from orders o where o.address_id = addresses.id)  -- rider: assigned orders only
);
create policy addresses_insert on addresses for insert to authenticated
  with check (customer_id = auth.uid());
create policy addresses_update on addresses for update to authenticated
  using (customer_id = auth.uid()) with check (customer_id = auth.uid());
create policy addresses_delete on addresses for delete to authenticated
  using (customer_id = auth.uid());

-- ---------- products, settings, time slots, closures ----------
-- Everyone signed in can read. Only the admin can change.
create policy products_select on products for select to authenticated
  using (is_active or auth_role() in ('staff', 'admin'));
create policy products_admin on products for all to authenticated
  using (auth_role() = 'admin') with check (auth_role() = 'admin');

create policy settings_select on settings for select to authenticated using (true);
create policy settings_admin on settings for all to authenticated
  using (auth_role() = 'admin') with check (auth_role() = 'admin');

create policy time_slots_select on time_slots for select to authenticated using (true);
create policy time_slots_admin on time_slots for all to authenticated
  using (auth_role() = 'admin') with check (auth_role() = 'admin');

create policy slot_closures_select on slot_closures for select to authenticated using (true);
create policy slot_closures_admin on slot_closures for all to authenticated
  using (auth_role() = 'admin') with check (auth_role() = 'admin');

-- ---------- orders (read only here, writes go through 04_functions.sql) ----------
create policy orders_select on orders for select to authenticated using (
  customer_id = auth.uid()                      -- customer: own orders
  or auth_role() in ('staff', 'admin')          -- staff: all, admin: all (read-only)
  or rider_id = auth.uid()                      -- rider: assigned orders only
);

-- Items and the status log follow the order: you see them only if you can see the order.
create policy order_items_select on order_items for select to authenticated
  using (exists (select 1 from orders o where o.id = order_items.order_id));
create policy order_status_log_select on order_status_log for select to authenticated
  using (exists (select 1 from orders o where o.id = order_status_log.order_id));

-- ---------- bottle ledger ----------
create policy bottle_ledger_select on bottle_ledger for select to authenticated using (
  customer_id = auth.uid()                      -- customer: own balance
  or auth_role() in ('staff', 'admin')          -- staff and admin: view all
  or recorded_by = auth.uid()                   -- rider: entries they recorded
);