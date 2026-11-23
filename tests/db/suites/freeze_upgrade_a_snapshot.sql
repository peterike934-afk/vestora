-- Payout freeze upgrade, phase A: state after 20261125000000 (referral
-- programme live) with paid, pending and rejected referrals, queued and sent
-- emails, consent history, a queued campaign and a review note.
alter table public.referrals alter column id set generated always;
insert into public.settings (id, referral_program_enabled, referral_referrer_bonus_usd, referral_referred_bonus_usd)
values (true, true, 25, 10) on conflict (id) do update set referral_program_enabled = true;

insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values
  ('f1000000-0000-0000-0000-000000000001', 'fz.admin@test.local', '{"full_name": "Freeze Admin"}', now()),
  ('f2000000-0000-0000-0000-000000000002', 'fz.referrer@test.local', '{"full_name": "Freeze Referrer"}', now());
insert into public.wallets (user_id, balance_usd) values
  ('f1000000-0000-0000-0000-000000000001', 0), ('f2000000-0000-0000-0000-000000000002', 40);
set session_replication_role = replica;
update public.profiles set role = 'admin' where id = 'f1000000-0000-0000-0000-000000000001';
set session_replication_role = origin;

-- Three referred customers through the real signup + verification path.
insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at)
select v.id, v.email, jsonb_build_object('full_name', v.email, 'referral_code',
       (select referral_code from public.profiles where id = 'f2000000-0000-0000-0000-000000000002')), now()
from (values ('f3000000-0000-0000-0000-000000000003'::uuid, 'fz.paid@test.local'),
             ('f4000000-0000-0000-0000-000000000004'::uuid, 'fz.pending@test.local'),
             ('f5000000-0000-0000-0000-000000000005'::uuid, 'fz.rejected@test.local')) v(id, email);
insert into public.wallets (user_id, balance_usd) values
  ('f3000000-0000-0000-0000-000000000003', 0), ('f4000000-0000-0000-0000-000000000004', 5), ('f5000000-0000-0000-0000-000000000005', 0);

-- Before the freeze an admin could pay and reject; do both as Production would have.
do $$
declare
  v_paid bigint := (select id from public.referrals where referred_id = 'f3000000-0000-0000-0000-000000000003');
  v_rejected bigint := (select id from public.referrals where referred_id = 'f5000000-0000-0000-0000-000000000005');
begin
  perform set_config('request.jwt.claim.sub', 'f1000000-0000-0000-0000-000000000001', true);
  set local role authenticated;
  perform public.pay_referral(v_paid);
  perform public.reject_referral(v_rejected, 'not_eligible', 'private: same household');
end $$;
-- One email already sent, one consent opt-in, a queued (paused) campaign.
update public.notification_deliveries set status = 'sent', provider_message_id = 'msg-1', attempt_count = 1
where id = (select id from public.notification_deliveries order by created_at, id limit 1);
do $$
begin
  perform set_config('request.jwt.claim.sub', 'f2000000-0000-0000-0000-000000000002', true);
  set local role authenticated;
  perform public.set_my_marketing_consent(true, 'settings');
end $$;
select public.enqueue_marketing_campaign('referral-launch');

create table public.t_fz_snapshot (k text primary key, v text);
create function public.t_fz_records() returns table (k text, v text) language sql as $$
  select 'profiles', md5(string_agg(to_jsonb(x)::text, '|' order by x.id)) from public.profiles x
  union all select 'referrals', md5(string_agg(to_jsonb(x)::text, '|' order by x.id)) from public.referrals x
  union all select 'wallets', md5(string_agg(to_jsonb(x)::text, '|' order by x.user_id)) from public.wallets x
  union all select 'transactions', md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from public.transactions x
  union all select 'audit_logs', md5(string_agg(to_jsonb(x)::text, '|' order by x.id)) from public.audit_logs x
  union all select 'auth_users', md5(string_agg(to_jsonb(x)::text, '|' order by x.id)) from auth.users x
  union all select 'settings', md5(string_agg(to_jsonb(x)::text, '|')) from public.settings x
  union all select 'admin_wallet_adjustment_requests', md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.request_id), '')) from public.admin_wallet_adjustment_requests x
  union all select 'notification_deliveries', md5(string_agg(to_jsonb(x)::text, '|' order by x.id)) from public.notification_deliveries x
  union all select 'marketing_consent_events', md5(string_agg(to_jsonb(x)::text, '|' order by x.id)) from public.marketing_consent_events x
  union all select 'referral_signup_intents', md5(string_agg(to_jsonb(x)::text, '|' order by x.user_id)) from public.referral_signup_intents x
  union all select 'referral_review_notes', md5(string_agg(to_jsonb(x)::text, '|' order by x.id)) from public.referral_review_notes x
  union all select 'marketing_campaign_controls', md5(string_agg(to_jsonb(x)::text, '|' order by x.campaign_key)) from public.marketing_campaign_controls x
$$;
-- Every function that exists now (source, ACL, definer, config), except the
-- three whose body or grants this migration changes; a missing one counts.
create table public.t_fz_fnlist (sig text primary key);
insert into public.t_fz_fnlist
select p.oid::regprocedure::text from pg_proc p
where p.pronamespace = 'public'::regnamespace and p.proname not like 't\_%'
  and p.oid not in ('public.pay_referral(bigint)'::regprocedure, 'public.set_marketing_campaign_paused(text, boolean, uuid)'::regprocedure,
                    'public.enqueue_marketing_campaign(text)'::regprocedure);
create function public.t_fz_functions() returns text language sql as $$
  select md5(string_agg(l.sig || ':' || coalesce(md5(replace(p.prosrc, chr(13), '')) || ':' || coalesce(p.proacl::text, '-')
                        || ':' || p.prosecdef || ':' || coalesce(array_to_string(p.proconfig, ','), '-'), 'MISSING'), '|' order by l.sig))
  from public.t_fz_fnlist l left join pg_proc p on p.oid = to_regprocedure(l.sig)
$$;
insert into public.t_fz_snapshot select * from public.t_fz_records();
insert into public.t_fz_snapshot values ('functions', public.t_fz_functions());
insert into public.t_fz_snapshot select 'pay_acl', proacl::text from pg_proc where oid = 'public.pay_referral(bigint)'::regprocedure;
insert into public.t_fz_snapshot select 'enqueue1_acl', proacl::text from pg_proc where oid = 'public.enqueue_marketing_campaign(text)'::regprocedure;
insert into public.t_fz_snapshot select 'paused_acl', proacl::text from pg_proc where oid = 'public.set_marketing_campaign_paused(text, boolean, uuid)'::regprocedure;
