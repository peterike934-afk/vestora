-- Atomic referral payout: public.pay_referral(p_referral_id bigint).
--
-- Pays both referral bonuses, writes one audit entry per recipient and marks
-- the referral paid, all in ONE transaction. Any failure (missing wallet,
-- audit failure, inconsistent earlier credit) rolls the whole call back.
--
-- Credits use the existing public.adjust_wallet_with_transaction UNCHANGED,
-- with the same deterministic request IDs as lib/referralPayment.js
-- (sha256 'vestora:referral-payout:v1:<referral id>:<role>' as a version-5
-- UUID). A credit that already exists (e.g. from a partial payment by the
-- previous two-call route, possibly by another admin) is verified in full
-- and recognised instead of being credited again; anything inconsistent
-- aborts for manual review. The referral row lock serialises every payer of
-- the same referral.
--
-- PRECONDITIONS: the block below verifies, on the target database, every
-- assumption this function makes about objects that are not defined in this
-- repository (referrals, log_admin_action). If any differs, the migration
-- aborts and nothing is created. Review its messages before retrying.
--
-- Requires 20261120180000_admin_financial_safety.sql (adjust_wallet_with_transaction).

do $$
declare
  v_missing text;
  v_proc record;
  v_empty_search_path text;
  v_adjust_search_path text[];
begin
  if current_user <> 'postgres' then
    raise exception 'Apply this migration as postgres';
  end if;

  -- referrals: columns and types this function reads and writes.
  select string_agg(want.col || ' ' || want.typ, ', ') into v_missing
  from (values ('id', 'bigint'), ('referrer_id', 'uuid'), ('referred_id', 'uuid'),
               ('referrer_bonus_usd', 'numeric'), ('referred_bonus_usd', 'numeric'),
               ('status', 'text'), ('paid_at', 'timestamp with time zone')) as want(col, typ)
  where not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = 'referrals'
      and c.column_name = want.col and c.data_type = want.typ);
  if v_missing is not null then
    raise exception 'public.referrals does not match the expected columns/types: %', v_missing;
  end if;

  -- adjust_wallet_with_transaction: exact signature, owned by postgres,
  -- SECURITY DEFINER, with an empty search_path.
  if to_regprocedure('public.adjust_wallet_with_transaction(uuid, uuid, text, numeric, text)') is null then
    raise exception 'public.adjust_wallet_with_transaction(uuid, uuid, text, numeric, text) not found';
  end if;

  select p.proowner, p.prosecdef, p.proconfig into v_proc
  from pg_catalog.pg_proc p
  where p.oid = 'public.adjust_wallet_with_transaction(uuid, uuid, text, numeric, text)'::regprocedure;

  if pg_catalog.pg_get_userbyid(v_proc.proowner) <> 'postgres' then
    raise exception 'public.adjust_wallet_with_transaction must be owned by postgres (owner: %)',
      pg_catalog.pg_get_userbyid(v_proc.proowner);
  end if;

  if not v_proc.prosecdef then
    raise exception 'public.adjust_wallet_with_transaction must be SECURITY DEFINER';
  end if;

  -- How this server records "set search_path = ''" in pg_proc.proconfig is
  -- read from a throw-away temporary function rather than assumed.
  execute 'create function pg_temp.vestora_empty_search_path_probe() returns void '
       || 'language plpgsql set search_path = '''' as ''begin end''';
  select c into v_empty_search_path
  from pg_catalog.pg_proc p, pg_catalog.unnest(p.proconfig) c
  where p.oid = 'pg_temp.vestora_empty_search_path_probe()'::regprocedure
    and c like 'search_path=%';
  execute 'drop function pg_temp.vestora_empty_search_path_probe()';

  if v_empty_search_path is null then
    raise exception 'Could not determine how an empty search_path is recorded';
  end if;

  select pg_catalog.array_agg(c) into v_adjust_search_path
  from pg_catalog.unnest(v_proc.proconfig) c
  where c like 'search_path=%';

  if v_adjust_search_path is null
     or pg_catalog.cardinality(v_adjust_search_path) <> 1
     or v_adjust_search_path[1] <> v_empty_search_path then
    raise exception 'public.adjust_wallet_with_transaction must have an empty search_path (found: %, expected: %)',
      coalesce(v_adjust_search_path::text, 'none'), v_empty_search_path;
  end if;

  -- log_admin_action: one function, the named parameters used below, a fixed
  -- search_path (so it is unaffected by this function's empty search_path),
  -- and the acting admin taken from auth.uid().
  select count(*) as n into v_proc
  from pg_proc where pronamespace = 'public'::regnamespace and proname = 'log_admin_action';
  if v_proc.n <> 1 then
    raise exception 'Expected exactly one public.log_admin_action, found %', v_proc.n;
  end if;
  select p.proargnames, p.proconfig, p.prosrc into v_proc
  from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'log_admin_action';
  if not (v_proc.proargnames @> array['p_action', 'p_target_user_id', 'p_amount_usd', 'p_reason', 'p_ip_address']) then
    raise exception 'public.log_admin_action parameters differ from (p_action, p_target_user_id, p_amount_usd, p_reason, p_ip_address): %', v_proc.proargnames;
  end if;
  if v_proc.proconfig is null or not exists (select 1 from unnest(v_proc.proconfig) c where c like 'search_path=%') then
    raise exception 'public.log_admin_action has no fixed search_path; it would inherit pay_referral''s empty search_path. Review it before installing pay_referral';
  end if;
  if position('auth.uid()' in v_proc.prosrc) = 0 then
    raise exception 'public.log_admin_action does not appear to take the admin from auth.uid(); review it before installing pay_referral';
  end if;
end;
$$;

create or replace function public.referral_payout_request_id(p_referral_key text, p_role text)
returns uuid
language sql
immutable
strict
set search_path = ''
as $$
  -- Same as lib/referralPayment.js referralRequestId: first 16 bytes of
  -- sha256('vestora:referral-payout:v1:<key>:<role>'), version nibble 5,
  -- variant bits 10.
  select (pg_catalog.substr(h.x, 1, 12) || '5' || pg_catalog.substr(h.x, 14, 3)
          || pg_catalog.substr('89ab', (('x' || pg_catalog.substr(h.x, 17, 1))::bit(4)::integer & 3) + 1, 1)
          || pg_catalog.substr(h.x, 18, 15))::uuid
  from (select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
          'vestora:referral-payout:v1:' || pg_catalog.btrim(p_referral_key) || ':' || p_role, 'UTF8')), 'hex') as x) h
$$;

-- The SQL request IDs must equal the JavaScript ones exactly.
do $$
begin
  if public.referral_payout_request_id('00000000-0000-4000-8000-000000000001', 'referrer') <> '5a84b8c7-8b5b-5aff-9353-0ae210409e5c'
     or public.referral_payout_request_id('00000000-0000-4000-8000-000000000001', 'referred') <> '50a81ac0-cd16-55b9-b6c6-10a419320743'
     or public.referral_payout_request_id((42::bigint)::text, 'referrer') <> '2d0db65a-73b8-5a0f-bdef-4d498eb1cdc7'
     or public.referral_payout_request_id((42::bigint)::text, 'referred') <> '042f0c9b-0311-5a9a-a238-29e62af8dc51' then
    raise exception 'referral_payout_request_id does not reproduce the JavaScript request IDs';
  end if;
end;
$$;

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

alter function public.referral_payout_request_id(text, text) owner to postgres;
alter function public.pay_referral(bigint) owner to postgres;

revoke all on function public.referral_payout_request_id(text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.pay_referral(bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.pay_referral(bigint) to authenticated;
