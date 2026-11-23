-- Financial operation controls: withdrawal payouts and bank-deposit pulls
-- are frozen in the database, withdrawals can only be paid against a valid
-- funds hold, customers can no longer insert withdrawals or pre-verified
-- deposits, and customer-typed crypto amounts are no longer stored.
--
-- Changes no existing row in any existing table: balances, wallets,
-- transactions, holds, claims, investments, referrals and audit records are
-- untouched. Adds one switch table (both operations OFF) and its append-only
-- log, replaces two function bodies, and replaces one RLS policy.
--
-- 1. FREEZE. claim_transaction_for_approval (the step before every external
--    payment) refuses to approve a withdrawal while
--    financial_operation_controls.withdrawal_payouts is off, and a bank-pull
--    deposit (payment_method 'bank') while bank_deposit_pulls is off. Both
--    start OFF; this migration never turns them on. Rejections are not
--    affected (a rejection only releases the hold back to the customer).
--    The switch row is read FOR SHARE, so turning an operation off waits
--    for approvals already being claimed and every later claim sees it.
-- 2. DELIBERATE, AUDITED ENABLING. Only postgres can change a switch,
--    through set_financial_operation_enabled(operation, enabled, operator,
--    reason, confirmation); enabling needs the exact confirmation
--    'ENABLE WITHDRAWAL PAYOUTS' or 'ENABLE BANK DEPOSIT PULLS'. Every change
--    is logged in financial_operation_control_events (append-only).
-- 3. VALID HOLD REQUIRED. A withdrawal is approved only if it has a 'held'
--    funds hold for the same customer and exactly amount_usd. The previous
--    version created a hold at approval time for withdrawals that had none
--    (debiting the balance then); that is removed: such withdrawals stay
--    pending for manual review and no balance is changed.
-- 4. VALIDATION BEFORE PAYMENT. The claim also checks the amount, the
--    coin (BTC, ETH or USDT) and the destination before the application can
--    contact any payment provider.
-- 5. CUSTOMER INSERTS. The policy "Users can submit their own deposit
--    claims" allowed customers to insert withdrawals and deposits with ANY
--    status, amounts and verification fields. It is replaced by a policy
--    that allows only pending crypto or bank-transfer ('wire') deposit
--    claims with no verification, payout or investment fields. Withdrawals
--    can then only be created by request_withdrawal.
-- 6. CRYPTO AMOUNT. request_withdrawal no longer stores the customer-typed
--    crypto amount (the server calculates it from a trusted price at
--    approval) and validates the coin and destination address format.
--
-- Requires 20261126000000_referral_payout_freeze.sql. Rollback:
-- supabase/rollback/20261127000000_financial_operation_controls_rollback.sql.

do $$
declare
  v_fp record;
  v_policies text;
begin
  if current_user <> 'postgres' then
    raise exception 'Apply this migration as postgres';
  end if;
  if to_regclass('public.referral_payout_controls') is null then
    raise exception 'Apply 20261126000000_referral_payout_freeze.sql first';
  end if;
  if to_regclass('public.financial_operation_controls') is not null
     or to_regclass('public.financial_operation_control_events') is not null
     or to_regprocedure('public.set_financial_operation_enabled(text, boolean, text, text, text)') is not null then
    raise exception 'Financial operation controls already exist: this migration was applied before';
  end if;

  -- The bodies replaced here must be exactly the reviewed 20261122000000 versions.
  for v_fp in
    select f.sig, f.expected, md5(replace(p.prosrc, chr(13), '')) as actual
    from (values
      ('public.claim_transaction_for_approval(uuid, text)', '8e37d7cc0cf29ce765e497cfd7b26b6e'),
      ('public.request_withdrawal(uuid, numeric, text, text, numeric, text, text)', '43f0483ce7afd6bd5e7c1b3cf5a9e8f7')
    ) f(sig, expected)
    left join pg_catalog.pg_proc p on p.oid = to_regprocedure(f.sig)
  loop
    if v_fp.actual is distinct from v_fp.expected then
      raise exception '% differs from the reviewed version (md5 %, expected %)', v_fp.sig, coalesce(v_fp.actual, 'missing'), v_fp.expected;
    end if;
  end loop;

  -- The only customer INSERT policy on transactions must be the reviewed one.
  select string_agg(pol.polname, ', ' order by pol.polname) into v_policies
  from pg_catalog.pg_policy pol
  where pol.polrelid = 'public.transactions'::regclass and pol.polcmd in ('a', '*');
  if v_policies is distinct from 'Users can submit their own deposit claims' then
    raise exception 'Unexpected INSERT policies on public.transactions: %', coalesce(v_policies, 'none');
  end if;

  -- Every column the new insert policy refers to must exist.
  select string_agg(w.col, ', ') into v_policies
  from (values ('user_id'), ('type'), ('status'), ('amount_usd'), ('payment_method'), ('linked_bank_account_id'),
               ('verified_by'), ('verified_at'), ('onchain_verification'), ('onchain_checked_at'), ('investment_id'),
               ('principal_portion'), ('forfeited_interest'), ('fee_charged'), ('stripe_payment_intent_id'),
               ('stripe_payment_intent_status'), ('destination_address'), ('sent_tx_hash'), ('sent_at'), ('send_error'),
               ('related_transaction_id'), ('claimed_interest_allocated')) w(col)
  where not exists (select 1 from information_schema.columns c
                    where c.table_schema = 'public' and c.table_name = 'transactions' and c.column_name = w.col);
  if v_policies is not null then
    raise exception 'public.transactions is missing expected columns: %', v_policies;
  end if;

  if pg_catalog.pg_get_userbyid((select relowner from pg_catalog.pg_class where oid = 'public.transactions'::regclass)) <> 'postgres' then
    raise exception 'public.transactions must be owned by postgres';
  end if;
