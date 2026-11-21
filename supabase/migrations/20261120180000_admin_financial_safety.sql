do $$
begin
  if current_user <> 'postgres' then
    raise exception 'Apply this migration as postgres';
  end if;
end;
$$;

create table public.admin_financial_operation_claims (
  transaction_id uuid primary key
    references public.transactions (id) on delete cascade,
  claim_token uuid not null unique,
  action text not null check (action in ('verify', 'reject')),
  state text not null check (state in ('processing', 'uncertain', 'completed', 'rejected', 'released')),
  admin_id uuid not null references public.profiles (id),
  admin_note text,
  provider_evidence jsonb not null default '{}'::jsonb,
  recovery_note text,
  recovery_operator_label text,
  reconciled_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now()
);

create table public.admin_wallet_adjustment_requests (
  request_id uuid primary key,
  admin_id uuid not null references public.profiles (id),
  user_id uuid not null references public.profiles (id),
  adjustment_type text not null check (adjustment_type in ('credit', 'debit')),
  amount numeric not null check (amount > 0),
  reason text not null,
  transaction_id uuid unique references public.transactions (id),
  resulting_balance numeric(14,2),
  created_at timestamptz not null default pg_catalog.now()
);

alter table public.admin_financial_operation_claims enable row level security;
alter table public.admin_wallet_adjustment_requests enable row level security;

revoke all on table public.admin_financial_operation_claims
  from public, anon, authenticated, service_role;
revoke all on table public.admin_wallet_adjustment_requests
  from public, anon, authenticated, service_role;

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

