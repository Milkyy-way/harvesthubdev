-- HarvestHub — notifications: push, email and text messages
-- (app/notifications/ in the API).
--
-- What gets sent, and on which channels, is decided in the API
-- (app/notifications/messages.py): order placed / ready / cancelled,
-- Harvest Pass free period ending, membership payment failed, farmer
-- approved / rejected, payout sent. Providers: Expo's push service (which
-- hands off to Apple and Google), Resend for email, Telnyx for texts. Each
-- stays off until its key is set on the API.
--
-- 1. push_tokens — one row per phone signed in to an account (an Expo push
--    token). The app registers it after sign-in and removes it on sign-out;
--    the API also drops tokens Expo reports as dead. A phone that signs in to
--    another account moves to that account. API-only: RLS on, no policies.
--
-- 2. notification_settings — the user's channel choices. No row means the
--    defaults: push and email on, texts OFF. Texts are opt-in, and
--    sms_consented_at records when the user turned them on (carriers and the
--    TCPA require that consent). API-only, so the consent time is always set
--    by the server.
--
-- 3. notifications — every notification sent and what happened on each
--    channel ('sent', 'off', 'none', 'not_configured', 'failed: ...'). The
--    unique dedupe_key is how the API makes sure an event (a webhook retried,
--    the scheduled job running again) is announced once. Users can read
--    their own rows, for a future in-app inbox.
--
-- Account deletion: all three are personal data, so erase_user_data() (0027)
-- now deletes them for anonymized accounts too; fully deleted profiles
-- cascade as before.

create table if not exists push_tokens (
  token text primary key,
  profile_id uuid not null references profiles (id) on delete cascade,
  platform text not null check (platform in ('ios', 'android')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists push_tokens_profile_idx on push_tokens (profile_id);

alter table push_tokens enable row level security;

-- ---------------------------------------------------------------------

create table if not exists notification_settings (
  profile_id uuid primary key references profiles (id) on delete cascade,
  push_enabled boolean not null default true,
  email_enabled boolean not null default true,
  sms_enabled boolean not null default false,
  sms_consented_at timestamptz,
  updated_at timestamptz not null default now(),
  check (not sms_enabled or sms_consented_at is not null)
);

alter table notification_settings enable row level security;

-- ---------------------------------------------------------------------

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles (id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null,
  data jsonb not null default '{}'::jsonb,
  dedupe_key text unique,
  push_status text,
  email_status text,
  sms_status text,
  created_at timestamptz not null default now()
);

create index if not exists notifications_profile_idx on notifications (profile_id, created_at desc);

alter table notifications enable row level security;

drop policy if exists "users view their own notifications" on notifications;
create policy "users view their own notifications"
  on notifications for select
  using (auth.uid() = profile_id);

-- ---------------------------------------------------------------------
-- erase_user_data — 0027's function, plus the three tables above.

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