end;
$$;

-- ===========================================================================
-- 1-2. Switches (both OFF) and their append-only change log
-- ===========================================================================
create table public.financial_operation_controls (
  operation text primary key check (operation in ('withdrawal_payouts', 'bank_deposit_pulls')),
  enabled boolean not null default false,
  updated_at timestamptz not null default pg_catalog.now(),
  updated_by text not null
);
insert into public.financial_operation_controls (operation, enabled, updated_by) values
  ('withdrawal_payouts', false, 'migration 20261127000000'),
  ('bank_deposit_pulls', false, 'migration 20261127000000');

create table public.financial_operation_control_events (
  id bigint generated always as identity primary key,
  operation text not null check (operation in ('withdrawal_payouts', 'bank_deposit_pulls')),
  enabled boolean not null,
  operator text not null check (pg_catalog.length(pg_catalog.btrim(operator)) between 1 and 200),
  reason text not null check (pg_catalog.length(pg_catalog.btrim(reason)) between 1 and 1000),
  database_user text not null default session_user,
  created_at timestamptz not null default pg_catalog.now()
);
insert into public.financial_operation_control_events (operation, enabled, operator, reason) values
  ('withdrawal_payouts', false, 'migration 20261127000000', 'Withdrawal payouts frozen by default when the database controls were installed.'),
  ('bank_deposit_pulls', false, 'migration 20261127000000', 'Bank deposit pulls frozen by default when the database controls were installed.');

alter table public.financial_operation_controls enable row level security;
alter table public.financial_operation_control_events enable row level security;
revoke all on table public.financial_operation_controls, public.financial_operation_control_events
  from public, anon, authenticated, service_role;
grant select on table public.financial_operation_controls, public.financial_operation_control_events to authenticated;
create policy "Admins can read financial operation switches" on public.financial_operation_controls
  for select to authenticated using (public.is_admin());
create policy "Admins can read financial operation switch changes" on public.financial_operation_control_events
  for select to authenticated using (public.is_admin());

create or replace function public._guard_financial_operation_controls()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op in ('DELETE', 'TRUNCATE') then
    raise exception 'Financial operation switches and their change log cannot be deleted';
  end if;
  if tg_table_name = 'financial_operation_control_events' and tg_op = 'UPDATE' then
    raise exception 'Financial operation switch changes are append-only';
  end if;
  if pg_catalog.current_setting('vestora.financial_operation_change', true) is distinct from 'authorised' then
    raise exception 'Use public.set_financial_operation_enabled to change financial operation switches';
  end if;
  return new;
end;
$$;

create trigger vestora_guard_financial_operation_controls
  before insert or update or delete on public.financial_operation_controls
  for each row execute function public._guard_financial_operation_controls();
create trigger vestora_guard_financial_operation_controls_truncate
  before truncate on public.financial_operation_controls
  for each statement execute function public._guard_financial_operation_controls();
create trigger vestora_guard_financial_operation_control_events
  before insert or update or delete on public.financial_operation_control_events
  for each row execute function public._guard_financial_operation_controls();
create trigger vestora_guard_financial_operation_control_events_truncate
  before truncate on public.financial_operation_control_events
  for each statement execute function public._guard_financial_operation_controls();

