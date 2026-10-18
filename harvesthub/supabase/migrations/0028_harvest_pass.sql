-- HarvestHub — Harvest Pass (customer membership) and referrals.
--
-- Harvest Pass is a recurring Stripe Billing subscription on the platform's
-- own Stripe account (membership revenue is HarvestHub's, so no Connect).
-- Plans and prices live in the API (app/core/pricing.py), not here: monthly,
-- every 3 months (10% off) or every 6 months (15% off). Benefit for now: no
-- service fee on checkouts of $25+ (items subtotal).
--
-- Card first: the app saves a card (a Stripe SetupIntent) BEFORE the
-- subscription is created, so a membership row only ever exists for a
-- subscription that has a card behind it. New members get a 7-day free
-- trial, or 30 days when they join with a friend's referral code — once
-- per customer (any earlier membership row means the trial was used).
--
-- 1. stripe_customers — one Stripe Customer per profile, created on first
--    use. API-only (RLS on, no policies). Group deals will reuse it to
--    charge saved cards later.
--
-- 2. memberships — one row per Stripe subscription. status mirrors
--    Stripe's own subscription status values directly (same rule as
--    payments.status in 0013 — no parallel state machine). The Stripe
--    webhook is the source of truth; the app's /membership/sync is a
--    client-triggered fallback for instant feedback. At most one live
--    subscription per customer (partial unique index).
--
-- 3. referral_codes / referrals — "give a month, get a month". A friend who
--    joins with your code gets a 30-day trial; once their first PAID
--    invoice goes through, you get one month's base price as a Stripe
--    customer-balance credit, applied automatically to your next bill.
--    A customer can be referred once, ever, and never by themselves.
--
-- 4. store_orders.member_savings — what Harvest Pass took off this farm's
--    order (today: the waived service fee), snapshotted like commission so
--    the savings tracker and refunds stay correct if the rules change.
--
-- Account deletion (0027): the API deletes the Stripe Customer first, which
-- cancels the subscription immediately; the cascades below remove these
-- rows when the profile itself is deleted. An anonymized profile keeps its
-- membership rows (Stripe ids and dates only — no personal data).

create table if not exists stripe_customers (
  profile_id uuid primary key references profiles (id) on delete cascade,
  stripe_customer_id text not null unique,
  created_at timestamptz not null default now()
);

alter table stripe_customers enable row level security;

-- ---------------------------------------------------------------------

create table if not exists memberships (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references profiles (id) on delete cascade,
  plan text not null check (plan in ('monthly', '3_months', '6_months')),
  interval_months integer not null check (interval_months > 0),
  -- Billed every interval_months — snapshot of the price at signup.
  -- Changing the price in the API only affects new members.
  price_amount numeric(10, 2) not null,
  stripe_subscription_id text not null unique,
  status text not null check (status in (
    'incomplete', 'incomplete_expired', 'trialing', 'active',
    'past_due', 'unpaid', 'paused', 'canceled'
  )),
  trial_end timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  canceled_at timestamptz,
  ended_at timestamptz,
  -- The renewal card, for display ("Visa •••• 4242") — never the number.
  card_brand text,
  card_last4 text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists memberships_customer_idx on memberships (customer_id, created_at desc);

create unique index if not exists memberships_one_live_per_customer
  on memberships (customer_id)
  where status in ('incomplete', 'trialing', 'active', 'past_due', 'unpaid', 'paused');

alter table memberships enable row level security;

drop policy if exists "customers view their own memberships" on memberships;
create policy "customers view their own memberships"
  on memberships for select
  using (auth.uid() = customer_id);

-- ---------------------------------------------------------------------

create table if not exists referral_codes (
  customer_id uuid primary key references profiles (id) on delete cascade,
  code text not null unique check (code ~ '^[A-Z0-9]{6,12}$'),
  created_at timestamptz not null default now()
);

alter table referral_codes enable row level security;

drop policy if exists "customers view their own referral code" on referral_codes;
create policy "customers view their own referral code"
  on referral_codes for select
  using (auth.uid() = customer_id);

create table if not exists referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references profiles (id) on delete cascade,
  referred_id uuid not null unique references profiles (id) on delete cascade,
  code text not null,
  membership_id uuid references memberships (id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'rewarded', 'void')),
  reward_amount numeric(10, 2),
  stripe_balance_transaction_id text unique,
  rewarded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (referrer_id <> referred_id)
);

create index if not exists referrals_referrer_idx on referrals (referrer_id, created_at desc);

alter table referrals enable row level security;

drop policy if exists "referrers view their own referrals" on referrals;
create policy "referrers view their own referrals"
  on referrals for select
  using (auth.uid() = referrer_id);

-- ---------------------------------------------------------------------

alter table store_orders add column if not exists member_savings numeric(10, 2) not null default 0;
