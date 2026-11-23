-- ROLLBACK for 20261127000000_financial_operation_controls.sql
--
-- NOT a migration. Run manually as postgres, in one transaction, only after
-- the application has been rolled back to a version that does not depend
-- on the financial operation switches.
--
-- WARNING: this REMOVES the database freeze on withdrawal payouts and bank
-- pulls, the valid-hold requirement, and the customer insert restriction.
-- Afterwards customers can again insert withdrawals and pre-verified
-- deposits directly, and withdrawals without a hold get one at approval.
-- Roll back only if these controls themselves cause a problem.
--
-- Restores, exactly:
--   - claim_transaction_for_approval and request_withdrawal to their
--     20261122000000 versions (md5 8e37d7cc0cf29ce765e497cfd7b26b6e and
--     43f0483ce7afd6bd5e7c1b3cf5a9e8f7) and their grants;
--   - the policy "Users can submit their own deposit claims" exactly as in
--     Production before 20261127000000.
-- Removes: set_financial_operation_enabled, _financial_operation_enabled and
--   the policy "Customers can submit pending deposit claims".
-- KEEPS every record: financial_operation_controls and
--   financial_operation_control_events stay (append-only, admin-readable).
--   Because they stay, 20261127000000 cannot simply be applied again.

begin;

do $$
begin
  if current_user <> 'postgres' then
    raise exception 'Run this rollback as postgres';
  end if;
  if to_regprocedure('public.set_financial_operation_enabled(text, boolean, text, text, text)') is null then
    raise exception '20261127000000 is not applied (set_financial_operation_enabled is missing); nothing to roll back';
  end if;
end;
$$;

drop policy "Customers can submit pending deposit claims" on public.transactions;
create policy "Users can submit their own deposit claims" on public.transactions
  for insert with check (((auth.uid() = user_id) AND (type = ANY (ARRAY['deposit'::text, 'withdrawal'::text]))));

-- claim_transaction_for_approval exactly as in 20261122000000.
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

-- request_withdrawal exactly as in 20261122000000.
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

drop function public.set_financial_operation_enabled(text, boolean, text, text, text);
drop function public._financial_operation_enabled(text);

alter function public.claim_transaction_for_approval(uuid, text) owner to postgres;
alter function public.request_withdrawal(uuid, numeric, text, text, numeric, text, text) owner to postgres;
revoke all on function public.claim_transaction_for_approval(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.request_withdrawal(uuid, numeric, text, text, numeric, text, text) from public, anon, authenticated, service_role;
grant execute on function public.claim_transaction_for_approval(uuid, text) to authenticated;
grant execute on function public.request_withdrawal(uuid, numeric, text, text, numeric, text, text) to authenticated;

commit;
