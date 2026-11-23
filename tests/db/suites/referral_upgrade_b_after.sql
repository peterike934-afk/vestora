-- Phase B: 20261125000000 applied. Nothing that existed may have changed.
set client_min_messages = notice;
create or replace function public.t_ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if coalesce(cond, false) then raise notice 'PASS  %', label; else raise notice 'FAIL  %', label; end if;
end $$;
select public.t_ok((select count(*) from public.t_ref_records() r join public.t_ref_snapshot s on s.k = r.k and s.v = r.v) = 6,
                   'existing profiles, referrals, wallets, transactions, audit logs and auth accounts unchanged by the migration');
select public.t_ok((select bool_and(not marketing_consent and marketing_consent_updated_at is null) from public.profiles),
                   'every existing customer starts WITHOUT marketing consent');
select public.t_ok((select string_agg(status || ':' || coalesce(reviewed_by::text, '-') || ':' || coalesce(rejection_reason, '-'), ',' order by id)
                    from public.referrals) = 'paid:-:-,pending:-:-',
                   'existing referrals: same statuses, no review data invented');
select public.t_ok((select count(*) from public.notification_deliveries) = 0, 'no notification queued for existing referrals');
select public.t_ok((select count(*) from public.referral_signup_intents) = 0 and (select count(*) from public.marketing_consent_events) = 0,
                   'no intents or consent records created for existing accounts');
-- Existing never-referred account: still cannot be attributed.
update auth.users set raw_user_meta_data = raw_user_meta_data || '{"referral_code": "ANYCODE1"}', email_confirmed_at = null
  where id = 'd5000000-0000-0000-0000-000000000005';
update auth.users set email_confirmed_at = now() where id = 'd5000000-0000-0000-0000-000000000005';
select public.t_ok((select count(*) from public.referrals where referred_id = 'd5000000-0000-0000-0000-000000000005') = 0,
                   'existing account re-verified with a code added later: not attributed');
