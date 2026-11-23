-- Referral payout freeze enforced in the database, a write guard on
-- referrals, and notification/campaign hardening for the referral programme.
--
-- Changes no existing row in any existing table: referrals, balances,
-- wallets, transactions, investments, audit records, accounts, deliveries
-- and consent records are untouched. It adds two small control tables (one
-- switch row, OFF) and two append-only event tables, replaces two function
-- bodies, and adds triggers and functions.
--
-- 1. PAYOUT FREEZE. public.pay_referral refuses to pay unless
--    public.referral_payout_controls.payouts_enabled is true. The switch is
--    created FALSE, and nothing in this migration turns it on. The check runs
--    inside pay_referral, so calling the function directly through Supabase
--    (PostgREST RPC with an admin's session) cannot bypass it. Apart from the
--    inserted check, pay_referral is the 20261124000000 version exactly:
--    the same admin check, referral row lock, idempotent request IDs,
--    recovery of earlier partial payments, audit entries and all-or-nothing
--    transaction. The switch row is read FOR SHARE, so turning payouts off
--    waits for payments already in progress and every later payment sees
--    the new value.
-- 2. DELIBERATE, AUDITED ENABLING. Only an operator connected as postgres
--    can change the switch, through
--      public.set_referral_payouts_enabled(enabled, operator, reason, confirmation)
--    Enabling also needs the exact confirmation 'ENABLE REFERRAL PAYOUTS'.
--    Every change is written to referral_payout_control_events, which is
--    append-only. Direct edits of the switch row are refused. Admins can read
--    both tables; no client role can change them.
-- 3. WRITE GUARD ON public.referrals. Only Vestora's functions owned by
--    postgres (pay_referral, reject_referral and signup attribution) can
--    insert, update or delete referral rows. Customers, admins and the
--    service role cannot edit amounts, statuses or recipients directly,
--    whatever the table's RLS policies and grants are. While payouts are
--    frozen, a change to 'paid' is refused for everyone, postgres included,
--    so no "paid" email can go out for a payment that did not happen.
-- 4. public.release_notification_delivery returns a claimed email to
--    'pending' when the sender could not look up the recipient. Nothing has
--    been sent to the provider at that point, so it is safe to try again.
--    After 5 attempts it becomes 'failed' for an admin to review.
-- 5. CAMPAIGN AUDIT TRAIL. marketing_campaign_events records which admin
--    queued, paused or resumed a campaign. enqueue_marketing_campaign gains
--    an admin parameter; the old one-argument form is no longer executable
--    by the service role.
--
-- Requires 20261125000000_referral_programme.sql. Apply it AFTER that
-- migration and its verification (its kit checks pay_referral's 20261124
-- fingerprint). Rollback: supabase/rollback/20261126000000_referral_payout_freeze_rollback.sql.

do $$
declare
  v_fp record;
  v_triggers text;
begin
  if current_user <> 'postgres' then
    raise exception 'Apply this migration as postgres';
  end if;
  if to_regprocedure('public.reject_referral(bigint, text, text)') is null
     or to_regclass('public.notification_deliveries') is null then
    raise exception 'Apply 20261125000000_referral_programme.sql first';
  end if;
  if to_regclass('public.referral_payout_controls') is not null
     or to_regclass('public.referral_payout_control_events') is not null
     or to_regclass('public.marketing_campaign_events') is not null
     or to_regprocedure('public.set_referral_payouts_enabled(boolean, text, text, text)') is not null then
    raise exception 'Referral payout freeze objects already exist: this migration was applied before';
  end if;

  -- The function bodies this migration replaces or calls must be exactly the
  -- versions 20261124000000 and 20261125000000 created (md5 of the source
  -- without carriage returns). The Production functions they depend on
  -- (adjust_wallet_with_transaction, log_admin_action, is_admin) are
  -- fingerprinted by the release kit's read-only pre-flight.
  for v_fp in
    select f.sig, f.expected, md5(replace(p.prosrc, chr(13), '')) as actual
    from (values
      ('public.pay_referral(bigint)', '1ffe439817eee8875eea7b31ab33dafc'),
      ('public.set_marketing_campaign_paused(text, boolean, uuid)', '50c2c3e061ed90983fccf840f5169b39'),
      ('public.enqueue_marketing_campaign(text)', '24b33b4351f449697134220add5dbe8f')
    ) f(sig, expected)
    left join pg_catalog.pg_proc p on p.oid = to_regprocedure(f.sig)
  loop
    if v_fp.actual is distinct from v_fp.expected then
      raise exception '% differs from the reviewed version (md5 %, expected %)', v_fp.sig, coalesce(v_fp.actual, 'missing'), v_fp.expected;
    end if;
  end loop;

  -- The write guard relies on referral writes being made by functions owned
  -- by postgres; the table itself must be owned by postgres.
  if pg_catalog.pg_get_userbyid((select relowner from pg_catalog.pg_class where oid = 'public.referrals'::regclass)) <> 'postgres' then
    raise exception 'public.referrals must be owned by postgres';
  end if;

  -- Only the two referral-programme triggers may exist on referrals; any
  -- other trigger could write referrals in a way this migration has not reviewed.
  select string_agg(t.tgname, ', ' order by t.tgname) into v_triggers
  from pg_catalog.pg_trigger t
  where t.tgrelid = 'public.referrals'::regclass and not t.tgisinternal
    and t.tgname not in ('vestora_referral_review_fields', 'vestora_referral_notifications');
  if v_triggers is not null then
    raise exception 'Unexpected triggers on public.referrals: %', v_triggers;
  end if;
end;
$$;

-- ===========================================================================
-- 1-2. Payout switch (OFF) and its append-only change log
-- ===========================================================================
create table public.referral_payout_controls (
  id boolean primary key default true check (id),
  payouts_enabled boolean not null default false,
  updated_at timestamptz not null default pg_catalog.now(),
  updated_by text not null
);
insert into public.referral_payout_controls (id, payouts_enabled, updated_by)
values (true, false, 'migration 20261126000000');

create table public.referral_payout_control_events (
  id bigint generated always as identity primary key,
  payouts_enabled boolean not null,
  operator text not null check (pg_catalog.length(pg_catalog.btrim(operator)) between 1 and 200),
  reason text not null check (pg_catalog.length(pg_catalog.btrim(reason)) between 1 and 1000),
  database_user text not null default session_user,
  created_at timestamptz not null default pg_catalog.now()
);
insert into public.referral_payout_control_events (payouts_enabled, operator, reason)
values (false, 'migration 20261126000000', 'Referral payouts frozen by default when the database freeze was installed.');

alter table public.referral_payout_controls enable row level security;
alter table public.referral_payout_control_events enable row level security;
revoke all on table public.referral_payout_controls, public.referral_payout_control_events
  from public, anon, authenticated, service_role;
grant select on table public.referral_payout_controls, public.referral_payout_control_events to authenticated;
create policy "Admins can read the referral payout switch" on public.referral_payout_controls
  for select to authenticated using (public.is_admin());
create policy "Admins can read referral payout switch changes" on public.referral_payout_control_events
  for select to authenticated using (public.is_admin());

-- Changes to the switch row and its log only through set_referral_payouts_enabled,
-- which sets a transaction-local marker. The switch row can never be deleted,
-- and the log can never be edited or deleted.
create or replace function public._guard_referral_payout_controls()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op in ('DELETE', 'TRUNCATE') then
    raise exception 'The referral payout switch and its change log cannot be deleted';
  end if;
  if tg_table_name = 'referral_payout_control_events' and tg_op = 'UPDATE' then
    raise exception 'Referral payout switch changes are append-only';
  end if;
  if pg_catalog.current_setting('vestora.referral_payout_change', true) is distinct from 'authorised' then
    raise exception 'Use public.set_referral_payouts_enabled to change referral payouts';
  end if;
  return new;
end;
$$;

create trigger vestora_guard_referral_payout_controls
  before insert or update or delete on public.referral_payout_controls
  for each row execute function public._guard_referral_payout_controls();
create trigger vestora_guard_referral_payout_controls_truncate
  before truncate on public.referral_payout_controls
  for each statement execute function public._guard_referral_payout_controls();
create trigger vestora_guard_referral_payout_control_events
  before insert or update or delete on public.referral_payout_control_events
  for each row execute function public._guard_referral_payout_controls();
create trigger vestora_guard_referral_payout_control_events_truncate
  before truncate on public.referral_payout_control_events
  for each statement execute function public._guard_referral_payout_controls();

-- Reads the switch. FOR SHARE: a payment holds the row until it commits, so
-- turning payouts off waits for payments in progress. A missing row means OFF.
create or replace function public._referral_payouts_enabled()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enabled boolean;
begin
  select c.payouts_enabled into v_enabled
  from public.referral_payout_controls c
  where c.id
  for share;
  return coalesce(v_enabled, false);
end;
$$;

-- The only way to change the switch. Run as postgres, for example:
--   select public.set_referral_payouts_enabled(true, 'Jane Operator',
--     'Terms published; first approved batch', 'ENABLE REFERRAL PAYOUTS');
--   select public.set_referral_payouts_enabled(false, 'Jane Operator', 'Pause payouts');
create or replace function public.set_referral_payouts_enabled(
  p_enabled boolean, p_operator text, p_reason text, p_confirmation text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_current boolean;
begin
  if current_user <> 'postgres' then
    raise exception 'Only the database owner (postgres) can change referral payouts';
  end if;
  if p_enabled is null then
    raise exception 'State whether referral payouts are enabled (true) or disabled (false)';
  end if;
  if p_operator is null or pg_catalog.length(pg_catalog.btrim(p_operator)) not between 1 and 200 then
    raise exception 'An operator name (1-200 characters) is required';
  end if;
  if p_reason is null or pg_catalog.length(pg_catalog.btrim(p_reason)) not between 1 and 1000 then
    raise exception 'A reason (1-1000 characters) is required';
  end if;
  if p_enabled and p_confirmation is distinct from 'ENABLE REFERRAL PAYOUTS' then
    raise exception 'To enable referral payouts, pass the confirmation ''ENABLE REFERRAL PAYOUTS''';
  end if;

  select c.payouts_enabled into v_current
  from public.referral_payout_controls c
  where c.id
  for update;
  if not found then
    raise exception 'The referral payout switch row is missing; payouts stay disabled';
  end if;
  if v_current = p_enabled then
    return pg_catalog.jsonb_build_object('payoutsEnabled', v_current, 'changed', false);
  end if;

  perform pg_catalog.set_config('vestora.referral_payout_change', 'authorised', true);
  update public.referral_payout_controls
  set payouts_enabled = p_enabled, updated_at = pg_catalog.now(), updated_by = pg_catalog.btrim(p_operator)
  where id;
  insert into public.referral_payout_control_events (payouts_enabled, operator, reason)
  values (p_enabled, pg_catalog.btrim(p_operator), pg_catalog.btrim(p_reason));
  perform pg_catalog.set_config('vestora.referral_payout_change', '', true);

  return pg_catalog.jsonb_build_object('payoutsEnabled', p_enabled, 'changed', true);
end;
$$;

-- ===========================================================================
-- 1. pay_referral: the 20261124000000 version plus the freeze check
-- ===========================================================================
create or replace function public.pay_referral(p_referral_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin_id uuid := auth.uid();
  v_referral public.referrals%rowtype;
  v_credit record;
  v_request_id uuid;
  v_existing public.admin_wallet_adjustment_requests%rowtype;
  v_txn public.transactions%rowtype;
  v_result jsonb;
  v_credits jsonb := '[]'::jsonb;
begin
  if v_admin_id is null or not public.is_admin() then
    raise exception 'Only admins can pay referrals';
  end if;

  -- Payout freeze (20261126000000). Checked after the admin check and before
  -- the referral is locked or anything is credited. The switch row stays
  -- share-locked until this payment commits or rolls back.
  if not public._referral_payouts_enabled() then
    raise exception 'Referral payouts are disabled';
  end if;

  if p_referral_id is null then
    raise exception 'Referral ID is required';
  end if;

  -- Serialises every payer of this referral, whichever admin.
  select * into v_referral
  from public.referrals
  where id = p_referral_id
  for update;

  if not found then
    raise exception 'Referral not found';
  end if;
  if v_referral.status = 'paid' then
    raise exception 'Already paid';
  end if;
  if v_referral.status is distinct from 'pending' then
    raise exception 'Referral is not pending (status: %)', v_referral.status;
  end if;
  if v_referral.referrer_id is null or v_referral.referred_id is null then
    raise exception 'Referral % has a missing recipient; manual review required', p_referral_id;
  end if;
  if v_referral.referrer_id = v_referral.referred_id then
    raise exception 'Self-referrals cannot be paid';
  end if;
  -- numeric NaN compares greater than every number and round(NaN) = NaN, and
  -- numeric Infinity survives round(); neither may ever reach a credit.
  -- Checked on the text form, which works on every PostgreSQL version.
  if pg_catalog.lower(v_referral.referrer_bonus_usd::text) in ('nan', 'infinity', '-infinity')
     or pg_catalog.lower(v_referral.referred_bonus_usd::text) in ('nan', 'infinity', '-infinity') then
    raise exception 'Referral % has invalid bonus amounts; manual review required', p_referral_id;
  end if;
  if v_referral.referrer_bonus_usd is null or v_referral.referred_bonus_usd is null
     or v_referral.referrer_bonus_usd < 0 or v_referral.referred_bonus_usd < 0
     or v_referral.referrer_bonus_usd <> pg_catalog.round(v_referral.referrer_bonus_usd, 2)
     or v_referral.referred_bonus_usd <> pg_catalog.round(v_referral.referred_bonus_usd, 2) then
    raise exception 'Referral % has invalid bonus amounts; manual review required', p_referral_id;
  end if;

  for v_credit in
    select c.role, c.user_id, c.amount, c.reason
    from (values
      (1, 'referrer', v_referral.referrer_id, v_referral.referrer_bonus_usd, 'Referral bonus (you referred someone)'),
      (2, 'referred', v_referral.referred_id, v_referral.referred_bonus_usd, 'Referral bonus (you signed up with a code)')
    ) as c(ord, role, user_id, amount, reason)
    order by c.ord
  loop
    -- A zero bonus is not paid (same as the previous route).
    continue when v_credit.amount = 0;

    v_request_id := public.referral_payout_request_id(p_referral_id::text, v_credit.role);

    select * into v_existing
    from public.admin_wallet_adjustment_requests
    where request_id = v_request_id
    for update;

    if found then
      -- An earlier credit exists (e.g. a partial payment by the previous
      -- route). Accept it only if every detail proves it is this credit,
      -- completed; never credit again to compensate.
      if v_existing.user_id is distinct from v_credit.user_id
         or v_existing.adjustment_type is distinct from 'credit'
         or v_existing.amount is distinct from v_credit.amount
         or v_existing.reason is distinct from v_credit.reason
         or v_existing.transaction_id is null
         or v_existing.resulting_balance is null then
        raise exception 'Existing % credit % for referral % does not match; manual review required',
          v_credit.role, v_request_id, p_referral_id;
      end if;

      -- Locked so the record cannot change while it is being relied on; a
      -- concurrent edit is waited for and the current version is checked.
      select * into v_txn
      from public.transactions
      where id = v_existing.transaction_id
      for update;

      if not found
         or v_txn.user_id is distinct from v_credit.user_id
         or v_txn.amount_usd is distinct from v_credit.amount
         or v_txn.type is distinct from 'admin_credit'
         or v_txn.status is distinct from 'verified'
         or v_txn.verified_by is null
         or v_txn.verified_at is null
         or v_txn.verified_by is distinct from v_existing.admin_id
         or v_txn.admin_note is distinct from v_credit.reason then
        raise exception 'Transaction behind existing % credit % for referral % is missing or inconsistent; manual review required',
          v_credit.role, v_request_id, p_referral_id;
      end if;

      perform public.log_admin_action(
        p_action => 'referral_credit_recovered',
        p_target_user_id => v_credit.user_id,
        p_amount_usd => v_credit.amount,
        p_reason => pg_catalog.format(
          'Referral #%s: %s bonus %s verified as already credited by admin %s at %s (transaction %s, request %s); referral completed by this admin',
          p_referral_id, v_credit.role, v_credit.amount, v_txn.verified_by, v_txn.verified_at, v_txn.id, v_request_id),
        p_ip_address => null
      );

      v_credits := v_credits || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'role', v_credit.role, 'userId', v_credit.user_id, 'amountUsd', v_credit.amount,
        'transactionId', v_txn.id, 'created', false, 'creditedBy', v_txn.verified_by));
    else
      -- New credit through the unchanged adjustment function, as this admin.
      v_result := public.adjust_wallet_with_transaction(
        v_request_id, v_credit.user_id, 'credit', v_credit.amount, v_credit.reason);

      if (v_result ->> 'duplicate')::boolean then
        -- Only possible if a credit with this request ID was committed after
        -- the check above outside pay_referral (the previous route). Abort
        -- rather than guess; a retry will verify and recognise it.
        raise exception 'Concurrent referral credit detected for referral %; retry', p_referral_id;
      end if;

      perform public.log_admin_action(
        p_action => 'referral_paid',
        p_target_user_id => v_credit.user_id,
        p_amount_usd => v_credit.amount,
        p_reason => pg_catalog.format('Referral #%s: %s bonus %s credited (transaction %s, request %s)',
          p_referral_id, v_credit.role, v_credit.amount, v_result ->> 'transactionId', v_request_id),
        p_ip_address => null
      );

      v_credits := v_credits || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'role', v_credit.role, 'userId', v_credit.user_id, 'amountUsd', v_credit.amount,
        'transactionId', v_result ->> 'transactionId', 'created', true, 'creditedBy', v_admin_id));
    end if;
  end loop;

  -- Only after every credit and audit entry succeeded.
  update public.referrals
  set status = 'paid',
      paid_at = pg_catalog.now()
  where id = p_referral_id;

  return pg_catalog.jsonb_build_object(
    'referralId', p_referral_id,
    'status', 'paid',
    'credits', v_credits
  );
