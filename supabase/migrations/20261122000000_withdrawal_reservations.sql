-- Withdrawal fund holds.
--
-- A pending withdrawal now holds its funds: the amount is debited from
-- the existing wallets.balance_usd when the withdrawal is requested (or,
-- for withdrawals created another way, when an admin first claims it for
-- approval). Approval consumes the hold without debiting again; rejection
-- returns the held amount to the wallet. withdrawal_reservations records
-- one hold per withdrawal transaction; it is not a second wallet.
--
-- Replaces three functions from 20261120180000_admin_financial_safety.sql.
-- Every line of those functions is unchanged except the marked hold logic.
-- Deposits, admin credits/debits, investment withdrawals, interest claims
-- and investment cancellation behave exactly as before.

do $$
begin
  if current_user <> 'postgres' then
    raise exception 'Apply this migration as postgres';
  end if;
end;
$$;

create table public.withdrawal_reservations (
  transaction_id uuid primary key
    references public.transactions (id) on delete restrict,
  user_id uuid not null references public.profiles (id),
  amount numeric(14,2) not null check (amount > 0),
  state text not null check (state in ('held', 'consumed', 'released')),
  request_id uuid unique,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now()
);

create index withdrawal_reservations_user_state_idx
  on public.withdrawal_reservations (user_id, state);

alter table public.withdrawal_reservations enable row level security;

revoke all on table public.withdrawal_reservations
  from public, anon, authenticated, service_role;

grant select on table public.withdrawal_reservations to authenticated;

create policy "Users can read their own withdrawal holds"
  on public.withdrawal_reservations
  for select
  to authenticated
  using (user_id = auth.uid());

