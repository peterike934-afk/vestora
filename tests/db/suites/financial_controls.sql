-- Financial operation controls (20261127000000_financial_operation_controls.sql),
-- all migrations applied. Withdrawal payouts and bank pulls frozen by
-- default; valid funds hold required; validation before any payment;
-- customer inserts limited to pending deposit claims; request_withdrawal
-- never stores a customer-typed crypto amount.
set client_min_messages = notice;

create function public.t_ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if coalesce(cond, false) then raise notice 'PASS  %', label; else raise notice 'FAIL  %', label; end if;
end $$;
create function public.t_err(stmt text, fragment text, label text) returns void language plpgsql as $$
begin
  execute stmt;
  raise notice 'FAIL  % (no error raised)', label;
exception when others then
  if position(fragment in sqlerrm) > 0 then raise notice 'PASS  %  [%]', label, sqlerrm;
  else raise notice 'FAIL  % (got: %)', label, sqlerrm; end if;
end $$;
-- Run one statement as a signed-in user (customer or admin), the service role or anon.
create function public.t_as(u uuid, stmt text) returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), true);
  set local role authenticated;
  execute stmt into v;
  return v;
end $$;
create function public.t_service(stmt text) returns text language plpgsql as $$
declare v text;
begin
  set local role service_role;
  execute stmt into v;
  return v;
end $$;
create function public.t_anon(stmt text) returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claim.sub', '', true);
  set local role anon;
  execute stmt into v;
  return v;
end $$;
create function public.bal(u uuid) returns numeric language sql as $$ select balance_usd from public.wallets where user_id = u $$;
create function public.st(t uuid) returns text language sql as $$ select status from public.transactions where id = t $$;
create function public.hold(t uuid) returns text language sql as $$ select coalesce((select state from public.withdrawal_reservations where transaction_id = t), 'none') $$;
create function public.claims(t uuid) returns bigint language sql as $$ select count(*) from public.admin_financial_operation_claims where transaction_id = t $$;
create function public.sw(op text) returns boolean language sql as $$ select enabled from public.financial_operation_controls where operation = op $$;
create function public.events() returns bigint language sql as $$ select count(*) from public.financial_operation_control_events $$;
-- Request a withdrawal as the customer; returns the transaction id.
create function public.t_request(u uuid, req uuid, amount numeric, method text, cur text default null, cryp numeric default null, dest text default null)
returns uuid language sql as $$
  select (public.t_as(u, format('select public.request_withdrawal(%L, %s, %L, %L, %s, %L)::text', req, amount, method, cur, coalesce(cryp::text, 'null'), dest))::jsonb ->> 'transactionId')::uuid
$$;
-- Claim as the admin (returns the token).
create function public.t_claim(t uuid) returns text language sql as $$
  select public.t_as('aaaaaaaa-0000-0000-0000-000000000001', format('select public.claim_transaction_for_approval(%L, null)::text', t))
$$;
create function public.t_finalize(t uuid, tok text) returns text language sql as $$
  select public.t_as('aaaaaaaa-0000-0000-0000-000000000001', format('select public.finalize_transaction_approval(%L, %L)::text', t, tok))
$$;

insert into public.profiles (id, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'admin'),
  ('11111111-0000-0000-0000-000000000001', 'user'),
  ('22222222-0000-0000-0000-000000000002', 'user');
insert into public.wallets (user_id, balance_usd) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 0),
  ('11111111-0000-0000-0000-000000000001', 1000),
  ('22222222-0000-0000-0000-000000000002', 300);
insert into public.settings (id, min_withdrawal_usd, daily_withdrawal_limit_usd) values (true, 10, 100000);

\set admin '''aaaaaaaa-0000-0000-0000-000000000001'''
\set alice '''11111111-0000-0000-0000-000000000001'''
\set bob '''22222222-0000-0000-0000-000000000002'''
\set eth '''0x00000000000000000000000000000000000000Aa'''
\set btc '''bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'''

