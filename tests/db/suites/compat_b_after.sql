-- Phase B: migration applied. Existing data must be untouched and every
-- in-flight V2 item must still complete correctly.
set client_min_messages = notice;
create function public.t_ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if coalesce(cond, false) then raise notice 'PASS  %', label; else raise notice 'FAIL  %', label; end if;
end $$;
create function public.bal(u uuid) returns numeric language sql security definer as $$ select balance_usd from public.wallets where user_id = u $$;
grant execute on function public.t_ok(boolean,text), public.bal(uuid) to authenticated;
grant select on public.t_ids to authenticated;

\echo '=== Migration preserves all existing rows'
select public.t_ok((select md5(string_agg(row(w.*)::text, '|' order by user_id)) from public.wallets w) = (select v from t_snapshot where k='wallets'), 'every wallet row byte-identical after migration');
select public.t_ok((select md5(string_agg(row(t.*)::text, '|' order by id)) from public.transactions t) = (select v from t_snapshot where k='transactions'), 'every transaction row byte-identical (incl. rejection notes)');
select public.t_ok((select md5(string_agg(row(c.*)::text, '|' order by transaction_id)) from public.admin_financial_operation_claims c) = (select v from t_snapshot where k='claims'), 'every approval-claim row byte-identical');
select public.t_ok((select count(*) from public.withdrawal_reservations) = 0, 'migration creates no holds by itself');

\echo '=== In-flight V2 items complete correctly'
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
set role authenticated;
-- P1: claim made under V2 (no hold) -> finalize debits once, as V2 did.
select public.finalize_transaction_approval((select v from t_ids where k='p1'), (select v from t_ids where k='p1tok'));
select public.t_ok(public.bal('55555555-0000-0000-0000-000000000005') = 60, 'withdrawal mid-approval at migration time: single debit 100 -> 60');
-- P2: unclaimed legacy -> claim holds, reject refunds, note kept.
insert into public.t_ids select 'p2tok', public.claim_transaction_for_approval((select v from t_ids where k='p2'), null);
select public.t_ok(public.bal('55555555-0000-0000-0000-000000000005') = 30, 'legacy pending withdrawal held at claim (60 -> 30)');
select public.release_transaction_claim((select v from t_ids where k='p2'), (select v from t_ids where k='p2tok'), '{}');
select public.reject_pending_transaction((select v from t_ids where k='p2'), 'Bank account closed');
select public.t_ok(public.bal('55555555-0000-0000-0000-000000000005') = 60, 'rejection returns the held 30 (back to 60)');
-- P3: deposit approval unchanged.
insert into public.t_ids select 'p3tok', public.claim_transaction_for_approval((select v from t_ids where k='p3'), null);
select public.finalize_transaction_approval((select v from t_ids where k='p3'), (select v from t_ids where k='p3tok'));
select public.t_ok(public.bal('66666666-0000-0000-0000-000000000006') = 550, 'pending deposit approved after migration credits once (500 -> 550)');
reset role;
select public.t_ok((select admin_note from public.transactions where id = (select v from t_ids where k='p2')) = 'Bank account closed', 'rejection note stored exactly as before');
select public.t_ok((select count(*) from public.transactions where status='rejected' and admin_note in ('Wallet address invalid','Hash not found')) = 2, 'historical rejection notes intact');

\echo '=== Create live holds for the rollback test'
select set_config('request.jwt.claim.sub', '66666666-0000-0000-0000-000000000006', false);
set role authenticated;
insert into public.t_ids select 'h1', (public.request_withdrawal('00000000-0000-0000-0000-0000000000d1', 120, 'bank')->>'transactionId')::uuid;
insert into public.t_ids select 'c1', (public.request_withdrawal('00000000-0000-0000-0000-0000000000d2', 80, 'bank')->>'transactionId')::uuid;
reset role;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
set role authenticated;
insert into public.t_ids select 'c1tok', public.claim_transaction_for_approval((select v from t_ids where k='c1'), null);
select public.finalize_transaction_approval((select v from t_ids where k='c1'), (select v from t_ids where k='c1tok'));
reset role;
select public.t_ok(public.bal('66666666-0000-0000-0000-000000000006') = 350, 'before rollback: 550 - 120 held - 80 approved = 350');
