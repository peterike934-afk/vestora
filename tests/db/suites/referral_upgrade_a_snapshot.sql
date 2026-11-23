-- Referral programme upgrade, phase A: Production state (all migrations up
-- to 20261124000000) with existing customers and referrals.
insert into public.settings (id) values (true) on conflict do nothing;
insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values
  ('d1000000-0000-0000-0000-000000000001', 'old.admin@test.local', '{"full_name": "Old Admin"}', now()),
  ('d2000000-0000-0000-0000-000000000002', 'old.referrer@test.local', '{"full_name": "Old Referrer"}', now()),
  ('d3000000-0000-0000-0000-000000000003', 'old.referred@test.local', '{"full_name": "Old Referred"}', now()),
  ('d4000000-0000-0000-0000-000000000004', 'old.pending@test.local', '{"full_name": "Old Pending"}', now()),
  ('d5000000-0000-0000-0000-000000000005', 'never.referred@test.local', '{"full_name": "Never Referred"}', now());
insert into public.wallets (user_id, balance_usd) values
  ('d1000000-0000-0000-0000-000000000001', 0), ('d2000000-0000-0000-0000-000000000002', 125),
  ('d3000000-0000-0000-0000-000000000003', 10), ('d4000000-0000-0000-0000-000000000004', 0),
  ('d5000000-0000-0000-0000-000000000005', 50);
set session_replication_role = replica;
update public.profiles set role = 'admin' where id = 'd1000000-0000-0000-0000-000000000001';
set session_replication_role = origin;
-- An already-paid referral and a still-pending one (Production state).
insert into public.referrals (referrer_id, referred_id, referrer_bonus_usd, referred_bonus_usd, status, paid_at) values
  ('d2000000-0000-0000-0000-000000000002', 'd3000000-0000-0000-0000-000000000003', 25, 10, 'paid', now() - interval '3 days'),
  ('d2000000-0000-0000-0000-000000000002', 'd4000000-0000-0000-0000-000000000004', 25, 10, 'pending', null);
update public.profiles set referred_by = 'd2000000-0000-0000-0000-000000000002'
  where id in ('d3000000-0000-0000-0000-000000000003', 'd4000000-0000-0000-0000-000000000004');
insert into public.audit_logs (admin_id, admin_name, action, reason)
  values ('d1000000-0000-0000-0000-000000000001', 'Old Admin', 'referral_paid', 'old payout');

create table public.t_ref_snapshot (k text primary key, v text);
-- Record fingerprints; the columns this migration adds are excluded.
create function public.t_ref_records() returns table (k text, v text) language sql as $$
  select 'profiles', md5(string_agg((to_jsonb(p) - 'marketing_consent' - 'marketing_consent_updated_at')::text, '|' order by p.id)) from public.profiles p
  union all select 'referrals', md5(string_agg((to_jsonb(r) - 'reviewed_by' - 'reviewed_at' - 'rejection_reason')::text, '|' order by r.id)) from public.referrals r
  union all select 'wallets', md5(string_agg(to_jsonb(w)::text, '|' order by w.user_id)) from public.wallets w
  union all select 'transactions', md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by t.id), '')) from public.transactions t
  union all select 'audit_logs', md5(string_agg(to_jsonb(a)::text, '|' order by a.id)) from public.audit_logs a
  union all select 'auth_users', md5(string_agg(to_jsonb(u)::text, '|' order by u.id)) from auth.users u
$$;
insert into public.t_ref_snapshot select * from public.t_ref_records();
insert into public.t_ref_snapshot select 'apply_acl', proacl::text from pg_proc where oid = 'public.apply_referral_code(text)'::regprocedure;
