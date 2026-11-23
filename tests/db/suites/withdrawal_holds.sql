\set QUIET on
\pset tuples_only on
set client_min_messages = notice;

-- helpers (security invoker: they run as whatever role is active)
create function public.t_ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if coalesce(cond, false) then raise notice 'PASS  %', label;
  else raise notice 'FAIL  %', label; end if;
end $$;
create function public.t_err(stmt text, fragment text, label text) returns void language plpgsql as $$
begin
  execute stmt;
  raise notice 'FAIL  % (no error raised)', label;
exception when others then
  if position(fragment in sqlerrm) > 0 then raise notice 'PASS  %  [%]', label, sqlerrm;
  else raise notice 'FAIL  % (got: %)', label, sqlerrm; end if;
end $$;
create function public.bal(u uuid) returns numeric language sql security definer as $$ select balance_usd from public.wallets where user_id = u $$;
create function public.held(t uuid) returns text language sql security definer as $$ select state from public.withdrawal_reservations where transaction_id = t $$;
create function public.txstatus(t uuid) returns text language sql security definer as $$ select status from public.transactions where id = t $$;
create function public.txnote(t uuid) returns text language sql security definer as $$ select admin_note from public.transactions where id = t $$;
grant execute on function public.t_ok(boolean,text), public.t_err(text,text,text), public.bal(uuid), public.held(uuid), public.txstatus(uuid), public.txnote(uuid) to authenticated, anon;
create function public.claimcount(t uuid) returns bigint language sql security definer as $$ select count(*) from public.admin_financial_operation_claims where transaction_id = t $$;
grant execute on function public.claimcount(uuid) to authenticated;
create table public.t_ids (k text primary key, v uuid);
grant all on public.t_ids to authenticated, anon;

insert into public.profiles values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'admin'),
  ('11111111-0000-0000-0000-000000000001', 'user'),
  ('22222222-0000-0000-0000-000000000002', 'user'),
  ('33333333-0000-0000-0000-000000000003', 'user');
insert into public.wallets values
  ('aaaaaaaa-0000-0000-0000-000000000001', 0, now()),
  ('11111111-0000-0000-0000-000000000001', 100, now()),
  ('22222222-0000-0000-0000-000000000002', 100, now()),
  ('33333333-0000-0000-0000-000000000003', 500, now());
insert into public.settings (id, min_withdrawal_usd, daily_withdrawal_limit_usd) values (true, 10, 300);

