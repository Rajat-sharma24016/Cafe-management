create extension if not exists pgcrypto;

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null unique,
  orders_count integer not null default 0,
  total_spend numeric(12,2) not null default 0,
  last_visit timestamptz,
  status text not null default 'new',
  created_at timestamptz not null default now()
);

create table if not exists public.cafe_tables (
  id uuid primary key default gen_random_uuid(),
  table_no integer not null unique,
  label text,
  seats integer not null default 2,
  status text not null default 'available',
  created_at timestamptz not null default now()
);

create table if not exists public.menu_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null,
  price numeric(10,2) not null,
  available boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.reservations (
  id uuid primary key default gen_random_uuid(),
  reservation_code text not null unique default ('RES-' || upper(substr(gen_random_uuid()::text, 1, 6))),
  customer_name text not null,
  phone text not null,
  reservation_date date not null,
  reservation_time time not null,
  guests integer not null default 2,
  status text not null default 'confirmed',
  channel text not null default 'whatsapp',
  created_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_code text not null unique default ('ORD-' || upper(substr(gen_random_uuid()::text, 1, 6))),
  customer_name text not null,
  phone text,
  table_no integer,
  items jsonb not null default '[]'::jsonb,
  items_text text,
  total numeric(12,2) not null default 0,
  order_type text not null default 'Dine-in',
  status text not null default 'pending',
  source text not null default 'dashboard',
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  payment_code text not null unique default ('PAY-' || upper(substr(gen_random_uuid()::text, 1, 6))),
  order_id uuid references public.orders(id) on delete set null,
  order_code text,
  customer_name text,
  amount numeric(12,2) not null default 0,
  method text,
  status text not null default 'pending',
  provider text,
  provider_payment_id text,
  created_at timestamptz not null default now()
);

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  phone text,
  rating text,
  message text,
  source text not null default 'whatsapp',
  created_at timestamptz not null default now()
);

insert into public.cafe_tables (table_no, label, seats)
select n, 'Table ' || n, 2 + (n % 4)
from generate_series(1, 12) as n
on conflict (table_no) do nothing;

insert into public.menu_items (name, category, price, available) values
  ('Cappuccino', 'Coffee', 180, true),
  ('Cold Coffee', 'Coffee', 160, true),
  ('Espresso', 'Coffee', 120, true),
  ('Cold Brew', 'Coffee', 200, true),
  ('Latte', 'Coffee', 190, true),
  ('Paneer Sandwich', 'Food', 220, true),
  ('Margherita Pizza', 'Food', 350, true),
  ('Grilled Sandwich', 'Food', 210, false),
  ('Veg Wrap', 'Food', 195, true),
  ('Chocolate Cake', 'Desserts', 240, true),
  ('Cheesecake', 'Desserts', 260, true),
  ('Blueberry Muffin', 'Desserts', 130, true),
  ('Masala Chai', 'Beverages', 60, true),
  ('Green Tea', 'Beverages', 80, true),
  ('Fresh Lime Soda', 'Beverages', 90, true)
on conflict do nothing;
