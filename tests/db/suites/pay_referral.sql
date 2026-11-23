-- public.pay_referral (20261124000000_pay_referral.sql), all migrations applied.
-- Uses the production referrals / audit_logs definitions and the partly
-- stand-in log_admin_action body from tests/db/referral_baseline.sql.
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
create function public.bal(u uuid) returns numeric language sql as $$ select balance_usd from public.wallets where user_id = u $$;
create function public.credits_to(u uuid) returns bigint language sql as $$
  select count(*) from public.transactions where user_id = u and type = 'admin_credit' $$;
create function public.audits(r bigint) returns bigint language sql as $$
  select count(*) from public.audit_logs where reason like 'Referral #' || r || ':%' $$;
create function public.ref_status(r bigint) returns text language sql as $$ select status from public.referrals where id = r $$;
-- pay(admin, referral): call pay_referral exactly as the route would.
create function public.t_pay(a uuid, r bigint) returns jsonb language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', a::text, false);
  set local role authenticated;
  return public.pay_referral(r);
end $$;

insert into public.settings (id) values (true);
insert into public.profiles (id, role) values
  ('a1000000-0000-0000-0000-000000000001', 'admin'),
  ('a2000000-0000-0000-0000-000000000002', 'admin');
insert into public.wallets (user_id, balance_usd) values
  ('a1000000-0000-0000-0000-000000000001', 0), ('a2000000-0000-0000-0000-000000000002', 0);

-- Recipients: r<n> referrer, d<n> referred.
create function public.t_people(n int, d_wallet boolean default true) returns void language plpgsql as $$
declare r uuid := ('b' || lpad(n::text, 7, '0') || '-0000-0000-0000-000000000001')::uuid;
        d uuid := ('c' || lpad(n::text, 7, '0') || '-0000-0000-0000-000000000002')::uuid;
begin
  insert into public.profiles (id, role) values (r, 'user'), (d, 'user');
  insert into public.wallets (user_id, balance_usd) values (r, 0);
  if d_wallet then insert into public.wallets (user_id, balance_usd) values (d, 0); end if;
end $$;
create function public.r(n int) returns uuid language sql as $$ select ('b' || lpad(n::text, 7, '0') || '-0000-0000-0000-000000000001')::uuid $$;
create function public.d(n int) returns uuid language sql as $$ select ('c' || lpad(n::text, 7, '0') || '-0000-0000-0000-000000000002')::uuid $$;
grant execute on function public.t_ok(boolean, text), public.t_err(text, text, text) to authenticated;

\echo '=== Request IDs: SQL reproduces the JavaScript vectors'
select public.t_ok(public.referral_payout_request_id('00000000-0000-4000-8000-000000000001', 'referrer') = '5a84b8c7-8b5b-5aff-9353-0ae210409e5c', 'string vector, referrer');
select public.t_ok(public.referral_payout_request_id('00000000-0000-4000-8000-000000000001', 'referred') = '50a81ac0-cd16-55b9-b6c6-10a419320743', 'string vector, referred');
select public.t_ok(public.referral_payout_request_id((42::bigint)::text, 'referrer') = '2d0db65a-73b8-5a0f-bdef-4d498eb1cdc7', 'bigint vector 42, referrer');
select public.t_ok(public.referral_payout_request_id((42::bigint)::text, 'referred') = '042f0c9b-0311-5a9a-a238-29e62af8dc51', 'bigint vector 42, referred');

\echo '=== Both credits succeed (referral #42)'
select public.t_people(42);
insert into public.referrals (id, referrer_id, referred_id, referrer_bonus_usd, referred_bonus_usd) values (42, public.r(42), public.d(42), 25, 10);
select public.t_pay('a1000000-0000-0000-0000-000000000001', 42);
select public.t_ok(public.bal(public.r(42)) = 25 and public.bal(public.d(42)) = 10, 'referrer +25, referred +10');
select public.t_ok((select count(*) = 2 and bool_and(status = 'verified' and verified_by = 'a1000000-0000-0000-0000-000000000001' and verified_at is not null)
                    from public.transactions where user_id in (public.r(42), public.d(42)) and type = 'admin_credit'),
                   'two verified admin_credit transactions by the paying admin');
