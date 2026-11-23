-- Referral programme: server-side attribution, admin rejection, transactional
-- notification ledger, and audited marketing consent.
--
-- Additive. Changes no existing row: existing referrals, balances, wallets,
-- transactions, audit records and accounts are untouched. New columns are
-- added with constant defaults (no table rewrite, no row update).
--
-- 1. Attribution happens only for accounts created after this migration:
--    the referral code in the signup metadata is captured ONCE, when the
--    auth.users row is inserted, and attributed only after the email is
--    verified. Later metadata edits are ignored. Device-independent and
--    idempotent. Nothing here can make signup or verification fail: every
--    trigger traps its own errors and records them for admins.
-- 2. apply_referral_code (client-side, any time) is withdrawn.
-- 3. referrals gains a 'rejected' status with review fields; private admin
--    notes live in a separate admin-only table. pay_referral is unchanged
--    and already refuses anything that is not 'pending'.
-- 4. notification_deliveries: one row per email, same state machine as the
--    welcome-email ledger (pending -> sending -> sent / failed / uncertain,
--    plus skipped). Enqueued by trigger in the same transaction as the
--    referral change; an enqueue problem can never fail that change.
-- 5. Marketing consent is separate from account notifications, defaults to
--    no consent, changes only through audited functions, and customers can
--    no longer edit referral_code, referred_by or consent directly.
--
-- Requires 20261124000000_pay_referral.sql.

do $$
declare
  v_missing text;
begin
  if current_user <> 'postgres' then
    raise exception 'Apply this migration as postgres';
  end if;
  if to_regprocedure('public.pay_referral(bigint)') is null then
    raise exception 'Apply 20261124000000_pay_referral.sql first';
  end if;
  if not pg_catalog.has_table_privilege('postgres', 'auth.users', 'TRIGGER') then
    raise exception 'postgres cannot create triggers on auth.users';
  end if;

  select string_agg(w.tbl || '.' || w.col, ', ') into v_missing
  from (values ('auth', 'users', 'id'), ('auth', 'users', 'email_confirmed_at'), ('auth', 'users', 'raw_user_meta_data'),
               ('public', 'profiles', 'referral_code'), ('public', 'profiles', 'referred_by'),
               ('public', 'profiles', 'email_notifications'), ('public', 'profiles', 'status'), ('public', 'profiles', 'role'),
               ('public', 'settings', 'referral_program_enabled'), ('public', 'settings', 'referral_referrer_bonus_usd'),
               ('public', 'settings', 'referral_referred_bonus_usd')) w(sch, tbl, col)
  where not exists (select 1 from information_schema.columns c
                    where c.table_schema = w.sch and c.table_name = w.tbl and c.column_name = w.col);
  if v_missing is not null then
    raise exception 'Expected columns missing: %', v_missing;
  end if;

  if pg_catalog.pg_get_constraintdef((select oid from pg_catalog.pg_constraint
        where conrelid = 'public.referrals'::regclass and conname = 'referrals_status_check'))
     is distinct from 'CHECK ((status = ANY (ARRAY[''pending''::text, ''paid''::text])))' then
    raise exception 'referrals_status_check is not the expected (pending, paid) constraint';
  end if;

  if exists (select 1 from information_schema.columns where table_schema = 'public'
             and ((table_name = 'profiles' and column_name in ('marketing_consent', 'marketing_consent_updated_at'))
               or (table_name = 'referrals' and column_name in ('reviewed_by', 'reviewed_at', 'rejection_reason')))) then
    raise exception 'Referral programme columns already exist: this migration was applied before';
  end if;
end;
$$;

-- ===========================================================================
-- 3. Referral review: rejected status, public reason, private notes
-- ===========================================================================
alter table public.referrals drop constraint referrals_status_check;
alter table public.referrals add constraint referrals_status_check
  check (status in ('pending', 'paid', 'rejected'));

alter table public.referrals
  add column reviewed_by uuid references public.profiles (id),
  add column reviewed_at timestamptz,
  add column rejection_reason text;

-- Neutral, customer-safe reasons only; details go to referral_review_notes.
alter table public.referrals add constraint referrals_rejection_reason_check
  check (rejection_reason is null or rejection_reason in ('not_eligible', 'duplicate_account', 'terms_not_met', 'other'));
