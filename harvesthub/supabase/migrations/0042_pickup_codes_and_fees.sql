-- 0042: the payment and pickup rules agreed with the user on 2026-11-19/20.
--
--  * Service fee: 5% of the items, plus 30¢ once per payment when the
--    checkout's items come to less than $25. Harvest Pass members pay none
--    from $25. Paying at the farm takes the whole fee off as a discount.
--    The fee isn't refunded when the customer cancels.
--  * Stock is held from the moment checkout opens (it used to be taken only
--    once a card payment went through), so two people can't buy the last one.
--  * Pickup: the farm taps Ready ("now" or "from" a time), the customer gets
--    a 4-digit code, and the farm confirms the handover with it. The window
--    is 3 hours, plus one 1-hour extension. When it ends, the app marks the
--    order "not picked": the stock goes back, and a card order isn't refunded.
--  * Customers can report a problem for 24 hours; HarvestHub decides.
--  * Disputes and refunds made outside the app are recorded and emailed.
--
-- See app/pickup/, app/problems/ and app/ops/ in the backend.

-- ---------------------------------------------------------------------
-- 1. Store orders

alter table store_orders
  -- The 30¢ part of service_fee (on one farm's part of a payment).
  add column if not exists fixed_fee numeric(10, 2) not null default 0,
  -- Paid at the farm: the service fee it would have had, taken off.
  add column if not exists cash_discount numeric(10, 2) not null default 0,
  -- This order's stock is taken off the products (given back if it's cancelled).
  add column if not exists stock_held boolean not null default false,
  -- Pickup: when the farm tapped Ready, the window, and the code.
  add column if not exists ready_at timestamptz,
  add column if not exists pickup_starts_at timestamptz,
  add column if not exists pickup_ends_at timestamptz,
  add column if not exists pickup_extended_at timestamptz,
  add column if not exists pickup_code text,
  add column if not exists pickup_code_failures integer not null default 0,
  add column if not exists pickup_code_locked_until timestamptz,
  add column if not exists pickup_confirmed_by text,
  add column if not exists pickup_backup_reason text,
  -- Handed over (picked up or delivered), or the window ended without it.
  add column if not exists completed_at timestamptz,
  add column if not exists not_picked_at timestamptz,
  -- A cash order marked "not picked": the customer's answer to "Did you
  -- collect this order?". A "yes" goes to HarvestHub to look into.
  add column if not exists collected_answer text,
  add column if not exists collected_answered_at timestamptz;

alter table store_orders drop constraint if exists store_orders_pickup_code_check;
alter table store_orders add constraint store_orders_pickup_code_check
  check (pickup_code is null or pickup_code ~ '^[0-9]{4}$');
alter table store_orders drop constraint if exists store_orders_pickup_confirmed_by_check;
alter table store_orders add constraint store_orders_pickup_confirmed_by_check
  check (pickup_confirmed_by is null or pickup_confirmed_by in ('code', 'backup'));
alter table store_orders drop constraint if exists store_orders_collected_answer_check;
alter table store_orders add constraint store_orders_collected_answer_check
  check (collected_answer is null or collected_answer in ('yes', 'no'));

alter table store_orders drop constraint if exists store_orders_status_check;
alter table store_orders add constraint store_orders_status_check
  check (status in ('pending_payment', 'paid', 'ready_for_pickup', 'out_for_delivery', 'completed', 'not_picked', 'cancelled'));

-- The scheduled job looks for windows ending.
create index if not exists store_orders_pickup_window_idx on store_orders (pickup_ends_at) where status = 'ready_for_pickup';

-- Orders already placed: whose stock was taken (card orders took it once
-- paid; cash, pod and group deal orders when they were placed).
update store_orders so
   set stock_held = true
 where not so.stock_held
   and (
         so.status in ('paid', 'ready_for_pickup', 'out_for_delivery')
         or (
           so.status = 'pending_payment'
           and exists (
                 select 1 from payments p
                  where p.order_id = so.order_id
                    and (p.payment_method = 'cash_on_pickup' or p.status in ('awaiting_cutoff', 'charging', 'charge_failed'))
               )
         )
       );

update store_orders set completed_at = coalesce(updated_at, created_at, now())
 where status = 'completed' and completed_at is null;

