-- Production baseline: definitions exported from the live Supabase database
-- on 2026-11-22 (pg_get_functiondef / pg_get_viewdef), loaded into the
-- disposable test database BEFORE the repository migrations so tests run
-- against the same functions production has. These are the "before" state
-- the migrations change; do not edit by hand.
--
-- _finalize_claimed_transaction, claim_transaction_for_approval and
-- reject_pending_transaction are not repeated here: production's versions are
-- identical to supabase/migrations/20261120180000_admin_financial_safety.sql.

CREATE OR REPLACE FUNCTION public.create_investment(p_plan_id uuid, p_amount_usd numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_plan record;
  v_balance numeric;
  v_investment_id uuid;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_plan from public.investment_plans where id = p_plan_id and is_active;
  if not found then
    raise exception 'Investment plan not found or inactive';
  end if;

  if p_amount_usd < v_plan.min_amount then
    raise exception 'Minimum investment for this plan is %', v_plan.min_amount;
  end if;

  select balance_usd into v_balance from public.wallets where user_id = v_user_id for update;
  if v_balance is null then
    raise exception 'No wallet found';
  end if;
  if v_balance < p_amount_usd then
    raise exception 'Insufficient wallet balance';
  end if;

  update public.wallets
  set balance_usd = balance_usd - p_amount_usd, updated_at = now()
  where user_id = v_user_id;

  insert into public.investments (user_id, plan_id, amount_usd, matures_at)
  values (v_user_id, p_plan_id, p_amount_usd, now() + (v_plan.term_days || ' days')::interval)
  returning id into v_investment_id;

  return v_investment_id;
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

  v_remaining_principal := v_inv.amount_usd - v_inv.withdrawn_principal;
  v_days_elapsed := extract(epoch from (now() - v_inv.started_at)) / 86400.0;
  v_days_counted := least(v_days_elapsed, v_plan.term_days);
  v_total_accrued := v_remaining_principal * ((v_plan.apy_percent / 100.0) * v_days_counted / 365.0);

  select coalesce(sum(amount_usd), 0) into v_pending_claims
  from public.transactions
  where investment_id = p_investment_id
    and type = 'investment_interest_claim'
    and status = 'pending';

  if now() >= v_inv.matures_at then
    v_claimable := v_total_accrued + v_inv.admin_profit - v_inv.claimed_interest - v_pending_claims;
  else
    -- before maturity only admin-credited profit can be claimed
    v_claimable := v_inv.admin_profit - v_inv.claimed_interest - v_pending_claims;
  end if;

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

  v_unclaimed_profit := greatest(v_inv.admin_profit - v_inv.claimed_interest - v_pending_claims, 0);

  if p_principal_amount >= v_available_principal - 0.005 and v_unclaimed_profit > 0.01 then
    raise exception 'Claim your profit of % first, then withdraw the full amount', round(v_unclaimed_profit, 2);
  end if;

  v_days_elapsed := extract(epoch from (now() - v_inv.started_at)) / 86400.0;
  v_days_counted := least(v_days_elapsed, v_plan.term_days);
  v_is_matured := now() >= v_inv.matures_at;

  if v_is_matured then
    v_interest_on_portion := p_principal_amount * ((v_plan.apy_percent / 100.0) * v_plan.term_days / 365.0);
    v_forfeited := 0;
    v_fee := 0;
  else
    v_interest_on_portion := 0;
    v_forfeited := greatest(
      p_principal_amount * ((v_plan.apy_percent / 100.0) * v_days_counted / 365.0)
      - case when v_remaining_principal > 0
             then v_inv.claimed_interest * (p_principal_amount / v_remaining_principal)
             else 0 end,
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
    investment_id, principal_portion, forfeited_interest, fee_charged
  )
  values (
    v_user_id, 'investment_withdrawal', v_payout, 'pending',
    p_investment_id, p_principal_amount, v_forfeited, v_fee
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

create view public.investments_with_value as
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
    (i.amount_usd - i.withdrawn_principal) * (1::numeric + p.apy_percent / 100.0 * LEAST(EXTRACT(epoch FROM now() - i.started_at) / 86400.0, p.term_days::numeric) / 365.0) - i.claimed_interest + i.admin_profit AS current_value,
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
        CASE
            WHEN now() >= i.matures_at THEN GREATEST((i.amount_usd - i.withdrawn_principal) * (p.apy_percent / 100.0 * LEAST(EXTRACT(epoch FROM now() - i.started_at) / 86400.0, p.term_days::numeric) / 365.0) - i.claimed_interest + i.admin_profit - COALESCE(( SELECT sum(t.amount_usd) AS sum
               FROM transactions t
              WHERE t.investment_id = i.id AND t.type = 'investment_interest_claim'::text AND t.status = 'pending'::text), 0::numeric), 0::numeric)
            ELSE GREATEST(i.admin_profit - i.claimed_interest - COALESCE(( SELECT sum(t.amount_usd) AS sum
               FROM transactions t
              WHERE t.investment_id = i.id AND t.type = 'investment_interest_claim'::text AND t.status = 'pending'::text), 0::numeric), 0::numeric)
        END AS available_to_claim,
    i.admin_profit
   FROM investments i
     JOIN investment_plans p ON p.id = i.plan_id;

alter table public.investments enable row level security;
create policy "Users can view their own investments" on public.investments for select to authenticated
  using (auth.uid() = user_id or public.is_admin());
grant select on public.investments, public.investments_with_value, public.investment_plans, public.settings to authenticated;
grant execute on function public.create_investment(uuid, numeric),
  public.claim_investment_gains(uuid),
  public.request_investment_withdrawal(uuid, numeric) to authenticated;