\echo '=== 1. Frozen by default; only postgres can change a switch, with a log entry'
select public.t_ok(public.sw('withdrawal_payouts') = false and public.sw('bank_deposit_pulls') = false, 'both switches OFF after the migration');
select public.t_ok(public.events() = 2 and not exists (select 1 from public.financial_operation_control_events where enabled or operator <> 'migration 20261127000000'), 'two log entries: frozen by the migration');
select public.t_err(format('select public.t_as(%L, %L)', :admin, $q$select public.set_financial_operation_enabled('withdrawal_payouts', true, 'x', 'y', 'ENABLE WITHDRAWAL PAYOUTS')::text$q$), 'permission denied', 'admin cannot change a switch');
select public.t_err(format('select public.t_service(%L)', $q$select public.set_financial_operation_enabled('withdrawal_payouts', true, 'x', 'y', 'ENABLE WITHDRAWAL PAYOUTS')::text$q$), 'permission denied', 'service role cannot change a switch');
select public.t_err(format('select public.t_as(%L, %L)', :admin, $q$update public.financial_operation_controls set enabled = true returning operation$q$), 'permission denied', 'admin cannot update the switch table');
select public.t_err(format('select public.t_service(%L)', $q$update public.financial_operation_controls set enabled = true returning operation$q$), 'permission denied', 'service role cannot update the switch table');
select public.t_err($q$update public.financial_operation_controls set enabled = true$q$, 'Use public.set_financial_operation_enabled', 'postgres: direct UPDATE refused (no unaudited change)');
select public.t_err($q$delete from public.financial_operation_controls$q$, 'cannot be deleted', 'switch rows cannot be deleted');
select public.t_err($q$truncate public.financial_operation_controls$q$, 'cannot be deleted', 'switch table cannot be truncated');
select public.t_err($q$insert into public.financial_operation_control_events (operation, enabled, operator, reason) values ('withdrawal_payouts', true, 'x', 'forged')$q$, 'Use public.set_financial_operation_enabled', 'log cannot be written directly');
select public.t_err($q$update public.financial_operation_control_events set reason = 'edited'$q$, 'append-only', 'log cannot be edited');
select public.t_err($q$delete from public.financial_operation_control_events$q$, 'cannot be deleted', 'log cannot be deleted');
select public.t_ok(public.t_as(:admin, 'select string_agg(operation || ''='' || enabled, '','' order by operation) from public.financial_operation_controls') = 'bank_deposit_pulls=false,withdrawal_payouts=false', 'admins can read the switches');
select public.t_ok(public.t_as(:alice, 'select count(*)::text from public.financial_operation_controls') = '0' and public.t_as(:alice, 'select count(*)::text from public.financial_operation_control_events') = '0', 'customers cannot see the switches or log');
select public.t_err($q$select public.set_financial_operation_enabled('withdrawal_payouts', true, 'Ops', 'go')$q$, 'ENABLE WITHDRAWAL PAYOUTS', 'enabling without the confirmation is refused');
select public.t_err($q$select public.set_financial_operation_enabled('withdrawal_payouts', true, 'Ops', 'go', 'ENABLE BANK DEPOSIT PULLS')$q$, 'ENABLE WITHDRAWAL PAYOUTS', 'the other operation''s phrase is refused');
select public.t_err($q$select public.set_financial_operation_enabled('bank_deposit_pulls', true, 'Ops', 'go', 'enable bank deposit pulls')$q$, 'ENABLE BANK DEPOSIT PULLS', 'wrong-case phrase refused');
select public.t_err($q$select public.set_financial_operation_enabled('payouts', true, 'Ops', 'go', 'x')$q$, 'Unknown financial operation', 'unknown operation refused');
select public.t_err($q$select public.set_financial_operation_enabled('withdrawal_payouts', true, ' ', 'go', 'ENABLE WITHDRAWAL PAYOUTS')$q$, 'operator name', 'blank operator refused');
select public.t_err($q$select public.set_financial_operation_enabled('withdrawal_payouts', true, 'Ops', '', 'ENABLE WITHDRAWAL PAYOUTS')$q$, 'reason', 'blank reason refused');
select public.t_ok(public.sw('withdrawal_payouts') = false and public.events() = 2, 'refused attempts changed and logged nothing');