alter table public.referrals add constraint referrals_rejection_complete_check
  check (status <> 'rejected' or (reviewed_by is not null and reviewed_at is not null and rejection_reason is not null));

create table public.referral_review_notes (
  id bigint generated always as identity primary key,
  referral_id bigint not null references public.referrals (id),
  admin_id uuid not null references public.profiles (id),
  note text not null check (pg_catalog.length(pg_catalog.btrim(note)) between 1 and 2000),
  created_at timestamptz not null default pg_catalog.now()
);
alter table public.referral_review_notes enable row level security;
revoke all on table public.referral_review_notes from public, anon, authenticated, service_role;
grant select on table public.referral_review_notes to authenticated;
create policy "Admins can read referral review notes" on public.referral_review_notes
  for select to authenticated using (public.is_admin());

-- ===========================================================================
-- 4. Notification ledger (welcome-email pattern, one row per email)
-- ===========================================================================
create table public.notification_deliveries (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  delivery_key text not null unique,
  category text not null check (category in ('transactional', 'marketing')),
  event_type text not null check (event_type in (
    'referral_registered_referrer', 'referral_registered_referred',
    'referral_paid_referrer', 'referral_paid_referred',
    'referral_rejected_referrer', 'referral_rejected_referred',
    'referral_admin_attention', 'campaign_referral_launch')),
  recipient_user_id uuid not null references public.profiles (id) on delete cascade,
  referral_id bigint references public.referrals (id),
  campaign_key text,
  -- Amounts and public reason codes only. Never private notes or PII.
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'failed', 'uncertain', 'skipped')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  attempt_id uuid,
  provider_message_id text,
  failure_code text,
  provider_evidence text,
  recovery_note text,
  skip_reason text,
  sending_started_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint notification_deliveries_campaign_check
    check ((category = 'marketing') = (campaign_key is not null))
);
create index notification_deliveries_pending_idx on public.notification_deliveries (created_at) where status = 'pending';
create index notification_deliveries_sending_idx on public.notification_deliveries (sending_started_at) where status = 'sending';
alter table public.notification_deliveries enable row level security;
revoke all on table public.notification_deliveries from public, anon, authenticated, service_role;
grant select on table public.notification_deliveries to authenticated;
create policy "Admins can read notification deliveries" on public.notification_deliveries
  for select to authenticated using (public.is_admin());

