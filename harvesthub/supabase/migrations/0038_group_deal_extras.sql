-- Group deals, step 4: pod drop points, the waitlist, and following a farm.

-- ---------------------------------------------------------------------
-- 1. A join can go to the customer's pod's drop point. pod_full_fee is the most
-- they can pay, and stays set if the pod is deleted, so the order can't quietly
-- become a delivery to their home.

alter table group_commits add column if not exists pod_id uuid references pods (id) on delete set null;
alter table group_commits add column if not exists pod_full_fee numeric(10, 2);
create index if not exists group_commits_pod_idx on group_commits (deal_id, pod_id) where pod_id is not null;

-- ---------------------------------------------------------------------
-- 2. The waitlist. API only: RLS on, no policies.

create table if not exists group_waitlist (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references group_deals (id) on delete cascade,
  customer_id uuid not null references profiles (id) on delete cascade,
  household_key text not null,
  status text not null default 'waiting'
    check (status in ('waiting', 'offered', 'claimed', 'expired', 'left', 'ended')),
  offered_at timestamptz,
  offer_expires_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists group_waitlist_one_per_household
  on group_waitlist (deal_id, household_key) where status in ('waiting', 'offered');
create unique index if not exists group_waitlist_one_per_customer
  on group_waitlist (deal_id, customer_id) where status in ('waiting', 'offered');
create index if not exists group_waitlist_line_idx on group_waitlist (deal_id, status, created_at);

alter table group_waitlist enable row level security;

-- ---------------------------------------------------------------------
-- 3. Following a farm, and telling followers when a deal opens.

create table if not exists farm_follows (
  customer_id uuid not null references profiles (id) on delete cascade,
  farmer_id uuid not null references profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (customer_id, farmer_id)
);
create index if not exists farm_follows_farmer_idx on farm_follows (farmer_id);

alter table farm_follows enable row level security;

alter table group_deals add column if not exists members_told_at timestamptz;
alter table group_deals add column if not exists public_told_at timestamptz;

-- ---------------------------------------------------------------------
-- 4. erase_user_data: 0037's function, plus the waitlist and follows go.
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
  delete from group_commits where customer_id = p_user_id and status in ('pending_card', 'active', 'withdrawn', 'not_charged');
  update group_commits set household_key = 'erased:' || id, stripe_setup_intent_id = null, stripe_payment_method_id = null
  where customer_id = p_user_id;
  delete from group_waitlist where customer_id = p_user_id;
  delete from farm_follows where customer_id = p_user_id or farmer_id = p_user_id;
  delete from pod_members where customer_id = p_user_id;
  update pod_invites set invitee_id = null where invitee_id = p_user_id;
  delete from pods where host_id = p_user_id;

  update farmer_profiles set
    address_street = null, address_city = null, address_state = null, address_zip = null,
    latitude = null, longitude = null, geocoded_at = null,
    photo_url = null, bio = null, tax_id = null, years_in_operation = null
  where id = p_user_id;

  update products set is_active = false, image_url = null, quantity_available = 0 where farmer_id = p_user_id;
  update group_deals set status = 'cancelled', cancelled_at = now(), reserved_quantity = 0
  where farmer_id = p_user_id and status in ('scheduled', 'early_access', 'live');
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
