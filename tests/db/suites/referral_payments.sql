-- Referral payouts through adjust_wallet_with_transaction (as
-- app/api/admin/pay-referral/route.js now does), with all migrations applied.
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
create function public.bal(u uuid) returns numeric language sql security definer as $$ select balance_usd from public.wallets where user_id = u $$;
create function public.credits(u uuid) returns bigint language sql security definer as $$
  select count(*) from public.transactions where user_id = u and type = 'admin_credit' $$;

-- pay(admin, request_id, user, amount, label): one referral credit, exactly
-- as the route performs it (admin session, credit, label as reason).
create function public.t_pay(a uuid, r uuid, u uuid, amount numeric, label text) returns jsonb language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', a::text, false);
  set local role authenticated;
  return public.adjust_wallet_with_transaction(r, u, 'credit', amount, label);
end $$;

insert into public.settings (id) values (true);
insert into public.profiles (id, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'admin'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'admin'),
  ('51000000-0000-0000-0000-000000000001', 'user'),
  ('52000000-0000-0000-0000-000000000002', 'user'),
  ('53000000-0000-0000-0000-000000000003', 'user');
insert into public.wallets (user_id, balance_usd) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 0), ('aaaaaaaa-0000-0000-0000-000000000002', 0),
  ('51000000-0000-0000-0000-000000000001', 0), ('52000000-0000-0000-0000-000000000002', 100),
  ('53000000-0000-0000-0000-000000000003', 100);

\echo '=== Referral credit: atomic, recorded, at most once'
select public.t_pay('aaaaaaaa-0000-0000-0000-000000000001', '5a000000-0000-5000-8000-000000000001',
                    '51000000-0000-0000-0000-000000000001', 25, 'Referral bonus (you referred someone)');
select public.t_ok(public.bal('51000000-0000-0000-0000-000000000001') = 25, 'referral bonus credited once (0 -> 25)');
select public.t_ok((select verified_by = 'aaaaaaaa-0000-0000-0000-000000000001' and verified_at is not null
                           and status = 'verified' and admin_note = 'Referral bonus (you referred someone)'
                    from public.transactions where user_id = '51000000-0000-0000-0000-000000000001' and type = 'admin_credit'),
                   'credit transaction has verified_by, verified_at, status verified and the bonus label');
select public.t_ok((public.t_pay('aaaaaaaa-0000-0000-0000-000000000001', '5a000000-0000-5000-8000-000000000001',
                    '51000000-0000-0000-0000-000000000001', 25, 'Referral bonus (you referred someone)') ->> 'duplicate')::boolean,
                   'repeat payment with the same referral request ID is reported as a duplicate');
select public.t_ok(public.bal('51000000-0000-0000-0000-000000000001') = 25 and public.credits('51000000-0000-0000-0000-000000000001') = 1,
                   'repeat payment credits nothing and adds no transaction');
select public.t_err($$select public.t_pay('aaaaaaaa-0000-0000-0000-000000000002', '5a000000-0000-5000-8000-000000000001',
                    '51000000-0000-0000-0000-000000000001', 25, 'Referral bonus (you referred someone)')$$,
                    'already used for a different adjustment', 'a second admin paying the same referral is refused, not paid again');
select public.t_ok(public.bal('51000000-0000-0000-0000-000000000001') = 25, 'still exactly one credit');
select public.t_err($$select public.t_pay('51000000-0000-0000-0000-000000000001', '5a000000-0000-5000-8000-000000000009',
                    '51000000-0000-0000-0000-000000000001', 25, 'Referral bonus')$$,
                    'Only admins', 'a non-admin cannot pay a referral');

\echo '=== Referral credits alongside withdrawal holds'
select set_config('request.jwt.claim.sub', '52000000-0000-0000-0000-000000000002', false);
set role authenticated;
create temp table t_w as select (public.request_withdrawal('00000000-0000-0000-0000-0000000000b1', 80, 'bank')->>'transactionId')::uuid as id;
reset role;
select public.t_ok(public.bal('52000000-0000-0000-0000-000000000002') = 20, 'withdrawal of 80 holds funds (100 -> 20)');
select public.t_pay('aaaaaaaa-0000-0000-0000-000000000001', '5a000000-0000-5000-8000-000000000002',
                    '52000000-0000-0000-0000-000000000002', 25, 'Referral bonus (you signed up with a code)');
select public.t_ok(public.bal('52000000-0000-0000-0000-000000000002') = 45, 'referral credit adds to the held balance; the hold is not undone (20 + 25)');
select set_config('request.jwt.claim.sub', '52000000-0000-0000-0000-000000000002', false);
set role authenticated;
select public.t_err($$select public.request_withdrawal('00000000-0000-0000-0000-0000000000b2', 80, 'bank')$$,
                    'Insufficient available balance', 'second 80 withdrawal still refused (45 available)');
reset role;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
set role authenticated;
select public.reject_pending_transaction((select id from t_w), 'Rejected');
reset role;
select public.t_ok(public.bal('52000000-0000-0000-0000-000000000002') = 125, 'rejecting the withdrawal returns the 80 hold (45 + 80)');
