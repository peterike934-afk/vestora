-- Migration chain, after 20261122000000, 20261123000000 and 20261124000000:
-- no existing financial record changed by applying them.
set client_min_messages = notice;
create or replace function public.t_ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if coalesce(cond, false) then raise notice 'PASS  %', label; else raise notice 'FAIL  %', label; end if;
end $$;
select public.t_ok((select count(*) from public.t_records() r join public.t_chain c on c.k = 'rec_' || r.k and c.v = r.v) = 6,
                   'after all three migrations: profiles, wallets, transactions, referrals, audit logs, adjustment requests unchanged');
select public.t_ok(to_regprocedure('public.pay_referral(bigint)') is not null
                   and (select status from public.referrals where id = 5002) = 'pending',
                   'after all three migrations: pay_referral installed; pending referral still pending');
