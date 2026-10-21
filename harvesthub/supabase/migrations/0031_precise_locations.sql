-- HarvestHub — precise locations for homes and farms.
--
-- Neighborhood Pods need to know whether neighbors are within 0.5 mi of a
-- drop point, which a ZIP-code guess (what we fell back to before) can't
-- tell. Three changes:
--
-- 1. location_precision on customer_profiles and farmer_profiles — how exact
--    latitude/longitude are: 'exact' (the address point), 'interpolated'
--    (estimated along the street), 'approximate' (street/area level) or 'zip'
--    (ZIP centroid). NULL = not geocoded, or nothing matched. Set by the API's
--    geocoder (app/core/geocoding.py): Google first, then the Census geocoder,
--    then the ZIP centroid. The app now also suggests real addresses while
--    the user types (Google Places, through the API), so typos rarely reach
--    the geocoder. (Radar at first; switched to Google on 2026-10-21 —
--    comment-only change, nothing to re-run.)
--
-- 2. Changing an address clears the coordinates (a trigger), so the API
--    geocodes the new one on its next read. The app used to clear them
--    itself; now it can't (see 3) and doesn't need to.
--
-- 3. Users can no longer write their own coordinates. Before, a customer or
--    farmer could set any latitude/longitude through supabase-js (the update
--    policies covered every column) — enough to fake being inside a pod's
--    radius. UPDATE is now granted only on the columns the app edits; the
--    API (connecting as postgres) still writes the rest. Same pattern as
--    0002 for profiles.
--
-- Every existing home and farm is re-geocoded once by the new geocoder:
-- geocoded_at is cleared below, and the old coordinates stay in place until
-- the new ones replace them.
--
-- Also fixes a gap: customer_profiles' latitude/longitude/geocoded_at were
-- only ever created by an Alembic revision (3be435d216d9), never by these
-- SQL migrations — so a database built from this folder alone (production,
-- via apply-migrations.mjs) didn't have them. Added here if missing, with
-- the same types Alembic used.

alter table customer_profiles add column if not exists latitude double precision;
alter table customer_profiles add column if not exists longitude double precision;
alter table customer_profiles add column if not exists geocoded_at timestamp;

alter table customer_profiles add column if not exists location_precision text;
alter table customer_profiles drop constraint if exists customer_profiles_location_precision_check;
alter table customer_profiles add constraint customer_profiles_location_precision_check
  check (location_precision in ('exact', 'interpolated', 'approximate', 'zip'));

alter table farmer_profiles add column if not exists location_precision text;
alter table farmer_profiles drop constraint if exists farmer_profiles_location_precision_check;
alter table farmer_profiles add constraint farmer_profiles_location_precision_check
  check (location_precision in ('exact', 'interpolated', 'approximate', 'zip'));

-- ---------------------------------------------------------------------

create or replace function public.reset_geocode_on_address_change()
returns trigger
language plpgsql
as $$
begin
  if (new.address_street, new.address_city, new.address_state, new.address_zip)
     is distinct from (old.address_street, old.address_city, old.address_state, old.address_zip) then
    new.latitude := null;
    new.longitude := null;
    new.geocoded_at := null;
    new.location_precision := null;
  end if;
  return new;
end;
$$;

drop trigger if exists customer_profiles_reset_geocode on customer_profiles;
create trigger customer_profiles_reset_geocode
  before update on customer_profiles
  for each row execute procedure public.reset_geocode_on_address_change();

drop trigger if exists farmer_profiles_reset_geocode on farmer_profiles;
create trigger farmer_profiles_reset_geocode
  before update on farmer_profiles
  for each row execute procedure public.reset_geocode_on_address_change();

-- ---------------------------------------------------------------------
-- What the app may update directly (edit-profile.tsx; the farmer
-- application, farm-profile.tsx and StorePhotoCard.tsx).

revoke update on customer_profiles from authenticated;
grant update (address_street, address_city, address_state, address_zip, dietary_preferences, produce_interests)
  on customer_profiles to authenticated;

revoke update on farmer_profiles from authenticated;
grant update (
  farm_name, bio, farm_types, years_in_operation, tax_id, photo_url,
  address_street, address_city, address_state, address_zip
) on farmer_profiles to authenticated;

-- ---------------------------------------------------------------------
-- Re-geocode everyone once with the new geocoder.

update customer_profiles set geocoded_at = null;
update farmer_profiles set geocoded_at = null where address_street is not null;
