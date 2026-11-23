-- Investment financial integrity.
--
-- A. Rejecting an investment withdrawal (directly, or by cancelling the
--    investment) refunds the early-withdrawal fee that was taken from the
--    wallet, as a separate verified 'early_withdrawal_fee_refund'
--    transaction linked to the fee by related_transaction_id. Fees deducted
--    from the payout were never collected and are not refunded. At most one
--    refund per fee (row lock + unique index). Approved withdrawals keep
--    their fees.
-- B. A matured withdrawal pays full-term interest on the withdrawn portion
--    LESS the interest already claimed on that portion (claimed interest on
--    the remaining principal, allocated pro rata). The allocated amount is
--    recorded on the withdrawal and, on approval, moved to
--    investments.withdrawn_claimed_interest so it is never counted twice.
-- C. Approving a gains claim re-checks it against the locked investment
--    with the same calculation used to create it, and refuses claims that
--    exceed what is currently claimable or whose investment is not active.
-- D. One calculation (investment_accrued_interest /
--    investment_claimable_gains) drives the view, claims, withdrawals and
--    approval. A principal withdrawal and a gains claim cannot be pending on
--    the same investment at the same time. Approval re-checks that a
--    withdrawal does not exceed the remaining principal; status still only
--    becomes 'withdrawn' when the full principal has been approved.
-- E. Cancelling an investment refunds only the principal still in it
--    (amount_usd - withdrawn_principal), not the original amount, so
--    principal already paid out by approved withdrawals is not paid twice.
--
-- Requires 20261122000000_withdrawal_reservations.sql (its versions of
-- _finalize_claimed_transaction and reject_pending_transaction are the
-- base for the versions here). Changes no existing rows: two columns are
-- added with neutral defaults and the transaction type list is extended.
-- Changed lines in replaced functions are marked [integrity A-D].

do $$
begin
  if current_user <> 'postgres' then
    raise exception 'Apply this migration as postgres';
  end if;
  -- Ordering guard: builds on 20261122000000_withdrawal_reservations.sql.
  if to_regclass('public.withdrawal_reservations') is null then
    raise exception 'Apply 20261122000000_withdrawal_reservations.sql first';
  end if;
end;
$$;

alter table public.investments
  add column withdrawn_claimed_interest numeric not null default 0;

alter table public.transactions
  add column claimed_interest_allocated numeric;

alter table public.transactions drop constraint transactions_type_check;
alter table public.transactions add constraint transactions_type_check check (type = any (array[
  'deposit'::text, 'withdrawal'::text, 'admin_credit'::text, 'admin_debit'::text,
  'investment_withdrawal'::text, 'investment_interest_claim'::text,
  'early_withdrawal_fee'::text, 'investment_cancelled'::text,
  'early_withdrawal_fee_refund'::text
]));

create unique index transactions_one_refund_per_fee
  on public.transactions (related_transaction_id)
  where type = 'early_withdrawal_fee_refund';

create or replace function public.investment_accrued_interest(
  p_principal numeric,
  p_apy_percent numeric,
  p_term_days numeric,
  p_started_at timestamptz,
  p_at timestamptz
)
returns numeric
language sql
immutable
set search_path = ''
as $$
  -- Simple interest on principal at the plan APY, capped at the plan term.
  -- The same formula investments_with_value has always used.
  select greatest(coalesce(p_principal, 0), 0)
       * (p_apy_percent / 100.0)
       * least(greatest(extract(epoch from (p_at - p_started_at)) / 86400.0, 0), p_term_days)
       / 365.0
$$;

create or replace function public.investment_claimable_gains(
  p_investment_id uuid,
  p_exclude_transaction_id uuid default null
)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_inv public.investments%rowtype;
  v_plan public.investment_plans%rowtype;
  v_remaining numeric;
  v_claimed_on_remaining numeric;
  v_pending_claims numeric;
  v_claimable numeric;
