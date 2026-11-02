-- HarvestHub: queries for the internal test. Paste into Supabase, SQL Editor.
-- Run ONE query at a time: highlight it, then press Run. Running several at once
-- shows only the last result.
--
-- PART 1 changes data. Everything from PART 2 down only reads.
-- Where you see EMAIL HERE or FARM NAME HERE, replace it, keeping the quotes.


-- =====================================================================
-- PART 1: SETUP (these change data)
-- =====================================================================

-- 1.1 Preview: every farm, and what is open on it. Run this before 1.2.
select f.farm_name, f.address_city, f.address_state, p.status, f.created_at,
       (select count(*) from products x where x.farmer_id = f.id and x.is_active) as products_showing,
       (select count(*) from store_orders s where s.farmer_id = f.id and s.status not in ('completed', 'cancelled')) as open_orders,
       (select count(*) from group_deals d where d.farmer_id = f.id and d.status not in ('draft', 'cancelled', 'expired', 'unlocked', 'fulfilled')) as open_deals
from farmer_profiles f
join profiles p on p.id = f.id
order by f.created_at;

-- 1.2 Hide every farm that is showing now. Run once, BEFORE you approve the 3 test
-- farmers. New sign-ups aren't affected, because they start as pending.
update profiles set status = 'suspended'
where role = 'farmer' and status = 'active';

-- 1.3 Undo: bring one farm back.
update profiles set status = 'active'
where id = (select id from farmer_profiles where farm_name = 'FARM NAME HERE');

-- 1.4 Create the 4 promo codes for the 3 test farms. Run AFTER those farmers have
-- signed up. Running it twice does no harm. Codes must stay in capital letters.
insert into promo_codes (farmer_id, code, discount_type, discount_value, min_order_amount, usage_limit, expires_at)
select f.id, c.code, c.discount_type, c.discount_value, c.min_order_amount, c.usage_limit, c.expires_at
from farmer_profiles f
cross join (values
  ('TEST10', 'percentage', 10.00, null::numeric, null::integer, null::timestamptz),
  ('OLD10',  'percentage', 10.00, null,          null,          now() - interval '1 day'),
  ('MIN50',  'percentage', 10.00, 50.00,         null,          null),
  ('ONCE5',  'fixed',       5.00, null,          1,             null)
) as c (code, discount_type, discount_value, min_order_amount, usage_limit, expires_at)
where f.farm_name in ('FARM A NAME HERE', 'FARM B NAME HERE', 'FARM C NAME HERE')
on conflict (farmer_id, code) do nothing;

-- 1.5 Check the promo codes, and how often each has been used.
select f.farm_name, c.code, c.discount_type, c.discount_value, c.min_order_amount,
       c.usage_limit, c.times_used, c.expires_at, c.is_active
from promo_codes c
join farmer_profiles f on f.id = c.farmer_id
order by f.farm_name, c.code;


-- =====================================================================
-- PART 2: EVERY TABLE
-- =====================================================================

-- 2.1 All table names, with about how many rows each has.
select relname as table_name, n_live_tup as rows_about
from pg_stat_user_tables
where schemaname = 'public'
order by relname;

-- 2.2 Quick look at any table: change the name. Accounts and addresses
select * from profiles order by created_at desc limit 50;
select * from customer_profiles order by created_at desc limit 50;
select * from customer_places order by created_at desc limit 50;
select * from farmer_profiles order by created_at desc limit 50;
select * from farmer_verification order by created_at desc limit 50;
select * from farmer_certifications order by created_at desc limit 50;

-- Products and carts
select * from categories limit 50;
select * from products order by created_at desc limit 50;
select * from cart_items order by created_at desc limit 50;
select * from promo_codes order by created_at desc limit 50;
select * from farm_follows order by created_at desc limit 50;

-- Orders and money
select * from orders order by created_at desc limit 50;
select * from store_orders order by created_at desc limit 50;
select * from store_order_items order by created_at desc limit 50;
select * from payments order by created_at desc limit 50;
select * from refunds order by created_at desc limit 50;
select * from order_cancellations order by created_at desc limit 50;
select * from payment_cancellations order by created_at desc limit 50;
select * from farmer_ledger_entries order by created_at desc limit 50;
select * from farmer_payouts order by created_at desc limit 50;
select * from farmer_ratings order by created_at desc limit 50;

