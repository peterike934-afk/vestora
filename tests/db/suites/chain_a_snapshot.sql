-- Migration chain, phase A: snapshot of the current production functions
-- and view (production baseline + migrations up to 20261120180000).
create table public.t_chain (k text primary key, v text);
insert into public.t_chain select 'fn_' || proname, md5(replace(prosrc, chr(13), '')) from pg_proc
  where pronamespace = 'public'::regnamespace
    and proname in ('_finalize_claimed_transaction', 'claim_transaction_for_approval', 'reject_pending_transaction',
                    'cancel_investment_atomically', 'request_investment_withdrawal', 'claim_investment_gains',
                    'finalize_transaction_approval', 'release_transaction_claim', 'adjust_wallet_with_transaction');
insert into public.t_chain select 'view', md5(pg_get_viewdef('public.investments_with_value'::regclass, true));
insert into public.t_chain select 'type_check', pg_get_constraintdef(oid) from pg_constraint where conname = 'transactions_type_check';

-- Existing financial records in production state. Every migration and every
-- rollback must leave them exactly as they are.
insert into public.profiles (id, role, full_name) values
  ('c4a00000-0000-0000-0000-000000000001', 'admin', 'Chain Admin'),
  ('c4a00000-0000-0000-0000-000000000002', 'user', 'Chain User Two'),
  ('c4a00000-0000-0000-0000-000000000003', 'user', 'Chain User Three'),
  ('c4a00000-0000-0000-0000-000000000004', 'user', null);
insert into public.wallets (user_id, balance_usd) values
  ('c4a00000-0000-0000-0000-000000000002', 125), ('c4a00000-0000-0000-0000-000000000003', 10),
  ('c4a00000-0000-0000-0000-000000000004', 0);
insert into public.transactions (id, user_id, type, amount_usd, status, verified_by, verified_at, admin_note) values
  ('c4a10000-0000-0000-0000-000000000001', 'c4a00000-0000-0000-0000-000000000002', 'admin_credit', 25, 'verified',
   'c4a00000-0000-0000-0000-000000000001', '2026-11-01 10:00+00', 'Referral bonus (you referred someone)'),
  ('c4a10000-0000-0000-0000-000000000002', 'c4a00000-0000-0000-0000-000000000003', 'admin_credit', 10, 'verified',
   'c4a00000-0000-0000-0000-000000000001', '2026-11-01 10:00+00', 'Referral bonus (you signed up with a code)'),
  ('c4a10000-0000-0000-0000-000000000003', 'c4a00000-0000-0000-0000-000000000002', 'deposit', 100, 'verified',
   'c4a00000-0000-0000-0000-000000000001', '2026-11-02 10:00+00', null);
insert into public.referrals (id, referrer_id, referred_id, referrer_bonus_usd, referred_bonus_usd, status, created_at, paid_at) values
  (5001, 'c4a00000-0000-0000-0000-000000000002', 'c4a00000-0000-0000-0000-000000000003', 25, 10, 'paid', '2026-10-30 10:00+00', '2026-11-01 10:00+00'),
  (5002, 'c4a00000-0000-0000-0000-000000000002', 'c4a00000-0000-0000-0000-000000000004', 25, 10, 'pending', '2026-11-03 10:00+00', null);
insert into public.audit_logs (id, admin_id, admin_name, target_user_id, target_user_name, action, amount_usd, reason, created_at) values
  ('c4a20000-0000-0000-0000-000000000001', 'c4a00000-0000-0000-0000-000000000001', 'Chain Admin',
   'c4a00000-0000-0000-0000-000000000002', 'Chain User Two', 'referral_paid', 25, 'Referral #5001: referrer bonus $25.00 credited', '2026-11-01 10:00+00');

create function public.t_records() returns table (k text, v text) language sql as $$
  select 'profiles', md5(string_agg(p::text, '|' order by p.id)) from public.profiles p
  union all select 'wallets', md5(string_agg(w::text, '|' order by w.user_id)) from public.wallets w
  union all select 'transactions', md5(string_agg(concat_ws(',', t.id, t.user_id, t.type, t.amount_usd, t.status, t.verified_by, t.verified_at, t.admin_note, t.created_at), '|' order by t.id)) from public.transactions t
  union all select 'referrals', md5(string_agg(r::text, '|' order by r.id)) from public.referrals r
  union all select 'audit_logs', md5(string_agg(a::text, '|' order by a.id)) from public.audit_logs a
  union all select 'adjustment_requests', md5(coalesce(string_agg(q::text, '|' order by q.request_id), '')) from public.admin_wallet_adjustment_requests q
$$;
insert into public.t_chain select 'rec_' || k, v from public.t_records();