\echo '=== 2. While frozen: every withdrawal kind and bank pulls are refused at the claim; nothing changes'
select public.t_request(:alice, 'c0000000-0000-4000-8000-000000000001', 100, 'crypto', 'ETH', 5, :eth) as wc \gset
select public.t_request(:alice, 'c0000000-0000-4000-8000-000000000002', 100, 'bank') as wb \gset
select public.t_request(:alice, 'c0000000-0000-4000-8000-000000000003', 100, 'wire', null, null, null) as ww \gset
select public.t_ok(public.bal(:alice) = 700 and public.hold(:'wc') = 'held' and public.hold(:'wb') = 'held' and public.hold(:'ww') = 'held', 'three requests hold 300 (1000 -> 700)');
select public.t_err(format('select public.t_claim(%L)', :'wc'), 'Withdrawal payouts are disabled', 'crypto withdrawal claim refused while frozen');
select public.t_err(format('select public.t_claim(%L)', :'wb'), 'Withdrawal payouts are disabled', 'bank withdrawal claim refused while frozen');
select public.t_err(format('select public.t_claim(%L)', :'ww'), 'Withdrawal payouts are disabled', 'wire withdrawal claim refused while frozen');
select public.t_ok(public.claims(:'wc') + public.claims(:'wb') + public.claims(:'ww') = 0, 'no claim rows created');
select public.t_ok(public.bal(:alice) = 700 and public.st(:'wc') = 'pending' and public.hold(:'wc') = 'held', 'balances, statuses and holds unchanged');
insert into public.transactions (id, user_id, type, amount_usd, status, payment_method)
values ('d0000000-0000-4000-8000-000000000001', :bob, 'deposit', 200, 'pending', 'bank');
select public.t_err(format('select public.t_claim(%L)', 'd0000000-0000-4000-8000-000000000001'), 'Bank deposit pulls are disabled', 'bank-pull deposit claim refused while frozen');
-- Allowed while frozen: crypto and Bank Transfer ('wire') deposits, verified manually.
insert into public.transactions (id, user_id, type, amount_usd, status, payment_method, admin_note)
values ('d0000000-0000-4000-8000-000000000002', :bob, 'deposit', 150, 'pending', 'wire', 'Sent from: Bob | Bank reference: REF-9');
select public.t_claim('d0000000-0000-4000-8000-000000000002') as dtok \gset
select public.t_finalize('d0000000-0000-4000-8000-000000000002', :'dtok');
select public.t_ok(public.st('d0000000-0000-4000-8000-000000000002') = 'verified' and public.bal(:bob) = 450, 'Bank Transfer deposit approved manually while frozen: credited once (300 -> 450)');
select public.t_as(:admin, format('select public.reject_pending_transaction(%L, %L)::text', :'ww', 'Wrong bank details'));
select public.t_ok(public.st(:'ww') = 'rejected' and public.hold(:'ww') = 'released' and public.bal(:alice) = 800, 'rejecting while frozen releases the hold (700 -> 800)');

