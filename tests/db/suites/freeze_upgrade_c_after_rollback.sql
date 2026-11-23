-- Phase C: rollback applied. Earlier functions restored exactly, records kept.
set client_min_messages = notice;
create or replace function public.t_err(stmt text, fragment text, label text) returns void language plpgsql as $$
begin
  execute stmt;
  raise notice 'FAIL  % (no error raised)', label;
exception when others then
  if position(fragment in sqlerrm) > 0 then raise notice 'PASS  %  [%]', label, sqlerrm;
  else raise notice 'FAIL  % (got: %)', label, sqlerrm; end if;
end $$;
select public.t_ok((select count(*) from public.t_fz_records() r join public.t_fz_snapshot s on s.k = r.k and s.v = r.v) = 13,
                   'rollback changed no existing record');
select public.t_ok(public.t_fz_functions() = (select v from public.t_fz_snapshot where k = 'functions'),
                   'every other function as before the migration');
select public.t_ok((select md5(replace(prosrc, chr(13), '')) from pg_proc where oid = 'public.pay_referral(bigint)'::regprocedure) = '1ffe439817eee8875eea7b31ab33dafc'
                   and (select proacl::text from pg_proc where oid = 'public.pay_referral(bigint)'::regprocedure) = (select v from public.t_fz_snapshot where k = 'pay_acl'),
                   'pay_referral restored exactly (20261124000000 source and grants)');
select public.t_ok((select md5(replace(prosrc, chr(13), '')) from pg_proc where oid = 'public.set_marketing_campaign_paused(text, boolean, uuid)'::regprocedure) = '50c2c3e061ed90983fccf840f5169b39'
                   and (select proacl::text from pg_proc where oid = 'public.set_marketing_campaign_paused(text, boolean, uuid)'::regprocedure) = (select v from public.t_fz_snapshot where k = 'paused_acl'),
                   'set_marketing_campaign_paused restored exactly (20261125000000 source and grants)');
select public.t_ok((select proacl::text from pg_proc where oid = 'public.enqueue_marketing_campaign(text)'::regprocedure) = (select v from public.t_fz_snapshot where k = 'enqueue1_acl'),
                   'enqueue_marketing_campaign(text) grants restored');
select public.t_ok(to_regprocedure('public.set_referral_payouts_enabled(boolean, text, text, text)') is null
                   and to_regprocedure('public._referral_payouts_enabled()') is null
                   and to_regprocedure('public.release_notification_delivery(uuid, uuid, integer, text)') is null
                   and to_regprocedure('public.enqueue_marketing_campaign(text, uuid)') is null
                   and not exists (select 1 from pg_trigger where tgname = 'vestora_referral_write_guard'),
                   'freeze functions and the referrals write guard removed');
select public.t_ok(to_regclass('public.referral_payout_controls') is not null and (select count(*) from public.referral_payout_control_events) = 1
                   and to_regclass('public.marketing_campaign_events') is not null, 'switch, its log and campaign events KEPT (records)');
select public.t_err($$update public.referral_payout_control_events set reason = 'x'$$, 'append-only', 'the kept log is still append-only');