begin
  select * into v_inv from public.investments where id = p_investment_id;
  if not found then
    return 0;
  end if;

  -- Callers other than the owner, an admin or the service role learn nothing.
  if auth.uid() is not null and v_inv.user_id is distinct from auth.uid() and not public.is_admin() then
    return 0;
  end if;

  if v_inv.status <> 'active' then
    return 0;
  end if;

  -- Nothing is claimable while a principal withdrawal is pending.
  if exists (
    select 1 from public.transactions
    where investment_id = p_investment_id
      and type = 'investment_withdrawal'
      and status = 'pending'
  ) then
    return 0;
  end if;

  select * into v_plan from public.investment_plans where id = v_inv.plan_id;
  if not found then
    return 0;
  end if;

  select coalesce(sum(amount_usd), 0) into v_pending_claims
  from public.transactions
  where investment_id = p_investment_id
    and type = 'investment_interest_claim'
    and status = 'pending'
    and id is distinct from p_exclude_transaction_id;

  v_remaining := v_inv.amount_usd - v_inv.withdrawn_principal;
  v_claimed_on_remaining := v_inv.claimed_interest - v_inv.withdrawn_claimed_interest;

  if pg_catalog.now() >= v_inv.matures_at then
    v_claimable := public.investment_accrued_interest(
                     v_remaining, v_plan.apy_percent, v_plan.term_days, v_inv.started_at, pg_catalog.now())
                   + v_inv.admin_profit - v_claimed_on_remaining - v_pending_claims;
  else
    -- Before maturity only admin-credited profit can be claimed.
    v_claimable := v_inv.admin_profit - v_claimed_on_remaining - v_pending_claims;
  end if;

  -- Whole cents, rounded down, so a claim can never exceed what was earned.
  return greatest(floor(v_claimable * 100) / 100, 0);
end;
$$;

create or replace function public._refund_early_withdrawal_fees(
  p_withdrawal_transaction_id uuid,
  p_actor_id uuid
)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fee public.transactions%rowtype;
  v_total numeric := 0;
begin
  -- Each wallet-funded fee is refunded at most once: the fee row is locked,
  -- an existing refund is checked, and a unique index backs this up.
  for v_fee in
    select f.*
    from public.transactions f
    where f.related_transaction_id = p_withdrawal_transaction_id
      and f.type = 'early_withdrawal_fee'
      and f.status = 'verified'
    order by f.created_at
    for update
  loop
    if exists (
      select 1 from public.transactions r
      where r.related_transaction_id = v_fee.id
        and r.type = 'early_withdrawal_fee_refund'
    ) then
      continue;
    end if;

    update public.wallets
    set balance_usd = balance_usd + v_fee.amount_usd,
        updated_at = pg_catalog.now()
    where user_id = v_fee.user_id;

    if not found then
      raise exception 'Wallet not found for this user';
    end if;

    insert into public.transactions (
      user_id, type, amount_usd, status, investment_id,
      related_transaction_id, admin_note, verified_by, verified_at
    )
    values (
      v_fee.user_id, 'early_withdrawal_fee_refund', v_fee.amount_usd, 'verified', v_fee.investment_id,
      v_fee.id, 'Early withdrawal fee refunded because the withdrawal was not approved',
      p_actor_id, pg_catalog.now()
    );

    v_total := v_total + v_fee.amount_usd;
  end loop;

  return v_total;
end;
$$;