select public.t_ok((select count(*) from public.admin_wallet_adjustment_requests
                    where request_id in ('2d0db65a-73b8-5a0f-bdef-4d498eb1cdc7', '042f0c9b-0311-5a9a-a238-29e62af8dc51')) = 2,
                   'stored request IDs equal the JavaScript vectors for referral 42');
select public.t_ok((select count(*) = 2
                           and bool_and(admin_id = 'a1000000-0000-0000-0000-000000000001' and action = 'referral_paid')
                           and count(*) filter (where target_user_id = public.r(42) and amount_usd = 25) = 1
                           and count(*) filter (where target_user_id = public.d(42) and amount_usd = 10) = 1
                    from public.audit_logs where reason like 'Referral #42:%'),
                   'two audit entries: each recipient with its own amount, current admin');
select public.t_ok(public.ref_status(42) = 'paid' and (select paid_at is not null from public.referrals where id = 42), 'referral marked paid');
select public.t_err($$select public.t_pay('a1000000-0000-0000-0000-000000000001', 42)$$, 'Already paid', 'retry refused as already paid');
select public.t_ok(public.credits_to(public.r(42)) = 1 and public.audits(42) = 2, 'retry: no new credit, no new audit entry');

\echo '=== Validation'
select public.t_people(2);
insert into public.referrals (id, referrer_id, referred_id, referrer_bonus_usd, referred_bonus_usd) values (2, public.r(2), public.r(2), 25, 10);
select public.t_err($$select public.t_pay('a1000000-0000-0000-0000-000000000001', 2)$$, 'Self-referrals', 'self-referral rejected');
select public.t_ok(public.bal(public.r(2)) = 0 and public.ref_status(2) = 'pending', 'self-referral: nothing paid, still pending');
-- Production: referred_id is UNIQUE, so each invalid referral below has its
-- own referred user d(n); the referrer r(2) may repeat.
select public.t_people(n) from unnest(array[3, 4, 5, 21, 22, 23]) n;
insert into public.referrals (id, referrer_id, referred_id, referrer_bonus_usd, referred_bonus_usd) values (3, public.r(2), public.d(3), -5, 10);
select public.t_err($$select public.t_pay('a1000000-0000-0000-0000-000000000001', 3)$$, 'invalid bonus', 'negative bonus rejected');
insert into public.referrals (id, referrer_id, referred_id, referrer_bonus_usd, referred_bonus_usd) values (4, public.r(2), public.d(4), 25.005, 10);
select public.t_err($$select public.t_pay('a1000000-0000-0000-0000-000000000001', 4)$$, 'invalid bonus', 'sub-cent bonus rejected');
-- Production: referrer_id is NOT NULL, so a referral without a referrer
-- cannot be stored. pay_referral's own missing-recipient check is still
-- exercised by lifting the constraint inside a block that is rolled back.
select public.t_err($$insert into public.referrals (id, referrer_id, referred_id, referrer_bonus_usd, referred_bonus_usd) values (5, null, public.d(5), 25, 10)$$,
                    'not-null', 'schema refuses a referral without a referrer');
select public.t_err($q$do $x$ begin
                      alter table public.referrals alter column referrer_id drop not null;
                      insert into public.referrals (id, referrer_id, referred_id, referrer_bonus_usd, referred_bonus_usd) values (5, null, public.d(5), 25, 10);
                      perform public.t_pay('a1000000-0000-0000-0000-000000000001', 5);
                    end $x$$q$, 'missing recipient', 'missing recipient rejected (constraint lifted temporarily)');
select public.t_ok((select attnotnull from pg_attribute where attrelid = 'public.referrals'::regclass and attname = 'referrer_id')
                   and not exists (select 1 from public.referrals where id = 5) and public.bal(public.d(5)) = 0,
                   'constraint restored, test referral 5 rolled back, nothing paid');
