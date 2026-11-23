-- 0043: photos on "Report a problem" (asked for 2026-11-21).
--
-- A customer can add up to 3 photos to a report (a squashed tomato, the
-- wrong item). They go in a PRIVATE bucket, in the customer's own folder:
-- problem-photos/{customer uid}/{store order id}/{1..3}.{ext}. HarvestHub
-- sees them through short-lived signed links (scripts/problems.py and the
-- alert email). They're deleted 120 days after the report (as long as a
-- bank dispute can come, like delivery photos), and with the account.

alter table problem_reports add column if not exists photo_paths text[] not null default '{}';
alter table problem_reports drop constraint if exists problem_reports_photo_count;
alter table problem_reports add constraint problem_reports_photo_count check (cardinality(photo_paths) <= 3);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'problem-photos', 'problem-photos', false, 10485760,
  array['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp']
)
on conflict (id) do nothing;

drop policy if exists "customers upload their problem photos" on storage.objects;
create policy "customers upload their problem photos"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'problem-photos' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "customers replace their problem photos" on storage.objects;
create policy "customers replace their problem photos"
  on storage.objects for update to authenticated
  using (bucket_id = 'problem-photos' and auth.uid()::text = (storage.foldername(name))[1])
  with check (bucket_id = 'problem-photos' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "customers view their problem photos" on storage.objects;
create policy "customers view their problem photos"
  on storage.objects for select to authenticated
  using (bucket_id = 'problem-photos' and auth.uid()::text = (storage.foldername(name))[1]);

-- Deleting an account: what they wrote, and the links to their photos (the
-- API deletes the files themselves, from the customer's folder).
create or replace function public.erase_problem_reports()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  update problem_reports set details = null, photo_paths = '{}' where customer_id = old.id;
  return old;
end;
$$;