\echo '=== 3. Enabled: only against a valid hold; validated before any payment'
select public.t_ok(public.set_financial_operation_enabled('withdrawal_payouts', true, 'Ops Lead', 'Approved release', 'ENABLE WITHDRAWAL PAYOUTS') = '{"changed": true, "enabled": true, "operation": "withdrawal_payouts"}'::jsonb, 'withdrawal payouts enabled with operator, reason and phrase');
select public.t_ok((select enabled and operator = 'Ops Lead' and reason = 'Approved release' and database_user = 'postgres' from public.financial_operation_control_events order by id desc limit 1) and public.events() = 3, 'log entry recorded');
select public.t_ok(public.sw('bank_deposit_pulls') = false, 'bank pulls stay off (independent switch)');
select public.t_claim(:'wc') as ctok \gset
select public.t_ok(public.claims(:'wc') = 1 and public.bal(:alice) = 800, 'held crypto withdrawal claimed; balance untouched');
select public.t_err(format('select public.t_claim(%L)', :'wc'), 'already has an active', 'second claim of the same withdrawal refused (no duplicate payment)');
select public.t_finalize(:'wc', :'ctok');
select public.t_ok(public.st(:'wc') = 'verified' and public.hold(:'wc') = 'consumed' and public.bal(:alice) = 800, 'finalized: hold consumed, no second debit');
-- Holds that do not match.
select public.t_request(:bob, 'c0000000-0000-4000-8000-000000000010', 50, 'bank') as m1 \gset
update public.withdrawal_reservations set amount = 49.99 where transaction_id = :'m1';
select public.t_err(format('select public.t_claim(%L)', :'m1'), 'no valid funds hold', 'hold amount different from the withdrawal: refused');
update public.withdrawal_reservations set amount = 50, user_id = :alice where transaction_id = :'m1';
select public.t_err(format('select public.t_claim(%L)', :'m1'), 'no valid funds hold', 'hold belonging to another customer: refused');
update public.withdrawal_reservations set user_id = :bob, state = 'released' where transaction_id = :'m1';
select public.t_err(format('select public.t_claim(%L)', :'m1'), 'no valid funds hold', 'released hold: refused');
update public.withdrawal_reservations set state = 'held' where transaction_id = :'m1';
-- Legacy withdrawal without any hold: blocked for manual review, nothing created.
insert into public.transactions (id, user_id, type, amount_usd, status, payment_method)
values ('e0000000-0000-4000-8000-000000000001', :bob, 'withdrawal', 40, 'pending', 'wire');
select public.bal(:bob) as bob_before \gset
select public.t_err(format('select public.t_claim(%L)', 'e0000000-0000-4000-8000-000000000001'), 'no valid funds hold; manual review required', 'legacy withdrawal without a hold: refused');
select public.t_ok(public.bal(:bob) = :bob_before and public.hold('e0000000-0000-4000-8000-000000000001') = 'none' and public.claims('e0000000-0000-4000-8000-000000000001') = 0
                   and public.st('e0000000-0000-4000-8000-000000000001') = 'pending', 'no hold created, no claim, balance unchanged, still pending');
-- Validation of the withdrawal itself (rows that predate the new checks).
insert into public.transactions (id, user_id, type, amount_usd, status, payment_method, crypto_currency, destination_address)
values ('e0000000-0000-4000-8000-000000000002', :bob, 'withdrawal', 20, 'pending', 'crypto', 'DOGE', 'Dabc');
insert into public.withdrawal_reservations (transaction_id, user_id, amount, state) values ('e0000000-0000-4000-8000-000000000002', :bob, 20, 'held');
select public.t_err(format('select public.t_claim(%L)', 'e0000000-0000-4000-8000-000000000002'), 'Crypto withdrawal details are invalid', 'unsupported coin refused before any payment');
insert into public.transactions (id, user_id, type, amount_usd, status, payment_method, crypto_currency, destination_address)
values ('e0000000-0000-4000-8000-000000000003', :bob, 'withdrawal', 20, 'pending', 'crypto', 'ETH', ' ');
insert into public.withdrawal_reservations (transaction_id, user_id, amount, state) values ('e0000000-0000-4000-8000-000000000003', :bob, 20, 'held');
select public.t_err(format('select public.t_claim(%L)', 'e0000000-0000-4000-8000-000000000003'), 'Crypto withdrawal details are invalid', 'blank destination refused before any payment');
-- Bank pulls need their own switch.
select public.t_err(format('select public.t_claim(%L)', 'd0000000-0000-4000-8000-000000000001'), 'Bank deposit pulls are disabled', 'bank pull still refused with only withdrawals enabled');
select public.set_financial_operation_enabled('bank_deposit_pulls', true, 'Ops Lead', 'test', 'ENABLE BANK DEPOSIT PULLS');
select public.t_ok(public.t_claim('d0000000-0000-4000-8000-000000000001') is not null, 'bank pull claim allowed once its switch is on');
select public.t_ok(public.set_financial_operation_enabled('withdrawal_payouts', false, 'Ops Lead', 'Freeze') ->> 'changed' = 'true'
                   and public.set_financial_operation_enabled('bank_deposit_pulls', false, 'Ops Lead', 'Freeze') ->> 'changed' = 'true', 'both frozen again (no phrase needed to disable)');
select public.t_err(format('select public.t_claim(%L)', :'m1'), 'Withdrawal payouts are disabled', 'frozen again: valid held withdrawal refused');

