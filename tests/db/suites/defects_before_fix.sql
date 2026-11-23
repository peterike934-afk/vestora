-- Demonstrates the defects in the CURRENT production logic (migrations up to
-- 20261122000000, plus the exported production functions), so the
-- integrity suite is known to test real failures. Each PASS here confirms
-- a defect exists before 20261123000000_investment_financial_integrity.sql.
\ir _integrity_helpers.sql

\echo '=== Defect A: rejected early withdrawal keeps the wallet-funded fee'
select public.t_setup('01', 1000, 7000, 60);
insert into t_ids select 'w01', public.t_withdraw('01', 7000);
select public.t_reject(public.id('w01'), 'Rejected');
select public.t_ok(public.bal(public.id('u01')) = 300, 'DEFECT A confirmed: 700 fee not returned after rejection (wallet stays 300)');

\echo '=== Defect B: claimed maturity interest paid again on withdrawal'
select public.t_setup('02', 0, 1000, 100);
insert into t_ids select 'c02', public.t_claim('02');
select public.t_approve(public.id('c02'));
insert into t_ids select 'w02', public.t_withdraw('02', 1000);
select public.t_ok((public.tx(public.id('w02'))).amount_usd > 1029, 'DEFECT B confirmed: withdrawal pays full-term interest again after it was claimed');

\echo '=== Defect C: approval credits a claim without re-checking it'
select public.t_setup('03', 0, 1000, 100);
insert into t_ids select 'c03', public.t_claim('03');
update public.transactions set amount_usd = 500 where id = public.id('c03');
select public.t_approve(public.id('c03'));
select public.t_ok(public.bal(public.id('u03')) = 500, 'DEFECT C confirmed: approval credited 500 although only 29.58 was earned');

\echo '=== Defect D: claim and principal withdrawal can be pending together'
select public.t_setup('04', 0, 1000, 100);
insert into t_ids select 'c04', public.t_claim('04');
select public.t_ok(public.t_withdraw('04', 500) is not null, 'DEFECT D confirmed: principal withdrawal accepted while a gains claim is pending');

\echo '=== Defect E: cancellation after a partial withdrawal refunds the original amount'
select public.t_setup('05', 0, 1000, 60);
insert into t_ids select 'w05', public.t_withdraw('05', 400);
select public.t_approve(public.id('w05'));
do $$ begin
  perform set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
  set local role authenticated;
  perform public.cancel_investment_atomically(public.id('i05'), 'Cancelled');
end $$;
select public.t_ok(public.bal(public.id('u05')) = 1360, 'DEFECT E confirmed: 400 already paid out (360 net) and 1000 refunded on cancel');
