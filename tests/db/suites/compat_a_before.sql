-- Phase A: production-like state under V2 only (migration NOT applied yet).
set client_min_messages = warning;
create table public.t_ids (k text primary key, v uuid);
grant select, insert on public.t_ids to authenticated;
create table public.t_snapshot (k text primary key, v text);

insert into public.profiles values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'admin'),
  ('55555555-0000-0000-0000-000000000005', 'user'),
  ('66666666-0000-0000-0000-000000000006', 'user');
insert into public.wallets values
  ('aaaaaaaa-0000-0000-0000-000000000001', 0, now()),
  ('55555555-0000-0000-0000-000000000005', 100, now()),
  ('66666666-0000-0000-0000-000000000006', 500, now());
insert into public.settings (id, min_withdrawal_usd, daily_withdrawal_limit_usd) values (true, 10, 10000);

-- Historical records that must survive untouched.
insert into public.transactions (user_id, type, amount_usd, status, admin_note, verified_at) values
  ('55555555-0000-0000-0000-000000000005', 'deposit', 300, 'verified', null, now() - interval '30 days'),
  ('55555555-0000-0000-0000-000000000005', 'withdrawal', 200, 'verified', null, now() - interval '20 days'),
  ('55555555-0000-0000-0000-000000000005', 'withdrawal', 75, 'rejected', 'Wallet address invalid', now() - interval '10 days'),
  ('66666666-0000-0000-0000-000000000006', 'deposit', 42, 'rejected', 'Hash not found', now() - interval '5 days');

-- In-flight under V2:
-- P1: legacy withdrawal 40 with an ACTIVE approval claim (payout in progress)
insert into public.transactions (user_id, type, amount_usd, status, payment_method)
  values ('55555555-0000-0000-0000-000000000005', 'withdrawal', 40, 'pending', 'wire') returning id \gset p1_
insert into public.t_ids values ('p1', :'p1_id');
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
set role authenticated;
insert into public.t_ids select 'p1tok', public.claim_transaction_for_approval(:'p1_id', 'paying');
reset role;
-- P2: legacy withdrawal 30, not yet claimed
insert into public.transactions (user_id, type, amount_usd, status, payment_method)
  values ('55555555-0000-0000-0000-000000000005', 'withdrawal', 30, 'pending', 'bank') returning id \gset p2_
insert into public.t_ids values ('p2', :'p2_id');
-- P3: pending deposit 50
insert into public.transactions (user_id, type, amount_usd, status)
  values ('66666666-0000-0000-0000-000000000006', 'deposit', 50, 'pending') returning id \gset p3_
insert into public.t_ids values ('p3', :'p3_id');

-- Fingerprint of every existing wallet, transaction and claim row.
insert into public.t_snapshot
select 'wallets', md5(string_agg(row(w.*)::text, '|' order by user_id)) from public.wallets w;
insert into public.t_snapshot
select 'transactions', md5(string_agg(row(t.*)::text, '|' order by id)) from public.transactions t;
insert into public.t_snapshot
select 'claims', md5(string_agg(row(c.*)::text, '|' order by transaction_id)) from public.admin_financial_operation_claims c;
-- V2 function source, to prove the rollback restores it exactly.
insert into public.t_snapshot
select 'fn_' || proname, md5(replace(prosrc, chr(13), '')) from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in ('_finalize_claimed_transaction', 'claim_transaction_for_approval', 'reject_pending_transaction');