insert into public.referrals (id, referrer_id, referred_id, referrer_bonus_usd, referred_bonus_usd) values
  (21, public.r(2), public.d(21), 'NaN', 10),
  (22, public.r(2), public.d(22), 25, 'Infinity'),
  (23, public.r(2), public.d(23), '-Infinity', 10);
select public.t_err($$select public.t_pay('a1000000-0000-0000-0000-000000000001', 21)$$, 'invalid bonus', 'NaN bonus rejected');
select public.t_err($$select public.t_pay('a1000000-0000-0000-0000-000000000001', 22)$$, 'invalid bonus', 'Infinity bonus rejected');
select public.t_err($$select public.t_pay('a1000000-0000-0000-0000-000000000001', 23)$$, 'invalid bonus', '-Infinity bonus rejected');
select public.t_ok((select count(*) from public.wallets
                    where user_id in (public.r(2), public.d(2), public.d(3), public.d(4), public.d(21), public.d(22), public.d(23))
                      and balance_usd <> 0) = 0
                   and (select count(*) from public.admin_wallet_adjustment_requests
                        where user_id in (public.r(2), public.d(2), public.d(3), public.d(4), public.d(21), public.d(22), public.d(23))) = 0
                   and (select count(*) from public.referrals where id in (21, 22, 23) and status = 'pending') = 3,
                   'special values never reach adjust_wallet_with_transaction; referrals left pending');
select public.t_err($$select public.t_pay('a1000000-0000-0000-0000-000000000001', 999)$$, 'Referral not found', 'unknown referral rejected');
select public.t_err($$select public.t_pay('c0000002-0000-0000-0000-000000000002', 42)$$, 'Only admins', 'non-admin rejected');
select public.t_err($q$do $x$ begin perform set_config('request.jwt.claim.sub', '', false); set local role anon; perform public.pay_referral(42); end $x$$q$,
                    'permission denied', 'anonymous caller cannot execute pay_referral');

\echo '=== Zero bonus'
select public.t_people(6);
insert into public.referrals (id, referrer_id, referred_id, referrer_bonus_usd, referred_bonus_usd) values (6, public.r(6), public.d(6), 25, 0);
select public.t_pay('a1000000-0000-0000-0000-000000000001', 6);
select public.t_ok(public.bal(public.r(6)) = 25 and public.credits_to(public.d(6)) = 0 and public.audits(6) = 1 and public.ref_status(6) = 'paid',
                   'zero referred bonus: one credit, one audit entry, referral paid');

\echo '=== Full rollback: second credit fails (missing wallet)'
select public.t_people(7, false);
insert into public.referrals (id, referrer_id, referred_id, referrer_bonus_usd, referred_bonus_usd) values (7, public.r(7), public.d(7), 25, 10);
select public.t_err($$select public.t_pay('a1000000-0000-0000-0000-000000000001', 7)$$, 'Wallet not found', 'missing wallet aborts the payment');
select public.t_ok(public.bal(public.r(7)) = 0 and public.credits_to(public.r(7)) = 0 and public.audits(7) = 0 and public.ref_status(7) = 'pending'
                   and (select count(*) from public.admin_wallet_adjustment_requests where user_id = public.r(7)) = 0,
                   'first credit, its audit entry and request row all rolled back; still pending');

\echo '=== Audit failure rolls back both credits'
select public.t_people(8);
insert into public.referrals (id, referrer_id, referred_id, referrer_bonus_usd, referred_bonus_usd) values (8, public.r(8), public.d(8), 25, 10);
select set_config('test.fail_audit', 'on', false);
select public.t_err($$select public.t_pay('a1000000-0000-0000-0000-000000000001', 8)$$, 'audit_logs insert failed', 'audit failure aborts the payment');
select set_config('test.fail_audit', 'off', false);
select public.t_ok(public.bal(public.r(8)) = 0 and public.bal(public.d(8)) = 0 and public.credits_to(public.r(8)) = 0
                   and public.audits(8) = 0 and public.ref_status(8) = 'pending', 'audit failure: no credits, no audit, still pending');
