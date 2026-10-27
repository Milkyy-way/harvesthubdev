-- HarvestHub — farm delivery (Phase 1 of delivery → live tracking → pods →
-- couriers; decided with the user 2026-10-27).
--
-- The farm drives its own orders. Each farm chooses whether it delivers, its
-- delivery fee (which the farm keeps in full — no commission on it), how far
-- it goes (radius_miles, from the farm), its weekly delivery windows (local
-- time, e.g. Fri 16:00–19:00), and how long before a window orders close
-- (cutoff_hours). Delivery orders are paid by card only. If nobody's home the
-- order is left at the door, and the farmer can attach a photo.
--
-- The customer picks a window at checkout. Once the order is paid it joins a
-- DELIVERY RUN (one farm + one window) as a STOP. The farmer starts the run
-- (store orders paid -> out_for_delivery, customers notified), then marks
-- each stop delivered (-> completed, ledger entry) or can't deliver it
-- (cancelled + refunded, the existing farmer-cancel path). A stop is its own
-- row, not just the store order, because Neighborhood Pods will put several
-- orders on one stop (a shared drop point); couriers will later run the same
-- runs (provider).
--
-- Times: windows are wall-clock times in America/New_York (the DC/MD/VA
-- launch market); runs and store orders store the resulting instants.
--
-- Everything here is API-only (RLS on, no policies) except the photo bucket.

-- ---------------------------------------------------------------------
-- 1. The farm's delivery offer.

create table if not exists farm_delivery_settings (
  farmer_id uuid primary key references profiles (id) on delete cascade,
  offers_delivery boolean not null default false,
  delivery_fee numeric(10, 2) not null default 5.00 check (delivery_fee >= 0 and delivery_fee <= 50),
  radius_miles numeric(4, 1) not null default 10 check (radius_miles > 0 and radius_miles <= 50),
  cutoff_hours integer not null default 24 check (cutoff_hours between 0 and 168),
  updated_at timestamptz not null default now()
);

alter table farm_delivery_settings enable row level security;

create table if not exists farm_delivery_windows (
  id uuid primary key default gen_random_uuid(),
  farmer_id uuid not null references profiles (id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6), -- 0 = Monday
  start_time time not null,
  end_time time not null,
  created_at timestamptz not null default now(),
  check (end_time > start_time),
  unique (farmer_id, weekday, start_time)
);

alter table farm_delivery_windows enable row level security;

-- ---------------------------------------------------------------------
-- 2. Runs and stops.

create table if not exists delivery_runs (
  id uuid primary key default gen_random_uuid(),
  -- RESTRICT like the other financial records: a farmer with delivery
  -- history is anonymized on account deletion, not deleted (0027).
  farmer_id uuid not null references profiles (id) on delete restrict,
  provider text not null default 'farm' check (provider in ('farm')),
  window_starts_at timestamptz not null,
  window_ends_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'in_progress', 'completed')),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (farmer_id, window_starts_at)
);

create index if not exists delivery_runs_farmer_idx on delivery_runs (farmer_id, window_starts_at desc);

alter table delivery_runs enable row level security;

create table if not exists delivery_stops (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references delivery_runs (id) on delete cascade,
  kind text not null default 'home' check (kind in ('home')), -- 'pod' with Neighborhood Pods
  sequence integer, -- route order, set when the run starts
  latitude double precision,
  longitude double precision,
  status text not null default 'pending' check (status in ('pending', 'en_route', 'delivered', 'cancelled')),
  delivered_at timestamptz,
  -- Proof-of-delivery photo in the private delivery-photos bucket, at
  -- {farmer uid}/{stop id}.<ext>. Deleted after 30 days (the API's job).
  photo_path text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists delivery_stops_run_idx on delivery_stops (run_id, sequence);

alter table delivery_stops enable row level security;

-- ---------------------------------------------------------------------
-- 3. Store orders: their stop and window, and the new status.

alter table store_orders add column if not exists delivery_stop_id uuid references delivery_stops (id) on delete set null;
alter table store_orders add column if not exists delivery_window_starts_at timestamptz;
alter table store_orders add column if not exists delivery_window_ends_at timestamptz;

create index if not exists store_orders_delivery_stop_idx on store_orders (delivery_stop_id) where delivery_stop_id is not null;

alter table store_orders drop constraint if exists store_orders_status_check;
alter table store_orders add constraint store_orders_status_check
  check (status in ('pending_payment', 'paid', 'ready_for_pickup', 'out_for_delivery', 'completed', 'cancelled'));

-- ---------------------------------------------------------------------
-- 4. Proof-of-delivery photos: private. The farmer uploads into their own
-- folder; customers see their photo through a short-lived signed link the
-- API creates.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('delivery-photos', 'delivery-photos', false, 10485760, array['image/jpeg', 'image/png', 'image/heic'])
on conflict (id) do nothing;

drop policy if exists "farmers upload their delivery photos" on storage.objects;
create policy "farmers upload their delivery photos"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'delivery-photos' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "farmers replace their delivery photos" on storage.objects;
create policy "farmers replace their delivery photos"
  on storage.objects for update to authenticated
  using (bucket_id = 'delivery-photos' and auth.uid()::text = (storage.foldername(name))[1])
  with check (bucket_id = 'delivery-photos' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "farmers view their delivery photos" on storage.objects;
create policy "farmers view their delivery photos"
  on storage.objects for select to authenticated
  using (bucket_id = 'delivery-photos' and auth.uid()::text = (storage.foldername(name))[1]);

-- ---------------------------------------------------------------------
-- 5. erase_user_data — 0030's function, plus: a customer's delivery stops
-- lose their coordinates and photo link (the API deletes the photo files
-- themselves), and a farmer's delivery settings/windows go.

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
  where so.delivery_stop_id = ds.id and o.customer_id = p_user_id;

  update profiles set full_name = null, phone = null, status = 'deleted', deleted_at = now()
  where id = p_user_id;

  return 'anonymized';
end;
$$;

revoke all on function public.erase_user_data(uuid) from public, anon, authenticated;
