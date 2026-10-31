-- HarvestHub — Neighborhood Pods (Phase 3 of delivery; 0032 and 0033 came
-- first). Spec: "Neighborhood Pods - Logic Spec.pdf"; decided with the user
-- 2026-10-31.
--
-- A pod is a group of nearby Harvest Pass households who share one drop point
-- and one delivery day. A host starts it and invites neighbors; it goes live
-- at the host + 2 members. Members order on their own, from any farm that
-- offers pod delivery, reaches the drop point and delivers on the pod's day.
-- On the farm's run, all of that pod's orders are one stop.
--
-- Where this differs from the spec, by decision:
--   * Fee: each farm sets a pod delivery fee and keeps it (commission is on
--     goods only, like any delivery fee). It's split evenly among the
--     households that actually order for that farm's window, so neither the
--     farm nor HarvestHub bears any of it. That isn't known until orders
--     close, so a pod order saves a card and is charged once, at the farm's
--     cutoff, for the exact amount: no refunds and no holds
--     (app/pods/charging.py).
--   * Delivery zone: "inside a delivery zone" means at least one farm's own
--     delivery distance reaches the drop point.
--   * Cutoff: each farm's own cutoff before its window on the pod's day, the
--     same for every member ordering from that farm.
--   * Invites: a link the host shares from their own phone, not a text or
--     email sent by HarvestHub.
--   * Grace: 7 days (one weekly delivery cycle) to get back above the minimum.
--
-- Everything here is API-only: RLS on, no policies. The API is what keeps
-- addresses to itself: members see first names, never each other's homes.

-- ---------------------------------------------------------------------
-- 1. Pods.