select public.t_pay('a1000000-0000-0000-0000-000000000001', 8);
select public.t_ok(public.bal(public.r(8)) = 25 and public.bal(public.d(8)) = 10 and public.ref_status(8) = 'paid', 'retry after the audit outage pays normally');

\echo '=== Cross-admin recovery of a partial payment made by the previous route'
select public.t_people(9);
insert into public.referrals (id, referrer_id, referred_id, referrer_bonus_usd, referred_bonus_usd) values (9, public.r(9), public.d(9), 25, 10);
-- The old route computed this request ID in JavaScript. Here it is computed
-- before the role switch (as postgres): authenticated is deliberately not
-- allowed to call referral_payout_request_id. Only the adjustment itself
-- runs as admin 1, exactly as the old route did.
do $$
declare
  v_request uuid := public.referral_payout_request_id('9', 'referrer');
begin
  perform set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000001', false);
  set local role authenticated;
  perform public.adjust_wallet_with_transaction(v_request, public.r(9), 'credit', 25, 'Referral bonus (you referred someone)');
end $$;
select public.t_ok((select verified_by from public.transactions where user_id = public.r(9) and type = 'admin_credit') = 'a1000000-0000-0000-0000-000000000001',
                   'setup: the partial referrer credit was made by admin 1');
select public.t_ok(public.bal(public.r(9)) = 25 and public.ref_status(9) = 'pending', 'setup: admin 1 credited the referrer only (old route, partial)');
select public.t_pay('a2000000-0000-0000-0000-000000000002', 9);
select public.t_ok(public.bal(public.r(9)) = 25 and public.credits_to(public.r(9)) = 1
                   and (select count(*) from public.admin_wallet_adjustment_requests
                        where request_id = public.referral_payout_request_id('9', 'referrer')) = 1
                   and (select verified_by from public.transactions where user_id = public.r(9) and type = 'admin_credit') = 'a1000000-0000-0000-0000-000000000001',
                   'admin 2: existing referrer credit recognised, not paid again (still one credit, made by admin 1)');
select public.t_ok(public.bal(public.d(9)) = 10, 'admin 2: missing referred credit paid');
select public.t_ok((select verified_by from public.transactions where user_id = public.r(9) and type = 'admin_credit') = 'a1000000-0000-0000-0000-000000000001'
                   and (select verified_by from public.transactions where user_id = public.d(9) and type = 'admin_credit') = 'a2000000-0000-0000-0000-000000000002',
                   'original credit keeps admin 1; new credit is by admin 2');
select public.t_ok((select count(*) from public.audit_logs where reason like 'Referral #9:%' and target_user_id = public.r(9)) = 1,
                   'exactly one audit entry for the recovered referrer credit');
select public.t_ok((select admin_id = 'a2000000-0000-0000-0000-000000000002' and action = 'referral_credit_recovered' and amount_usd = 25
                    from public.audit_logs where reason like 'Referral #9:%' and target_user_id = public.r(9)),
                   'recovery audit: admin 2 is the recorded actor');
select public.t_ok((select reason like '%already credited by admin a1000000-0000-0000-0000-000000000001%'
                    from public.audit_logs where reason like 'Referral #9:%' and target_user_id = public.r(9)),
                   'recovery audit reason names admin 1 as the original crediting admin');
select public.t_ok((select admin_id = 'a2000000-0000-0000-0000-000000000002' and action = 'referral_paid' and amount_usd = 10
                    from public.audit_logs where reason like 'Referral #9:%' and target_user_id = public.d(9)),
                   'new credit audit: admin 2 as the crediting actor');
select public.t_ok(public.ref_status(9) = 'paid', 'recovered referral marked paid');

