-- Phase B: 20261126000000 applied. Nothing that existed may have changed.
set client_min_messages = notice;
create or replace function public.t_ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if coalesce(cond, false) then raise notice 'PASS  %', label; else raise notice 'FAIL  %', label; end if;
end $$;
select public.t_ok((select count(*) from public.t_fz_records() r join public.t_fz_snapshot s on s.k = r.k and s.v = r.v) = 13,
                   'all 13 record tables unchanged by the migration (profiles, referrals, wallets, transactions, audit, auth, settings, adjustments, deliveries, consent, intents, notes, campaign)');
select public.t_ok(public.t_fz_functions() = (select v from public.t_fz_snapshot where k = 'functions'),
                   'every other function unchanged (source, ACL, SECURITY DEFINER, search_path)');
select public.t_ok((select proacl::text from pg_proc where oid = 'public.pay_referral(bigint)'::regprocedure) = (select v from public.t_fz_snapshot where k = 'pay_acl'),
                   'pay_referral EXECUTE grants unchanged');
select public.t_ok((select payouts_enabled from public.referral_payout_controls) = false and (select count(*) from public.referral_payout_control_events) = 1,
                   'payouts OFF after the upgrade; one log entry');
select public.t_ok((select count(*) from public.marketing_campaign_events) = 0, 'no campaign events invented for the earlier queueing');
select public.t_ok((select string_agg(status, ',' order by id) from public.referrals) = 'paid,pending,rejected', 'paid, pending and rejected referrals keep their status');
do $$
declare
  v_pending bigint := (select id from public.referrals where referred_id = 'f4000000-0000-0000-0000-000000000004');
begin
  perform set_config('request.jwt.claim.sub', 'f1000000-0000-0000-0000-000000000001', true);
  set local role authenticated;
  perform public.pay_referral(v_pending);
  raise notice 'FAIL  the pending referral was paid while frozen';
exception when others then
  if sqlerrm = 'Referral payouts are disabled' then raise notice 'PASS  the existing pending referral cannot be paid while frozen';
  else raise notice 'FAIL  unexpected error: %', sqlerrm; end if;
end $$;
select public.t_ok((select count(*) from public.t_fz_records() r join public.t_fz_snapshot s on s.k = r.k and s.v = r.v) = 13,
                   'the refused payment changed nothing');