end;
$$;

-- ===========================================================================
-- 3. Write guard on public.referrals
-- ===========================================================================
-- SECURITY INVOKER on purpose: current_user is the role making the change.
-- Inside Vestora's SECURITY DEFINER functions (owned by postgres) it is
-- postgres; for a direct PostgREST or service-role write it is anon,
-- authenticated or service_role, and the write is refused.
create or replace function public._guard_referral_writes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('postgres', 'supabase_admin') then
    raise exception 'Referrals can only be changed through Vestora''s controlled functions';
  end if;
  if tg_op = 'UPDATE' and new.status = 'paid' and old.status is distinct from 'paid'
     and not public._referral_payouts_enabled() then
    raise exception 'Referral payouts are disabled';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger vestora_referral_write_guard
  before insert or update or delete on public.referrals
  for each row execute function public._guard_referral_writes();

-- ===========================================================================
-- 4. Return a claimed email to the queue when the recipient lookup failed
-- ===========================================================================
-- Only for the attempt that claimed it, and only while it is 'sending' (the
-- provider was not called). Attempt 5 or later becomes 'failed' instead, so a
-- persistent problem reaches an admin rather than looping forever.
create or replace function public.release_notification_delivery(
  p_delivery_id uuid, p_attempt_id uuid, p_expected_attempt_count integer, p_reason text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if p_reason is null or p_reason !~ '^[a-z][a-z_]{2,59}$' then
    raise exception 'Invalid release reason';
  end if;
  update public.notification_deliveries d
  set status = case when d.attempt_count >= 5 then 'failed' else 'pending' end,
      failure_code = case when d.attempt_count >= 5 then p_reason || '_repeated' else p_reason end,
      updated_at = pg_catalog.now()
  where d.id = p_delivery_id and d.status = 'sending'
    and d.attempt_id = p_attempt_id and d.attempt_count = p_expected_attempt_count
  returning d.status into v_status;
  return v_status;
end;
$$;

-- ===========================================================================
-- 5. Campaign audit trail
-- ===========================================================================
create table public.marketing_campaign_events (
  id bigint generated always as identity primary key,
  campaign_key text not null references public.marketing_campaign_controls (campaign_key),
  action text not null check (action in ('queued', 'paused', 'resumed')),
  actor_id uuid not null references public.profiles (id),
  queued_count integer check (queued_count is null or queued_count >= 0),
  created_at timestamptz not null default pg_catalog.now()
);
create index marketing_campaign_events_campaign_idx on public.marketing_campaign_events (campaign_key, created_at);
alter table public.marketing_campaign_events enable row level security;
revoke all on table public.marketing_campaign_events from public, anon, authenticated, service_role;
grant select on table public.marketing_campaign_events to authenticated;
create policy "Admins can read campaign events" on public.marketing_campaign_events
  for select to authenticated using (public.is_admin());

-- Same behaviour as the 20261125000000 version, plus one event per change.
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
  insert into public.marketing_campaign_events (campaign_key, action, actor_id)
  values (p_campaign_key, case when p_paused then 'paused' else 'resumed' end, p_actor);
  return p_paused;
end;
$$;

-- Queues the campaign (unchanged one-argument function) and records which
-- admin did it and how many emails were queued.
create or replace function public.enqueue_marketing_campaign(p_campaign_key text, p_actor uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_actor is null or not exists (select 1 from public.profiles where id = p_actor and role = 'admin') then
    raise exception 'Only admins can queue campaigns';
  end if;
  v_count := public.enqueue_marketing_campaign(p_campaign_key);
  insert into public.marketing_campaign_events (campaign_key, action, actor_id, queued_count)
  values (p_campaign_key, 'queued', p_actor, v_count);
  return v_count;
end;
$$;

-- ===========================================================================
-- Ownership and permissions
-- ===========================================================================
alter table public.referral_payout_controls owner to postgres;
alter table public.referral_payout_control_events owner to postgres;
alter table public.marketing_campaign_events owner to postgres;
alter function public._guard_referral_payout_controls() owner to postgres;
alter function public._referral_payouts_enabled() owner to postgres;
alter function public.set_referral_payouts_enabled(boolean, text, text, text) owner to postgres;
alter function public.pay_referral(bigint) owner to postgres;
alter function public._guard_referral_writes() owner to postgres;
alter function public.release_notification_delivery(uuid, uuid, integer, text) owner to postgres;
alter function public.set_marketing_campaign_paused(text, boolean, uuid) owner to postgres;
alter function public.enqueue_marketing_campaign(text, uuid) owner to postgres;

revoke all on function
  public._guard_referral_payout_controls(),
  public._referral_payouts_enabled(),
  public.set_referral_payouts_enabled(boolean, text, text, text),
  public.pay_referral(bigint),
  public._guard_referral_writes(),
  public.release_notification_delivery(uuid, uuid, integer, text),
  public.set_marketing_campaign_paused(text, boolean, uuid),
  public.enqueue_marketing_campaign(text, uuid),
  public.enqueue_marketing_campaign(text)
from public, anon, authenticated, service_role;

-- Unchanged from 20261124000000: admins call pay_referral with their own session.
grant execute on function public.pay_referral(bigint) to authenticated;

grant execute on function
  public.release_notification_delivery(uuid, uuid, integer, text),
  public.set_marketing_campaign_paused(text, boolean, uuid),
  public.enqueue_marketing_campaign(text, uuid)
to service_role;
