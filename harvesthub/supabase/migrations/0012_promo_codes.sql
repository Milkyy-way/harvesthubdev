-- HarvestHub — promo codes, farmer-scoped. Applied per-farm subsection at
-- checkout (see harvesthub-backend/app/checkout/), never across the whole
-- cart — a farmer's promo only ever discounts that one farmer's own
-- subtotal, since each farmer's items become a separate order.
--
-- Tax/delivery/service-fee rates are NOT in this schema — those are still
-- an undecided, cross-cutting business policy (jurisdiction tax rules,
-- mileage-based delivery pricing, platform commission), kept as constants
-- in harvesthub-backend/app/core/pricing.py so they're a one-file change
-- once decided, rather than a migration. Promo codes are different: they
-- genuinely vary per farmer today, so they need real rows.

create table if not exists promo_codes (
  id uuid primary key default gen_random_uuid(),
  farmer_id uuid not null references profiles (id) on delete cascade,
  code text not null,
  discount_type text not null check (discount_type in ('percentage', 'fixed')),
  discount_value numeric(10, 2) not null check (discount_value >= 0),
  min_order_amount numeric(10, 2),
  max_discount_amount numeric(10, 2), -- caps a percentage discount; null = uncapped
  usage_limit integer, -- null = unlimited
  times_used integer not null default 0,
  is_active boolean not null default true,
  starts_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  unique (farmer_id, code)
);

create index if not exists promo_codes_farmer_id_idx on promo_codes (farmer_id);

alter table promo_codes enable row level security;

drop policy if exists "farmers manage their own promo codes" on promo_codes;
create policy "farmers manage their own promo codes"
  on promo_codes for all
  using (auth.uid() = farmer_id)
  with check (auth.uid() = farmer_id);

-- Same caveat as every other table here (see 0008) — FastAPI's own
-- connection bypasses RLS entirely; this is for a future direct
-- supabase-js read, not what /checkout/preview relies on.
drop policy if exists "active promo codes are viewable by everyone" on promo_codes;
create policy "active promo codes are viewable by everyone"
  on promo_codes for select
  using (is_active = true);

-- Note: times_used is NOT incremented anywhere yet — there's no real order
-- creation to trigger redemption tracking from until that checkpoint ships.
-- Validation today checks usage_limit against whatever times_used already
-- holds, it just never advances it.

-- ---------------------------------------------------------------------
-- DEV/TEST SEED DATA (optional) — one sample code on two of 0010's seeded
-- farmers, so the checkout page's promo field has something real to try.
-- Safe no-op if those farmer rows don't exist.

insert into promo_codes (id, farmer_id, code, discount_type, discount_value, min_order_amount)
select v.id::uuid, v.farmer_id::uuid, v.code, v.discount_type, v.discount_value, v.min_order_amount
from (values
  ('44444444-4444-4444-4444-444444444001', '11111111-1111-1111-1111-111111111101', 'WELCOME10', 'percentage', 10.00, null::numeric),
  ('44444444-4444-4444-4444-444444444002', '11111111-1111-1111-1111-111111111103', 'DAIRY5', 'fixed', 5.00, 15.00)
) as v (id, farmer_id, code, discount_type, discount_value, min_order_amount)
where exists (select 1 from profiles p where p.id = v.farmer_id::uuid)
on conflict (id) do nothing;
