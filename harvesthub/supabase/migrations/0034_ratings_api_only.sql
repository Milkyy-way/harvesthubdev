-- HarvestHub — ratings can only be written through the API.
--
-- 0016's policy let a signed-in customer write any row with their own
-- customer_id straight through supabase-js, skipping the API's rule that you
-- can only rate your own completed order — so anyone could post a rating for
-- any farm without having ordered from it. The app has only ever gone through
-- POST /orders/{id}/store/{store_order_id}/rating, and FastAPI's connection
-- bypasses RLS, so nothing depends on the old policy. Customers can still read
-- their own ratings and farmers the ones about them (0016).

drop policy if exists "customers manage their own ratings" on farmer_ratings;

drop policy if exists "customers view their own ratings" on farmer_ratings;
create policy "customers view their own ratings"
  on farmer_ratings for select
  using (auth.uid() = customer_id);