-- Harvest Pass
select * from memberships order by created_at desc limit 50;
select * from harvest_pass_free_periods order by created_at desc limit 50;
select * from free_month_identifiers order by created_at desc limit 50;
select * from stripe_customers limit 50;

-- Delivery
select * from farm_delivery_settings limit 50;
select * from farm_delivery_windows order by created_at desc limit 50;
select * from delivery_runs order by created_at desc limit 50;
select * from delivery_stops order by created_at desc limit 50;

-- Pods
select * from pods order by created_at desc limit 50;
select * from pod_members order by created_at desc limit 50;
select * from pod_invites order by created_at desc limit 50;

-- Group deals
select * from group_deals order by created_at desc limit 50;
select * from group_commits order by created_at desc limit 50;
select * from group_waitlist order by created_at desc limit 50;

-- Notifications and settings
select * from notifications order by created_at desc limit 50;
select * from notification_settings limit 50;
select * from push_tokens limit 50;
select * from app_config;


-- =====================================================================
-- PART 3: LOGINS AND ACTIVITY
-- =====================================================================

-- 3.1 Everyone: role, status, whether their email is confirmed, last login.
select u.email, p.full_name, p.phone, p.role, p.status,
       u.created_at as signed_up, u.email_confirmed_at, u.last_sign_in_at
from auth.users u
left join profiles p on p.id = u.id
order by u.last_sign_in_at desc nulls last;

-- 3.2 Who hasn't logged in during the last 24 hours.
select u.email, p.full_name, p.role, u.last_sign_in_at
from auth.users u
join profiles p on p.id = u.id
where u.last_sign_in_at is null or u.last_sign_in_at < now() - interval '24 hours'
order by u.last_sign_in_at nulls first;

-- 3.3 Login history. If this comes back empty, your project isn't saving audit
-- logs here: use Authentication, then Logs, in the Supabase dashboard instead.
select a.created_at, a.payload ->> 'action' as action, a.payload ->> 'actor_username' as who, a.ip_address
from auth.audit_log_entries a
order by a.created_at desc
limit 100;

-- 3.4 Devices that are logged in now.
select u.email, s.created_at as logged_in_at, s.refreshed_at as last_active, s.user_agent
from auth.sessions s
join auth.users u on u.id = s.user_id
order by s.refreshed_at desc nulls last;

-- 3.5 One person's whole history, newest first.
with me as (select id from auth.users where email = 'EMAIL HERE')
select * from (
  select o.created_at as happened, 'Order placed' as what,
         o.status || ', $' || coalesce((select sum(s.total) from store_orders s where s.order_id = o.id), 0) as detail
  from orders o where o.customer_id = (select id from me)
  union all
  select c.created_at, 'Order cancelled', coalesce(c.reason, '')
  from order_cancellations c join orders o on o.id = c.order_id where o.customer_id = (select id from me)
  union all
  select r.created_at, 'Refund', '$' || r.amount || ', ' || r.status
  from refunds r join payments y on y.id = r.payment_id where y.customer_id = (select id from me)
  union all
  select r.created_at, 'Rated a farm', r.rating || ' stars'
  from farmer_ratings r where r.customer_id = (select id from me)
  union all
  select f.starts_at, 'Free month started', 'ends ' || f.ends_at::date
  from harvest_pass_free_periods f where f.customer_id = (select id from me)
  union all
  select m.created_at, 'Joined Harvest Pass', m.plan || ', ' || m.status
  from memberships m where m.customer_id = (select id from me)
  union all
  select m.joined_at, 'Joined a pod', x.name || ', ' || m.status
  from pod_members m join pods x on x.id = m.pod_id where m.customer_id = (select id from me)
  union all
  select g.joined_at, 'Joined a group deal', g.units || ' share(s), ' || g.status
  from group_commits g where g.customer_id = (select id from me)
  union all
  select n.created_at, 'Message: ' || n.kind, n.title
  from notifications n where n.profile_id = (select id from me)
) history
where happened is not null
order by happened desc;