\echo '=== 4. Customers can insert only pending crypto / Bank Transfer deposit claims'
select public.t_ok(public.t_as(:alice, $q$insert into public.transactions (user_id, type, amount_usd, payment_method, crypto_currency, crypto_amount, tx_hash) values ('11111111-0000-0000-0000-000000000001', 'deposit', 25, 'crypto', 'ETH', 0.01, '0xabc') returning status$q$) = 'pending', 'pending crypto deposit claim accepted');
select public.t_ok(public.t_as(:alice, $q$insert into public.transactions (user_id, type, amount_usd, payment_method, admin_note) values ('11111111-0000-0000-0000-000000000001', 'deposit', 25, 'wire', 'Sent from: Alice') returning status$q$) = 'pending', 'pending Bank Transfer deposit claim accepted');
select public.t_err(format('select public.t_as(%L, %L)', :alice, $q$insert into public.transactions (user_id, type, amount_usd, status, payment_method) values ('11111111-0000-0000-0000-000000000001', 'withdrawal', 10, 'pending', 'wire') returning id$q$), 'row-level security', 'customer cannot insert a withdrawal');
select public.t_err(format('select public.t_as(%L, %L)', :alice, $q$insert into public.transactions (user_id, type, amount_usd, status, payment_method) values ('11111111-0000-0000-0000-000000000001', 'deposit', 10, 'verified', 'crypto') returning id$q$), 'row-level security', 'customer cannot insert a verified deposit');
select public.t_err(format('select public.t_as(%L, %L)', :alice, $q$insert into public.transactions (user_id, type, amount_usd, payment_method) values ('11111111-0000-0000-0000-000000000001', 'admin_credit', 10, 'crypto') returning id$q$), 'row-level security', 'customer cannot insert an admin credit');
select public.t_err(format('select public.t_as(%L, %L)', :alice, $q$insert into public.transactions (user_id, type, amount_usd, payment_method) values ('11111111-0000-0000-0000-000000000001', 'deposit', 10, 'bank') returning id$q$), 'row-level security', 'customer cannot submit a bank-pull deposit');
select public.t_err(format('select public.t_as(%L, %L)', :alice, $q$insert into public.transactions (user_id, type, amount_usd, payment_method, verified_by, verified_at) values ('11111111-0000-0000-0000-000000000001', 'deposit', 10, 'crypto', 'aaaaaaaa-0000-0000-0000-000000000001', now()) returning id$q$), 'row-level security', 'customer cannot pre-fill verification');
select public.t_err(format('select public.t_as(%L, %L)', :alice, $q$insert into public.transactions (user_id, type, amount_usd, payment_method, sent_tx_hash) values ('11111111-0000-0000-0000-000000000001', 'deposit', 10, 'crypto', '0xfake') returning id$q$), 'row-level security', 'customer cannot pre-fill payout evidence');
select public.t_err(format('select public.t_as(%L, %L)', :alice, $q$insert into public.transactions (user_id, type, amount_usd, payment_method, onchain_verification) values ('11111111-0000-0000-0000-000000000001', 'deposit', 10, 'crypto', '{"found":true}') returning id$q$), 'row-level security', 'customer cannot pre-fill on-chain verification');
select public.t_err(format('select public.t_as(%L, %L)', :alice, $q$insert into public.transactions (user_id, type, amount_usd, payment_method) values ('11111111-0000-0000-0000-000000000001', 'deposit', 0, 'crypto') returning id$q$), 'row-level security', 'zero-amount deposit refused');
select public.t_err(format('select public.t_as(%L, %L)', :alice, $q$insert into public.transactions (user_id, type, amount_usd, payment_method) values ('22222222-0000-0000-0000-000000000002', 'deposit', 10, 'crypto') returning id$q$), 'row-level security', 'customer cannot insert for another customer');
-- Production grants anon every table privilege (RLS refuses); the test baseline grants none (permission denied). Either way: refused.
do $$
begin
  perform public.t_anon($q$insert into public.transactions (user_id, type, amount_usd, payment_method) values ('11111111-0000-0000-0000-000000000001', 'deposit', 10, 'crypto') returning id$q$);
  raise notice 'FAIL  anonymous insert refused (no error raised)';
