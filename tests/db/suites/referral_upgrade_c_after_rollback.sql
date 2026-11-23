-- Phase C: rollback applied. Behaviour removed, every record kept.
-- Compared as a set of privileges: PostgreSQL may list the same entries in
-- a different order after revoke/grant.
select public.t_ok((select array_agg(x order by x::text) from unnest((select v from public.t_ref_snapshot where k = 'apply_acl')::aclitem[]) x)
                     = (select array_agg(x order by x::text) from unnest((select proacl from pg_proc where oid = 'public.apply_referral_code(text)'::regprocedure)) x),
                   'apply_referral_code permissions restored exactly (same privileges)');
select public.t_ok(not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in
                     ('reject_referral', 'get_my_referral_history', '_referral_process_intent', 'claim_notification_delivery',
                      'set_my_marketing_consent', 'record_marketing_unsubscribe', 'enqueue_marketing_campaign')),
                   'new functions removed');
select public.t_ok(not exists (select 1 from pg_trigger where tgname in ('vestora_referral_capture_intent', 'vestora_referral_on_email_confirmed',
                     'vestora_referral_on_profile_created', 'vestora_referral_review_fields', 'vestora_referral_notifications')),
                   'attribution and notification triggers removed');
select public.t_ok(to_regclass('public.notification_deliveries') is not null and to_regclass('public.marketing_consent_events') is not null
                   and to_regclass('public.referral_signup_intents') is not null and to_regclass('public.referral_review_notes') is not null,
                   'record tables kept');
select public.t_ok(exists (select 1 from pg_trigger where tgname = 'vestora_guard_profile_referral_and_consent'),
                   'consent/referral-field guard kept, so consent cannot change unaudited while rolled back');
-- The phase B test account (d5) was re-verified, so its auth row changed by design.
select public.t_ok((select count(*) from public.t_ref_records() r join public.t_ref_snapshot s on s.k = r.k and s.v = r.v
                    where r.k <> 'auth_users') = 5 and (select count(*) from public.referrals) = 2,
                   'existing profiles, referrals, wallets, transactions and audit logs still unchanged after rollback');