-- 3.6 Every customer at a glance.
select u.email, p.full_name, p.status, c.address_city, c.address_state,
       (select count(*) from orders o where o.customer_id = c.id) as orders,
       (select count(*) from orders o where o.customer_id = c.id and o.status = 'cancelled') as cancelled,
       (select coalesce(sum(y.amount), 0) from payments y where y.customer_id = c.id and y.status = 'succeeded') as paid_by_card,
       (select coalesce(sum(r.amount), 0) from refunds r join payments y on y.id = r.payment_id where y.customer_id = c.id) as refunded,
       (select f.ends_at::date from harvest_pass_free_periods f where f.customer_id = c.id) as free_month_ends,
       (select m.plan || ', ' || m.status from memberships m where m.customer_id = c.id order by m.created_at desc limit 1) as plan,
       (select count(*) from customer_places x where x.customer_id = c.id) as saved_places,
       (select count(*) from pod_members m where m.customer_id = c.id and m.status = 'active') as pods,
       (select count(*) from group_commits g where g.customer_id = c.id) as deals_joined
from customer_profiles c
join profiles p on p.id = c.id
left join auth.users u on u.id = c.id
order by orders desc;

-- 3.7 Every farmer at a glance.
select u.email, f.farm_name, p.status as account, v.status as application, v.reviewer_notes,
       (select count(*) from products x where x.farmer_id = f.id and x.is_active) as products_showing,
       (select count(*) from store_orders s where s.farmer_id = f.id and s.released_to_farmer_at is not null) as orders,
       (select coalesce(sum(l.gross_amount), 0) from farmer_ledger_entries l where l.farmer_id = f.id) as sales,
       (select coalesce(sum(l.net_amount), 0) from farmer_ledger_entries l where l.farmer_id = f.id) as earned,
       (select round(avg(r.rating), 1) from farmer_ratings r where r.farmer_id = f.id) as rating,
       (select d.offers_delivery from farm_delivery_settings d where d.farmer_id = f.id) as delivers,
       (select d.offers_pod_delivery from farm_delivery_settings d where d.farmer_id = f.id) as delivers_to_pods
from farmer_profiles f
join profiles p on p.id = f.id
left join farmer_verification v on v.id = f.id
left join auth.users u on u.id = f.id
order by f.created_at desc;


-- =====================================================================
-- PART 4: MONEY
-- =====================================================================

-- 4.1 Every order, with each charge split out. One row per farm on an order.
select s.created_at, u.email as customer, s.farm_name, s.fulfillment_method, s.status,
       y.payment_method, y.status as payment_status,
       s.subtotal, s.promo_code, s.promo_discount, s.delivery_fee, s.service_fee, s.member_savings, s.tax, s.total,
       (select coalesce(sum(r.amount), 0) from refunds r where r.store_order_id = s.id) as refunded
from store_orders s
join orders o on o.id = s.order_id
left join payments y on y.order_id = o.id
left join auth.users u on u.id = o.customer_id
order by s.created_at desc
limit 200;

-- 4.2 Totals by payment status.
select payment_method, status, count(*) as payments, sum(amount) as total
from payments
group by payment_method, status
order by payment_method, status;

-- 4.3 What HarvestHub has earned on orders not cancelled: service fees, plus
-- commission from the ledger. Harvest Pass income is in Stripe, not here.
select
  (select coalesce(sum(service_fee), 0) from store_orders where status <> 'cancelled' and released_to_farmer_at is not null) as service_fees,
  (select coalesce(sum(commission_amount), 0) from farmer_ledger_entries) as commission,
  (select coalesce(sum(member_savings), 0) from store_orders where status <> 'cancelled') as fees_waived_by_harvest_pass,
  (select coalesce(sum(promo_discount), 0) from store_orders where status <> 'cancelled') as promo_discounts,
  (select coalesce(sum(tax), 0) from store_orders where status <> 'cancelled' and released_to_farmer_at is not null) as tax_collected;

-- 4.4 Refunds.
select r.created_at, u.email as customer, s.farm_name, r.amount, r.status, r.reason, r.stripe_refund_id
from refunds r
join payments y on y.id = r.payment_id
left join store_orders s on s.id = r.store_order_id
left join auth.users u on u.id = y.customer_id
order by r.created_at desc;

