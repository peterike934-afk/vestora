-- Financial controls upgrade, phase A: state after 20261126000000 with real
-- withdrawal activity created by the PREVIOUS functions: held withdrawals
-- (the old request_withdrawal still stored customer-typed crypto amounts),
-- a legacy withdrawal without a hold, a claim in progress, verified,
-- pending and rejected transactions.
insert into public.profiles (id, role) values
  ('f7a00000-0000-0000-0000-000000000001', 'admin'),
  ('f7b00000-0000-0000-0000-000000000002', 'user'),
  ('f7c00000-0000-0000-0000-000000000003', 'user');
insert into public.wallets (user_id, balance_usd) values
  ('f7a00000-0000-0000-0000-000000000001', 0),
  ('f7b00000-0000-0000-0000-000000000002', 900),
  ('f7c00000-0000-0000-0000-000000000003', 50);
insert into public.settings (id, min_withdrawal_usd, daily_withdrawal_limit_usd) values (true, 10, 100000)
on conflict (id) do update set min_withdrawal_usd = 10, daily_withdrawal_limit_usd = 100000;

do $$
begin
  perform set_config('request.jwt.claim.sub', 'f7b00000-0000-0000-0000-000000000002', true);
  set local role authenticated;
  perform public.request_withdrawal('f7d00000-0000-4000-8000-000000000001', 100, 'crypto', 'BTC', 0.5, 'bc1qtest-old-format', 'old crypto');
  perform public.request_withdrawal('f7d00000-0000-4000-8000-000000000002', 60, 'bank');
  perform public.request_withdrawal('f7d00000-0000-4000-8000-000000000003', 40, 'wire', null, null, null, 'Wire to: X');
  -- The old policy allowed this: a pending deposit claim and a direct withdrawal row.
  insert into public.transactions (id, user_id, type, amount_usd, status, payment_method)
  values ('f7e00000-0000-4000-8000-000000000001', 'f7b00000-0000-0000-0000-000000000002', 'deposit', 250, 'pending', 'crypto');
end $$;
-- A legacy withdrawal from before holds existed.
insert into public.transactions (id, user_id, type, amount_usd, status, payment_method)
values ('f7e00000-0000-4000-8000-000000000002', 'f7c00000-0000-0000-0000-000000000003', 'withdrawal', 30, 'pending', 'wire');
-- Approvals made with the previous functions: one completed, one in progress, one rejection.
do $$
declare
  -- Looked up before switching to the admin session (row-level security).
  t60 uuid := (select id from public.transactions where type = 'withdrawal' and amount_usd = 60);
  t40 uuid := (select id from public.transactions where type = 'withdrawal' and amount_usd = 40);
  tok uuid;
begin
  perform set_config('request.jwt.claim.sub', 'f7a00000-0000-0000-0000-000000000001', true);
  set local role authenticated;
  tok := public.claim_transaction_for_approval(t60, 'paid before 27');
  perform public.finalize_transaction_approval(t60, tok);
  perform public.claim_transaction_for_approval(t40, 'in progress when 27 is applied');
  perform public.reject_pending_transaction('f7e00000-0000-4000-8000-000000000001', 'hash not found');
end $$;

create table public.t_fc_snapshot (k text primary key, v text);
create function public.t_fc_records() returns table (k text, v text) language sql as $$
  select 'profiles', md5(string_agg(to_jsonb(x)::text, '|' order by x.id)) from public.profiles x
  union all select 'wallets', md5(string_agg(to_jsonb(x)::text, '|' order by x.user_id)) from public.wallets x
  union all select 'transactions', md5(string_agg(to_jsonb(x)::text, '|' order by x.id)) from public.transactions x
  union all select 'withdrawal_reservations', md5(string_agg(to_jsonb(x)::text, '|' order by x.transaction_id)) from public.withdrawal_reservations x
  union all select 'admin_financial_operation_claims', md5(string_agg(to_jsonb(x)::text, '|' order by x.transaction_id)) from public.admin_financial_operation_claims x
  union all select 'audit_logs', md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from public.audit_logs x
  union all select 'settings', md5(string_agg(to_jsonb(x)::text, '|')) from public.settings x
  union all select 'referral_payout_controls', md5(string_agg(to_jsonb(x)::text, '|')) from public.referral_payout_controls x
$$;
create table public.t_fc_fnlist (sig text primary key);
insert into public.t_fc_fnlist
select p.oid::regprocedure::text from pg_proc p
where p.pronamespace = 'public'::regnamespace and p.proname not like 't\_%'
  and p.oid not in ('public.claim_transaction_for_approval(uuid, text)'::regprocedure,
                    'public.request_withdrawal(uuid, numeric, text, text, numeric, text, text)'::regprocedure);
create function public.t_fc_functions() returns text language sql as $$
  select md5(string_agg(l.sig || ':' || coalesce(md5(replace(p.prosrc, chr(13), '')) || ':' || coalesce(p.proacl::text, '-')
                        || ':' || p.prosecdef || ':' || coalesce(array_to_string(p.proconfig, ','), '-'), 'MISSING'), '|' order by l.sig))
  from public.t_fc_fnlist l left join pg_proc p on p.oid = to_regprocedure(l.sig)
$$;
create function public.t_fc_other_policies() returns text language sql as $$
  select md5(string_agg(c.relname || ':' || pol.polname || ':' || pol.polcmd::text || ':' || coalesce(pg_get_expr(pol.polqual, pol.polrelid), '-') || ':' || coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '-'), '|' order by c.relname, pol.polname))
  from pg_policy pol join pg_class c on c.oid = pol.polrelid
  where c.relnamespace = 'public'::regnamespace
    and not (c.relname = 'transactions' and pol.polcmd = 'a')
    and c.relname not in ('financial_operation_controls', 'financial_operation_control_events')
$$;
insert into public.t_fc_snapshot select * from public.t_fc_records();
insert into public.t_fc_snapshot values ('functions', public.t_fc_functions()), ('other_policies', public.t_fc_other_policies());
insert into public.t_fc_snapshot select 'insert_policy', pol.polname || ' | ' || pg_get_expr(pol.polwithcheck, pol.polrelid)
from pg_policy pol where pol.polrelid = 'public.transactions'::regclass and pol.polcmd = 'a';
insert into public.t_fc_snapshot select 'claim_acl', proacl::text from pg_proc where oid = 'public.claim_transaction_for_approval(uuid, text)'::regprocedure;
insert into public.t_fc_snapshot select 'request_acl', proacl::text from pg_proc where oid = 'public.request_withdrawal(uuid, numeric, text, text, numeric, text, text)'::regprocedure;