create table if not exists pods (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references profiles (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  status text not null default 'draft'
    check (status in ('draft', 'pending', 'active', 'paused', 'expired', 'dissolved')),
  delivery_weekday smallint not null check (delivery_weekday between 0 and 6), -- 0 = Monday

  -- The drop point. Empty while a new host still has to choose one (the old
  -- host's home stopped being available), and cleared once a pod has ended
  -- and has no open orders: orders keep their own copy of the address.
  drop_kind text check (drop_kind in ('home', 'neutral')),
  address_street text,
  address_city text,
  address_state text,
  address_zip text,
  latitude double precision,
  longitude double precision,
  location_precision text,
  geocoded_at timestamptz, -- Google's coordinates may only be kept 30 days
  access_notes text check (char_length(access_notes) <= 300), -- gate, door code: host and driver only
  shelter_note text check (char_length(shelter_note) <= 200), -- the covered or shaded spot
  permission_attested_at timestamptz, -- a neutral location: the host says they may use it

  -- Goes up each time the drop point changes, so members re-approve it.
  drop_version integer not null default 1,
  reapprove_by timestamptz,
  -- Everyone has ordered for this delivery date: the drop point can't change
  -- until those orders are done, and they're delivered there.
  drop_locked_date date,

  first_invite_at timestamptz,
  activated_at timestamptz,
  paused_at timestamptz,
  grace_ends_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pods_host_idx on pods (host_id);
create index if not exists pods_live_idx on pods (status) where status not in ('expired', 'dissolved');

alter table pods enable row level security;

-- ---------------------------------------------------------------------
-- 2. Members. leave_at + leave_reason: a departure that's been decided;
-- it takes effect once leave_at has passed AND their open order is delivered.

create table if not exists pod_members (
  id uuid primary key default gen_random_uuid(),
  pod_id uuid not null references pods (id) on delete cascade,
  customer_id uuid not null references profiles (id) on delete cascade,
  delivery_weekday smallint not null, -- copied from the pod, for the index below
  status text not null default 'active' check (status in ('active', 'left')),
  approved_drop_version integer not null default 1,
  leave_at timestamptz,
  leave_reason text check (leave_reason in ('left', 'lapsed', 'revoked', 'no_reapproval')),
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists pod_members_one_active_idx on pod_members (pod_id, customer_id) where status = 'active';
-- "Not already in another pod on the same delivery day" — enforced here too,
-- so two invites accepted at the same moment can't get around it.
create unique index if not exists pod_members_one_per_day_idx on pod_members (customer_id, delivery_weekday) where status = 'active';
create index if not exists pod_members_customer_idx on pod_members (customer_id) where status = 'active';

alter table pod_members enable row level security;

-- ---------------------------------------------------------------------
-- 3. Invites. The code is what goes in the shared link.

create table if not exists pod_invites (
  id uuid primary key default gen_random_uuid(),
  pod_id uuid not null references pods (id) on delete cascade,
  code text not null unique,
  label text check (char_length(label) <= 60), -- the host's own note: "Sam next door"
  status text not null default 'sent' check (status in ('sent', 'accepted', 'declined', 'expired', 'revoked')),
  invitee_id uuid references profiles (id) on delete set null, -- who answered
  expires_at timestamptz not null,
  responded_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists pod_invites_pod_idx on pod_invites (pod_id, created_at desc);

alter table pod_invites enable row level security;

-- ---------------------------------------------------------------------
-- 4. A farm's pod delivery offer. Off until the farm turns it on.

alter table farm_delivery_settings add column if not exists offers_pod_delivery boolean not null default false;
alter table farm_delivery_settings add column if not exists pod_delivery_fee numeric(10, 2) not null default 5.00;
alter table farm_delivery_settings drop constraint if exists farm_delivery_settings_pod_fee_check;
alter table farm_delivery_settings add constraint farm_delivery_settings_pod_fee_check
  check (pod_delivery_fee >= 0 and pod_delivery_fee <= 50);

-- ---------------------------------------------------------------------
-- 5. A drop point is a stop on the farm's run, holding several orders.

alter table delivery_stops drop constraint if exists delivery_stops_kind_check;
alter table delivery_stops add constraint delivery_stops_kind_check check (kind in ('home', 'pod'));
alter table delivery_stops add column if not exists pod_id uuid references pods (id) on delete set null;
alter table delivery_stops add column if not exists pod_drop_version integer;

alter table store_orders add column if not exists pod_id uuid references pods (id) on delete set null;
alter table store_orders add column if not exists pod_drop_version integer;
create index if not exists store_orders_pod_idx on store_orders (pod_id) where pod_id is not null;

-- A pod order's share of the fee isn't known until the cutoff. Until then
-- delivery_fee and total hold the most it can be, and pod_full_fee the fee
-- it's divided from.
alter table store_orders add column if not exists pod_full_fee numeric(10, 2);

alter table payments add column if not exists stripe_setup_intent_id text;
alter table payments add column if not exists stripe_payment_method_id text;
alter table payments add column if not exists charge_attempts integer not null default 0;
alter table payments add column if not exists last_charge_attempt_at timestamptz;

alter table payments drop constraint if exists payments_status_check;
alter table payments add constraint payments_status_check
  check (status in (
    'requires_payment_method', 'requires_confirmation', 'requires_action',
    'requires_capture', 'processing', 'succeeded', 'failed', 'canceled', 'pending',
    'awaiting_cutoff', 'charging', 'charge_failed'
  ));

create index if not exists payments_cutoff_idx on payments (status)
  where status in ('awaiting_cutoff', 'charging', 'charge_failed');

-- ---------------------------------------------------------------------
-- 6. Cold items: the farmer flags a product, and whoever orders it from a
-- drop point is told to collect it soon after delivery.

alter table products add column if not exists keep_cold boolean not null default false;
alter table store_order_items add column if not exists keep_cold boolean not null default false;

-- ---------------------------------------------------------------------
-- 7. erase_user_data — 0032's function, plus: pod rows go, and a shared drop
-- point isn't erased because one of the customers on it deleted their account
-- (only a home stop is that customer's own data).

create or replace function public.erase_user_data(p_user_id uuid)
returns text
language plpgsql
security definer set search_path = public
as $$
begin
  -- No financial history: delete everything (cascades do the rest).
  begin
    delete from profiles where id = p_user_id;
    return 'deleted';
  exception when restrict_violation or foreign_key_violation then
    null; -- has orders/payouts/ratings to keep (ON DELETE RESTRICT); anonymize below
  end;

  delete from cart_items where customer_id = p_user_id;
  delete from customer_profiles where id = p_user_id;
  delete from farmer_certifications where farmer_id = p_user_id;
  delete from farmer_verification where id = p_user_id;
  delete from push_tokens where profile_id = p_user_id;
  delete from notification_settings where profile_id = p_user_id;
  delete from notifications where profile_id = p_user_id;
  delete from farm_delivery_windows where farmer_id = p_user_id;
  delete from farm_delivery_settings where farmer_id = p_user_id;
  delete from pod_members where customer_id = p_user_id;
  update pod_invites set invitee_id = null where invitee_id = p_user_id;
  delete from pods where host_id = p_user_id;

  update farmer_profiles set
    address_street = null, address_city = null, address_state = null, address_zip = null,
    latitude = null, longitude = null, geocoded_at = null,
    photo_url = null, bio = null, tax_id = null, years_in_operation = null
  where id = p_user_id;

  update products set is_active = false, image_url = null, quantity_available = 0 where farmer_id = p_user_id;
  update promo_codes set is_active = false where farmer_id = p_user_id;

  update farmer_ratings set comment = null where customer_id = p_user_id;

  update store_orders so set
    delivery_address_street = null, delivery_address_city = null,
    delivery_address_state = null, delivery_address_zip = null
  from orders o
  where o.id = so.order_id and o.customer_id = p_user_id;

  update delivery_stops ds set latitude = null, longitude = null, photo_path = null, note = null
  from store_orders so
  join orders o on o.id = so.order_id
  where so.delivery_stop_id = ds.id and o.customer_id = p_user_id and ds.kind = 'home';

  update profiles set full_name = null, phone = null, status = 'deleted', deleted_at = now()
  where id = p_user_id;

  return 'anonymized';
end;
$$;

revoke all on function public.erase_user_data(uuid) from public, anon, authenticated;