exception when others then
  if sqlerrm like '%row-level security%' or sqlerrm like '%permission denied%' then raise notice 'PASS  anonymous insert refused  [%]', sqlerrm;
  else raise notice 'FAIL  anonymous insert refused (got: %)', sqlerrm; end if;
end $$;

\echo '=== 5. request_withdrawal: no customer crypto amount; coin and address validated'
select public.t_ok((select crypto_amount is null and crypto_currency = 'ETH' from public.transactions where id = :'wc'), 'typed crypto amount (5 ETH) not stored');
select public.t_request(:alice, 'c0000000-0000-4000-8000-000000000020', 20, 'crypto', 'btc', 9, :btc) as rb \gset
select public.t_ok((select crypto_currency = 'BTC' and crypto_amount is null from public.transactions where id = :'rb'), 'coin normalised to BTC; amount not stored');
select public.t_ok(public.t_request(:alice, 'c0000000-0000-4000-8000-000000000021', 20, 'crypto', 'BTC', null, '1BoatSLRHtKNngkdXEeobR76b53LETtpyT') is not null, 'legacy BTC address accepted');
select public.t_err(format('select public.t_request(%L, %L, 20, %L, %L, null, %L)', :alice, 'c0000000-0000-4000-8000-000000000022', 'crypto', 'ETH', '0x123'), 'valid destination address', 'malformed ETH address refused');
select public.t_err(format('select public.t_request(%L, %L, 20, %L, %L, null, %L)', :alice, 'c0000000-0000-4000-8000-000000000023', 'crypto', 'BTC', '0x00000000000000000000000000000000000000Aa'), 'valid destination address', 'ETH address for BTC refused');
select public.t_err(format('select public.t_request(%L, %L, 20, %L, %L, null, %L)', :alice, 'c0000000-0000-4000-8000-000000000024', 'crypto', 'DOGE', 'DAbc'), 'BTC, ETH or USDT', 'unsupported coin refused');
select public.t_ok((public.t_as(:alice, format('select public.request_withdrawal(%L, 20, %L, %L, 7, %L)::text', 'c0000000-0000-4000-8000-000000000020', 'crypto', 'BTC', :btc))::jsonb ->> 'duplicate')::boolean,
                   'replaying a request still returns the original (idempotent)');

\echo '=== 6. Definitions and grants'
select public.t_ok((select bool_and(p.prosecdef and p.proconfig = array['search_path=""'] and pg_get_userbyid(p.proowner) = 'postgres'
                                    and has_function_privilege('authenticated', p.oid, 'EXECUTE') and not has_function_privilege('anon', p.oid, 'EXECUTE')
                                    and not has_function_privilege('service_role', p.oid, 'EXECUTE'))
                    from pg_proc p where p.oid in ('public.claim_transaction_for_approval(uuid, text)'::regprocedure,
                                                   'public.request_withdrawal(uuid, numeric, text, text, numeric, text, text)'::regprocedure)),
                   'claim and request_withdrawal: definer, empty search_path, owner postgres, authenticated only (unchanged grants)');
select public.t_ok(not has_function_privilege('authenticated', 'public.set_financial_operation_enabled(text, boolean, text, text, text)', 'EXECUTE')
                   and not has_function_privilege('service_role', 'public.set_financial_operation_enabled(text, boolean, text, text, text)', 'EXECUTE')
                   and not has_function_privilege('authenticated', 'public._financial_operation_enabled(text)', 'EXECUTE')
                   and not has_function_privilege('service_role', 'public._financial_operation_enabled(text)', 'EXECUTE'), 'no client can execute the switch functions');
select public.t_ok((select count(*) from pg_policy where polrelid = 'public.transactions'::regclass and polcmd = 'a') = 1
                   and exists (select 1 from pg_policy where polrelid = 'public.transactions'::regclass and polname = 'Customers can submit pending deposit claims'),
                   'exactly one customer INSERT policy: pending deposit claims');
select public.t_ok(position('_financial_operation_enabled' in p.prosrc) < position('from public.admin_financial_operation_claims' in p.prosrc),
                   'freeze and hold checks run before the claim is created')
from pg_proc p where p.oid = 'public.claim_transaction_for_approval(uuid, text)'::regprocedure;
