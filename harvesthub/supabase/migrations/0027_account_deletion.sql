-- HarvestHub — account deletion (Google Play's account-deletion requirement).
--
-- A user deletes their account from the app (DELETE /api/v1/account), or
-- asks support, who deletes them in Studio (Authentication -> Users). Either
-- way the auth.users row is deleted, and the trigger below cleans up
-- everything in public:
--
-- * No order history (e.g. a customer who never bought anything, a farmer
--   who never sold): the profile is deleted outright, and the existing
--   ON DELETE CASCADE foreign keys remove the customer/farmer profile, cart,
--   products, promo codes, verification record, and certifications.
-- * Order history: orders, payments, store orders, ledger entries, payouts
--   and ratings point at profiles with ON DELETE RESTRICT, because they are
--   financial records HarvestHub has to keep (tax, refunds, farmer payouts).
--   The profile stays as an anonymous tombstone (no name, no phone,
--   status 'deleted'), and the personal data around it is erased: address
--   and preferences, cart, farm address/location/photo/bio/tax ID,
--   verification record (license numbers, document paths), certifications,
--   rating comments, and the delivery addresses on their old orders.
--   Products are hidden, promo codes switched off. Amounts, dates, items,
--   and the farm name on old orders are kept.
--
-- Files in Storage (verification documents, farm and product photos) can't
-- be deleted from SQL; the API's DELETE /account removes them through the
-- Storage API before deleting the auth user. If support deletes a user in
-- Studio instead, delete the user's folder in the farmer-verification-docs
-- and farmer-photos buckets too.
--
-- The API refuses to delete an account while an order is still in progress
-- or a farmer still has earnings waiting to be paid (or owes HarvestHub).

-- ---------------------------------------------------------------------
-- profiles: a 'deleted' status and when it happened.

alter table profiles add column if not exists deleted_at timestamptz;

alter table profiles drop constraint if exists profiles_status_check;
alter table profiles add constraint profiles_status_check
  check (status in ('active', 'pending_verification', 'rejected', 'suspended', 'pending_role_selection', 'deleted'));

-- profiles.id used to cascade from auth.users, so deleting a user with any
-- order history failed (the cascade hit the RESTRICT foreign keys above).
-- The link is now kept by the trigger below instead of a foreign key.
alter table profiles drop constraint if exists profiles_id_fkey;

-- ---------------------------------------------------------------------

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

  update profiles set full_name = null, phone = null, status = 'deleted', deleted_at = now()
  where id = p_user_id;

  return 'anonymized';
end;
$$;

revoke all on function public.erase_user_data(uuid) from public, anon, authenticated;

create or replace function public.handle_auth_user_deleted()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  perform public.erase_user_data(old.id);
  return old;
end;
$$;

drop trigger if exists on_auth_user_deleted on auth.users;
create trigger on_auth_user_deleted
  after delete on auth.users
  for each row execute procedure public.handle_auth_user_deleted();
