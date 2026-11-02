-- One free month per person, and saved places to browse from.

-- ---------------------------------------------------------------------
-- 1. Keyed hashes of the emails and phones that have had a free month. No link
-- to any account, on purpose: erase_user_data leaves this table alone, because
-- deleting an account and signing up again mustn't earn another free month.
-- See app/membership/free_month_guard.py. API only: RLS on, no policies.

create table if not exists free_month_identifiers (
  identifier_hash text primary key,
  created_at timestamptz not null default now()
);

alter table free_month_identifiers enable row level security;

-- ---------------------------------------------------------------------
-- 2. Saved places, like Work. Home is the customer's own address, not a row
-- here. A place only changes which farms they browse: never where an order goes.
-- API only: RLS on, no policies.

create table if not exists customer_places (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references profiles (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 30),
  address_street text not null,
  address_city text not null,
  address_state text not null,
  address_zip text not null,
  latitude double precision,
  longitude double precision,
  geocoded_at timestamp,
  created_at timestamp not null default now()
);
create index if not exists customer_places_customer_idx on customer_places (customer_id, created_at);
create index if not exists customer_places_geocoded_idx on customer_places (geocoded_at);

alter table customer_places enable row level security;

alter table customer_profiles add column if not exists browse_place_id uuid references customer_places (id) on delete set null;

-- ---------------------------------------------------------------------
-- 3. erase_user_data: 0038's function, plus their places go.
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
  update customer_profiles set browse_place_id = null where id = p_user_id;
  delete from customer_places where customer_id = p_user_id;
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
