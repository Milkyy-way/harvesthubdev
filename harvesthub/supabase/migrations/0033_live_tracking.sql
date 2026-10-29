-- HarvestHub — live delivery tracking (Phase 2 of delivery; 0032 was Phase 1).
--
-- While a farmer's delivery run is in progress, their phone sends its
-- position to the API every ~15 seconds (also in the background, through an
-- Android foreground service with a visible notification). The customer
-- whose stop is NEXT sees it on a map with an arrival estimate; everyone
-- else on the run only sees "N stops before yours" — so nobody can watch
-- the farmer stop at other customers' homes.
--
-- Only the latest position is kept — no trail — and it is cleared the moment
-- the run completes. API-only, like the rest of delivery_runs (RLS on, no
-- policies).

alter table delivery_runs add column if not exists current_latitude double precision;
alter table delivery_runs add column if not exists current_longitude double precision;
alter table delivery_runs add column if not exists current_heading real; -- degrees from north, if the phone reports it
alter table delivery_runs add column if not exists location_updated_at timestamptz;

alter table delivery_runs drop constraint if exists delivery_runs_current_position_check;
alter table delivery_runs add constraint delivery_runs_current_position_check
  check (
    (current_latitude is null and current_longitude is null)
    or (current_latitude between -90 and 90 and current_longitude between -180 and 180)
  );