-- Inserts one ledger row; never raises (an email must never block the
-- referral change that caused it).
create or replace function public._enqueue_notification(
  p_delivery_key text, p_event_type text, p_recipient uuid, p_referral_id bigint, p_payload jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_recipient is null then
    return;
  end if;
  insert into public.notification_deliveries (delivery_key, category, event_type, recipient_user_id, referral_id, payload)
  values (p_delivery_key, 'transactional', p_event_type, p_recipient, p_referral_id, coalesce(p_payload, '{}'::jsonb))
  on conflict (delivery_key) do nothing;
exception when others then
  null;
end;
$$;

-- Referral lifecycle -> notifications, plus review fields on payment.
create or replace function public._referral_review_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Paid through pay_referral: record the paying admin as the reviewer.
  if new.status = 'paid' and old.status = 'pending' and new.reviewed_by is null then
    new.reviewed_by := auth.uid();
    new.reviewed_at := pg_catalog.now();
  end if;
  return new;
end;
$$;

create or replace function public._referral_notifications()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.status = 'pending' then
    perform public._enqueue_notification('referral:' || new.id || ':registered:referrer', 'referral_registered_referrer',
      new.referrer_id, new.id, pg_catalog.jsonb_build_object('referral_id', new.id));
    perform public._enqueue_notification('referral:' || new.id || ':registered:referred', 'referral_registered_referred',
      new.referred_id, new.id, pg_catalog.jsonb_build_object('referral_id', new.id));
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'paid' then
    if new.referrer_bonus_usd > 0 then
      perform public._enqueue_notification('referral:' || new.id || ':paid:referrer', 'referral_paid_referrer',
        new.referrer_id, new.id, pg_catalog.jsonb_build_object('referral_id', new.id, 'amount_usd', new.referrer_bonus_usd));
    end if;
    if new.referred_bonus_usd > 0 then
      perform public._enqueue_notification('referral:' || new.id || ':paid:referred', 'referral_paid_referred',
        new.referred_id, new.id, pg_catalog.jsonb_build_object('referral_id', new.id, 'amount_usd', new.referred_bonus_usd));
    end if;
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'rejected' then
    perform public._enqueue_notification('referral:' || new.id || ':rejected:referrer', 'referral_rejected_referrer',
      new.referrer_id, new.id, pg_catalog.jsonb_build_object('referral_id', new.id, 'reason', new.rejection_reason));
    perform public._enqueue_notification('referral:' || new.id || ':rejected:referred', 'referral_rejected_referred',
      new.referred_id, new.id, pg_catalog.jsonb_build_object('referral_id', new.id, 'reason', new.rejection_reason));
  end if;
  return null;
exception when others then
  return null;
end;
$$;

create trigger vestora_referral_review_fields before update of status on public.referrals
  for each row execute function public._referral_review_fields();
create trigger vestora_referral_notifications after insert or update of status on public.referrals
  for each row execute function public._referral_notifications();

-- ===========================================================================
-- 1. Server-side attribution
-- ===========================================================================
create table public.referral_signup_intents (
  user_id uuid primary key references auth.users (id) on delete cascade,
  referral_code text not null,
  status text not null default 'captured'
    check (status in ('captured', 'attributed', 'not_attributed', 'error')),
  outcome text check (outcome in ('attributed', 'program_disabled', 'invalid_code', 'unknown_code',
                                  'self_referral', 'already_referred', 'processing_error')),
  referral_id bigint references public.referrals (id),
  error_sqlstate text,
  captured_at timestamptz not null default pg_catalog.now(),
  processed_at timestamptz
);
alter table public.referral_signup_intents enable row level security;
revoke all on table public.referral_signup_intents from public, anon, authenticated, service_role;
grant select on table public.referral_signup_intents to authenticated;
create policy "Admins can read referral signup intents" on public.referral_signup_intents
  for select to authenticated using (public.is_admin());

-- Attributes a captured intent once the account is verified and its profile
-- exists. Safe to call any number of times, from any of the three triggers.
create or replace function public._referral_process_intent(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_intent public.referral_signup_intents%rowtype;
  v_confirmed timestamptz;
  v_enabled boolean;
  v_referrer_bonus numeric;
  v_referred_bonus numeric;
  v_referrer uuid;
  v_referral_id bigint;
  v_outcome text;
  v_state text;
  v_admin record;
begin
  select * into v_intent from public.referral_signup_intents where user_id = p_user_id for update;
  if not found or v_intent.status <> 'captured' then
    return;
  end if;

  select u.email_confirmed_at into v_confirmed from auth.users u where u.id = p_user_id;
  if v_confirmed is null then
    return;  -- not verified yet: attribution waits for verification
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    return;  -- profile not created yet: the profile trigger will retry
  end if;

  begin
    if v_intent.referral_code !~ '^[A-Z0-9]{4,32}$' then
      v_outcome := 'invalid_code';
    else
      select s.referral_program_enabled, s.referral_referrer_bonus_usd, s.referral_referred_bonus_usd
        into v_enabled, v_referrer_bonus, v_referred_bonus
      from public.settings s where s.id = true;

      if not coalesce(v_enabled, false) then
        v_outcome := 'program_disabled';
      else
        select p.id into v_referrer from public.profiles p where p.referral_code = v_intent.referral_code;
        if v_referrer is null then
          v_outcome := 'unknown_code';
        elsif v_referrer = p_user_id then
          v_outcome := 'self_referral';
        elsif exists (select 1 from public.referrals r where r.referred_id = p_user_id)
           or exists (select 1 from public.profiles p where p.id = p_user_id and p.referred_by is not null) then
          v_outcome := 'already_referred';
        else
          -- Amounts are the live settings at attribution; pay_referral pays them.
          insert into public.referrals (referrer_id, referred_id, referrer_bonus_usd, referred_bonus_usd, status)
          values (v_referrer, p_user_id, v_referrer_bonus, v_referred_bonus, 'pending')
          returning id into v_referral_id;
          update public.profiles set referred_by = v_referrer where id = p_user_id;
          v_outcome := 'attributed';
        end if;
      end if;
    end if;

    update public.referral_signup_intents
    set status = case when v_outcome = 'attributed' then 'attributed' else 'not_attributed' end,
        outcome = v_outcome, referral_id = v_referral_id, processed_at = pg_catalog.now()
    where user_id = p_user_id;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    update public.referral_signup_intents
    set status = 'error', outcome = 'processing_error', error_sqlstate = v_state, processed_at = pg_catalog.now()
    where user_id = p_user_id;
    for v_admin in select p.id from public.profiles p where p.role = 'admin' loop
      perform public._enqueue_notification('intent:' || p_user_id || ':attention:' || v_admin.id, 'referral_admin_attention',
        v_admin.id, null, pg_catalog.jsonb_build_object('kind', 'attribution_error', 'sqlstate', v_state));
    end loop;
  end;
end;
$$;

-- auth.users AFTER INSERT: capture the code from the signup metadata once.
create or replace function public._referral_capture_signup_intent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text;
begin
  begin
    v_code := pg_catalog.upper(pg_catalog.btrim(coalesce(new.raw_user_meta_data ->> 'referral_code', '')));
    if v_code = '' then
      return new;
    end if;
    insert into public.referral_signup_intents (user_id, referral_code)
    values (new.id, pg_catalog.left(v_code, 64))
    on conflict (user_id) do nothing;
    perform public._referral_process_intent(new.id);
  exception when others then
    begin
      insert into public.referral_signup_intents (user_id, referral_code, status, outcome, error_sqlstate, processed_at)
      values (new.id, coalesce(nullif(pg_catalog.left(v_code, 64), ''), '?'), 'error', 'processing_error', sqlstate, pg_catalog.now())
      on conflict (user_id) do update
        set status = 'error', outcome = 'processing_error', error_sqlstate = excluded.error_sqlstate, processed_at = pg_catalog.now();
    exception when others then
      null;
    end;
  end;
  return new;
end;
$$;

-- auth.users AFTER UPDATE OF email_confirmed_at: attribute on verification.
create or replace function public._referral_on_email_confirmed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.email_confirmed_at is null and new.email_confirmed_at is not null then
    begin
      perform public._referral_process_intent(new.id);
    exception when others then
      null;
    end;
  end if;
  return new;
end;
$$;

-- profiles AFTER INSERT: covers the profile being created after the intent.
create or replace function public._referral_on_profile_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform public._referral_process_intent(new.id);
  exception when others then
    null;
  end;
  return null;
end;
$$;

create trigger vestora_referral_capture_intent after insert on auth.users
  for each row execute function public._referral_capture_signup_intent();
create trigger vestora_referral_on_email_confirmed after update of email_confirmed_at on auth.users
  for each row execute function public._referral_on_email_confirmed();
create trigger vestora_referral_on_profile_created after insert on public.profiles
  for each row execute function public._referral_on_profile_created();

-- ===========================================================================
-- Admin rejection
-- ===========================================================================
create or replace function public.reject_referral(p_referral_id bigint, p_reason text, p_private_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_referral public.referrals%rowtype;
begin
  if v_admin is null or not public.is_admin() then
    raise exception 'Only admins can reject referrals';
  end if;
  if p_reason is null or p_reason not in ('not_eligible', 'duplicate_account', 'terms_not_met', 'other') then
    raise exception 'Invalid rejection reason';
  end if;

  select * into v_referral from public.referrals where id = p_referral_id for update;
  if not found then
    raise exception 'Referral not found';
  end if;
  if v_referral.status = 'paid' then
    raise exception 'Already paid';
  end if;
  if v_referral.status = 'rejected' then
    raise exception 'Already rejected';
  end if;

  update public.referrals
  set status = 'rejected', reviewed_by = v_admin, reviewed_at = pg_catalog.now(), rejection_reason = p_reason
  where id = p_referral_id;

  if p_private_note is not null and pg_catalog.btrim(p_private_note) <> '' then
    insert into public.referral_review_notes (referral_id, admin_id, note)
    values (p_referral_id, v_admin, pg_catalog.left(pg_catalog.btrim(p_private_note), 2000));
  end if;

  perform public.log_admin_action(
    p_action => 'referral_rejected',
    p_target_user_id => v_referral.referrer_id,
    p_amount_usd => null,
    p_reason => pg_catalog.format('Referral #%s rejected (%s)', p_referral_id, p_reason),
    p_ip_address => null);

  return pg_catalog.jsonb_build_object('referralId', p_referral_id, 'status', 'rejected', 'reason', p_reason);
end;
$$;

-- Customer view of their own referrals (as referrer or as referred).
-- Public fields only; never review notes or reviewer identity.
create or replace function public.get_my_referral_history()
returns table (id bigint, my_role text, other_party_name text, status text, my_bonus_usd numeric,
               rejection_reason text, created_at timestamptz, reviewed_at timestamptz, paid_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id,
         case when r.referrer_id = auth.uid() then 'referrer' else 'referred' end,
         p.full_name,
         r.status,
         case when r.referrer_id = auth.uid() then r.referrer_bonus_usd else r.referred_bonus_usd end,
         r.rejection_reason, r.created_at, r.reviewed_at, r.paid_at
  from public.referrals r
  join public.profiles p on p.id = case when r.referrer_id = auth.uid() then r.referred_id else r.referrer_id end
  where auth.uid() is not null and (r.referrer_id = auth.uid() or r.referred_id = auth.uid())
  order by r.created_at desc;
$$;

-- ===========================================================================
-- Delivery ledger functions (service role only; used by the server sender)
-- ===========================================================================
-- Lists deliveries by status and category, so the transactional sender and
-- the campaign sender never pick up each other's emails, and stale
-- 'sending' rows can be found for recovery.
create or replace function public.list_notification_deliveries(
  p_status text, p_category text, p_limit integer default 50, p_campaign_key text default null
)
returns table (delivery_id uuid, campaign_key text, created_at timestamptz, sending_started_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select d.id, d.campaign_key, d.created_at, d.sending_started_at
  from public.notification_deliveries d
  where d.status = p_status and d.category = p_category
    and (p_campaign_key is null or d.campaign_key = p_campaign_key)
  order by d.created_at
  limit least(greatest(coalesce(p_limit, 50), 1), 500);
$$;

-- Campaign switch: every campaign starts PAUSED and sends nothing until an
-- admin resumes it. Pausing takes effect for every email not yet claimed.
create table public.marketing_campaign_controls (
  campaign_key text primary key check (campaign_key ~ '^[a-z0-9][a-z0-9-]{2,63}$'),
  paused boolean not null default true,
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default pg_catalog.now()
);
alter table public.marketing_campaign_controls enable row level security;
revoke all on table public.marketing_campaign_controls from public, anon, authenticated, service_role;
grant select on table public.marketing_campaign_controls to authenticated;
create policy "Admins can read campaign controls" on public.marketing_campaign_controls
  for select to authenticated using (public.is_admin());

create or replace function public.set_marketing_campaign_paused(p_campaign_key text, p_paused boolean, p_actor uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_paused is null or p_actor is null then
    raise exception 'Pause state and actor are required';
  end if;
  if not exists (select 1 from public.profiles where id = p_actor and role = 'admin') then
    raise exception 'Only admins can control campaigns';
  end if;
  update public.marketing_campaign_controls
  set paused = p_paused, updated_by = p_actor, updated_at = pg_catalog.now()
  where campaign_key = p_campaign_key;
  if not found then
    raise exception 'Unknown campaign';
  end if;
  return p_paused;
end;
$$;

-- Claims one pending delivery for sending. Re-checks the recipient's
-- preferences at claim time: transactional emails respect
-- email_notifications; marketing emails require current marketing consent
-- and an active account. Ineligible deliveries become 'skipped'.
create or replace function public.claim_notification_delivery(p_delivery_id uuid, p_attempt_id uuid)
returns table (delivery_id uuid, attempt_id uuid, attempt_count integer, event_type text, category text,
               recipient_user_id uuid, referral_id bigint, campaign_key text, payload jsonb)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_d public.notification_deliveries%rowtype;
  v_p public.profiles%rowtype;
  v_skip text;
begin
  if p_attempt_id is null then
    raise exception 'attempt id required';
  end if;
  select * into v_d from public.notification_deliveries where id = p_delivery_id for update;
  if not found or v_d.status <> 'pending' then
    return;
  end if;

  -- A paused (or unknown) campaign sends nothing; the email stays pending.
  if v_d.category = 'marketing' and coalesce((select c.paused from public.marketing_campaign_controls c
                                              where c.campaign_key = v_d.campaign_key), true) then
    return;
  end if;

  select * into v_p from public.profiles where id = v_d.recipient_user_id;
  if v_d.category = 'transactional' and not v_p.email_notifications then
    v_skip := 'notifications_disabled';
  elsif v_d.category = 'marketing' and (not v_p.marketing_consent or v_p.status <> 'active') then
    v_skip := 'no_marketing_consent';
  elsif not exists (select 1 from auth.users u where u.id = v_d.recipient_user_id and u.email_confirmed_at is not null) then
    v_skip := 'email_not_verified';
  end if;

  if v_skip is not null then
    update public.notification_deliveries set status = 'skipped', skip_reason = v_skip, updated_at = pg_catalog.now()
    where id = p_delivery_id;
    return;
  end if;

  update public.notification_deliveries d
  set status = 'sending', attempt_id = p_attempt_id, attempt_count = d.attempt_count + 1,
      sending_started_at = pg_catalog.now(), failure_code = null, updated_at = pg_catalog.now()
  where d.id = p_delivery_id;

  return query
    select d.id, d.attempt_id, d.attempt_count, d.event_type, d.category, d.recipient_user_id, d.referral_id, d.campaign_key, d.payload
    from public.notification_deliveries d where d.id = p_delivery_id;
end;
$$;

-- Records the provider outcome of the current attempt only.
create or replace function public.complete_notification_delivery(
  p_delivery_id uuid, p_attempt_id uuid, p_expected_attempt_count integer,
  p_outcome text, p_provider_message_id text default null, p_failure_code text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_outcome not in ('sent', 'failed', 'uncertain') then
    raise exception 'Invalid outcome';
  end if;
  update public.notification_deliveries
  set status = p_outcome,
      provider_message_id = coalesce(p_provider_message_id, provider_message_id),
      failure_code = case when p_outcome = 'sent' then null else pg_catalog.left(p_failure_code, 200) end,
      updated_at = pg_catalog.now()
  where id = p_delivery_id and status = 'sending'
    and attempt_id = p_attempt_id and attempt_count = p_expected_attempt_count;
  return found;
end;
$$;

-- A 'sending' row older than the threshold becomes 'uncertain' (never
-- resent automatically: the provider may have delivered it).
create or replace function public.recover_stale_notification_delivery(p_delivery_id uuid, p_stale_after_minutes integer default 15)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.notification_deliveries
  set status = 'uncertain', failure_code = 'stale_sending', updated_at = pg_catalog.now()
  where id = p_delivery_id and status = 'sending'
    and sending_started_at < pg_catalog.now() - pg_catalog.make_interval(mins => greatest(coalesce(p_stale_after_minutes, 15), 5));
  return found;
end;
$$;

-- Explicitly approved retry. 'failed' needs an operator and a note;
-- 'uncertain' additionally needs provider evidence that it was not delivered.
create or replace function public.retry_notification_delivery(
  p_delivery_id uuid, p_operator text, p_note text, p_provider_evidence text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if p_operator is null or pg_catalog.btrim(p_operator) = '' or p_note is null or pg_catalog.btrim(p_note) = '' then
    raise exception 'Retry requires an operator and a note';
  end if;
  select status into v_status from public.notification_deliveries where id = p_delivery_id for update;
  if v_status = 'uncertain' and (p_provider_evidence is null or pg_catalog.btrim(p_provider_evidence) = '') then
    raise exception 'Retrying an uncertain delivery requires provider evidence that it was not delivered';
  end if;
  if v_status is null or v_status not in ('failed', 'uncertain') then
    return false;
  end if;
  update public.notification_deliveries
  set status = 'pending',
      recovery_note = pg_catalog.left(pg_catalog.format('%s: %s', pg_catalog.btrim(p_operator), pg_catalog.btrim(p_note)), 1000),
      provider_evidence = coalesce(pg_catalog.left(p_provider_evidence, 1000), provider_evidence),
      updated_at = pg_catalog.now()
  where id = p_delivery_id;
  return true;
end;
$$;

-- ===========================================================================
-- 5. Marketing consent
-- ===========================================================================
alter table public.profiles
  add column marketing_consent boolean not null default false,
  add column marketing_consent_updated_at timestamptz;

create table public.marketing_consent_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  granted boolean not null,
  source text not null check (source in ('settings', 'announcement_prompt', 'unsubscribe_link')),
  actor_id uuid,
  created_at timestamptz not null default pg_catalog.now()
);
create index marketing_consent_events_user_idx on public.marketing_consent_events (user_id, created_at);
alter table public.marketing_consent_events enable row level security;
revoke all on table public.marketing_consent_events from public, anon, authenticated, service_role;
grant select on table public.marketing_consent_events to authenticated;
create policy "Users can read their own consent history" on public.marketing_consent_events
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

-- Customers (and the service role) cannot change referral or consent fields
-- directly: only SECURITY DEFINER functions owned by postgres can.
create or replace function public._guard_profile_referral_and_consent()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user <> 'postgres' then
    if tg_op = 'INSERT' then
      if new.marketing_consent or new.marketing_consent_updated_at is not null or new.referred_by is not null then
        raise exception 'Referral and marketing consent fields can only be set by Vestora';
      end if;
    elsif new.referral_code is distinct from old.referral_code
       or new.referred_by is distinct from old.referred_by
       or new.marketing_consent is distinct from old.marketing_consent
       or new.marketing_consent_updated_at is distinct from old.marketing_consent_updated_at then
      raise exception 'Referral and marketing consent fields can only be changed through Vestora''s controlled functions';
    end if;
  end if;
  return new;
end;
$$;
create trigger vestora_guard_profile_referral_and_consent before insert or update on public.profiles
  for each row execute function public._guard_profile_referral_and_consent();

create or replace function public.set_my_marketing_consent(p_granted boolean, p_source text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_current boolean;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;
  if p_granted is null or p_source is null or p_source not in ('settings', 'announcement_prompt') then
    raise exception 'Invalid consent request';
  end if;
  select marketing_consent into v_current from public.profiles where id = v_user for update;
  if not found then
    raise exception 'Profile not found';
  end if;
  if v_current is distinct from p_granted then
    update public.profiles set marketing_consent = p_granted, marketing_consent_updated_at = pg_catalog.now() where id = v_user;
    insert into public.marketing_consent_events (user_id, granted, source, actor_id) values (v_user, p_granted, p_source, v_user);
  end if;
  return pg_catalog.jsonb_build_object('marketingConsent', p_granted, 'changed', v_current is distinct from p_granted);
end;
$$;

-- Unsubscribe link (the server verifies the signed token first).
create or replace function public.record_marketing_unsubscribe(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current boolean;
begin
  select marketing_consent into v_current from public.profiles where id = p_user_id for update;
  if not found or not v_current then
    return false;
  end if;
  update public.profiles set marketing_consent = false, marketing_consent_updated_at = pg_catalog.now() where id = p_user_id;
  insert into public.marketing_consent_events (user_id, granted, source, actor_id) values (p_user_id, false, 'unsubscribe_link', null);
  return true;
end;
$$;

-- Dry run: exactly the recipients enqueue_marketing_campaign would queue now
-- (active, verified customers with current marketing consent). Read-only.
create or replace function public.preview_marketing_campaign_recipients()
returns table (recipient_user_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.role = 'user' and p.status = 'active' and p.marketing_consent and u.email_confirmed_at is not null
  order by p.id;
$$;

-- Promotional campaign queue: only active, verified customers with current
-- marketing consent. One delivery per customer per campaign. Consent is
-- re-checked again when each email is claimed.
create or replace function public.enqueue_marketing_campaign(p_campaign_key text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_campaign_key is null or p_campaign_key !~ '^[a-z0-9][a-z0-9-]{2,63}$' then
    raise exception 'Invalid campaign key';
  end if;
  -- Every campaign starts paused; nothing is sent until an admin resumes it.
  insert into public.marketing_campaign_controls (campaign_key) values (p_campaign_key) on conflict (campaign_key) do nothing;
  insert into public.notification_deliveries (delivery_key, category, event_type, recipient_user_id, campaign_key, payload)
  select 'campaign:' || p_campaign_key || ':' || r.recipient_user_id, 'marketing', 'campaign_referral_launch', r.recipient_user_id, p_campaign_key, '{}'::jsonb
  from public.preview_marketing_campaign_recipients() r
  on conflict (delivery_key) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ===========================================================================
-- 2. Withdraw the client-side, any-time attribution function
-- ===========================================================================
revoke all on function public.apply_referral_code(text) from public, anon, authenticated, service_role;

-- ===========================================================================
-- Ownership and permissions
-- ===========================================================================
alter function public._enqueue_notification(text, text, uuid, bigint, jsonb) owner to postgres;
alter function public._referral_review_fields() owner to postgres;
alter function public._referral_notifications() owner to postgres;
alter function public._referral_process_intent(uuid) owner to postgres;
alter function public._referral_capture_signup_intent() owner to postgres;
alter function public._referral_on_email_confirmed() owner to postgres;
alter function public._referral_on_profile_created() owner to postgres;
alter function public._guard_profile_referral_and_consent() owner to postgres;
alter function public.reject_referral(bigint, text, text) owner to postgres;
alter function public.get_my_referral_history() owner to postgres;
alter function public.list_notification_deliveries(text, text, integer, text) owner to postgres;
alter function public.set_marketing_campaign_paused(text, boolean, uuid) owner to postgres;
alter function public.preview_marketing_campaign_recipients() owner to postgres;
alter function public.claim_notification_delivery(uuid, uuid) owner to postgres;
alter function public.complete_notification_delivery(uuid, uuid, integer, text, text, text) owner to postgres;
alter function public.recover_stale_notification_delivery(uuid, integer) owner to postgres;
alter function public.retry_notification_delivery(uuid, text, text, text) owner to postgres;
alter function public.set_my_marketing_consent(boolean, text) owner to postgres;
alter function public.record_marketing_unsubscribe(uuid) owner to postgres;
alter function public.enqueue_marketing_campaign(text) owner to postgres;

revoke all on function
  public._enqueue_notification(text, text, uuid, bigint, jsonb),
  public._referral_review_fields(),
  public._referral_notifications(),
  public._referral_process_intent(uuid),
  public._referral_capture_signup_intent(),
  public._referral_on_email_confirmed(),
  public._referral_on_profile_created(),
  public._guard_profile_referral_and_consent(),
  public.reject_referral(bigint, text, text),
  public.get_my_referral_history(),
  public.list_notification_deliveries(text, text, integer, text),
  public.set_marketing_campaign_paused(text, boolean, uuid),
  public.preview_marketing_campaign_recipients(),
  public.claim_notification_delivery(uuid, uuid),
  public.complete_notification_delivery(uuid, uuid, integer, text, text, text),
  public.recover_stale_notification_delivery(uuid, integer),
  public.retry_notification_delivery(uuid, text, text, text),
  public.set_my_marketing_consent(boolean, text),
  public.record_marketing_unsubscribe(uuid),
  public.enqueue_marketing_campaign(text)
from public, anon, authenticated, service_role;

grant execute on function
  public.reject_referral(bigint, text, text),
  public.get_my_referral_history(),
  public.set_my_marketing_consent(boolean, text)
to authenticated;

grant execute on function
  public.list_notification_deliveries(text, text, integer, text),
  public.set_marketing_campaign_paused(text, boolean, uuid),
  public.preview_marketing_campaign_recipients(),
  public.claim_notification_delivery(uuid, uuid),
  public.complete_notification_delivery(uuid, uuid, integer, text, text, text),
  public.recover_stale_notification_delivery(uuid, integer),
  public.retry_notification_delivery(uuid, text, text, text),
  public.record_marketing_unsubscribe(uuid),
  public.enqueue_marketing_campaign(text)
to service_role;
