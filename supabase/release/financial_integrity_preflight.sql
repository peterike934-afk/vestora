-- PRE-FLIGHT for the financial-integrity release:
--   20261122000000_withdrawal_reservations.sql
--   20261123000000_investment_financial_integrity.sql
--   20261124000000_pay_referral.sql
--
-- READ-ONLY. Runs inside a READ ONLY transaction that is rolled back; it
-- cannot change anything. Run as postgres (Supabase SQL editor or psql).
--
-- Result: one row per check.
--   OK      as expected
--   BLOCK   do NOT apply the migrations until resolved
--   REVIEW  compare by hand before applying (may be formatting only)
--   INFO    for the record / reconciliation; keep the output
--
-- Function fingerprints are md5(prosrc) of the production definitions
-- exported on 2026-11-22 (tests/db/production_baseline.sql and
-- 20261120180000_admin_financial_safety.sql). A mismatch means production
-- changed since the export: the migrations would replace that change.
-- tests/db/run.mjs runs this script against the production-state test
-- database and requires every check to pass there.

begin transaction read only;

with
fp(fn, expected) as (values
  ('public._finalize_claimed_transaction(uuid, uuid)', '610fc1ac0571ca021d3e948e2e89b2dd'),
  ('public.claim_transaction_for_approval(uuid, text)', '59df1dbe751858ef1057070a2f456613'),
  ('public.reject_pending_transaction(uuid, text)', '3d6b52b1a932f7e77affb5bb12bc2d79'),
  ('public.cancel_investment_atomically(uuid, text)', '47224b19a853b706c087dbd4a0e21f3d'),
  ('public.request_investment_withdrawal(uuid, numeric)', '8245a67eee9e4ad5de7ca4b9d9f9ab4f'),
  ('public.claim_investment_gains(uuid)', '7782d86cd84503d78ad5d9b06b1bd9b9'),
  ('public.adjust_wallet_with_transaction(uuid, uuid, text, numeric, text)', '1cb23257aa7e58baae7bd9fd928608f9')
),
log_fn as (
  select p.* from pg_catalog.pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.proname = 'log_admin_action'
),
pending_ref as (
  select * from public.referrals where status = 'pending'
),
referrer_excess as (
  select t.user_id,
         count(*) as credits,
         (select count(*) from public.referrals r where r.referrer_id = t.user_id and r.status = 'paid') as paid_referrals
  from public.transactions t
  where t.type = 'admin_credit' and t.admin_note = 'Referral bonus (you referred someone)'
  group by t.user_id
),
referred_excess as (
  select t.user_id, count(*) as credits,
         (select count(*) from public.referrals r where r.referred_id = t.user_id and r.status = 'paid') as paid_referrals
  from public.transactions t
  where t.type = 'admin_credit' and t.admin_note = 'Referral bonus (you signed up with a code)'
  group by t.user_id
),
checks(seq, check_name, result, detail) as (
  select 1, 'running as postgres',
         case when current_user = 'postgres' then 'OK' else 'BLOCK' end, current_user::text

  union all
  select 2, 'release not yet applied',
         case when n = 0 then 'OK' when n = 4 then 'BLOCK' else 'BLOCK' end,
         case when n = 0 then 'none of the release objects exist'
              when n = 4 then 'already applied: do not re-run the migrations'
              else 'PARTIALLY applied (' || n || ' of 4 markers): investigate before anything else' end
  from (select (to_regclass('public.withdrawal_reservations') is not null)::int
             + (to_regprocedure('public.investment_claimable_gains(uuid, uuid)') is not null)::int
             + (to_regprocedure('public.pay_referral(bigint)') is not null)::int
             + (exists (select 1 from information_schema.columns where table_schema = 'public'
                        and table_name = 'investments' and column_name = 'withdrawn_claimed_interest'))::int as n) x

  union all
  select 3, 'prerequisite 20261120180000 applied',
         case when to_regclass('public.admin_wallet_adjustment_requests') is not null
                and to_regclass('public.admin_financial_operation_claims') is not null then 'OK' else 'BLOCK' end,
         'admin_wallet_adjustment_requests and admin_financial_operation_claims must exist'

  union all
  select 4, 'unchanged since export: ' || fp.fn,
         case when p.oid is null then 'BLOCK'
              when md5(replace(p.prosrc, chr(13), '')) = fp.expected then 'OK' else 'BLOCK' end,
         case when p.oid is null then 'function missing'
              else 'md5 ' || md5(replace(p.prosrc, chr(13), '')) || ' expected ' || fp.expected end
  from fp left join pg_catalog.pg_proc p on p.oid = to_regprocedure(fp.fn)

  union all
  select 5, 'unchanged since export: investments_with_value view',
         case when md5(pg_get_viewdef('public.investments_with_value'::regclass, true)) = 'c8377788f652feb9081bf0df0001e03f'
              then 'OK' else 'REVIEW' end,
         'md5 ' || md5(pg_get_viewdef('public.investments_with_value'::regclass, true)) || ' expected c8377788f652feb9081bf0df0001e03f'

  union all
  select 6, 'transactions_type_check is the exported list',
         case when d = 'CHECK ((type = ANY (ARRAY[''deposit''::text, ''withdrawal''::text, ''admin_credit''::text, ''admin_debit''::text, ''investment_withdrawal''::text, ''investment_interest_claim''::text, ''early_withdrawal_fee''::text, ''investment_cancelled''::text])))'
              then 'OK' when d is null then 'BLOCK' else 'REVIEW' end,
         coalesce(d, 'constraint transactions_type_check not found (20261123000000 drops it by name)')
  from (select pg_get_constraintdef(c.oid) as d from pg_catalog.pg_constraint c
        where c.conrelid = 'public.transactions'::regclass and c.conname = 'transactions_type_check') x
  right join (select 1) one on true

  union all
  select 7, 'adjust_wallet_with_transaction: owner postgres, SECURITY DEFINER, empty search_path',
         case when pg_get_userbyid(p.proowner) = 'postgres' and p.prosecdef and p.proconfig = array['search_path=""'] then 'OK' else 'BLOCK' end,
         pg_get_userbyid(p.proowner) || ', definer=' || p.prosecdef || ', ' || coalesce(array_to_string(p.proconfig, ','), 'no config')
  from pg_catalog.pg_proc p where p.oid = to_regprocedure('public.adjust_wallet_with_transaction(uuid, uuid, text, numeric, text)')

  union all
  select 8, 'log_admin_action: one function, fixed search_path, admin from auth.uid()',
         case when (select count(*) from log_fn) = 1
                and exists (select 1 from log_fn, unnest(log_fn.proconfig) c where c like 'search_path=%')
                and exists (select 1 from log_fn where position('auth.uid()' in prosrc) > 0)
                and exists (select 1 from log_fn where prosecdef and pg_get_userbyid(proowner) = 'postgres')
              then 'OK' else 'BLOCK' end,
         (select count(*) from log_fn)::text || ' function(s); ' || coalesce((select array_to_string(proconfig, ',') from log_fn limit 1), 'no config')

  union all
  select 9, 'log_admin_action ACL as supplied',
         case when (select proacl::text from log_fn limit 1) = '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'
              then 'OK' else 'REVIEW' end,
         coalesce((select proacl::text from log_fn limit 1), 'default')

  union all
  select 10, 'referrals columns and types',
         case when count(*) = 7 then 'OK' else 'BLOCK' end, count(*) || ' of 7 expected columns'
  from information_schema.columns c
  join (values ('id', 'bigint'), ('referrer_id', 'uuid'), ('referred_id', 'uuid'), ('referrer_bonus_usd', 'numeric'),
               ('referred_bonus_usd', 'numeric'), ('status', 'text'), ('paid_at', 'timestamp with time zone')) w(col, typ)
    on c.column_name = w.col and c.data_type = w.typ
  where c.table_schema = 'public' and c.table_name = 'referrals'

  union all
  select 11, 'no admin approval in flight',
         case when count(*) = 0 then 'OK' else 'BLOCK' end,
         count(*) || ' claim(s) processing/uncertain' || coalesce(': ' || string_agg(transaction_id::text, ', '), '')
  from public.admin_financial_operation_claims where state in ('processing', 'uncertain')

  union all
  select 12, 'no partially paid pending referral (referred user already credited)',
         case when count(*) = 0 then 'OK' else 'BLOCK' end,
         count(*) || ' referral(s)' || coalesce(': ' || string_agg(r.id::text, ', '), '')
         || case when count(*) > 0 then ' - mark paid by hand after checking; pay_referral would pay again' else '' end
  from pending_ref r
  where exists (select 1 from public.transactions t where t.user_id = r.referred_id and t.type = 'admin_credit'
                and t.admin_note = 'Referral bonus (you signed up with a code)')

  union all
  select 13, 'no partially paid pending referral (referrer has unexplained credits)',
         case when count(*) = 0 then 'OK' else 'BLOCK' end,
         count(*) || ' referral(s)' || coalesce(': ' || string_agg(r.id::text, ', '), '')
         || case when count(*) > 0 then ' - referrer has more referral credits than paid referrals; check by hand' else '' end
  from pending_ref r join referrer_excess e on e.user_id = r.referrer_id
  where e.credits > e.paid_referrals

  union all
  select 14, 'historical referral credits beyond paid referrals (reconciliation)',
         case when count(*) = 0 then 'OK' else 'INFO' end,
         count(*) || ' user(s)' || coalesce(': ' || string_agg(x.user_id || ' ' || x.credits || '/' || x.paid_referrals, ', '), '')
  from (select user_id, credits, paid_referrals from referrer_excess where credits > paid_referrals
        union all select user_id, credits, paid_referrals from referred_excess where credits > paid_referrals) x

  union all
  select 15, 'pending referrals pay_referral will refuse (manual review)',
         case when count(*) = 0 then 'OK' else 'INFO' end,
         count(*) || ' referral(s)' || coalesce(': ' || string_agg(r.id::text, ', '), '')
  from pending_ref r
  where r.referrer_id = r.referred_id
     or lower(r.referrer_bonus_usd::text) in ('nan', 'infinity', '-infinity')
     or lower(r.referred_bonus_usd::text) in ('nan', 'infinity', '-infinity')
     or r.referrer_bonus_usd < 0 or r.referred_bonus_usd < 0
     or r.referrer_bonus_usd <> round(r.referrer_bonus_usd, 2) or r.referred_bonus_usd <> round(r.referred_bonus_usd, 2)
     or (r.referrer_bonus_usd > 0 and not exists (select 1 from public.wallets w where w.user_id = r.referrer_id))
     or (r.referred_bonus_usd > 0 and not exists (select 1 from public.wallets w where w.user_id = r.referred_id))

  union all
  select 16, 'pending withdrawals (held at first claim after 20261122000000)',
         'INFO',
         count(*) || ' pending, total ' || coalesce(sum(t.amount_usd), 0)
         || ', ' || count(*) filter (where coalesce(w.balance_usd, 0) < t.amount_usd) || ' exceed the current balance'
  from public.transactions t left join public.wallets w on w.user_id = t.user_id
  where t.type = 'withdrawal' and t.status = 'pending'

  union all
  select 17, 'investments with a pending principal withdrawal AND a pending gains claim',
         case when count(*) = 0 then 'OK' else 'INFO' end,
         count(*) || ' investment(s)' || coalesce(': ' || string_agg(i.id::text, ', '), '')
  from public.investments i
  where exists (select 1 from public.transactions t where t.investment_id = i.id and t.type = 'investment_withdrawal' and t.status = 'pending')
    and exists (select 1 from public.transactions t where t.investment_id = i.id and t.type = 'investment_interest_claim' and t.status = 'pending')

  union all
  select 18, 'admins without full_name (audit shows ''Unknown admin'')',
         case when count(*) = 0 then 'OK' else 'INFO' end, count(*) || ' admin(s)'
  from public.profiles where role = 'admin' and full_name is null

  union all
  select 19, 'record snapshot (compare with the verification script)', 'INFO',
         'wallets ' || (select count(*) || '/' || coalesce(sum(balance_usd), 0) from public.wallets)
         || '; transactions ' || (select count(*) || '/' || coalesce(sum(amount_usd), 0) from public.transactions)
         || '; investments ' || (select count(*) || '/' || coalesce(sum(amount_usd), 0) from public.investments)
         || '; referrals ' || (select count(*) || '/' || count(*) filter (where status = 'paid') from public.referrals)
         || '; audit_logs ' || (select count(*) from public.audit_logs)
         || '; adjustment_requests ' || (select count(*) from public.admin_wallet_adjustment_requests)
)
select seq, check_name, result, detail from checks order by seq, check_name;

rollback;