\echo '=== Inconsistent existing credit records abort for manual review'
create function public.t_bad_request(n int, role text, user_id uuid, amount numeric, reason text, txn uuid, resulting numeric)
returns void language sql as $$
  insert into public.admin_wallet_adjustment_requests (request_id, admin_id, user_id, adjustment_type, amount, reason, transaction_id, resulting_balance)
  values (public.referral_payout_request_id(n::text, role), 'a1000000-0000-0000-0000-000000000001', user_id, 'credit', amount, reason, txn, resulting)
$$;
create function public.t_txn(u uuid, amount numeric, typ text, st text, by_admin uuid, note text default null) returns uuid language sql as $$
  insert into public.transactions (user_id, type, amount_usd, status, verified_by, verified_at, admin_note)
  values (u, typ, amount, st, by_admin, case when by_admin is null then null else now() end, note) returning id
$$;

select public.t_people(10);
insert into public.referrals (id, referrer_id, referred_id, referrer_bonus_usd, referred_bonus_usd) values (10, public.r(10), public.d(10), 25, 10);
select public.t_bad_request(10, 'referrer', public.d(10), 25, 'Referral bonus (you referred someone)',
  public.t_txn(public.d(10), 25, 'admin_credit', 'verified', 'a1000000-0000-0000-0000-000000000001'), 25);
select public.t_err($$select public.t_pay('a2000000-0000-0000-0000-000000000002', 10)$$, 'manual review', 'existing request with the wrong recipient aborts');

select public.t_people(11);
insert into public.referrals (id, referrer_id, referred_id, referrer_bonus_usd, referred_bonus_usd) values (11, public.r(11), public.d(11), 25, 10);
select public.t_bad_request(11, 'referrer', public.r(11), 20, 'Referral bonus (you referred someone)',
  public.t_txn(public.r(11), 20, 'admin_credit', 'verified', 'a1000000-0000-0000-0000-000000000001'), 20);
select public.t_err($$select public.t_pay('a2000000-0000-0000-0000-000000000002', 11)$$, 'manual review', 'existing request with a different amount (bonus changed) aborts');

select public.t_people(12);
insert into public.referrals (id, referrer_id, referred_id, referrer_bonus_usd, referred_bonus_usd) values (12, public.r(12), public.d(12), 25, 10);
select public.t_bad_request(12, 'referrer', public.r(12), 25, 'Referral bonus (you referred someone)', null, null);
select public.t_err($$select public.t_pay('a2000000-0000-0000-0000-000000000002', 12)$$, 'manual review', 'existing request without transaction_id aborts');

select public.t_people(13);
insert into public.referrals (id, referrer_id, referred_id, referrer_bonus_usd, referred_bonus_usd) values (13, public.r(13), public.d(13), 25, 10);
set session_replication_role = replica;  -- simulate a corrupted link the foreign key would normally prevent
select public.t_bad_request(13, 'referrer', public.r(13), 25, 'Referral bonus (you referred someone)', gen_random_uuid(), 25);
set session_replication_role = origin;
select public.t_err($$select public.t_pay('a2000000-0000-0000-0000-000000000002', 13)$$, 'missing or inconsistent', 'existing request whose transaction is missing aborts');

select public.t_people(14);
insert into public.referrals (id, referrer_id, referred_id, referrer_bonus_usd, referred_bonus_usd) values (14, public.r(14), public.d(14), 25, 10);
select public.t_bad_request(14, 'referrer', public.r(14), 25, 'Referral bonus (you referred someone)',
  public.t_txn(public.r(14), 25, 'deposit', 'verified', 'a1000000-0000-0000-0000-000000000001'), 25);
select public.t_err($$select public.t_pay('a2000000-0000-0000-0000-000000000002', 14)$$, 'missing or inconsistent', 'linked transaction of the wrong type aborts');

select public.t_people(15);
insert into public.referrals (id, referrer_id, referred_id, referrer_bonus_usd, referred_bonus_usd) values (15, public.r(15), public.d(15), 25, 10);
select public.t_bad_request(15, 'referrer', public.r(15), 25, 'Referral bonus (you referred someone)',
  public.t_txn(public.r(15), 25, 'admin_credit', 'pending', null), 25);