-- Orders already waiting for pickup get a code and a window starting now.
update store_orders
   set pickup_code = lpad(floor(random() * 10000)::int::text, 4, '0'),
       ready_at = coalesce(ready_at, now()),
       pickup_starts_at = now(),
       pickup_ends_at = now() + interval '3 hours'
 where status = 'ready_for_pickup' and fulfillment_method = 'pickup' and pickup_code is null;

-- An order is finished once every farm's part is handed over, not picked
-- up, or cancelled (0013's function, with 'not_picked').
create or replace function public.sync_order_status_from_store_orders()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  target_order_id uuid := coalesce(new.order_id, old.order_id);
  total_count integer;
  cancelled_count integer;
  unfinished_count integer;
  new_status text;
begin
  select count(*) into total_count from store_orders where order_id = target_order_id;
  select count(*) into cancelled_count from store_orders where order_id = target_order_id and status = 'cancelled';
  select count(*) into unfinished_count from store_orders
   where order_id = target_order_id and status not in ('completed', 'not_picked', 'cancelled');

  if total_count = 0 then
    return coalesce(new, old);
  elsif cancelled_count = total_count then
    new_status := 'cancelled';
  elsif unfinished_count = 0 then
    new_status := 'completed';
  else
    new_status := 'active';
  end if;

  update orders set status = new_status where id = target_order_id and status is distinct from new_status;
  return coalesce(new, old);
end;
$$;

-- ---------------------------------------------------------------------
-- 2. Payments and refunds

-- What Stripe kept for itself on each card payment (filled in by the job).
alter table payments add column if not exists stripe_fee numeric(10, 2);

-- A refund made in Stripe's Dashboard can't be matched to a farm, so
-- store_order_id may be empty; source says where each refund came from.
alter table refunds alter column store_order_id drop not null;
alter table refunds add column if not exists source text not null default 'cancel';
alter table refunds drop constraint if exists refunds_source_check;
alter table refunds add constraint refunds_source_check
  check (source in ('cancel', 'problem', 'outside', 'late_payment'));

-- ---------------------------------------------------------------------
-- 3. "Report a problem" (24 hours after pickup or delivery, or after
-- "not picked"). HarvestHub decides; nothing waits on the farm.

create table if not exists problem_reports (
  id uuid primary key default gen_random_uuid(),
  store_order_id uuid not null references store_orders (id) on delete cascade,
  customer_id uuid not null,
  reason text not null check (reason in ('missing_item', 'damaged', 'wrong_item', 'quality', 'farm_closed', 'other')),
  details text,
  -- [{"item_id": ..., "product_name": ..., "quantity": n}]
  items jsonb not null default '[]'::jsonb,
  status text not null default 'open' check (status in ('open', 'refunded', 'declined', 'handled')),
  refund_amount numeric(10, 2),
  decision_note text,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists problem_reports_one_per_store_order on problem_reports (store_order_id);
create index if not exists problem_reports_open_idx on problem_reports (created_at) where status = 'open';
alter table problem_reports enable row level security;

-- ---------------------------------------------------------------------
-- 4. Disputes (a customer asked their bank for the money back), and the
-- emails sent to HarvestHub itself (alerts and the daily check).

create table if not exists payment_disputes (
  id uuid primary key default gen_random_uuid(),
  stripe_dispute_id text not null unique,
  stripe_charge_id text,
  stripe_payment_intent_id text,
  payment_id uuid references payments (id) on delete set null,
  amount numeric(10, 2) not null,
  reason text,
  status text not null,
  evidence_due_by timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table payment_disputes enable row level security;

create table if not exists ops_alerts (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  dedupe_key text not null unique,
  subject text not null,
  body text not null,
  email_status text,
  created_at timestamptz not null default now()
);
alter table ops_alerts enable row level security;

-- ---------------------------------------------------------------------
-- 5. Deleting an account also clears what that person wrote in their
-- problem reports (0027's trigger handles everything else).

create or replace function public.erase_problem_reports()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  update problem_reports set details = null where customer_id = old.id;
  return old;
end;
$$;

drop trigger if exists on_auth_user_deleted_problem_reports on auth.users;
create trigger on_auth_user_deleted_problem_reports
  before delete on auth.users
  for each row execute procedure public.erase_problem_reports();
