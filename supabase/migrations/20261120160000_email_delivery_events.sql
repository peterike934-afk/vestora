do $$
begin
  if current_user <> 'postgres' then
    raise exception 'Apply this migration as postgres so ledger and SECURITY DEFINER ownership cannot be weakened';
  end if;
end;
$$;

create table if not exists public.email_delivery_events (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  event_type text not null default 'welcome'
    check (event_type = 'welcome'),
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'failed', 'uncertain')),
  attempt_count integer not null default 0
    check (attempt_count >= 0),
  attempt_id uuid,
  provider_message_id text,
  failure_code text,
  provider_evidence text,
  recovery_note text,
  sending_started_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint email_delivery_events_user_event_unique unique (user_id, event_type)
);

alter table public.email_delivery_events
  add column if not exists attempt_count integer not null default 0,
  add column if not exists attempt_id uuid,
  add column if not exists provider_message_id text,
  add column if not exists failure_code text,
  add column if not exists provider_evidence text,
  add column if not exists recovery_note text,
  add column if not exists sending_started_at timestamptz;

alter table public.email_delivery_events
  drop constraint if exists email_delivery_events_status_check;

alter table public.email_delivery_events
  add constraint email_delivery_events_status_check
  check (status in ('pending', 'sending', 'sent', 'failed', 'uncertain'));

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conname = 'email_delivery_events_user_event_unique'
      and conrelid = 'public.email_delivery_events'::pg_catalog.regclass
  ) then
    alter table public.email_delivery_events
      add constraint email_delivery_events_user_event_unique unique (user_id, event_type);
  end if;
end;
$$;

create index if not exists email_delivery_events_stale_sending_idx
  on public.email_delivery_events (sending_started_at)
  where status = 'sending';

alter table public.email_delivery_events
  enable row level security;

revoke all on table public.email_delivery_events
  from public, anon, authenticated, service_role;

