-- ROLLBACK for 20261122000000_withdrawal_reservations.sql
--
-- NOT a migration. Run manually, as postgres, only if the withdrawal-hold
-- change has to be undone, and only AFTER the application has been rolled
-- back to a version that does not call request_withdrawal.
--
-- 1. Returns every still-held withdrawal amount to its wallet. The
--    restored V2 functions debit a withdrawal when it is approved, so a
--    hold left in place would be charged twice.
-- 2. Restores _finalize_claimed_transaction, claim_transaction_for_approval
--    and reject_pending_transaction to their exact text from
--    20261120180000_admin_financial_safety.sql.
-- 3. Removes request_withdrawal.
--
-- withdrawal_reservations is kept as an audit record of every hold; after
-- this script no function reads or writes it.

begin;

do $$
begin
  if current_user <> 'postgres' then
    raise exception 'Run this rollback as postgres';
  end if;
end;
$$;

-- Lock holds and their wallets so nothing changes underneath the refund.
lock table public.withdrawal_reservations in exclusive mode;

with held as (
  select r.transaction_id, r.user_id, r.amount
  from public.withdrawal_reservations r
  where r.state = 'held'
),
per_user as (
  select user_id, sum(amount) as amount
  from held
  group by user_id
),
refunded as (
  update public.wallets w
  set balance_usd = w.balance_usd + p.amount,
      updated_at = pg_catalog.now()
  from per_user p
  where w.user_id = p.user_id
  returning w.user_id
)
update public.withdrawal_reservations r
set state = 'released',
    updated_at = pg_catalog.now()
from held h
where r.transaction_id = h.transaction_id
  and exists (select 1 from refunded f where f.user_id = h.user_id);

do $$
begin
  if exists (select 1 from public.withdrawal_reservations where state = 'held') then
    raise exception 'Some holds could not be returned (wallet missing); nothing was changed';
  end if;
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

  v_is_credit := v_txn.type in (
    'deposit', 'admin_credit', 'investment_withdrawal', 'investment_interest_claim'
  );
  v_delta := case when v_is_credit then v_txn.amount_usd else -v_txn.amount_usd end;
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


alter function public._finalize_claimed_transaction(uuid, uuid) owner to postgres;
alter function public.claim_transaction_for_approval(uuid, text) owner to postgres;
alter function public.reject_pending_transaction(uuid, text) owner to postgres;

revoke all on function public._finalize_claimed_transaction(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.claim_transaction_for_approval(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.reject_pending_transaction(uuid, text)
  from public, anon, authenticated, service_role;

grant execute on function public.claim_transaction_for_approval(uuid, text)
  to authenticated;
grant execute on function public.reject_pending_transaction(uuid, text)
  to authenticated;

drop function public.request_withdrawal(uuid, numeric, text, text, numeric, text, text);

commit;