-- 4.5 Failed or waiting card charges, including pods and group deals.
select y.updated_at, u.email as customer, y.amount, y.status, y.failure_reason, y.charge_attempts, y.last_charge_attempt_at
from payments y
left join auth.users u on u.id = y.customer_id
where y.status in ('charge_failed', 'awaiting_cutoff', 'charging')
order by y.updated_at desc;

-- 4.6 Leftover "Awaiting payment" orders: the customer closed the card screen.
select o.created_at, u.email as customer, y.amount, y.status
from orders o
join payments y on y.order_id = o.id
left join auth.users u on u.id = o.customer_id
where y.status = 'requires_payment_method' and o.status <> 'cancelled'
order by o.created_at desc;

-- 4.7 MONEY CHECK: should return NO rows. A payment that doesn't match its orders.
select y.order_id, y.status, y.amount as payment, sum(s.total) as orders_total
from payments y
join store_orders s on s.order_id = y.order_id
where y.status = 'succeeded'
group by y.order_id, y.status, y.amount
having abs(y.amount - sum(s.total)) > 0.01;

-- 4.8 MONEY CHECK: should return NO rows. Refunded more than the order's total.
select s.id as store_order_id, s.farm_name, s.total, sum(r.amount) as refunded
from store_orders s
join refunds r on r.store_order_id = s.id
group by s.id, s.farm_name, s.total
having sum(r.amount) > s.total + 0.01;

-- 4.9 Each farm's week: compare this with the farmer's Earnings screen.
select f.farm_name, l.pay_period_start, l.pay_period_end, count(*) as entries,
       sum(l.gross_amount) as sales, sum(l.commission_amount) as commission,
       sum(l.cash_collected) as cash_kept, sum(l.fee_amount) as cancellation_fees, sum(l.net_amount) as net
from farmer_ledger_entries l
join farmer_profiles f on f.id = l.farmer_id
group by f.farm_name, l.pay_period_start, l.pay_period_end
order by l.pay_period_start desc, f.farm_name;

-- 4.10 MONEY CHECK: should return NO rows. Sales minus everything must equal net.
select id, entry_type, gross_amount, commission_amount, cash_collected, fee_amount, net_amount
from farmer_ledger_entries
where abs(gross_amount - commission_amount - cash_collected - fee_amount - net_amount) > 0.01;

-- 4.11 Payouts. To mark one paid, change status to 'paid' on the row in Table Editor.
select f.farm_name, x.pay_period_start, x.pay_period_end, x.status, x.gross_total, x.commission_total,
       x.cash_collected_total, x.fee_total, x.carried_in_total, x.net_total, x.disbursed_at
from farmer_payouts x
join farmer_profiles f on f.id = x.farmer_id
order by x.pay_period_start desc, f.farm_name;

-- 4.12 Harvest Pass: everyone with a free month or a plan.
select u.email, f.starts_at::date as free_from, f.ends_at::date as free_until, f.ends_at > now() as free_now,
       m.plan, m.price_amount, m.status as plan_status, m.current_period_end::date as renews,
       m.cancel_at_period_end, m.card_brand, m.card_last4
from harvest_pass_free_periods f
full join memberships m on m.customer_id = f.customer_id
left join auth.users u on u.id = coalesce(f.customer_id, m.customer_id)
order by f.starts_at desc nulls last;


-- =====================================================================
-- PART 5: STATUS
-- =====================================================================

-- 5.1 How many orders are at each stage, by farm.
select farm_name, status, fulfillment_method, count(*) as orders, sum(total) as total
from store_orders
group by farm_name, status, fulfillment_method
order by farm_name, status;

-- 5.2 Group deals: progress against the goal.
select f.farm_name, x.name as product, d.status, d.goal,
       (select count(*) from group_commits g where g.deal_id = d.id and g.status in ('active', 'ordered')) as households,
       (select coalesce(sum(g.units), 0) from group_commits g where g.deal_id = d.id and g.status in ('active', 'ordered')) as shares_claimed,
       d.capacity, d.deal_price, d.regular_price, d.member_opens_at, d.public_opens_at, d.deadline_at, d.fulfillment_date,
       (select count(*) from group_waitlist w where w.deal_id = d.id and w.status in ('waiting', 'offered')) as on_waitlist