create or replace function public.request_withdrawal(
  p_request_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_crypto_currency text default null,
  p_crypto_amount numeric default null,
  p_destination_address text default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_existing public.withdrawal_reservations%rowtype;
  v_balance numeric(14,2);
  v_min numeric;
  v_daily numeric;
  v_today numeric;
  v_transaction_id uuid;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if p_request_id is null
    or p_amount is null or p_amount <= 0
    or p_amount <> pg_catalog.round(p_amount, 2)
    or p_payment_method is null
    or p_payment_method not in ('crypto', 'bank', 'wire') then
    raise exception 'Invalid withdrawal request';
  end if;

  if p_payment_method = 'crypto' and (
    p_crypto_currency is null or pg_catalog.btrim(p_crypto_currency) = ''
    or p_crypto_amount is null or p_crypto_amount <= 0
    or p_destination_address is null or pg_catalog.btrim(p_destination_address) = ''
  ) then
    raise exception 'Crypto withdrawals need a currency, amount and destination address';
  end if;

  -- One lock per user: concurrent requests from the same account run one
  -- at a time, so each sees the balance left by the previous one.
  select balance_usd into v_balance
  from public.wallets
  where user_id = v_user_id
  for update;

  if not found then
    raise exception 'Wallet not found for this user';
  end if;

  -- Replaying the same request (double click, network retry) returns the
  -- original withdrawal instead of creating a second one.
  select * into v_existing
  from public.withdrawal_reservations
  where request_id = p_request_id;

  if found then
    if v_existing.user_id <> v_user_id or v_existing.amount <> p_amount then
      raise exception 'Request ID was already used for a different withdrawal';
    end if;

    return pg_catalog.jsonb_build_object(
      'transactionId', v_existing.transaction_id,
      'newBalance', v_balance,
      'duplicate', true
    );
  end if;

  select min_withdrawal_usd, daily_withdrawal_limit_usd
  into v_min, v_daily
  from public.settings
  limit 1;

  if v_min is not null and p_amount < v_min then
    raise exception 'Amount is below the minimum withdrawal of %', v_min;
  end if;

  if v_daily is not null then
    select coalesce(sum(amount_usd), 0) into v_today
    from public.transactions
    where user_id = v_user_id
      and type = 'withdrawal'
      and status in ('pending', 'verified')
      and created_at >= pg_catalog.date_trunc('day', pg_catalog.now());

    if v_today + p_amount > v_daily then
      raise exception 'This withdrawal would exceed your daily limit';
    end if;
  end if;

  if v_balance < p_amount then
    raise exception 'Insufficient available balance';
  end if;

  update public.wallets
  set balance_usd = balance_usd - p_amount,
      updated_at = pg_catalog.now()
  where user_id = v_user_id
  returning balance_usd into v_balance;

  insert into public.transactions (
    user_id, type, amount_usd, status, admin_note, payment_method,
    crypto_currency, crypto_amount, destination_address
  )
  values (
    v_user_id, 'withdrawal', p_amount, 'pending',
    nullif(pg_catalog.btrim(coalesce(p_note, '')), ''),
    p_payment_method,
    case when p_payment_method = 'crypto' then pg_catalog.btrim(p_crypto_currency) end,
    case when p_payment_method = 'crypto' then p_crypto_amount end,
    case when p_payment_method = 'crypto' then pg_catalog.btrim(p_destination_address) end
  )
  returning id into v_transaction_id;

  insert into public.withdrawal_reservations (
    transaction_id, user_id, amount, state, request_id
  )
  values (
    v_transaction_id, v_user_id, p_amount, 'held', p_request_id
  );

  return pg_catalog.jsonb_build_object(
    'transactionId', v_transaction_id,
    'newBalance', v_balance,
    'duplicate', false
  );
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


create or replace function public.claim_transaction_for_approval(
  p_transaction_id uuid,
  p_admin_note text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin_id uuid := auth.uid();
  v_txn public.transactions%rowtype;
  v_claim public.admin_financial_operation_claims%rowtype;
  v_token uuid := pg_catalog.gen_random_uuid();
  v_balance numeric(14,2);
begin
  if v_admin_id is null or not public.is_admin() then
    raise exception 'Only admins can approve transactions';
  end if;

  select * into v_txn
  from public.transactions
  where id = p_transaction_id
  for update;

  if not found or v_txn.status <> 'pending' then
    raise exception 'Transaction is no longer pending';
  end if;

  -- Withdrawals created before holds existed (or inserted without
  -- request_withdrawal) get their funds held now, before any payout is
  -- attempted. Two such withdrawals can therefore never both be paid
  -- from the same balance. Placed before the claim lookup so the FOUND
  -- checks below keep their original meaning; if a later check raises,
  -- the whole call (including this hold) is rolled back.
  if v_txn.type = 'withdrawal' and not exists (
    select 1
    from public.withdrawal_reservations
    where transaction_id = p_transaction_id
      and state = 'held'
  ) then
    select balance_usd into v_balance
    from public.wallets
    where user_id = v_txn.user_id
    for update;

    if not found then
      raise exception 'Wallet not found for this user';
    end if;

    if v_balance < v_txn.amount_usd then
      raise exception 'Insufficient balance to reserve this withdrawal';
    end if;

    update public.wallets
    set balance_usd = balance_usd - v_txn.amount_usd,
        updated_at = pg_catalog.now()
    where user_id = v_txn.user_id;

    insert into public.withdrawal_reservations (
      transaction_id, user_id, amount, state
    )
    values (
      p_transaction_id, v_txn.user_id, v_txn.amount_usd, 'held'
    );
  end if;

  select * into v_claim
  from public.admin_financial_operation_claims
  where transaction_id = p_transaction_id
  for update;

  if found and v_claim.state <> 'released' then
    raise exception 'Transaction already has an active or completed processing claim';
  end if;

  if found then
    update public.admin_financial_operation_claims
    set claim_token = v_token,
        action = 'verify',
        state = 'processing',
        admin_id = v_admin_id,
        admin_note = p_admin_note,
        provider_evidence = '{}'::jsonb,
        recovery_note = null,
        recovery_operator_label = null,
        reconciled_at = null,
        updated_at = pg_catalog.now()
    where transaction_id = p_transaction_id;
  else
    insert into public.admin_financial_operation_claims (
      transaction_id, claim_token, action, state, admin_id, admin_note
    )
    values (
      p_transaction_id, v_token, 'verify', 'processing', v_admin_id, p_admin_note
    );
  end if;

  return v_token;
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


alter function public.request_withdrawal(uuid, numeric, text, text, numeric, text, text) owner to postgres;
alter function public._finalize_claimed_transaction(uuid, uuid) owner to postgres;
alter function public.claim_transaction_for_approval(uuid, text) owner to postgres;
alter function public.reject_pending_transaction(uuid, text) owner to postgres;

revoke all on function public.request_withdrawal(uuid, numeric, text, text, numeric, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public._finalize_claimed_transaction(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.claim_transaction_for_approval(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.reject_pending_transaction(uuid, text)
  from public, anon, authenticated, service_role;

grant execute on function public.request_withdrawal(uuid, numeric, text, text, numeric, text, text)
  to authenticated;
grant execute on function public.claim_transaction_for_approval(uuid, text)
  to authenticated;
grant execute on function public.reject_pending_transaction(uuid, text)
  to authenticated;
