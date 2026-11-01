-- Apartments on customer addresses, and threshold group deals (the farmer's side).

-- ---------------------------------------------------------------------
-- 1. Apartment, suite or unit. Without it a driver can't find the door, and a
-- deal's one-per-household rule would stop neighbors in the same building.
-- Changing it doesn't move the map pin, so the geocode trigger ignores it.

alter table customer_profiles add column if not exists address_unit text;
alter table customer_profiles drop constraint if exists customer_profiles_address_unit_length;
alter table customer_profiles add constraint customer_profiles_address_unit_length
  check (address_unit is null or char_length(address_unit) <= 40);

grant update (address_unit) on customer_profiles to authenticated;

-- 0018's function, plus the apartment from the signup form.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_role text;
begin
  -- Signup metadata is fully client-controlled, so 'admin' is deliberately
  -- excluded here — someone editing the signup request could otherwise pass
  -- role: 'admin' and self-promote. Admin accounts get created by directly
  -- updating this table from the Supabase dashboard (service_role access),
  -- never through the public signup flow.
  v_role := case
    when new.raw_user_meta_data ->> 'role' in ('customer', 'farmer') then new.raw_user_meta_data ->> 'role'
    else null
  end;

  insert into public.profiles (id, role, full_name, phone, status)
  values (
    new.id,
    v_role,
    -- OAuth providers key the display name as 'full_name' or 'name'
    -- depending on provider; our own signup form always sends 'full_name'.
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'phone',
    case
      when v_role = 'farmer' then 'pending_verification'
      when v_role = 'customer' then 'active'
      else 'pending_role_selection'
    end
  );

  if v_role = 'customer' then
    insert into public.customer_profiles (
      id, address_street, address_city, address_state, address_zip, address_unit,
      dietary_preferences, produce_interests, referral_source, referral_source_other
    )
    values (
      new.id,
      new.raw_user_meta_data ->> 'address_street',
      new.raw_user_meta_data ->> 'address_city',
      new.raw_user_meta_data ->> 'address_state',
      new.raw_user_meta_data ->> 'address_zip',
      left(nullif(trim(new.raw_user_meta_data ->> 'address_unit'), ''), 40),
      array(select jsonb_array_elements_text(coalesce(new.raw_user_meta_data -> 'dietary_preferences', '[]'::jsonb))),
      array(select jsonb_array_elements_text(coalesce(new.raw_user_meta_data -> 'produce_interests', '[]'::jsonb))),
      new.raw_user_meta_data ->> 'referral_source',
      new.raw_user_meta_data ->> 'referral_source_other'
    );
  elsif v_role = 'farmer' then
    insert into public.farmer_profiles (id, farm_name)
    values (new.id, new.raw_user_meta_data ->> 'farm_name');

    insert into public.farmer_verification (id) values (new.id);
  end if;
  -- else: v_role is null (OAuth, or any other identity provider that
  -- never sends our custom fields) — bare profile only. Nothing else to
  -- insert until complete_profile_setup() runs.

  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 2. Group deals. API only: RLS on, no policies. Prices are per the listing's
-- unit, and a share is share_size of those units.

create table if not exists group_deals (
  id uuid primary key default gen_random_uuid(),
  farmer_id uuid not null references profiles (id) on delete cascade,
  product_id uuid not null references products (id) on delete cascade,
  status text not null default 'draft'
    check (status in ('draft', 'scheduled', 'early_access', 'live', 'goal_met', 'unlocked', 'expired', 'cancelled', 'fulfilled')),
  unit text not null,
  regular_price numeric(10, 2) not null check (regular_price > 0),
  share_size numeric(8, 2) not null default 1 check (share_size > 0),
  deal_price numeric(10, 2) not null check (deal_price > 0),
  goal integer not null check (goal > 0),
  capacity integer not null check (capacity > 0),
  max_units smallint not null default 1 check (max_units > 0),
  subscriber_fallback boolean not null default true,
  public_start_date date,
  window_days smallint not null default 5 check (window_days > 0),
  fulfillment_date date,
  member_opens_at timestamptz,
  public_opens_at timestamptz,
  deadline_at timestamptz,
  reserved_quantity integer not null default 0 check (reserved_quantity >= 0),
  published_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists group_deals_farmer_idx on group_deals (farmer_id, created_at desc);
create index if not exists group_deals_open_idx on group_deals (status, deadline_at);
create index if not exists group_deals_product_idx on group_deals (product_id);

alter table group_deals enable row level security;

-- ---------------------------------------------------------------------
-- 3. erase_user_data: 0035's function, plus a deleted farm's running deals end.
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