from group_deals d
join farmer_profiles f on f.id = d.farmer_id
join products x on x.id = d.product_id
order by d.created_at desc;

-- 5.3 Who joined each deal, and what happened to them.
select x.name as product, u.email as customer, g.status, g.units, g.fulfillment_method, g.delivery_fee, g.member_at_join,
       g.joined_at, g.withdrawn_at, y.status as payment_status, y.amount as charged, y.charge_attempts, y.failure_reason
from group_commits g
join group_deals d on d.id = g.deal_id
join products x on x.id = d.product_id
left join auth.users u on u.id = g.customer_id
left join payments y on y.order_id = g.order_id
order by d.created_at desc, g.joined_at;

-- 5.4 Pods and their members.
select x.name as pod, x.status, x.delivery_weekday, x.address_street, h.email as host,
       (select count(*) from pod_members m where m.pod_id = x.id and m.status = 'active') as members,
       (select string_agg(u.email, ', ') from pod_members m join auth.users u on u.id = m.customer_id
         where m.pod_id = x.id and m.status = 'active') as member_emails,
       (select count(*) from pod_invites i where i.pod_id = x.id and i.status = 'sent') as invites_waiting
from pods x
left join auth.users h on h.id = x.host_id
order by x.created_at desc;

-- 5.5 Delivery runs and how far along they are.
select f.farm_name, r.window_starts_at, r.status, r.started_at, r.completed_at, r.location_updated_at,
       (select count(*) from delivery_stops s where s.run_id = r.id) as stops,
       (select count(*) from delivery_stops s where s.run_id = r.id and s.status = 'delivered') as delivered,
       (select count(*) from delivery_stops s where s.run_id = r.id and s.status = 'cancelled') as cancelled
from delivery_runs r
join farmer_profiles f on f.id = r.farmer_id
order by r.window_starts_at desc;

-- 5.6 Messages sent, newest first. Use this when a tester says nothing arrived.
select n.created_at, u.email, n.kind, n.title, n.push_status, n.email_status, n.sms_status
from notifications n
left join auth.users u on u.id = n.profile_id
order by n.created_at desc
limit 100;

-- 5.7 Message results by type. Look for anything starting with "failed".
select kind, push_status, email_status, sms_status, count(*) as sent
from notifications
group by kind, push_status, email_status, sms_status
order by kind;

-- 5.8 Products: stock and what's showing.
select f.farm_name, x.name, c.slug as category, x.price, x.unit, x.quantity_available, x.is_active, x.tax_category, x.keep_cold
from products x
join farmer_profiles f on f.id = x.farmer_id
left join categories c on c.id = x.category_id
order by f.farm_name, x.name;

-- 5.9 Farms: are they located properly? Precision should be exact or interpolated.
select f.farm_name, p.status, f.address_street, f.address_city, f.address_state, f.address_zip,
       f.latitude, f.longitude, f.location_precision, f.geocoded_at
from farmer_profiles f
join profiles p on p.id = f.id
order by f.address_state, f.farm_name;

-- 5.10 Customers: "zip" or an empty location can't get delivery or join a pod.
select u.email, c.address_street, c.address_unit, c.address_city, c.address_state, c.address_zip, c.location_precision, c.geocoded_at
from customer_profiles c
left join auth.users u on u.id = c.id
order by c.location_precision nulls first;

-- 5.11 How far every showing farm is from one customer, in miles.
select f.farm_name, f.address_city, f.address_state,
       round((3958.8 * 2 * asin(sqrt(
         power(sin(radians(f.latitude - c.latitude) / 2), 2) +
         cos(radians(c.latitude)) * cos(radians(f.latitude)) * power(sin(radians(f.longitude - c.longitude) / 2), 2)
       )))::numeric, 1) as miles,
       d.offers_delivery, d.radius_miles
from customer_profiles c
join farmer_profiles f on f.latitude is not null
join profiles p on p.id = f.id and p.status = 'active'
left join farm_delivery_settings d on d.farmer_id = f.id
where c.id = (select id from auth.users where email = 'EMAIL HERE')
order by miles;