select public.t_err($$select public.t_pay('a2000000-0000-0000-0000-000000000002', 15)$$, 'missing or inconsistent', 'linked transaction not verified aborts');

select public.t_people(17);
insert into public.referrals (id, referrer_id, referred_id, referrer_bonus_usd, referred_bonus_usd) values (17, public.r(17), public.d(17), 25, 10);
-- request recorded as admin 1, transaction verified by admin 2
select public.t_bad_request(17, 'referrer', public.r(17), 25, 'Referral bonus (you referred someone)',
  public.t_txn(public.r(17), 25, 'admin_credit', 'verified', 'a2000000-0000-0000-0000-000000000002', 'Referral bonus (you referred someone)'), 25);
select public.t_err($$select public.t_pay('a2000000-0000-0000-0000-000000000002', 17)$$, 'missing or inconsistent', 'request admin differs from transaction verified_by: aborts');

select public.t_people(18);
insert into public.referrals (id, referrer_id, referred_id, referrer_bonus_usd, referred_bonus_usd) values (18, public.r(18), public.d(18), 25, 10);
select public.t_bad_request(18, 'referrer', public.r(18), 25, 'Referral bonus (you referred someone)',
  public.t_txn(public.r(18), 25, 'admin_credit', 'verified', 'a1000000-0000-0000-0000-000000000001', 'Goodwill credit'), 25);
select public.t_err($$select public.t_pay('a2000000-0000-0000-0000-000000000002', 18)$$, 'missing or inconsistent', 'transaction admin_note differs from the referral reason: aborts');

-- Control: identical record except all fields correct is accepted (proves
-- the two checks above fail only on the field they target).
select public.t_people(19);
insert into public.referrals (id, referrer_id, referred_id, referrer_bonus_usd, referred_bonus_usd) values (19, public.r(19), public.d(19), 25, 10);
select public.t_bad_request(19, 'referrer', public.r(19), 25, 'Referral bonus (you referred someone)',
  public.t_txn(public.r(19), 25, 'admin_credit', 'verified', 'a1000000-0000-0000-0000-000000000001', 'Referral bonus (you referred someone)'), 25);
select public.t_pay('a2000000-0000-0000-0000-000000000002', 19);
select public.t_ok(public.ref_status(19) = 'paid' and public.credits_to(public.r(19)) = 1 and public.bal(public.d(19)) = 10,
                   'control: fully consistent existing credit recognised (no second credit), referral paid');

select public.t_ok((select count(*) from public.transactions t join generate_series(10, 15) n on t.user_id in (public.r(n), public.d(n))
                    where t.type = 'admin_credit' and t.status = 'verified') = 2
                   and (select count(*) from public.referrals where id between 10 and 15 and status = 'pending') = 6
                   and (select count(*) from public.audit_logs where reason ~ '^Referral #1[0-5]:') = 0,
                   'no compensating credit, no audit entry, every inconsistent referral left pending');

\echo '=== Compatibility with withdrawal reservations'
select public.t_people(16);
update public.wallets set balance_usd = 100 where user_id = public.d(16);
insert into public.referrals (id, referrer_id, referred_id, referrer_bonus_usd, referred_bonus_usd) values (16, public.r(16), public.d(16), 25, 10);
select set_config('request.jwt.claim.sub', public.d(16)::text, false);
set role authenticated;
create temp table t_hold as select (public.request_withdrawal('00000000-0000-0000-0000-0000000000a6', 80, 'bank') ->> 'transactionId')::uuid as id;
reset role;
select public.t_ok(public.bal(public.d(16)) = 20, 'referred user holds 80 for a withdrawal (100 -> 20)');
select public.t_pay('a1000000-0000-0000-0000-000000000001', 16);
select public.t_ok(public.bal(public.d(16)) = 30, 'referral credit adds to the held balance; the hold stays (20 + 10)');
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000001', false);
set role authenticated;
select public.reject_pending_transaction((select id from t_hold), 'Rejected');
reset role;
select public.t_ok(public.bal(public.d(16)) = 110, 'rejecting the withdrawal returns the 80 hold (30 + 80)');

