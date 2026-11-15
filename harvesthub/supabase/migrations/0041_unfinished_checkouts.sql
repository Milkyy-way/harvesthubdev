-- 0041: a checkout the customer never paid for is not an order (2026-11-14).
--
-- A card order is written before the payment sheet opens (Stripe needs the
-- order to pay for). If the customer closes the sheet without paying, that
-- row used to sit in Orders as "Awaiting payment", count as an order, and
-- count as a cancelled order once they cancelled it. Now the app removes it
-- when the sheet closes, the customer can finish paying or remove it from
-- the order screen, and the scheduled job removes any left after an hour
-- (app/orders/service.py, discard_checkout and expire_unfinished_checkouts).
--
-- "Removed" is this timestamp, not a delete: the rows stay for the record
-- (Stripe's cancelled PaymentIntent still points at the order), but the
-- customer's lists and counts leave them out. No money ever moved on them,
-- and the farm never saw them (store_orders.released_to_farmer_at is null).

alter table orders add column if not exists abandoned_at timestamptz;

-- Checkouts already cancelled without ever being paid for: the card payment
-- was cancelled, nothing was released to a farm, and it wasn't a pod order
-- whose card had been saved (that one was placed, then cancelled) or a group
-- deal order (placed when the deal closed).
update orders o
   set abandoned_at = coalesce(o.updated_at, now())
 where o.abandoned_at is null
   and exists (
         select 1 from payments p
          where p.order_id = o.id
            and p.payment_method <> 'cash_on_pickup'
            and p.status = 'canceled'
            and p.stripe_payment_method_id is null
       )
   and not exists (
         select 1 from store_orders so
          where so.order_id = o.id
            and (so.released_to_farmer_at is not null or so.group_deal_id is not null)
       )
   and not exists (select 1 from refunds r join payments p on p.id = r.payment_id where p.order_id = o.id);