create or replace function public.claim_welcome_email(
  p_user_id uuid,
  p_attempt_id uuid
)
returns table (
  delivery_id uuid,
  attempt_count integer,
  attempt_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null or p_attempt_id is null then
    raise exception 'Welcome claim requires a user and attempt ID';
  end if;

  insert into public.email_delivery_events (user_id, event_type, status)
  values (p_user_id, 'welcome', 'pending')
  on conflict (user_id, event_type) do nothing;

  return query
  update public.email_delivery_events as event
  set status = 'sending',
      attempt_count = event.attempt_count + 1,
      attempt_id = p_attempt_id,
      sending_started_at = pg_catalog.now(),
      provider_message_id = null,
      failure_code = null,
      provider_evidence = null,
      recovery_note = null,
      updated_at = pg_catalog.now()
  where event.user_id = p_user_id
    and event.event_type = 'welcome'
    and event.status = 'pending'
  returning event.id, event.attempt_count, event.attempt_id;
end;
$$;

revoke all on function public.claim_welcome_email(uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.get_welcome_email_delivery_event(
  p_user_id uuid
)
returns table (
  event_type text,
  status text,
  attempt_count integer,
  attempt_id uuid,
  provider_message_id text,
  failure_code text,
  provider_evidence text,
  recovery_note text,
  sending_started_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
security definer
set search_path = ''
as $$
  select event.event_type,
         event.status,
         event.attempt_count,
         event.attempt_id,
         event.provider_message_id,
         event.failure_code,
         event.provider_evidence,
         event.recovery_note,
         event.sending_started_at,
         event.created_at,
         event.updated_at
  from public.email_delivery_events as event
  where event.user_id = p_user_id
    and event.event_type = 'welcome'
  limit 1;
$$;

revoke all on function public.get_welcome_email_delivery_event(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.complete_welcome_email(
  p_user_id uuid,
  p_attempt_id uuid,
  p_expected_attempt_count integer,
  p_status text,
  p_provider_message_id text,
  p_failure_code text
)
returns table (
  id uuid,
  attempt_count integer,
  attempt_id uuid,
  status text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null or p_attempt_id is null or p_expected_attempt_count is null
    or p_expected_attempt_count < 1
    or p_status is null or p_status not in ('sent', 'failed', 'uncertain') then
    raise exception 'Invalid welcome email completion status';
  end if;

  return query
  update public.email_delivery_events as event
  set status = p_status,
      provider_message_id = case
        when p_status = 'sent' then p_provider_message_id
        else null
      end,
      failure_code = case
        when p_status = 'sent' then null
        else p_failure_code
      end,
      sending_started_at = null,
      updated_at = pg_catalog.now()
  where event.user_id = p_user_id
    and event.event_type = 'welcome'
    and event.status = 'sending'
    and event.attempt_id = p_attempt_id
    and event.attempt_count = p_expected_attempt_count
  returning event.id, event.attempt_count, event.attempt_id, event.status;
end;
$$;

revoke all on function public.complete_welcome_email(uuid, uuid, integer, text, text, text)
  from public, anon, authenticated, service_role;

drop function if exists public.recover_stale_welcome_email(uuid, uuid, integer, integer, text, text);

create or replace function public.recover_stale_welcome_email(
  p_user_id uuid,
  p_attempt_id uuid,
  p_expected_attempt_count integer,
  p_lease_seconds integer,
  p_operator_label text,
  p_operator_note text
)
returns table (
  id uuid,
  attempt_count integer,
  attempt_id uuid,
  status text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null or p_attempt_id is null or p_expected_attempt_count is null
    or p_expected_attempt_count < 1
    or p_lease_seconds is null or p_lease_seconds < 60 or p_lease_seconds > 86400
    or nullif(pg_catalog.btrim(p_operator_label), '') is null
    or nullif(pg_catalog.btrim(p_operator_note), '') is null then
    raise exception 'Invalid stale welcome recovery parameters';
  end if;

  return query
  update public.email_delivery_events as event
  set status = 'uncertain',
      failure_code = 'stale_sending_lease',
      recovery_note = pg_catalog.left(
        pg_catalog.concat_ws(E'\n', nullif(event.recovery_note, ''),
          'Stale sending lease identified by ', pg_catalog.left(pg_catalog.btrim(p_operator_label), 200),
          ': ', pg_catalog.left(pg_catalog.btrim(p_operator_note), 500),
          '. Inspect Resend logs before reconciliation.'),
        2000
      ),
      sending_started_at = null,
      updated_at = pg_catalog.now()
  where event.user_id = p_user_id
    and event.event_type = 'welcome'
    and event.status = 'sending'
    and event.attempt_id = p_attempt_id
    and event.attempt_count = p_expected_attempt_count
    and event.sending_started_at is not null
    and event.sending_started_at <= pg_catalog.now() - pg_catalog.make_interval(secs => p_lease_seconds)
  returning event.id, event.attempt_count, event.attempt_id, event.status;
end;
$$;

revoke all on function public.recover_stale_welcome_email(uuid, uuid, integer, integer, text, text)
  from public, anon, authenticated, service_role;

drop function if exists public.reconcile_uncertain_welcome_email(uuid, uuid, integer, text, text, text, text, text);

create or replace function public.reconcile_uncertain_welcome_email(
  p_user_id uuid,
  p_attempt_id uuid,
  p_expected_attempt_count integer,
  p_outcome text,
  p_provider_message_id text,
  p_provider_evidence text,
  p_operator_label text,
  p_operator_note text
)
returns table (
  id uuid,
  attempt_count integer,
  attempt_id uuid,
  status text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null or p_attempt_id is null or p_expected_attempt_count is null
    or p_expected_attempt_count < 1
    or p_outcome is null or p_outcome not in ('accepted', 'not_accepted')
    or nullif(pg_catalog.btrim(p_provider_evidence), '') is null
    or nullif(pg_catalog.btrim(p_operator_label), '') is null
    or nullif(pg_catalog.btrim(p_operator_note), '') is null then
    raise exception 'Invalid uncertain welcome reconciliation parameters';
  end if;

  return query
  update public.email_delivery_events as event
  set status = case when p_outcome = 'accepted' then 'sent' else 'failed' end,
      provider_message_id = case
        when p_outcome = 'accepted' then coalesce(p_provider_message_id, event.provider_message_id)
        else event.provider_message_id
      end,
      failure_code = case
        when p_outcome = 'accepted' then null
        else 'operator_confirmed_not_accepted'
      end,
      provider_evidence = pg_catalog.left(pg_catalog.btrim(p_provider_evidence), 500),
      recovery_note = pg_catalog.left(
        pg_catalog.concat_ws(E'\n', nullif(event.recovery_note, ''),
          'Reconciled by ', pg_catalog.left(pg_catalog.btrim(p_operator_label), 200),
          ': ', pg_catalog.left(pg_catalog.btrim(p_operator_note), 500)),
        2000
      ),
      updated_at = pg_catalog.now()
  where event.user_id = p_user_id
    and event.event_type = 'welcome'
    and event.status = 'uncertain'
    and event.attempt_id = p_attempt_id
    and event.attempt_count = p_expected_attempt_count
  returning event.id, event.attempt_count, event.attempt_id, event.status;
end;
$$;

revoke all on function public.reconcile_uncertain_welcome_email(uuid, uuid, integer, text, text, text, text, text)
  from public, anon, authenticated, service_role;

drop function if exists public.retry_failed_welcome_email(uuid, integer, uuid);
drop function if exists public.retry_failed_welcome_email(uuid, integer, uuid, boolean, text, text, text);

create or replace function public.retry_failed_welcome_email(
  p_user_id uuid,
  p_expected_attempt_count integer,
  p_attempt_id uuid,
  p_approved boolean,
  p_operator_label text,
  p_operator_note text,
  p_provider_evidence text
)
returns table (
  delivery_id uuid,
  attempt_count integer,
  attempt_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null or p_expected_attempt_count is null
    or p_expected_attempt_count < 1 or p_attempt_id is null
    or p_approved is distinct from true
    or nullif(pg_catalog.btrim(p_provider_evidence), '') is null
    or nullif(pg_catalog.btrim(p_operator_label), '') is null
    or nullif(pg_catalog.btrim(p_operator_note), '') is null then
    raise exception 'Retry requires explicit approval and evidence of non-acceptance';
  end if;

  return query
  update public.email_delivery_events as event
  set status = 'sending',
      attempt_count = event.attempt_count + 1,
      attempt_id = p_attempt_id,
      sending_started_at = pg_catalog.now(),
      provider_message_id = null,
      failure_code = null,
      provider_evidence = null,
      recovery_note = pg_catalog.left(
        pg_catalog.concat_ws(E'\n', nullif(event.recovery_note, ''),
          'Retry approved by ', pg_catalog.left(pg_catalog.btrim(p_operator_label), 200),
          ': ', pg_catalog.left(pg_catalog.btrim(p_operator_note), 500),
          '. Prior-attempt non-acceptance evidence: ',
          pg_catalog.left(pg_catalog.btrim(p_provider_evidence), 500)),
        2000
      ),
      updated_at = pg_catalog.now()
  where event.user_id = p_user_id
    and event.event_type = 'welcome'
    and event.status = 'failed'
    and event.attempt_count = p_expected_attempt_count
    and event.attempt_id is distinct from p_attempt_id
  returning event.id, event.attempt_count, event.attempt_id;
end;
$$;

revoke all on function public.retry_failed_welcome_email(uuid, integer, uuid, boolean, text, text, text)
  from public, anon, authenticated, service_role;

alter table public.email_delivery_events owner to postgres;
alter function public.claim_welcome_email(uuid, uuid) owner to postgres;
alter function public.get_welcome_email_delivery_event(uuid) owner to postgres;
alter function public.complete_welcome_email(uuid, uuid, integer, text, text, text) owner to postgres;
alter function public.recover_stale_welcome_email(uuid, uuid, integer, integer, text, text) owner to postgres;
alter function public.reconcile_uncertain_welcome_email(uuid, uuid, integer, text, text, text, text, text) owner to postgres;
alter function public.retry_failed_welcome_email(uuid, integer, uuid, boolean, text, text, text) owner to postgres;

revoke all on function public.claim_welcome_email(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.get_welcome_email_delivery_event(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.complete_welcome_email(uuid, uuid, integer, text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.recover_stale_welcome_email(uuid, uuid, integer, integer, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.reconcile_uncertain_welcome_email(uuid, uuid, integer, text, text, text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.retry_failed_welcome_email(uuid, integer, uuid, boolean, text, text, text)
  from public, anon, authenticated, service_role;

grant execute on function public.claim_welcome_email(uuid, uuid)
  to service_role;
grant execute on function public.get_welcome_email_delivery_event(uuid)
  to service_role;
grant execute on function public.complete_welcome_email(uuid, uuid, integer, text, text, text)
  to service_role;
grant execute on function public.recover_stale_welcome_email(uuid, uuid, integer, integer, text, text)
  to service_role;
grant execute on function public.reconcile_uncertain_welcome_email(uuid, uuid, integer, text, text, text, text, text)
  to service_role;
grant execute on function public.retry_failed_welcome_email(uuid, integer, uuid, boolean, text, text, text)
  to service_role;