create or replace function public.adjust_wallet_with_transaction(
  p_request_id uuid,
  p_user_id uuid,
  p_adjustment_type text,
  p_amount numeric,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin_id uuid := auth.uid();
  v_existing public.admin_wallet_adjustment_requests%rowtype;
  v_balance numeric(14,2);
  v_delta numeric(14,2);
  v_transaction_id uuid;
  v_inserted integer;
begin
  if v_admin_id is null or not public.is_admin() then
    raise exception 'Only admins can adjust wallet balances';
  end if;

  if p_request_id is null or p_user_id is null
    or p_adjustment_type not in ('credit', 'debit')
    or p_amount is null or p_amount <= 0
    or p_reason is null or pg_catalog.btrim(p_reason) = '' then
    raise exception 'Invalid wallet adjustment';
  end if;

  insert into public.admin_wallet_adjustment_requests (
    request_id, admin_id, user_id, adjustment_type, amount, reason,
    transaction_id, resulting_balance
  )
  values (
    p_request_id, v_admin_id, p_user_id, p_adjustment_type,
    p_amount, pg_catalog.btrim(p_reason),
    null, null
  )
  on conflict (request_id) do nothing;

  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    select * into v_existing
    from public.admin_wallet_adjustment_requests
    where request_id = p_request_id
    for update;

    if v_existing.admin_id <> v_admin_id
      or v_existing.user_id <> p_user_id
      or v_existing.adjustment_type <> p_adjustment_type
      or v_existing.amount <> p_amount
      or v_existing.reason <> pg_catalog.btrim(p_reason) then
      raise exception 'Request ID was already used for a different adjustment';
    end if;

    return pg_catalog.jsonb_build_object(
      'transactionId', v_existing.transaction_id,
      'newBalance', v_existing.resulting_balance,
      'duplicate', true
    );
  end if;

  select balance_usd into v_balance
  from public.wallets
  where user_id = p_user_id
  for update;

  if not found then
    raise exception 'Wallet not found for this user';
  end if;

  v_delta := case
    when p_adjustment_type = 'credit' then p_amount
    else -p_amount
  end;

  if v_balance + v_delta < 0 then
    raise exception 'This would take the user balance negative';
  end if;

  update public.wallets
  set balance_usd = balance_usd + v_delta,
      updated_at = pg_catalog.now()
  where user_id = p_user_id
  returning balance_usd into v_balance;

  insert into public.transactions (
    user_id, type, amount_usd, status, admin_note, verified_by, verified_at
  )
  values (
    p_user_id,
    case when p_adjustment_type = 'credit' then 'admin_credit' else 'admin_debit' end,
    p_amount,
    'verified',
    pg_catalog.btrim(p_reason),
    v_admin_id,
    pg_catalog.now()
  )
  returning id into v_transaction_id;

  update public.admin_wallet_adjustment_requests
  set transaction_id = v_transaction_id,
      resulting_balance = v_balance
  where request_id = p_request_id;

  return pg_catalog.jsonb_build_object(
    'transactionId', v_transaction_id,
    'newBalance', v_balance,
    'duplicate', false
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

create or replace function public.record_transaction_claim_evidence(
  p_transaction_id uuid,
  p_claim_token uuid,
  p_provider_evidence jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Only admins can record transaction processing evidence';
  end if;

  update public.admin_financial_operation_claims
  set provider_evidence = provider_evidence || coalesce(p_provider_evidence, '{}'::jsonb),
      updated_at = pg_catalog.now()
  where transaction_id = p_transaction_id
    and claim_token = p_claim_token
    and admin_id = auth.uid()
    and action = 'verify'
    and state = 'processing';

  if not found then
    raise exception 'No matching processing claim';
  end if;

end;
$$;

create or replace function public.mark_transaction_claim_uncertain(
  p_transaction_id uuid,
  p_claim_token uuid,
  p_provider_evidence jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Only admins can mark transaction processing uncertain';
  end if;

  update public.admin_financial_operation_claims
  set state = 'uncertain',
      provider_evidence = provider_evidence || coalesce(p_provider_evidence, '{}'::jsonb),
      updated_at = pg_catalog.now()
  where transaction_id = p_transaction_id
    and claim_token = p_claim_token
    and admin_id = auth.uid()
    and action = 'verify'
    and state = 'processing';

  if not found then
    raise exception 'No matching processing claim';
  end if;

  update public.transactions
  set send_error = coalesce(p_provider_evidence ->> 'sendError', send_error)
  where id = p_transaction_id and status = 'pending';
end;
$$;

create or replace function public.release_transaction_claim(
  p_transaction_id uuid,
  p_claim_token uuid,
  p_provider_evidence jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Only admins can release transaction processing claims';
  end if;

  update public.admin_financial_operation_claims
  set state = 'released',
      provider_evidence = provider_evidence || coalesce(p_provider_evidence, '{}'::jsonb),
      updated_at = pg_catalog.now()
  where transaction_id = p_transaction_id
    and claim_token = p_claim_token
    and admin_id = auth.uid()
    and action = 'verify'
    and state = 'processing';

  if not found then
    raise exception 'No matching processing claim';
  end if;

  update public.transactions
  set stripe_payment_intent_id = coalesce(
        p_provider_evidence ->> 'stripePaymentIntentId', stripe_payment_intent_id
      ),
      stripe_payment_intent_status = coalesce(
        p_provider_evidence ->> 'stripePaymentIntentStatus', stripe_payment_intent_status
      ),
      send_error = coalesce(p_provider_evidence ->> 'sendError', send_error)
  where id = p_transaction_id and status = 'pending';
end;
$$;

create or replace function public.finalize_transaction_approval(
  p_transaction_id uuid,
  p_claim_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin_id uuid;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Only admins can approve transactions';
  end if;

  select admin_id into v_admin_id
  from public.admin_financial_operation_claims
  where transaction_id = p_transaction_id
    and claim_token = p_claim_token;

  if v_admin_id is distinct from auth.uid() then
    raise exception 'Transaction claim belongs to a different admin';
  end if;

  return public._finalize_claimed_transaction(p_transaction_id, p_claim_token);
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
  set balance_usd = balance_usd + v_investment.amount_usd,
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

  return pg_catalog.jsonb_build_object(
    'userId', v_investment.user_id,
    'amountUsd', v_investment.amount_usd,
    'newBalance', v_new_balance,
    'reversedPendingClaims', v_reversed
  );
end;
$$;

create or replace function public.reconcile_transaction_processing_claim(
  p_transaction_id uuid,
  p_claim_token uuid,
  p_outcome text,
  p_operator_label text,
  p_recovery_note text,
  p_provider_evidence jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim public.admin_financial_operation_claims%rowtype;
begin
  if p_operator_label is null or pg_catalog.btrim(p_operator_label) = ''
    or p_recovery_note is null or pg_catalog.btrim(p_recovery_note) = '' then
    raise exception 'Operator label and recovery note are required';
  end if;

  select * into v_claim
  from public.admin_financial_operation_claims
  where transaction_id = p_transaction_id
    and claim_token = p_claim_token
    and action = 'verify'
    and state in ('processing', 'uncertain')
  for update;

  if not found then
    raise exception 'No matching uncertain processing claim';
  end if;

  update public.admin_financial_operation_claims
  set provider_evidence = provider_evidence || coalesce(p_provider_evidence, '{}'::jsonb),
      recovery_note = pg_catalog.btrim(p_recovery_note),
      recovery_operator_label = pg_catalog.btrim(p_operator_label),
      reconciled_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
  where transaction_id = p_transaction_id;

  if p_outcome = 'accepted' then
    return public._finalize_claimed_transaction(p_transaction_id, p_claim_token);
  elsif p_outcome = 'not_accepted' then
    update public.admin_financial_operation_claims
    set state = 'released'
    where transaction_id = p_transaction_id;

    update public.transactions
    set stripe_payment_intent_id = coalesce(
          p_provider_evidence ->> 'stripePaymentIntentId', stripe_payment_intent_id
        ),
        stripe_payment_intent_status = coalesce(
          p_provider_evidence ->> 'stripePaymentIntentStatus', stripe_payment_intent_status
        ),
        send_error = coalesce(p_provider_evidence ->> 'sendError', send_error)
    where id = p_transaction_id and status = 'pending';

    return pg_catalog.jsonb_build_object('released', true);
  else
    raise exception 'Outcome must be accepted or not_accepted';
  end if;
end;
$$;

alter function public._finalize_claimed_transaction(uuid, uuid) owner to postgres;
alter function public.adjust_wallet_with_transaction(uuid, uuid, text, numeric, text) owner to postgres;
alter function public.claim_transaction_for_approval(uuid, text) owner to postgres;
alter function public.record_transaction_claim_evidence(uuid, uuid, jsonb) owner to postgres;
alter function public.mark_transaction_claim_uncertain(uuid, uuid, jsonb) owner to postgres;
alter function public.release_transaction_claim(uuid, uuid, jsonb) owner to postgres;
alter function public.finalize_transaction_approval(uuid, uuid) owner to postgres;
alter function public.reject_pending_transaction(uuid, text) owner to postgres;
alter function public.cancel_investment_atomically(uuid, text) owner to postgres;
alter function public.reconcile_transaction_processing_claim(uuid, uuid, text, text, text, jsonb) owner to postgres;

revoke all on function public._finalize_claimed_transaction(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.adjust_wallet_with_transaction(uuid, uuid, text, numeric, text)
  from public, anon, authenticated, service_role;
revoke all on function public.claim_transaction_for_approval(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.record_transaction_claim_evidence(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.mark_transaction_claim_uncertain(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.release_transaction_claim(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.finalize_transaction_approval(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.reject_pending_transaction(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.cancel_investment_atomically(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.reconcile_transaction_processing_claim(uuid, uuid, text, text, text, jsonb)
  from public, anon, authenticated, service_role;

grant execute on function public.adjust_wallet_with_transaction(uuid, uuid, text, numeric, text)
  to authenticated;
grant execute on function public.claim_transaction_for_approval(uuid, text)
  to authenticated;
grant execute on function public.record_transaction_claim_evidence(uuid, uuid, jsonb)
  to authenticated;
grant execute on function public.mark_transaction_claim_uncertain(uuid, uuid, jsonb)
  to authenticated;
grant execute on function public.release_transaction_claim(uuid, uuid, jsonb)
  to authenticated;
grant execute on function public.finalize_transaction_approval(uuid, uuid)
  to authenticated;
grant execute on function public.reject_pending_transaction(uuid, text)
  to authenticated;
grant execute on function public.cancel_investment_atomically(uuid, text)
  to authenticated;
grant execute on function public.reconcile_transaction_processing_claim(uuid, uuid, text, text, text, jsonb)
  to service_role;
