-- HarvestHub — farmer bio (shown on the farm detail page a customer lands
-- on after tapping a FarmerCard) + cart_items (per-customer product
-- quantities backing that page's +/- stepper and running total).
--
-- Bio is free text, filled in later via a farmer profile-edit UI (not built
-- yet) — nullable like every other farmer_profiles column that isn't
-- required at signup (see 0004's header note on the same pattern).

alter table farmer_profiles
  add column if not exists bio text;

-- ---------------------------------------------------------------------
-- One row per (customer, product). quantity is the single source of truth
-- for both the qty stepper on a product card and the farm detail page's
-- running total — a customer's cart can span multiple farms, but the farm
-- detail page only ever reads/writes the rows for the farm it's showing.

create table if not exists cart_items (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references profiles (id) on delete cascade,
  product_id uuid not null references products (id) on delete cascade,
  quantity integer not null check (quantity > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (customer_id, product_id)
);

create index if not exists cart_items_customer_id_idx on cart_items (customer_id);

alter table cart_items enable row level security;

-- NOTE: same caveat as products/categories (see 0008) — FastAPI's own
-- connection bypasses RLS entirely. This policy is for any future direct
-- supabase-js access to cart_items, not what the /cart endpoints rely on.
drop policy if exists "customers manage their own cart items" on cart_items;
create policy "customers manage their own cart items"
  on cart_items for all
  using (auth.uid() = customer_id)
  with check (auth.uid() = customer_id);

drop trigger if exists cart_items_set_updated_at on cart_items;
create trigger cart_items_set_updated_at
  before update on cart_items
  for each row execute procedure public.set_updated_at();

-- ---------------------------------------------------------------------
-- DEV/TEST SEED DATA (optional) — backfills bio + a couple of public
-- certification badges onto 0010's 5 fake farmers, purely so the farm
-- detail page's header has something real to display during development.
-- Safe to run against a database that never ran 0010's seed: these
-- `update ... where id = <fixed seed uuid>` and cert inserts are no-ops if
-- those farmer rows don't exist. Same fixed-id + `on conflict do nothing`
-- discipline as 0010, so re-running this file never duplicates rows.

update farmer_profiles set
  bio = 'Family-owned since 2018, growing heirloom vegetables and herbs without synthetic pesticides. We pick everything the morning of pickup.'
where id = '11111111-1111-1111-1111-111111111101';

update farmer_profiles set
  bio = 'Third-generation orchard specializing in tree-ripened apples and pears. Our sunflowers are grown as a pollinator cover crop between rows.'
where id = '11111111-1111-1111-1111-111111111102';

update farmer_profiles set
  bio = 'Small grass-fed dairy herd, milked and bottled on-site daily. No hormones, no antibiotics.'
where id = '11111111-1111-1111-1111-111111111103';

-- (The farmer must exist for the insert to be a no-op without 0010; a
-- plain VALUES insert would fail the farmer_id foreign key instead.)
insert into farmer_certifications (id, farmer_id, cert_type, cert_name)
select v.id::uuid, v.farmer_id::uuid, v.cert_type, v.cert_name
from (values
  ('33333333-3333-3333-3333-333333333001', '11111111-1111-1111-1111-111111111101', 'organic', 'USDA Certified Organic'),
  ('33333333-3333-3333-3333-333333333002', '11111111-1111-1111-1111-111111111103', 'state_ag_registration', 'State Dairy License')
) as v (id, farmer_id, cert_type, cert_name)
where exists (select 1 from profiles p where p.id = v.farmer_id::uuid)
on conflict (id) do nothing;