\echo '=== Withdrawal request: funds held at request time'
select set_config('request.jwt.claim.sub', '11111111-0000-0000-0000-000000000001', false);
set role authenticated;
insert into public.t_ids select 'w1', (public.request_withdrawal('00000000-0000-0000-0000-0000000000a1', 60, 'crypto', 'BTC', 0.001, 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', 'my note')->>'transactionId')::uuid;
select public.t_ok(public.bal('11111111-0000-0000-0000-000000000001') = 40, 'request 60 of 100 -> available balance 40');
select public.t_ok(public.txstatus((select v from t_ids where k='w1')) = 'pending', 'new withdrawal starts as pending');
select public.t_ok(public.held((select v from t_ids where k='w1')) = 'held', 'funds recorded as held');
select public.t_ok(public.txnote((select v from t_ids where k='w1')) = 'my note', 'user note preserved in admin_note as before');
-- 20261127000000: the customer-typed crypto amount (0.001) is not stored; the server calculates it at approval.
select public.t_ok((select crypto_amount is null and crypto_currency = 'BTC' and destination_address = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq' from public.transactions where id = (select v from t_ids where k='w1')),
                   'customer-typed crypto amount not stored; coin and address kept');
select public.t_ok((public.request_withdrawal('00000000-0000-0000-0000-0000000000a1', 60, 'crypto', 'BTC', 0.001, 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq')->>'duplicate')::boolean, 'same request replayed -> duplicate, not a second withdrawal');
select public.t_ok(public.bal('11111111-0000-0000-0000-000000000001') = 40, 'replay did not debit again');
select public.t_ok((select count(*) from public.transactions where user_id='11111111-0000-0000-0000-000000000001' and type='withdrawal') = 1, 'exactly one withdrawal row exists');
select public.t_err($$select public.request_withdrawal('00000000-0000-0000-0000-0000000000a2', 60, 'bank')$$, 'Insufficient available balance', 'second request beyond held balance rejected (double spend)');
select public.t_err($$select public.request_withdrawal('00000000-0000-0000-0000-0000000000a1', 30, 'bank')$$, 'already used for a different withdrawal', 'reused request id with different amount rejected');
select public.t_err($$select public.request_withdrawal('00000000-0000-0000-0000-0000000000a3', 5, 'bank')$$, 'below the minimum', 'minimum withdrawal enforced on server');
select public.t_err($$select public.request_withdrawal('00000000-0000-0000-0000-0000000000a4', 10.005, 'bank')$$, 'Invalid withdrawal request', 'sub-cent amount rejected');
select public.t_err($$select public.request_withdrawal('00000000-0000-0000-0000-0000000000a5', 20, 'crypto')$$, 'need BTC, ETH or USDT', 'crypto withdrawal without address rejected');
select public.t_err($$select public.request_withdrawal('00000000-0000-0000-0000-0000000000a6', 20, 'crypto', 'DOGE', null, 'D8bad')$$, 'need BTC, ETH or USDT', 'unsupported coin rejected');
select public.t_err($$select public.request_withdrawal('00000000-0000-0000-0000-0000000000a7', 20, 'crypto', 'ETH', null, '0x123')$$, 'valid destination address', 'malformed ETH address rejected');
select public.t_err($$insert into public.transactions (user_id, type, amount_usd, status, payment_method, crypto_currency, crypto_amount, destination_address)
                      values ('11111111-0000-0000-0000-000000000001', 'withdrawal', 10, 'pending', 'crypto', 'BTC', 5, 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq')$$,
                    'row-level security', 'customer cannot insert a withdrawal directly (only request_withdrawal)');
reset role;

select set_config('request.jwt.claim.sub', '33333333-0000-0000-0000-000000000003', false);
set role authenticated;
select public.request_withdrawal('00000000-0000-0000-0000-0000000000c1', 200, 'wire', null, null, null, 'Wire to: X');
select public.t_err($$select public.request_withdrawal('00000000-0000-0000-0000-0000000000c2', 150, 'bank')$$, 'daily limit', 'daily limit enforced on server (200 + 150 > 300)');
reset role;

\echo '=== Approval: consumes the hold, never debits twice'
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
set role authenticated;
insert into public.t_ids select 'tok1', public.claim_transaction_for_approval((select v from t_ids where k='w1'), 'paid');
select public.t_ok(public.bal('11111111-0000-0000-0000-000000000001') = 40, 'claiming a held withdrawal does not touch balance');
select public.t_err(format($$select public.claim_transaction_for_approval(%L, 'again')$$, (select v from t_ids where k='w1')), 'already has an active', 'duplicate approval claim blocked');
select public.finalize_transaction_approval((select v from t_ids where k='w1'), (select v from t_ids where k='tok1'));
select public.t_ok(public.bal('11111111-0000-0000-0000-000000000001') = 40, 'approval leaves balance at 40 (single debit of 60)');
select public.t_ok(public.txstatus((select v from t_ids where k='w1')) = 'verified', 'withdrawal marked verified');
select public.t_ok(public.held((select v from t_ids where k='w1')) = 'consumed', 'hold consumed');
select public.t_err(format($$select public.finalize_transaction_approval(%L, %L)$$, (select v from t_ids where k='w1'), (select v from t_ids where k='tok1')), 'No matching active approval claim', 'second finalize of same claim blocked');
select public.t_err(format($$select public.reject_pending_transaction(%L, 'late')$$, (select v from t_ids where k='w1')), 'no longer pending', 'cannot reject an approved withdrawal');
reset role;

\echo '=== Rejection: restores held funds and keeps the reason'
select set_config('request.jwt.claim.sub', '22222222-0000-0000-0000-000000000002', false);
set role authenticated;
insert into public.t_ids select 'w2', (public.request_withdrawal('00000000-0000-0000-0000-0000000000b1', 70, 'bank')->>'transactionId')::uuid;
select public.t_ok(public.bal('22222222-0000-0000-0000-000000000002') = 30, 'request 70 of 100 -> 30 available');
select public.t_err(format($$select public.reject_pending_transaction(%L, 'self-reject')$$, (select v from t_ids where k='w2')), 'Only admins', 'user cannot reject their own withdrawal');
reset role;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
set role authenticated;
select public.reject_pending_transaction((select v from t_ids where k='w2'), 'Destination account name does not match');
select public.t_ok(public.bal('22222222-0000-0000-0000-000000000002') = 100, 'rejection restores 70 -> balance 100');
select public.t_ok(public.held((select v from t_ids where k='w2')) = 'released', 'hold released');
select public.t_ok(public.txnote((select v from t_ids where k='w2')) = 'Destination account name does not match', 'rejection reason stored in admin_note (existing feature)');
select public.t_err(format($$select public.reject_pending_transaction(%L, 'twice')$$, (select v from t_ids where k='w2')), 'no longer pending', 'double rejection blocked (no double refund)');
select public.t_ok(public.bal('22222222-0000-0000-0000-000000000002') = 100, 'balance still 100 after blocked second rejection');
reset role;

\echo '=== Legacy withdrawals without a hold (created before holds existed): blocked for manual review'
-- 20261127000000: these rows can no longer be inserted by customers; they
-- exist only from before (inserted here as the database owner). They are
-- never paid and no hold is created for them; the balance is not touched.
insert into public.transactions (user_id, type, amount_usd, status, payment_method) values ('22222222-0000-0000-0000-000000000002', 'withdrawal', 70, 'pending', 'wire') returning id \gset l1_
insert into public.transactions (user_id, type, amount_usd, status, payment_method) values ('22222222-0000-0000-0000-000000000002', 'withdrawal', 70, 'pending', 'wire') returning id \gset l2_
select public.t_ok(public.bal('22222222-0000-0000-0000-000000000002') = 100, 'legacy rows do not move the balance');
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
set role authenticated;
select public.t_err(format($$select public.claim_transaction_for_approval(%L, null)$$, :'l1_id'), 'no valid funds hold; manual review required', 'legacy withdrawal without a hold cannot be approved');
select public.t_ok(public.bal('22222222-0000-0000-0000-000000000002') = 100, 'no hold created, balance unchanged (100)');
select public.t_ok(public.claimcount(:'l1_id') = 0 and public.held(:'l1_id') is null, 'no claim row and no hold were created');
select public.t_ok(public.txstatus(:'l1_id') = 'pending', 'legacy withdrawal stays pending for manual review');
select public.reject_pending_transaction(:'l2_id', 'Insufficient funds');
select public.t_ok(public.bal('22222222-0000-0000-0000-000000000002') = 100, 'rejecting an unheld legacy withdrawal does not credit anything');
reset role;

\echo '=== Release after failed payout keeps funds held; later rejection returns them'
select set_config('request.jwt.claim.sub', '33333333-0000-0000-0000-000000000003', false);
set role authenticated;
insert into public.t_ids select 'w3', (public.request_withdrawal('00000000-0000-0000-0000-0000000000c3', 50, 'bank')->>'transactionId')::uuid;
reset role;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
set role authenticated;
select public.bal('33333333-0000-0000-0000-000000000003') as before_claim \gset
select public.claim_transaction_for_approval((select v from t_ids where k='w3'), null) as tok3 \gset
select public.release_transaction_claim((select v from t_ids where k='w3'), :'tok3', '{"reason":"stripe_rejected"}');
select public.t_ok(public.bal('33333333-0000-0000-0000-000000000003') = :before_claim, 'released claim keeps the hold (balance unchanged)');
select public.t_ok(public.held((select v from t_ids where k='w3')) = 'held', 'still held while pending');
select public.reject_pending_transaction((select v from t_ids where k='w3'), 'Bank details invalid');
select public.t_ok(public.bal('33333333-0000-0000-0000-000000000003') = :before_claim + 50, 'rejection after release returns 50');
reset role;

\echo '=== Deposits: pending never credits; only approval credits; rejection never credits'
select set_config('request.jwt.claim.sub', '11111111-0000-0000-0000-000000000001', false);
set role authenticated;
insert into public.transactions (user_id, type, amount_usd, status) values ('11111111-0000-0000-0000-000000000001', 'deposit', 250, 'pending') returning id \gset d1_
insert into public.transactions (user_id, type, amount_usd, status) values ('11111111-0000-0000-0000-000000000001', 'deposit', 999, 'pending') returning id \gset d2_
select public.t_ok(public.bal('11111111-0000-0000-0000-000000000001') = 40, 'pending deposits do not increase balance');
select public.t_err($$insert into public.transactions (user_id, type, amount_usd, status) values ('11111111-0000-0000-0000-000000000001', 'deposit', 5, 'verified')$$, 'row-level security', 'user cannot insert an already-verified deposit');
select public.t_err($$insert into public.transactions (user_id, type, amount_usd, status, verified_at) values ('11111111-0000-0000-0000-000000000001', 'deposit', 5, 'pending', now())$$, 'row-level security', 'user cannot pre-fill verification fields');
select public.t_err($$insert into public.transactions (user_id, type, amount_usd, status, payment_method) values ('11111111-0000-0000-0000-000000000001', 'deposit', 5, 'pending', 'bank')$$, 'row-level security', 'user cannot submit a bank-pull deposit (Coming Soon)');
select public.t_err($$insert into public.transactions (user_id, type, amount_usd, status) values ('33333333-0000-0000-0000-000000000003', 'deposit', 5, 'pending')$$, 'row-level security', 'user cannot submit a deposit for someone else');
select public.t_err(format($$select public.claim_transaction_for_approval(%L, null)$$, :'d1_id'), 'Only admins', 'user cannot approve their own deposit');
reset role;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
set role authenticated;
select public.claim_transaction_for_approval(:'d1_id', 'ok') as dtok \gset
select public.finalize_transaction_approval(:'d1_id', :'dtok');
select public.t_ok(public.txstatus(:'d1_id') = 'verified', 'deposit marked verified');
select public.t_ok(public.bal('11111111-0000-0000-0000-000000000001') = 290, 'approved deposit credits once (40 + 250)');
select public.t_err(format($$select public.claim_transaction_for_approval(%L, null)$$, :'d1_id'), 'no longer pending', 'duplicate deposit approval blocked');
select public.reject_pending_transaction(:'d2_id', 'Transaction hash not found on chain');
select public.t_ok(public.bal('11111111-0000-0000-0000-000000000001') = 290, 'rejected deposit does not credit');
select public.t_ok(public.txnote(:'d2_id') = 'Transaction hash not found on chain', 'deposit rejection reason stored');
reset role;

\echo '=== Access control'
select set_config('request.jwt.claim.sub', '', false);
set role anon;
select public.t_err($$select public.request_withdrawal('00000000-0000-0000-0000-0000000000f1', 20, 'bank')$$, 'permission denied', 'anonymous caller cannot request withdrawals');
reset role;
select set_config('request.jwt.claim.sub', '22222222-0000-0000-0000-000000000002', false);
set role authenticated;
select public.t_ok((select count(*) from public.withdrawal_reservations where user_id <> '22222222-0000-0000-0000-000000000002') = 0, 'user sees only their own holds');
select public.t_err($$update public.withdrawal_reservations set state = 'released'$$, 'permission denied', 'user cannot modify holds');
select public.t_err($$select public._finalize_claimed_transaction(gen_random_uuid(), gen_random_uuid())$$, 'permission denied', 'internal finalize not callable by users');
reset role;
