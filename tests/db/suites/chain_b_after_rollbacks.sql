-- Migration chain, phase B: all three migrations applied, then rolled back in
-- reverse order (20261124000000, 20261123000000, then 20261122000000).
set client_min_messages = notice;
create or replace function public.t_ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if coalesce(cond, false) then raise notice 'PASS  %', label; else raise notice 'FAIL  %', label; end if;
end $$;

select public.t_ok((select count(*) from pg_proc p join t_chain c on c.k = 'fn_' || p.proname
                    where p.pronamespace = 'public'::regnamespace and md5(replace(p.prosrc, chr(13), '')) = c.v) = 9,
                   'after both rollbacks: all 9 financial functions identical to current production');
select public.t_ok(md5(pg_get_viewdef('public.investments_with_value'::regclass, true)) = (select v from t_chain where k = 'view'),
                   'after both rollbacks: investments_with_value identical to current production');
select public.t_ok(not exists (select 1 from pg_proc where proname in
                     ('request_withdrawal', 'investment_claimable_gains', 'investment_accrued_interest', '_refund_early_withdrawal_fees',
                      'pay_referral', 'referral_payout_request_id')),
                   'after both rollbacks: all added functions removed');
select public.t_ok(position('early_withdrawal_fee_refund' in (select pg_get_constraintdef(oid) from pg_constraint where conname = 'transactions_type_check')) > 0,
                   'refund transaction type kept (existing refund rows must stay valid)');
select public.t_ok((select count(*) from public.t_records() r join public.t_chain c on c.k = 'rec_' || r.k and c.v = r.v) = 6,
                   'after all three rollbacks: profiles, wallets, transactions, referrals, audit logs, adjustment requests unchanged');