\echo '=== log_admin_action (production behaviour as supplied)'
-- log(caller, target): call log_admin_action as an authenticated caller.
create function public.t_log(a uuid, target uuid, reason text) returns uuid language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(a::text, ''), false);
  set local role authenticated;
  return public.log_admin_action('test_action', target, 1, reason, null);
end $$;
select public.t_ok((select pg_get_userbyid(proowner) = 'postgres' and prosecdef and proconfig = array['search_path=public']
                    from pg_proc where oid = 'public.log_admin_action(text, uuid, numeric, text, text)'::regprocedure),
                   'log_admin_action: owner postgres, SECURITY DEFINER, search_path=public');
select public.t_ok((select proacl::text from pg_proc where oid = 'public.log_admin_action(text, uuid, numeric, text, text)'::regprocedure)
                     = '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}',
                   'log_admin_action ACL equals production exactly');
select public.t_ok((select proacl::text from pg_proc where oid = 'public.pay_referral(bigint)'::regprocedure)
                     = '{postgres=X/postgres,authenticated=X/postgres}'
                   and (select proacl::text from pg_proc where oid = 'public.referral_payout_request_id(text, text)'::regprocedure)
                     = '{postgres=X/postgres}',
                   'pay_referral executable by authenticated only; request-ID helper by nobody (despite Supabase default grants)');
select public.t_ok((select full_name is null from public.profiles where id = 'a1000000-0000-0000-0000-000000000001'),
                   'setup: admin 1 has no full_name');
select public.t_ok((select count(*) > 0 and bool_and(admin_name = 'Unknown admin')
                    from public.audit_logs where admin_id = 'a1000000-0000-0000-0000-000000000001' and reason like 'Referral #42:%'),
                   'NULL admin full_name: pay_referral audit entries record ''Unknown admin'' and the payment succeeded');
select public.t_log('a1000000-0000-0000-0000-000000000001', public.r(42), 'log test: unnamed admin');
select public.t_ok((select count(*) = 1 and bool_and(admin_name = 'Unknown admin' and target_user_name is null)
                    from public.audit_logs where reason = 'log test: unnamed admin'),
                   'NULL admin full_name: direct call writes ''Unknown admin'' instead of failing');
update public.profiles set full_name = 'Admin Two' where id = 'a2000000-0000-0000-0000-000000000002';
update public.profiles set full_name = 'Referrer Forty-Two' where id = public.r(42);
select public.t_log('a2000000-0000-0000-0000-000000000002', public.r(42), 'log test: named admin');
select public.t_ok((select count(*) = 1 and bool_and(admin_id = 'a2000000-0000-0000-0000-000000000002' and admin_name = 'Admin Two'
                                                    and target_user_name = 'Referrer Forty-Two')
                    from public.audit_logs where reason = 'log test: named admin'),
                   'admin_name and target_user_name come from profiles.full_name');
select public.t_err($$select public.t_log(public.d(42), public.r(42), 'log test: non-admin')$$, 'Only admins', 'non-admin call to log_admin_action raises');
select public.t_err($$select public.t_log(null, public.r(42), 'log test: no user')$$, 'Only admins', 'call without a signed-in user raises');
select public.t_err($q$do $x$ begin perform set_config('request.jwt.claim.sub', '', false); set local role anon;
                      perform public.log_admin_action('test_action', public.r(42), 1, 'log test: anon', null); end $x$$q$,
                    'Only admins', 'anonymous call to log_admin_action raises');
select public.t_ok((select count(*) from public.audit_logs where reason in ('log test: non-admin', 'log test: no user', 'log test: anon')) = 0,
                   'rejected callers wrote no audit entries');
