-- 01_schema.sql: Tables from Section 7 of the AquaRun plan.
-- Run first, in the Supabase SQL editor. Policies (02) and functions (04) come later.

-- ---------- Types ----------
create type user_role as enum ('customer', 'staff', 'rider', 'admin');
create type order_status as enum (
  'submitted', 'confirmed', 'refilling', 'ready',
  'rider_assigned', 'out_for_delivery', 'delivered', 'completed', 'cancelled'
);
create type payment_status as enum ('unpaid', 'paid');

create sequence order_number_seq start 1001;

-- ---------- profiles ----------
create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  phone text,
  role user_role not null default 'customer',
  is_active boolean not null default true,
  is_available boolean not null default false,  -- riders only
  created_at timestamptz not null default now()
);

-- ---------- addresses ----------
create table addresses (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references profiles (id) on delete cascade,
  label text not null,
  street text not null,
  barangay text not null,
  city text not null,
  landmark text,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index one_default_address_per_customer on addresses (customer_id) where is_default;

-- ---------- products, settings ----------
create table products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  unit text not null default 'gallon',
  photo_url text,
  price numeric(10,2) not null check (price >= 0),
  is_active boolean not null default true
);

create table settings (
  key text primary key,
  value text not null
);

-- ---------- time slots ----------
create table time_slots (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  start_time time not null,
  end_time time not null,
  max_orders integer not null check (max_orders > 0),
  is_active boolean not null default true,
  check (end_time > start_time)
);

create table slot_closures (
  id uuid primary key default gen_random_uuid(),
  time_slot_id uuid not null references time_slots (id) on delete cascade,
  closure_date date not null,
  reason text,
  unique (time_slot_id, closure_date)
);

-- ---------- orders ----------
create table orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique default ('AR-' || nextval('order_number_seq')),
  customer_id uuid not null references profiles (id),
  address_id uuid not null references addresses (id),
  delivery_date date not null,
  preferred_slot_id uuid not null references time_slots (id),
  scheduled_slot_id uuid references time_slots (id),  -- set by staff, defaults to preferred
  slot_adjusted_by uuid references profiles (id),
  slot_note text,
  rider_id uuid references profiles (id),
  status order_status not null default 'submitted',
  payment_method text not null default 'cash_on_delivery',
  payment_status payment_status not null default 'unpaid',
  paid_at timestamptz,
  payment_confirmed_by uuid references profiles (id),
  subtotal numeric(10,2) not null check (subtotal >= 0),
  service_charge numeric(10,2) not null check (service_charge >= 0),
  total numeric(10,2) not null check (total >= 0),
  notes text,
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  check (total = subtotal + service_charge)
);
create index orders_customer_idx on orders (customer_id);
create index orders_rider_idx on orders (rider_id);
create index orders_status_idx on orders (status);
create index orders_delivery_date_idx on orders (delivery_date);

create table order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders (id) on delete cascade,
  product_id uuid not null references products (id),
  quantity integer not null check (quantity > 0),
  unit_price numeric(10,2) not null check (unit_price >= 0)  -- copied at checkout
);
create index order_items_order_idx on order_items (order_id);

-- ---------- bottle ledger (one entry per delivered order) ----------
create table bottle_ledger (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references profiles (id),
  order_id uuid not null unique references orders (id),
  bottles_refilled integer not null default 0 check (bottles_refilled >= 0),
  bottles_delivered integer not null default 0 check (bottles_delivered >= 0),
  empties_collected integer not null default 0 check (empties_collected >= 0),
  recorded_by uuid references profiles (id),
  created_at timestamptz not null default now()
);
create index bottle_ledger_customer_idx on bottle_ledger (customer_id);

-- ---------- order status log ----------
create table order_status_log (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders (id) on delete cascade,
  status order_status not null,
  changed_by uuid references profiles (id),
  changed_at timestamptz not null default now()
);
create index order_status_log_order_idx on order_status_log (order_id);

-- ---------- create a profile when someone signs up ----------
-- New sign ups are always customers. Staff, rider and admin roles are set by the admin.
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, phone, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    new.raw_user_meta_data ->> 'phone',
    'customer'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------- lock every table until the policies in 02 are added ----------
alter table profiles enable row level security;
alter table addresses enable row level security;
alter table products enable row level security;
alter table settings enable row level security;
alter table time_slots enable row level security;
alter table slot_closures enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table bottle_ledger enable row level security;
alter table order_status_log enable row level security;