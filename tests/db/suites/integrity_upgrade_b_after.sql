-- Integrity upgrade, phase B: 20261123000000 applied on top of phase A.
set client_min_messages = notice;

\echo '=== Upgrade preserves every existing record'
select public.t_ok((select md5(string_agg((to_jsonb(t) - 'claimed_interest_allocated')::text, '|' order by id)) from public.transactions t)
                   = (select v from t_snap where k = 'transactions'), 'every transaction row unchanged (incl. rejection notes, fee records)');
select public.t_ok((select md5(string_agg((to_jsonb(i) - 'withdrawn_claimed_interest')::text, '|' order by id)) from public.investments i)
                   = (select v from t_snap where k = 'investments'), 'every investment row unchanged');
select public.t_ok((select md5(string_agg(to_jsonb(w)::text, '|' order by user_id)) from public.wallets w)
                   = (select v from t_snap where k = 'wallets'), 'every wallet balance unchanged');
select public.t_ok((select count(*) from public.investments where withdrawn_claimed_interest <> 0) = 0, 'new allocation column starts at 0 for all investments');
select public.t_ok((select count(*) from public.transactions where type = 'early_withdrawal_fee_refund') = 0, 'upgrade issues no refunds by itself');

\echo '=== Valuation unchanged for existing investments'
-- Compared with the production formula evaluated at the same instant (the
-- snapshot in phase A was taken seconds earlier, so interest has accrued).
select public.t_ok(not exists (
  select 1 from public.investments_with_value v
  join public.investments i on i.id = v.id join public.investment_plans p on p.id = i.plan_id
  where abs(v.current_value - ((i.amount_usd - i.withdrawn_principal)
          * (1::numeric + p.apy_percent / 100.0 * least(extract(epoch from now() - i.started_at) / 86400.0, p.term_days::numeric) / 365.0)
          - i.claimed_interest + i.admin_profit)) > 0.000000001), 'current_value identical to the production formula for every investment');
select public.t_ok(not exists (
  select 1 from public.investments_with_value v join t_view o using (id)
  where o.available_to_withdraw = v.available_to_withdraw
    and not exists (select 1 from public.transactions t where t.investment_id = v.id and t.type = 'investment_withdrawal' and t.status = 'pending')
    and abs(v.available_to_claim - o.available_to_claim) >= 0.01), 'available_to_claim identical (to the cent) where no withdrawal is pending');

\echo '=== Historical and in-flight items'
select public.t_ok(public.bal(public.id('u21')) = 300 and public.refunds_of(public.fee_of(public.id('w21'))) = 0,
                   'historical rejected fee is NOT refunded automatically (left for reconciliation)');
select public.t_reject(public.id('w22'), 'Rejected after upgrade');
select public.t_ok(public.bal(public.id('u22')) = 1000 and public.refunds_of(public.fee_of(public.id('w22'))) = 1,
                   'withdrawal pending at upgrade: rejection now refunds its wallet-funded fee');
select public.t_approve(public.id('c23'));
-- The old function stored the claim unrounded (29.589...). Approval credits the
-- wallet in whole cents (existing V2 behaviour: numeric(14,2) delta) and records
-- the stored amount in claimed_interest.
select public.t_ok(public.bal(public.id('u23')) = round((public.tx(public.id('c23'))).amount_usd, 2)
                   and (public.inv(public.id('i23'))).claimed_interest = (public.tx(public.id('c23'))).amount_usd
                   and (public.tx(public.id('c23'))).status = 'verified',
                   'legitimate claim pending at upgrade is approved normally');
