-- Integrity upgrade, phase A: production-like state built with the CURRENT
-- functions (before 20261123000000), then fingerprinted.
\ir _integrity_helpers.sql

-- Historical case (like the production $2,000 fee): rejected under the old
-- code, fee never returned.
select public.t_setup('21', 1000, 7000, 60);
insert into t_ids select 'w21', public.t_withdraw('21', 7000);
select public.t_reject(public.id('w21'), 'Historical rejection');
-- In flight at upgrade time: a pending withdrawal whose fee came from the wallet.
select public.t_setup('22', 1000, 7000, 60);
insert into t_ids select 'w22', public.t_withdraw('22', 7000);
-- In flight at upgrade time: a legitimate pending gains claim.
select public.t_setup('23', 0, 1000, 100);
insert into t_ids select 'c23', public.t_claim('23');
-- Plain active investments for view comparison.
select public.t_setup('24', 0, 5000, 30);
select public.t_setup('25', 0, 2000, 120, 15);

create table public.t_snap (k text primary key, v text);
-- Row fingerprints over the original columns (new columns excluded).
insert into public.t_snap select 'transactions',
  md5(string_agg((to_jsonb(t) - 'claimed_interest_allocated')::text, '|' order by id)) from public.transactions t;
insert into public.t_snap select 'investments',
  md5(string_agg((to_jsonb(i) - 'withdrawn_claimed_interest')::text, '|' order by id)) from public.investments i;
insert into public.t_snap select 'wallets', md5(string_agg(to_jsonb(w)::text, '|' order by user_id)) from public.wallets w;
insert into public.t_snap select 'fn_' || proname, md5(replace(prosrc, chr(13), '')) from pg_proc
  where pronamespace = 'public'::regnamespace
    and proname in ('_finalize_claimed_transaction', 'reject_pending_transaction', 'cancel_investment_atomically',
                    'request_investment_withdrawal', 'claim_investment_gains');
insert into public.t_snap select 'view', md5(pg_get_viewdef('public.investments_with_value'::regclass, true));
create table public.t_view as
  select id, current_value, available_to_claim, available_to_withdraw from public.investments_with_value;
