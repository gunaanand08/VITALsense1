-- CARDIOPULSE — Supabase schema
--
-- Paste this whole file into the Supabase SQL Editor of a fresh project and run
-- it once. It is idempotent: re-running it is safe.
--
-- What it creates
--   1. public.ecg_devices  — one row per heart-monitor board that has published.
--   2. public.ecg_batches  — the ECG sample batches the dashboard streams.
--   3. Read-only RLS for the anon key the browser ships with.
--   4. Realtime publication for ecg_batches.
--
-- Who writes
--   Nothing the browser can reach writes here. The browser holds the
--   publishable (anon) key, which is public by design, so its role is granted
--   SELECT only. Rows are inserted by `scripts/cloud-gateway.mjs`, which runs
--   with the secret key and is therefore the only writer.
--
-- These tables hold educational ECG traces, not medical records.

-- ---------------------------------------------------------------- tables

create table if not exists public.ecg_devices (
  device_id text primary key check (char_length(device_id) between 1 and 64),
  firmware_version text,
  sample_rate_hz integer check (sample_rate_hz between 100 and 2000),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- No foreign key to ecg_devices on purpose: a batch must never be rejected
-- because the gateway's device upsert lost a race with its first insert.
create table if not exists public.ecg_batches (
  id bigint generated always as identity primary key,
  device_id text not null check (char_length(device_id) between 1 and 64),
  -- Resets to 1 when a device reconnects, so it is per-connection, not global.
  sequence bigint not null check (sequence >= 0),
  sample_rate_hz integer not null check (sample_rate_hz between 100 and 2000),
  device_time_ms bigint not null default 0 check (device_time_ms >= 0),
  -- 12-bit ADC counts, 0..4095. The 512 cap matches MAX_BATCH_SAMPLES.
  -- Array values are range-checked in the client (parseBatchMessage); Postgres
  -- CHECK constraints cannot contain subqueries.
  samples smallint[] not null check (cardinality(samples) between 1 and 512),
  lead_off_positive boolean not null default false,
  lead_off_negative boolean not null default false,
  received_at timestamptz not null default now()
);

comment on table public.ecg_batches is
  'Raw ECG sample batches (12-bit ADC counts). Educational data, not a medical record.';

create index if not exists ecg_batches_device_idx on public.ecg_batches (device_id, id desc);
create index if not exists ecg_batches_received_idx on public.ecg_batches (received_at desc);

-- ------------------------------------------------------------ row security

alter table public.ecg_devices enable row level security;
alter table public.ecg_batches enable row level security;

-- The dashboard only ever reads. Both tables are granted to anon and
-- authenticated so the shipped publishable key can subscribe and hydrate.
grant select on public.ecg_devices to anon, authenticated;
grant select on public.ecg_batches to anon, authenticated;
revoke insert, update, delete on public.ecg_devices from anon, authenticated;
revoke insert, update, delete on public.ecg_batches from anon, authenticated;

drop policy if exists "public read devices" on public.ecg_devices;
create policy "public read devices"
  on public.ecg_devices for select
  to anon, authenticated
  using (true);

drop policy if exists "public read batches" on public.ecg_batches;
create policy "public read batches"
  on public.ecg_batches for select
  to anon, authenticated
  using (true);

-- No INSERT/UPDATE/DELETE policies exist for anon or authenticated: with RLS
-- enabled and no matching policy those statements are refused. The secret key
-- used by the gateway bypasses RLS by role (service_role).

-- --------------------------------------------------------------- realtime

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'ecg_batches'
  ) then
    alter publication supabase_realtime add table public.ecg_batches;
  end if;
end $$;

-- -------------------------------------------------------------- retention

-- A 500 Hz stream is ~45 MB/day at two batches a second, which outgrows a free
-- project quickly. Call this from a scheduled job when you want a rolling
-- window; it is not scheduled automatically.
create or replace function public.trim_ecg_batches(keep_hours integer default 24)
returns bigint
language sql
security definer
set search_path = public
as $$
  with deleted as (
    delete from public.ecg_batches
    where received_at < now() - make_interval(hours => keep_hours)
    returning 1
  )
  select count(*) from deleted;
$$;

revoke all on function public.trim_ecg_batches(integer) from anon, authenticated;

-- ------------------------------------------------------------------ verify

-- Expect one row, `rowsecurity = true`, and two SELECT policies.
select tablename, rowsecurity, policyname, cmd, roles
from pg_tables t
left join pg_policies p using (tablename)
where t.schemaname = 'public' and t.tablename in ('ecg_devices', 'ecg_batches');