create or replace function public._finalize_claimed_transaction(
  p_transaction_id uuid,
  p_claim_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim public.admin_financial_operation_claims%rowtype;
  v_txn public.transactions%rowtype;
  v_investment public.investments%rowtype;
  v_balance numeric(14,2);
  v_new_balance numeric(14,2);
  v_delta numeric(14,2);
  v_is_credit boolean;
  v_new_withdrawn numeric;
  v_provider jsonb;
  v_reservation public.withdrawal_reservations%rowtype;
  v_has_reservation boolean := false;
  v_claimable numeric;
begin
  select * into v_claim
  from public.admin_financial_operation_claims
  where transaction_id = p_transaction_id
    and claim_token = p_claim_token
    and action = 'verify'
    and state in ('processing', 'uncertain')
  for update;

  if not found then
    raise exception 'No matching active approval claim';
  end if;

  select * into v_txn
  from public.transactions
  where id = p_transaction_id;

  if not found or v_txn.status <> 'pending' then
    raise exception 'Transaction is no longer pending';
  end if;

  if v_txn.investment_id is not null
    and v_txn.type in ('investment_withdrawal', 'investment_interest_claim') then
    select * into v_investment
    from public.investments
    where id = v_txn.investment_id
    for update;

    if not found then
      raise exception 'Investment not found';
    end if;

    -- [integrity C/D] Re-check eligibility at approval time, against the
    -- locked investment, using the same calculation as the claim itself.
    if v_investment.status <> 'active' then
      raise exception 'This investment is no longer active (status: %); reject this request', v_investment.status;
    end if;

    if v_txn.type = 'investment_interest_claim' then
      v_claimable := public.investment_claimable_gains(v_txn.investment_id, p_transaction_id);
      if v_txn.amount_usd > v_claimable + 0.01 then
        raise exception 'This gains claim of % exceeds the % currently claimable; reject it so the customer can claim the correct amount',
          v_txn.amount_usd, v_claimable;
      end if;
    end if;

    if v_txn.type = 'investment_withdrawal'
      and v_investment.withdrawn_principal + coalesce(v_txn.principal_portion, 0)
          > v_investment.amount_usd + 0.005 then
      raise exception 'This withdrawal exceeds the principal remaining in the investment; reject this request';
    end if;
  end if;

  select balance_usd into v_balance
  from public.wallets
  where user_id = v_txn.user_id
  for update;

  if not found then
    raise exception 'Wallet not found for this user';
  end if;

  -- A withdrawal whose funds are already held was debited when the hold
  -- was placed; approving it consumes the hold instead of debiting again.
  if v_txn.type = 'withdrawal' then
    select * into v_reservation
    from public.withdrawal_reservations
    where transaction_id = p_transaction_id
      and state = 'held'
    for update;
    v_has_reservation := found;
  end if;

  v_is_credit := v_txn.type in (
    'deposit', 'admin_credit', 'investment_withdrawal', 'investment_interest_claim'
  );
  v_delta := case when v_is_credit then v_txn.amount_usd else -v_txn.amount_usd end;
  if v_has_reservation then
    v_delta := 0;
  end if;
  v_new_balance := v_balance + v_delta;

  if v_new_balance < 0 then
    raise exception 'This would take the user balance negative';
  end if;

  update public.wallets
  set balance_usd = balance_usd + v_delta,
      updated_at = pg_catalog.now()
  where user_id = v_txn.user_id
  returning balance_usd into v_new_balance;

  if v_txn.type = 'investment_withdrawal' and v_txn.investment_id is not null then
    v_new_withdrawn := v_investment.withdrawn_principal
      + coalesce(v_txn.principal_portion, 0);

    update public.investments
    set withdrawn_principal = v_new_withdrawn,
        -- [integrity B] Interest already claimed that belongs to the
        -- principal leaving the investment (fixed at request time).
        withdrawn_claimed_interest = withdrawn_claimed_interest
          + coalesce(v_txn.claimed_interest_allocated, 0),
        status = case
          when v_new_withdrawn >= v_investment.amount_usd - 0.005
            then 'withdrawn'
          else 'active'
        end
    where id = v_txn.investment_id;
  elsif v_txn.type = 'investment_interest_claim' and v_txn.investment_id is not null then
    update public.investments
    set claimed_interest = claimed_interest + v_txn.amount_usd
    where id = v_txn.investment_id;
  end if;

  v_provider := v_claim.provider_evidence;

  update public.transactions
  set status = 'verified',
      admin_note = v_claim.admin_note,
      verified_by = v_claim.admin_id,
      verified_at = pg_catalog.now(),
      stripe_payment_intent_id = coalesce(
        v_provider ->> 'stripePaymentIntentId', stripe_payment_intent_id
      ),
      stripe_payment_intent_status = coalesce(
        v_provider ->> 'stripePaymentIntentStatus', stripe_payment_intent_status
      ),
      sent_tx_hash = coalesce(v_provider ->> 'sentTxHash', sent_tx_hash),
      sent_at = coalesce(
        nullif(v_provider ->> 'sentAt', '')::timestamptz,
        sent_at
      ),
      send_error = null
  where id = p_transaction_id
    and status = 'pending';

  if not found then
    raise exception 'Transaction is no longer pending';
  end if;

  if v_has_reservation then
    update public.withdrawal_reservations
    set state = 'consumed',
        updated_at = pg_catalog.now()
    where transaction_id = p_transaction_id
      and state = 'held';
  end if;

  update public.admin_financial_operation_claims
  set state = 'completed',
      updated_at = pg_catalog.now()
  where transaction_id = p_transaction_id
    and claim_token = p_claim_token;

  return pg_catalog.jsonb_build_object(
    'newBalance', v_new_balance,
    'transactionId', p_transaction_id
  );
end;
$$;

create or replace function public.reject_pending_transaction(
  p_transaction_id uuid,
  p_admin_note text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin_id uuid := auth.uid();
  v_txn public.transactions%rowtype;
  v_claim public.admin_financial_operation_claims%rowtype;
  v_has_claim boolean;
  v_reservation public.withdrawal_reservations%rowtype;
begin
  if v_admin_id is null or not public.is_admin() then
    raise exception 'Only admins can reject transactions';
  end if;

  select * into v_txn
  from public.transactions
  where id = p_transaction_id
  for update;

  if not found or v_txn.status <> 'pending' then
    raise exception 'Transaction is no longer pending';
  end if;

  select * into v_claim
  from public.admin_financial_operation_claims
  where transaction_id = p_transaction_id;
  v_has_claim := found;

  if v_has_claim and v_claim.state in ('processing', 'uncertain', 'completed') then
    raise exception 'Transaction has an active or completed processing claim';
  end if;

  update public.transactions
  set status = 'rejected',
      admin_note = p_admin_note,
      verified_by = v_admin_id,
      verified_at = pg_catalog.now()
  where id = p_transaction_id
    and status = 'pending';

  if not found then
    raise exception 'Transaction is no longer pending';
  end if;

  -- Return any held withdrawal funds to the wallet.
  select * into v_reservation
  from public.withdrawal_reservations
  where transaction_id = p_transaction_id
    and state = 'held'
  for update;

  if found then
    update public.wallets
    set balance_usd = balance_usd + v_reservation.amount,
        updated_at = pg_catalog.now()
    where user_id = v_reservation.user_id;

    if not found then
      raise exception 'Wallet not found for this user';
    end if;

    update public.withdrawal_reservations
    set state = 'released',
        updated_at = pg_catalog.now()
    where transaction_id = p_transaction_id;
  end if;

  -- [integrity A] Return any early-withdrawal fee that was taken from the
  -- wallet for this investment withdrawal. Fees deducted from the payout
  -- were never collected and are not refunded.
  if v_txn.type = 'investment_withdrawal' then
    perform public._refund_early_withdrawal_fees(p_transaction_id, v_admin_id);
  end if;

  if v_has_claim then
    update public.admin_financial_operation_claims
    set action = 'reject',
        state = 'rejected',
        admin_id = v_admin_id,
        admin_note = p_admin_note,
        updated_at = pg_catalog.now()
    where transaction_id = p_transaction_id;
  else
    insert into public.admin_financial_operation_claims (
      transaction_id, claim_token, action, state, admin_id, admin_note
    )
    values (
      p_transaction_id, pg_catalog.gen_random_uuid(), 'reject', 'rejected',
      v_admin_id, p_admin_note
    );
  end if;
end;
$$;

create or replace function public.cancel_investment_atomically(
  p_investment_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin_id uuid := auth.uid();
  v_investment public.investments%rowtype;
  v_balance numeric(14,2);
  v_new_balance numeric(14,2);
  v_reversed jsonb;
begin
  if v_admin_id is null or not public.is_admin() then
    raise exception 'Only admins can cancel investments';
  end if;

  if p_reason is null or pg_catalog.btrim(p_reason) = '' then
    raise exception 'A reason is required';
  end if;

  select * into v_investment
  from public.investments
  where id = p_investment_id
  for update;

  if not found or v_investment.status <> 'active' then
    raise exception 'Only active investments can be cancelled';
  end if;

  perform 1
  from public.transactions
  where investment_id = p_investment_id
    and status = 'pending'
    and type in ('investment_interest_claim', 'investment_withdrawal')
  for update;

  if exists (
    select 1
    from public.transactions t
    join public.admin_financial_operation_claims c
      on c.transaction_id = t.id
    where t.investment_id = p_investment_id
      and t.status = 'pending'
      and t.type in ('investment_interest_claim', 'investment_withdrawal')
      and c.state in ('processing', 'uncertain')
  ) then
    raise exception 'An investment transaction is being processed; reconcile it before cancellation';
  end if;

  select balance_usd into v_balance
  from public.wallets
  where user_id = v_investment.user_id
  for update;

  if not found then
    raise exception 'Wallet not found for this user';
  end if;

  update public.wallets
  -- [integrity E] Refund only the principal still in the investment;
  -- principal already paid out by approved withdrawals is not paid again.
  set balance_usd = balance_usd + (v_investment.amount_usd - v_investment.withdrawn_principal),
      updated_at = pg_catalog.now()
  where user_id = v_investment.user_id
  returning balance_usd into v_new_balance;

  update public.investments
  set status = 'withdrawn'
  where id = p_investment_id
    and status = 'active';

  if not found then
    raise exception 'Investment is no longer active';
  end if;

  with reversed as (
    update public.transactions
    set status = 'rejected',
        admin_note = 'Auto-rejected — investment was cancelled by admin',
        verified_by = v_admin_id,
        verified_at = pg_catalog.now()
    where investment_id = p_investment_id
      and status = 'pending'
      and type in ('investment_interest_claim', 'investment_withdrawal')
    returning id, type, amount_usd
  )
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object('id', id, 'type', type, 'amount_usd', amount_usd)
    ),
    '[]'::jsonb
  )
  into v_reversed
  from reversed;

  -- [integrity A] Auto-rejected investment withdrawals get any
  -- wallet-funded early-withdrawal fee back, as with a manual rejection.
  perform public._refund_early_withdrawal_fees((r.value ->> 'id')::uuid, v_admin_id)
  from pg_catalog.jsonb_array_elements(v_reversed) as r(value)
  where r.value ->> 'type' = 'investment_withdrawal';

  return pg_catalog.jsonb_build_object(
    'userId', v_investment.user_id,
    'amountUsd', v_investment.amount_usd - v_investment.withdrawn_principal,
    'originalAmountUsd', v_investment.amount_usd,
    'newBalance', v_new_balance,
    'reversedPendingClaims', v_reversed
  );
end;
$$;

CREATE OR REPLACE FUNCTION public.request_investment_withdrawal(p_investment_id uuid, p_principal_amount numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  c_early_fee_rate constant numeric := 0.10;   -- 10% early withdrawal fee
  v_user_id uuid := auth.uid();
  v_inv record;
  v_plan record;
  v_settings record;
  v_wallet_balance numeric;
  v_days_elapsed numeric;
  v_days_counted numeric;
  v_is_matured boolean;
  v_available_principal numeric;
  v_pending_principal numeric;
  v_remaining_principal numeric;
  v_pending_claims numeric;
  v_unclaimed_profit numeric;
  v_interest_on_portion numeric;
  v_forfeited numeric;
  v_fee numeric;
  v_fee_from_wallet numeric;
  v_fee_shortfall numeric;
  v_payout numeric;
  v_withdrawn_today numeric;
  v_transaction_id uuid;
  v_claimed_on_remaining numeric;
  v_claimed_share numeric;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if p_principal_amount is null or p_principal_amount <= 0 then
    raise exception 'Withdrawal amount must be greater than zero';
  end if;

  select * into v_inv
  from public.investments
  where id = p_investment_id and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Investment not found';
  end if;

  if v_inv.status <> 'active' then
    raise exception 'This investment is not active (status: %)', v_inv.status;
  end if;

  select * into v_plan from public.investment_plans where id = v_inv.plan_id;
  if not found then
    raise exception 'Investment plan not found';
  end if;

  select * into v_settings from public.settings where id = true;

  select balance_usd into v_wallet_balance
  from public.wallets
  where user_id = v_user_id
  for update;
  v_wallet_balance := coalesce(v_wallet_balance, 0);

  select coalesce(sum(principal_portion), 0) into v_pending_principal
  from public.transactions
  where investment_id = p_investment_id
    and type = 'investment_withdrawal'
    and status = 'pending';

  v_remaining_principal := v_inv.amount_usd - v_inv.withdrawn_principal;
  v_available_principal := v_remaining_principal - v_pending_principal;

  if p_principal_amount > v_available_principal then
    raise exception 'Only % is available to withdraw from this investment', v_available_principal;
  end if;

  -- Don't let a full withdrawal close the investment while admin profit is unclaimed
  select coalesce(sum(amount_usd), 0) into v_pending_claims
  from public.transactions
  where investment_id = p_investment_id
    and type = 'investment_interest_claim'
    and status = 'pending';

  -- [integrity B/D] A principal withdrawal and a gains claim on the same
  -- investment must not be pending together: each would count the same
  -- interest.
  if v_pending_claims > 0 then
    raise exception 'A gains claim on this investment is pending review. You can withdraw once it has been processed.';
  end if;

  v_unclaimed_profit := greatest(v_inv.admin_profit - v_inv.claimed_interest - v_pending_claims, 0);

  if p_principal_amount >= v_available_principal - 0.005 and v_unclaimed_profit > 0.01 then
    raise exception 'Claim your profit of % first, then withdraw the full amount', round(v_unclaimed_profit, 2);
  end if;

  v_days_elapsed := extract(epoch from (now() - v_inv.started_at)) / 86400.0;
  v_days_counted := least(v_days_elapsed, v_plan.term_days);
  v_is_matured := now() >= v_inv.matures_at;

  -- [integrity B] Interest already claimed on the remaining principal is
  -- allocated pro rata to the portion being withdrawn, so it is never paid
  -- a second time with the principal.
  v_claimed_on_remaining := greatest(v_inv.claimed_interest - v_inv.withdrawn_claimed_interest, 0);
  v_claimed_share := case when v_remaining_principal > 0
                          then v_claimed_on_remaining * (p_principal_amount / v_remaining_principal)
                          else 0 end;

  if v_is_matured then
    v_interest_on_portion := floor(greatest(
      public.investment_accrued_interest(p_principal_amount, v_plan.apy_percent, v_plan.term_days, v_inv.started_at, now())
      - v_claimed_share,
      0) * 100) / 100;
    v_forfeited := 0;
    v_fee := 0;
  else
    v_interest_on_portion := 0;
    v_forfeited := greatest(
      public.investment_accrued_interest(p_principal_amount, v_plan.apy_percent, v_plan.term_days, v_inv.started_at, now())
      - v_claimed_share,
      0);
    v_fee := round(p_principal_amount * c_early_fee_rate, 2);
  end if;

  -- The fee is charged to the wallet first; only a shortfall comes out of the payout.
  v_fee_from_wallet := least(v_fee, v_wallet_balance);
  v_fee_shortfall := v_fee - v_fee_from_wallet;

  v_payout := p_principal_amount + v_interest_on_portion - v_fee_shortfall;
  if v_payout < 0 then
    v_payout := 0;
  end if;

  if v_settings.min_withdrawal_usd is not null and v_payout < v_settings.min_withdrawal_usd then
    raise exception 'Minimum withdrawal is %. This request would only pay out %', v_settings.min_withdrawal_usd, v_payout;
  end if;

  if v_settings.daily_withdrawal_limit_usd is not null then
    select coalesce(sum(amount_usd), 0) into v_withdrawn_today
    from public.transactions
    where user_id = v_user_id
      and type in ('withdrawal', 'investment_withdrawal')
      and status in ('pending', 'verified')
      and created_at >= date_trunc('day', now());

    if v_withdrawn_today + v_payout > v_settings.daily_withdrawal_limit_usd then
      raise exception 'This would exceed your daily withdrawal limit of %. You have % remaining today',
        v_settings.daily_withdrawal_limit_usd,
        greatest(v_settings.daily_withdrawal_limit_usd - v_withdrawn_today, 0);
    end if;
  end if;

  insert into public.transactions (
    user_id, type, amount_usd, status,
    investment_id, principal_portion, forfeited_interest, fee_charged,
    claimed_interest_allocated
  )
  values (
    v_user_id, 'investment_withdrawal', v_payout, 'pending',
    p_investment_id, p_principal_amount, v_forfeited, v_fee,
    v_claimed_share
  )
  returning id into v_transaction_id;

  -- Charge the wallet part of the fee now, as its own line in the history.
  if v_fee_from_wallet > 0 then
    update public.wallets
    set balance_usd = balance_usd - v_fee_from_wallet,
        updated_at = now()
    where user_id = v_user_id;

    insert into public.transactions (
      user_id, type, amount_usd, status, investment_id,
      related_transaction_id, admin_note, verified_at
    )
    values (
      v_user_id, 'early_withdrawal_fee', v_fee_from_wallet, 'verified', p_investment_id,
      v_transaction_id, 'Early withdrawal fee', now()
    );
  end if;

  return v_transaction_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.claim_investment_gains(p_investment_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_inv record;
  v_plan record;
  v_settings record;
  v_remaining_principal numeric;
  v_days_elapsed numeric;
  v_days_counted numeric;
  v_total_accrued numeric;
  v_pending_claims numeric;
  v_claimable numeric;
  v_transaction_id uuid;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_inv
  from public.investments
  where id = p_investment_id and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Investment not found';
  end if;

  if v_inv.status <> 'active' then
    raise exception 'This investment is not active (status: %)', v_inv.status;
  end if;

  select * into v_plan from public.investment_plans where id = v_inv.plan_id;
  if not found then
    raise exception 'Investment plan not found';
  end if;

  -- [integrity B/C/D] One calculation, shared with the view, withdrawals
  -- and approval: public.investment_claimable_gains. The investment row is
  -- locked above, so concurrent claims are evaluated one at a time.
  if exists (
    select 1 from public.transactions
    where investment_id = p_investment_id
      and type = 'investment_withdrawal'
      and status = 'pending'
  ) then
    raise exception 'A withdrawal from this investment is pending review. You can claim gains once it has been processed.';
  end if;

  v_claimable := public.investment_claimable_gains(p_investment_id);

  if v_claimable <= 0.01 then
    raise exception 'Nothing available to claim right now';
  end if;

  select * into v_settings from public.settings where id = true;
  if v_settings.min_withdrawal_usd is not null and v_claimable < v_settings.min_withdrawal_usd then
    raise exception 'Minimum claim amount is %. You currently have % available', v_settings.min_withdrawal_usd, v_claimable;
  end if;

  insert into public.transactions (
    user_id, type, amount_usd, status, investment_id,
    principal_portion, forfeited_interest, fee_charged
  )
  values (
    v_user_id, 'investment_interest_claim', v_claimable, 'pending', p_investment_id,
    0, 0, 0
  )
  returning id into v_transaction_id;

  return v_transaction_id;
end;
$function$;

-- Keep whatever view options production has (e.g. security_invoker).
create temp table _integrity_view_options as
  select reloptions from pg_class where oid = 'public.investments_with_value'::regclass;

create or replace view public.investments_with_value as
 SELECT i.id,
    i.user_id,
    i.plan_id,
    i.amount_usd,
    i.started_at,
    i.matures_at,
    i.status,
    p.name AS plan_name,
    p.apy_percent,
    p.term_days,
    -- [integrity B/D] Remaining principal plus interest accrued on it, less
    -- interest already claimed on it, plus admin profit. Identical to the
    -- previous formula until a withdrawal allocates claimed interest.
    (i.amount_usd - i.withdrawn_principal)
      + public.investment_accrued_interest(i.amount_usd - i.withdrawn_principal, p.apy_percent, p.term_days::numeric, i.started_at, now())
      - (i.claimed_interest - i.withdrawn_claimed_interest)
      + i.admin_profit AS current_value,
    GREATEST(p.term_days::numeric - EXTRACT(epoch FROM now() - i.started_at) / 86400.0, 0::numeric) AS days_remaining,
    i.withdrawn_principal,
    i.amount_usd - i.withdrawn_principal AS remaining_principal,
    p.early_withdrawal_fee_usd,
    now() >= i.matures_at AS is_matured,
    COALESCE(( SELECT sum(t.principal_portion) AS sum
           FROM transactions t
          WHERE t.investment_id = i.id AND t.type = 'investment_withdrawal'::text AND t.status = 'pending'::text), 0::numeric) AS pending_withdrawal_principal,
    i.amount_usd - i.withdrawn_principal - COALESCE(( SELECT sum(t.principal_portion) AS sum
           FROM transactions t
          WHERE t.investment_id = i.id AND t.type = 'investment_withdrawal'::text AND t.status = 'pending'::text), 0::numeric) AS available_to_withdraw,
    i.claimed_interest,
    -- [integrity C/D] The same calculation the claim and its approval use.
    public.investment_claimable_gains(i.id) AS available_to_claim,
    i.admin_profit
   FROM investments i
     JOIN investment_plans p ON p.id = i.plan_id;

do $$
declare
  v_options text[];
begin
  select reloptions into v_options from _integrity_view_options;
  if v_options is not null and array_length(v_options, 1) > 0 then
    execute 'alter view public.investments_with_value set (' || array_to_string(v_options, ', ') || ')';
  end if;
end;
$$;

drop table _integrity_view_options;


revoke all on function public.investment_accrued_interest(numeric, numeric, numeric, timestamptz, timestamptz)
  from public, anon;
revoke all on function public.investment_claimable_gains(uuid, uuid)
  from public, anon;
revoke all on function public._refund_early_withdrawal_fees(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.investment_accrued_interest(numeric, numeric, numeric, timestamptz, timestamptz)
  to authenticated, service_role;
grant execute on function public.investment_claimable_gains(uuid, uuid)
  to authenticated, service_role;

alter function public.investment_accrued_interest(numeric, numeric, numeric, timestamptz, timestamptz) owner to postgres;
alter function public.investment_claimable_gains(uuid, uuid) owner to postgres;
alter function public._refund_early_withdrawal_fees(uuid, uuid) owner to postgres;
alter function public._finalize_claimed_transaction(uuid, uuid) owner to postgres;
alter function public.reject_pending_transaction(uuid, text) owner to postgres;
alter function public.cancel_investment_atomically(uuid, text) owner to postgres;
alter function public.request_investment_withdrawal(uuid, numeric) owner to postgres;
alter function public.claim_investment_gains(uuid) owner to postgres;
