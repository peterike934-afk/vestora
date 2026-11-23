-- ROLLBACK for 20261126000000_referral_payout_freeze.sql
--
-- NOT a migration. Run manually as postgres, in one transaction, only after
-- the application has been rolled back to a version that does not call
-- enqueue_marketing_campaign(text, uuid) or release_notification_delivery.
--
-- WARNING: this REMOVES the database-level referral payout freeze and the
-- write guard on public.referrals. Afterwards any admin can pay a referral by
-- calling pay_referral directly, and the only remaining payout control is the
-- application's REFERRAL_PAYOUTS_ENABLED setting. Roll back only if the
-- freeze itself is causing a problem, and re-freeze promptly.
--
-- Restores, exactly:
--   - public.pay_referral to the 20261124000000 version (md5 1ffe439817eee8875eea7b31ab33dafc);
--   - public.set_marketing_campaign_paused to the 20261125000000 version
--     (md5 50c2c3e061ed90983fccf840f5169b39);
--   - EXECUTE on public.enqueue_marketing_campaign(text) for service_role.
-- Removes: the referrals write guard, set_referral_payouts_enabled,
--   _referral_payouts_enabled, release_notification_delivery and
--   enqueue_marketing_campaign(text, uuid).
-- KEEPS every record: referral_payout_controls, referral_payout_control_events
--   and marketing_campaign_events stay, still append-only and readable by
--   admins only. Because they stay, 20261126000000 cannot simply be applied
--   again afterwards (its guard refuses); re-freezing would need a reviewed
--   follow-up migration.
-- Deliveries released to 'pending' stay pending and are sent normally.

begin;

do $$
begin
  if current_user <> 'postgres' then
    raise exception 'Run this rollback as postgres';
  end if;
  if to_regprocedure('public.set_referral_payouts_enabled(boolean, text, text, text)') is null then
    raise exception '20261126000000 is not applied (set_referral_payouts_enabled is missing); nothing to roll back';
  end if;
end;
$$;

drop trigger vestora_referral_write_guard on public.referrals;
drop function public._guard_referral_writes();
drop function public.release_notification_delivery(uuid, uuid, integer, text);
drop function public.enqueue_marketing_campaign(text, uuid);

-- pay_referral exactly as in 20261124000000 (no freeze check).
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

-- set_marketing_campaign_paused exactly as in 20261125000000 (no event row).
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

-- The switch functions go last: pay_referral above no longer calls them.
drop function public.set_referral_payouts_enabled(boolean, text, text, text);
drop function public._referral_payouts_enabled();

alter function public.pay_referral(bigint) owner to postgres;
alter function public.set_marketing_campaign_paused(text, boolean, uuid) owner to postgres;
revoke all on function public.pay_referral(bigint) from public, anon, authenticated, service_role;
grant execute on function public.pay_referral(bigint) to authenticated;
revoke all on function public.set_marketing_campaign_paused(text, boolean, uuid) from public, anon, authenticated, service_role;
grant execute on function public.set_marketing_campaign_paused(text, boolean, uuid) to service_role;
grant execute on function public.enqueue_marketing_campaign(text) to service_role;

commit;
