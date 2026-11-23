-- Phase C: rollback applied.
set client_min_messages = notice;
\echo '=== Rollback returns held funds and restores V2 exactly'
select public.t_ok(public.bal('66666666-0000-0000-0000-000000000006') = 470, 'held 120 returned to wallet (350 -> 470); approved 80 stays debited');
select public.t_ok((select count(*) from public.withdrawal_reservations where state = 'held') = 0, 'no holds left');
select public.t_ok((select state from public.withdrawal_reservations where transaction_id = (select v from t_ids where k='c1')) = 'consumed', 'completed hold kept as audit record');
select public.t_ok((select status from public.transactions where id = (select v from t_ids where k='h1')) = 'pending', 'withdrawal whose hold was returned is still pending for admin review');
select public.t_ok(
  (select count(*) from pg_proc p join t_snapshot s on s.k = 'fn_' || p.proname
   where p.pronamespace = 'public'::regnamespace and md5(replace(p.prosrc, chr(13), '')) = s.v) = 3,
  'all three functions identical to V2 originals (ignoring CR line endings)');
select public.t_ok(not exists (select 1 from pg_proc where proname = 'request_withdrawal'), 'request_withdrawal removed');

\echo '=== After rollback, V2 behaviour: approval debits once'
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
set role authenticated;
insert into public.t_ids select 'h1tok', public.claim_transaction_for_approval((select v from t_ids where k='h1'), null);
select public.t_ok(public.bal('66666666-0000-0000-0000-000000000006') = 470, 'V2 claim does not hold funds');
select public.finalize_transaction_approval((select v from t_ids where k='h1'), (select v from t_ids where k='h1tok'));
reset role;
select public.t_ok(public.bal('66666666-0000-0000-0000-000000000006') = 350, 'approving the formerly-held 120 debits exactly once (470 -> 350)');
