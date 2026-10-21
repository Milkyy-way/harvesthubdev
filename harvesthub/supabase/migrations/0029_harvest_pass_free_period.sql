-- HarvestHub — Harvest Pass: a free period for every new customer, and no
-- more referral rewards (decided with the user 2026-10-19).
--
-- Every new customer gets Harvest Pass free for 30 days (HARVEST_PASS_FREE_DAYS
-- in app/core/pricing.py), with no card needed. After that they pay to keep
-- it. This replaces 0028's Stripe free trials (7 days, or 30 with a referral
-- code). A customer who joins while their free period is still running isn't
-- charged until it ends: the API starts their Stripe subscription with a
-- trial up to that same date.
--
-- 1. harvest_pass_free_periods — one row per customer. The API creates it the
--    first time the customer's account reaches it (in practice, right after
--    sign-up), so the length is set in one place (pricing.py). Existing
--    customers get theirs on their next visit. Customers can read their own
--    row; only the API and Studio write it. Support can extend someone's free
--    period by editing ends_at.
--
-- 2. Referrals: "give a month, get a month" is gone — no reward for the
--    friend who shares, nor for the one who joins. referral_codes and
--    referrals are dropped (pre-launch: test data only). Test-mode Stripe
--    credits already granted stay on those Stripe customers.

create table if not exists harvest_pass_free_periods (
  customer_id uuid primary key references profiles (id) on delete cascade,
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create index if not exists harvest_pass_free_periods_ends_at_idx on harvest_pass_free_periods (ends_at);

alter table harvest_pass_free_periods enable row level security;

drop policy if exists "customers view their own free period" on harvest_pass_free_periods;
create policy "customers view their own free period"
  on harvest_pass_free_periods for select
  using (auth.uid() = customer_id);

-- ---------------------------------------------------------------------

drop table if exists referrals;
drop table if exists referral_codes;
