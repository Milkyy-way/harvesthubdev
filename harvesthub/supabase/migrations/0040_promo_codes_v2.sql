-- Promo codes, part 2 (2026-11-09): farmers make their own in the app, and can
-- show them on their farm page. A code still comes off that farm's goods, and
-- the farm pays for it: commission is on what's left. See
-- app/promotions/service.py.

-- ---------------------------------------------------------------------
-- 1. promo_codes: the two new switches.

alter table promo_codes add column if not exists show_on_farm_page boolean not null default false;
alter table promo_codes add column if not exists once_per_customer boolean not null default false;

-- Codes are matched in capitals. Not checked against rows already there.
alter table promo_codes drop constraint if exists promo_codes_code_format;
alter table promo_codes add constraint promo_codes_code_format check (code ~ '^[A-Z0-9]{3,20}$') not valid;
alter table promo_codes drop constraint if exists promo_codes_percentage_max;
alter table promo_codes add constraint promo_codes_percentage_max
  check (discount_type <> 'percentage' or discount_value <= 100) not valid;

-- ---------------------------------------------------------------------
-- 2. Who used which code, on which order: one row per order. Drives "one per
-- customer", and gives a use back when the order is cancelled. API only: RLS
-- on, no policies.

create table if not exists promo_code_uses (
  id uuid primary key default gen_random_uuid(),
  promo_code_id uuid not null references promo_codes (id) on delete cascade,
  customer_id uuid not null references profiles (id) on delete cascade,
  order_id uuid not null references orders (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (promo_code_id, order_id)
);
create index if not exists promo_code_uses_customer_idx on promo_code_uses (promo_code_id, customer_id);

alter table promo_code_uses enable row level security;

-- Codes on orders already placed, so "one per customer" counts them.
insert into promo_code_uses (promo_code_id, customer_id, order_id)
select c.id, o.customer_id, s.order_id
from store_orders s
join orders o on o.id = s.order_id
join promo_codes c on c.farmer_id = s.farmer_id and c.code = s.promo_code
where s.promo_code is not null and s.status <> 'cancelled' and s.released_to_farmer_at is not null
on conflict (promo_code_id, order_id) do nothing;
