-- Integrity upgrade, phase C: rollback script applied after phase B.
set client_min_messages = notice;

\echo '=== Rollback restores the previous functions and view exactly'
select public.t_ok((select count(*) from pg_proc p join t_snap s on s.k = 'fn_' || p.proname
                    where p.pronamespace = 'public'::regnamespace and md5(replace(p.prosrc, chr(13), '')) = s.v) = 5,
                   'all five replaced functions identical to their pre-upgrade source');
select public.t_ok(md5(pg_get_viewdef('public.investments_with_value'::regclass, true)) = (select v from t_snap where k = 'view'),
                   'investments_with_value identical to the production definition');
select public.t_ok(not exists (select 1 from pg_proc where proname in
                     ('investment_claimable_gains', 'investment_accrued_interest', '_refund_early_withdrawal_fees')),
                   'helper functions removed');
select public.t_ok(public.refunds_of(public.fee_of(public.id('w22'))) = 1 and public.bal(public.id('u22')) = 1000,
                   'refund issued while the fix was live is kept (real money movement)');
select public.t_ok(public.bal(public.id('u23')) = round((public.tx(public.id('c23'))).amount_usd, 2), 'approved claim kept');
