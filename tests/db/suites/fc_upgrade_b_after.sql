-- Phase B: 20261127000000 applied. Nothing that existed may have changed.
set client_min_messages = notice;
create or replace function public.t_ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if coalesce(cond, false) then raise notice 'PASS  %', label; else raise notice 'FAIL  %', label; end if;
end $$;
select public.t_ok((select count(*) from public.t_fc_records() r join public.t_fc_snapshot s on s.k = r.k and s.v = r.v) = 8,
                   'all 8 record tables unchanged (profiles, wallets, transactions, holds, claims, audit, settings, referral switch)');
select public.t_ok(public.t_fc_functions() = (select v from public.t_fc_snapshot where k = 'functions'),
                   'every other function unchanged (source, grants, definer, search_path)');
select public.t_ok(public.t_fc_other_policies() = (select v from public.t_fc_snapshot where k = 'other_policies'),
                   'every other RLS policy unchanged');
select public.t_ok((select proacl::text from pg_proc where oid = 'public.claim_transaction_for_approval(uuid, text)'::regprocedure) = (select v from public.t_fc_snapshot where k = 'claim_acl')
                   and (select proacl::text from pg_proc where oid = 'public.request_withdrawal(uuid, numeric, text, text, numeric, text, text)'::regprocedure) = (select v from public.t_fc_snapshot where k = 'request_acl'),
                   'claim and request_withdrawal keep their grants');
select public.t_ok((select string_agg(operation || '=' || enabled, ',' order by operation) from public.financial_operation_controls) = 'bank_deposit_pulls=false,withdrawal_payouts=false',
                   'both switches OFF after the upgrade');
select public.t_ok((select crypto_amount = 0.5 from public.transactions where type = 'withdrawal' and amount_usd = 100),
                   'existing withdrawal keeps its stored crypto amount (not used for payment any more)');
select public.t_ok((select status = 'pending' from public.transactions where id = 'f7e00000-0000-4000-8000-000000000002')
                   and not exists (select 1 from public.withdrawal_reservations where transaction_id = 'f7e00000-0000-4000-8000-000000000002'),
                   'legacy withdrawal without a hold: still pending, no hold created');
select public.t_ok((select state = 'processing' from public.admin_financial_operation_claims c join public.transactions t on t.id = c.transaction_id where t.amount_usd = 40),
                   'claim in progress left as it was');
