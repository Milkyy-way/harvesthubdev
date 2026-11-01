-- Group deals, the customer's side: households joining, and charging at the deadline.

-- ---------------------------------------------------------------------
-- 1. A household's join on a deal. API only: RLS on, no policies.

create table if not exists group_commits (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references group_deals (id) on delete cascade,
  customer_id uuid not null references profiles (id) on delete cascade,
  household_key text not null,
  status text not null default 'pending_card'
    check (status in ('pending_card', 'active', 'withdrawn', 'ordered', 'not_charged')),
  units smallint not null default 1 check (units > 0),
  fulfillment_method text not null check (fulfillment_method in ('pickup', 'delivery')),
  delivery_starts_at timestamptz,
  delivery_ends_at timestamptz,
  delivery_fee numeric(10, 2) not null default 0 check (delivery_fee >= 0),
  member_at_join boolean not null default false,
  stripe_setup_intent_id text,
  stripe_payment_method_id text,
  order_id uuid references orders (id) on delete set null,
  joined_at timestamptz,
  withdrawn_at timestamptz,
  created_at timestamptz not null default now()
);

-- The database's own guarantee of one join per household and per customer.
create unique index if not exists group_commits_one_per_household
  on group_commits (deal_id, household_key) where status in ('active', 'ordered');
create unique index if not exists group_commits_one_per_customer
  on group_commits (deal_id, customer_id) where status in ('pending_card', 'active', 'ordered');
create index if not exists group_commits_customer_idx on group_commits (customer_id, created_at desc);
create index if not exists group_commits_pending_idx on group_commits (created_at) where status = 'pending_card';

alter table group_commits enable row level security;

-- ---------------------------------------------------------------------
-- 2. On the deal.

alter table group_deals add column if not exists extended_once boolean not null default false;
alter table group_deals add column if not exists closed_at timestamptz;
alter table group_deals add column if not exists fallback_ends_at timestamptz;

-- ---------------------------------------------------------------------
-- 3. A deal's orders are ordinary orders that remember where they came from.
-- stock_units: a 2.5 lb share of a by-the-lb listing isn't one unit of stock.

alter table store_orders add column if not exists group_deal_id uuid references group_deals (id) on delete set null;
create index if not exists store_orders_group_deal_idx on store_orders (group_deal_id) where group_deal_id is not null;
alter table store_order_items add column if not exists stock_units integer;

-- ---------------------------------------------------------------------
-- 4. erase_user_data: 0036's function, plus their joins go, keeping only an
-- anonymous record of the ones that became orders.
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