-- Reads one switch FOR SHARE (a missing row means OFF).
create or replace function public._financial_operation_enabled(p_operation text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enabled boolean;
begin
  select c.enabled into v_enabled
  from public.financial_operation_controls c
  where c.operation = p_operation
  for share;
  return coalesce(v_enabled, false);
end;
$$;

-- The only way to change a switch. Run as postgres, for example:
--   select public.set_financial_operation_enabled('withdrawal_payouts', true, 'Jane Operator',
--     'Approved release of withdrawal payouts', 'ENABLE WITHDRAWAL PAYOUTS');
--   select public.set_financial_operation_enabled('withdrawal_payouts', false, 'Jane Operator', 'Freeze');
create or replace function public.set_financial_operation_enabled(
  p_operation text, p_enabled boolean, p_operator text, p_reason text, p_confirmation text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_current boolean;
  v_expected_confirmation text;
begin
  if current_user <> 'postgres' then
    raise exception 'Only the database owner (postgres) can change financial operation switches';
  end if;
  if p_operation is null or p_operation not in ('withdrawal_payouts', 'bank_deposit_pulls') then
    raise exception 'Unknown financial operation (withdrawal_payouts or bank_deposit_pulls)';
  end if;
  if p_enabled is null then
    raise exception 'State whether the operation is enabled (true) or disabled (false)';
  end if;
  if p_operator is null or pg_catalog.length(pg_catalog.btrim(p_operator)) not between 1 and 200 then
    raise exception 'An operator name (1-200 characters) is required';
  end if;
  if p_reason is null or pg_catalog.length(pg_catalog.btrim(p_reason)) not between 1 and 1000 then
    raise exception 'A reason (1-1000 characters) is required';
  end if;
  v_expected_confirmation := case p_operation
                               when 'withdrawal_payouts' then 'ENABLE WITHDRAWAL PAYOUTS'
                               else 'ENABLE BANK DEPOSIT PULLS' end;
  if p_enabled and p_confirmation is distinct from v_expected_confirmation then
    raise exception 'To enable %, pass the confirmation ''%''', p_operation, v_expected_confirmation;
  end if;

  select c.enabled into v_current
  from public.financial_operation_controls c
  where c.operation = p_operation
  for update;
  if not found then
    raise exception 'The % switch row is missing; the operation stays disabled', p_operation;
  end if;
  if v_current = p_enabled then
    return pg_catalog.jsonb_build_object('operation', p_operation, 'enabled', v_current, 'changed', false);
  end if;

  perform pg_catalog.set_config('vestora.financial_operation_change', 'authorised', true);
  update public.financial_operation_controls
  set enabled = p_enabled, updated_at = pg_catalog.now(), updated_by = pg_catalog.btrim(p_operator)
  where operation = p_operation;
  insert into public.financial_operation_control_events (operation, enabled, operator, reason)
  values (p_operation, p_enabled, pg_catalog.btrim(p_operator), pg_catalog.btrim(p_reason));
  perform pg_catalog.set_config('vestora.financial_operation_change', '', true);

  return pg_catalog.jsonb_build_object('operation', p_operation, 'enabled', p_enabled, 'changed', true);
end;
$$;

-- ===========================================================================
-- 1, 3, 4. claim_transaction_for_approval: freeze, valid hold, validation
-- ===========================================================================
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
  v_reservation public.withdrawal_reservations%rowtype;
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

  -- 20261127000000: every check that can stop a payment runs here, before
  -- the application contacts any payment provider. Placed before the claim
  -- lookup so the FOUND checks below keep their original meaning.
  if v_txn.type = 'withdrawal' then
    -- Freeze: no withdrawal is approved while payouts are disabled.
    if not public._financial_operation_enabled('withdrawal_payouts') then
      raise exception 'Withdrawal payouts are disabled';
    end if;

    -- Only against the funds already held for exactly this withdrawal. A
    -- withdrawal without such a hold (created before holds existed, or
    -- inserted directly) stays pending for manual review; no hold is
    -- created and no balance is changed here.
    select * into v_reservation
    from public.withdrawal_reservations
    where transaction_id = p_transaction_id
    for update;

    if not found
       or v_reservation.state <> 'held'
       or v_reservation.user_id <> v_txn.user_id
       or v_reservation.amount <> v_txn.amount_usd then
      raise exception 'Withdrawal has no valid funds hold; manual review required';
    end if;

    if v_txn.amount_usd is null or v_txn.amount_usd <= 0
       or v_txn.amount_usd <> pg_catalog.round(v_txn.amount_usd, 2) then
      raise exception 'Withdrawal amount is invalid; manual review required';
    end if;

    if v_txn.payment_method is null or v_txn.payment_method not in ('crypto', 'bank', 'wire') then
      raise exception 'Withdrawal payment method is invalid; manual review required';
    end if;

    if v_txn.payment_method = 'crypto' and (
      v_txn.crypto_currency is null or v_txn.crypto_currency not in ('BTC', 'ETH', 'USDT')
      or v_txn.destination_address is null or pg_catalog.btrim(v_txn.destination_address) = ''
    ) then
      raise exception 'Crypto withdrawal details are invalid; manual review required';
    end if;

    if not exists (select 1 from public.wallets where user_id = v_txn.user_id) then
      raise exception 'Wallet not found for this user';
    end if;
  elsif v_txn.type = 'deposit' and v_txn.payment_method = 'bank' then
    -- Freeze: no bank pull (charging the customer's bank) while disabled.
    if not public._financial_operation_enabled('bank_deposit_pulls') then
      raise exception 'Bank deposit pulls are disabled';
    end if;
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

-- ===========================================================================
-- 6. request_withdrawal: no customer-typed crypto amount; coin and address checks
-- ===========================================================================
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

  -- 20261127000000: the crypto amount is no longer taken from the customer
  -- (p_crypto_amount is accepted for compatibility and ignored); the server
  -- calculates it from a trusted price when an admin approves. The coin and
  -- the destination address format are validated here.
  if p_payment_method = 'crypto' and (
    p_crypto_currency is null
    or pg_catalog.upper(pg_catalog.btrim(p_crypto_currency)) not in ('BTC', 'ETH', 'USDT')
    or p_destination_address is null or pg_catalog.btrim(p_destination_address) = ''
    or pg_catalog.length(pg_catalog.btrim(p_destination_address)) > 120
    or (pg_catalog.upper(pg_catalog.btrim(p_crypto_currency)) in ('ETH', 'USDT')
        and pg_catalog.btrim(p_destination_address) !~ '^0x[0-9a-fA-F]{40}$')
    or (pg_catalog.upper(pg_catalog.btrim(p_crypto_currency)) = 'BTC'
        and pg_catalog.btrim(p_destination_address) !~ '^((bc1|tb1)[02-9ac-hj-np-z]{8,87}|[123mn][1-9A-HJ-NP-Za-km-z]{25,39})$')
  ) then
    raise exception 'Crypto withdrawals need BTC, ETH or USDT and a valid destination address';
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
    case when p_payment_method = 'crypto' then pg_catalog.upper(pg_catalog.btrim(p_crypto_currency)) end,
    null::numeric,
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

-- ===========================================================================
-- 5. Customers may insert only pending crypto / bank-transfer deposit claims
-- ===========================================================================
drop policy "Users can submit their own deposit claims" on public.transactions;
create policy "Customers can submit pending deposit claims" on public.transactions
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and type = 'deposit'
    and status = 'pending'
    and amount_usd > 0
    and payment_method in ('crypto', 'wire')
    and linked_bank_account_id is null
    and verified_by is null and verified_at is null
    and onchain_verification is null and onchain_checked_at is null
    and investment_id is null and principal_portion is null
    and forfeited_interest is null and fee_charged is null
    and stripe_payment_intent_id is null and stripe_payment_intent_status is null
    and destination_address is null
    and sent_tx_hash is null and sent_at is null and send_error is null
    and related_transaction_id is null and claimed_interest_allocated is null
  );

-- ===========================================================================
-- Ownership and permissions
-- ===========================================================================
alter table public.financial_operation_controls owner to postgres;
alter table public.financial_operation_control_events owner to postgres;
alter function public._guard_financial_operation_controls() owner to postgres;
alter function public._financial_operation_enabled(text) owner to postgres;
alter function public.set_financial_operation_enabled(text, boolean, text, text, text) owner to postgres;
alter function public.claim_transaction_for_approval(uuid, text) owner to postgres;
alter function public.request_withdrawal(uuid, numeric, text, text, numeric, text, text) owner to postgres;

revoke all on function
  public._guard_financial_operation_controls(),
  public._financial_operation_enabled(text),
  public.set_financial_operation_enabled(text, boolean, text, text, text),
  public.claim_transaction_for_approval(uuid, text),
  public.request_withdrawal(uuid, numeric, text, text, numeric, text, text)
from public, anon, authenticated, service_role;

-- Unchanged from 20261122000000: admins claim with their own session;
-- customers request withdrawals with theirs.
grant execute on function public.claim_transaction_for_approval(uuid, text) to authenticated;
grant execute on function public.request_withdrawal(uuid, numeric, text, text, numeric, text, text) to authenticated;
