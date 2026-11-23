-- POST-DEPLOYMENT VERIFICATION for the financial-integrity release.
--
-- READ-ONLY (READ ONLY transaction, rolled back). Run as postgres after
-- applying 20261122000000, 20261123000000 and 20261124000000, and again
-- after the application deployment.
--
--   OK / FAIL / INFO   (any FAIL: stop and follow the rollback plan)
--
-- Fingerprints are md5(prosrc) of the functions exactly as the repository
-- migrations create them; tests/db/run.mjs runs this script after applying
-- the migrations to the test database and requires every check to pass.

begin transaction read only;

with
fp(fn, expected) as (values
  ('public._finalize_claimed_transaction(uuid, uuid)', '62d44e91876bb2a76c3c67e48f50a41c'),
  ('public.claim_transaction_for_approval(uuid, text)', '8e37d7cc0cf29ce765e497cfd7b26b6e'),
  ('public.reject_pending_transaction(uuid, text)', '649260a243dc8771bf6016a8b019ae8e'),
  ('public.cancel_investment_atomically(uuid, text)', '2b81d0d2aa7779194f98596ac5dd711f'),
  ('public.request_investment_withdrawal(uuid, numeric)', 'a9533e449c0820d29e15714f7745742c'),
  ('public.claim_investment_gains(uuid)', '6559341401ebc101716f2bcc41c381e5'),
  ('public.adjust_wallet_with_transaction(uuid, uuid, text, numeric, text)', '1cb23257aa7e58baae7bd9fd928608f9'),
  ('public.request_withdrawal(uuid, numeric, text, text, numeric, text, text)', '43f0483ce7afd6bd5e7c1b3cf5a9e8f7'),
  ('public.investment_accrued_interest(numeric, numeric, numeric, timestamptz, timestamptz)', '5099368a5d6edc2d43e8c5e0982af7a6'),
  ('public.investment_claimable_gains(uuid, uuid)', '3ae25e33590084878e720b0e5ec16064'),
  ('public._refund_early_withdrawal_fees(uuid, uuid)', 'c142e2fad7b962ec11b85e671f7c2f06'),
  ('public.pay_referral(bigint)', '1ffe439817eee8875eea7b31ab33dafc'),
  ('public.referral_payout_request_id(text, text)', '62a683704059bead9baf3f03fc3da340')
),
-- Who may execute each release function: anon, authenticated, service_role.
acl(fn, anon_ok, auth_ok, service_ok) as (values
  ('public.request_withdrawal(uuid, numeric, text, text, numeric, text, text)', false, true, false),
  ('public.claim_transaction_for_approval(uuid, text)', false, true, false),
  ('public.reject_pending_transaction(uuid, text)', false, true, false),
  ('public._finalize_claimed_transaction(uuid, uuid)', false, false, false),
  ('public.investment_accrued_interest(numeric, numeric, numeric, timestamptz, timestamptz)', false, true, true),
  ('public.investment_claimable_gains(uuid, uuid)', false, true, true),
  ('public._refund_early_withdrawal_fees(uuid, uuid)', false, false, false),
  ('public.pay_referral(bigint)', false, true, false),
  ('public.referral_payout_request_id(text, text)', false, false, false)
),
checks(seq, check_name, result, detail) as (
  select 1, 'installed as in the repository: ' || fp.fn,
         case when p.oid is not null and md5(replace(p.prosrc, chr(13), '')) = fp.expected then 'OK' else 'FAIL' end,
         coalesce('md5 ' || md5(replace(p.prosrc, chr(13), '')), 'missing') || ' expected ' || fp.expected
  from fp left join pg_catalog.pg_proc p on p.oid = to_regprocedure(fp.fn)

  union all
  select 2, 'owner postgres, SECURITY DEFINER with fixed search_path: ' || fp.fn,
         case when p.oid is not null and pg_get_userbyid(p.proowner) = 'postgres'
                and (not p.prosecdef or exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'))
              then 'OK' else 'FAIL' end,
         coalesce(pg_get_userbyid(p.proowner) || ', definer=' || p.prosecdef || ', ' || coalesce(array_to_string(p.proconfig, ','), 'no config'), 'missing')
  from fp left join pg_catalog.pg_proc p on p.oid = to_regprocedure(fp.fn)

  union all
  select 3, 'execute permissions: ' || acl.fn,
         case when p.oid is not null
                and has_function_privilege('anon', p.oid, 'EXECUTE') = acl.anon_ok
                and has_function_privilege('authenticated', p.oid, 'EXECUTE') = acl.auth_ok
                and has_function_privilege('service_role', p.oid, 'EXECUTE') = acl.service_ok
              then 'OK' else 'FAIL' end,
         coalesce('anon=' || has_function_privilege('anon', p.oid, 'EXECUTE')
                  || ' authenticated=' || has_function_privilege('authenticated', p.oid, 'EXECUTE')
                  || ' service_role=' || has_function_privilege('service_role', p.oid, 'EXECUTE'), 'missing')
  from acl left join pg_catalog.pg_proc p on p.oid = to_regprocedure(acl.fn)

  union all
  select 4, 'withdrawal_reservations: RLS on; authenticated SELECT only',
         case when c.relrowsecurity
                and not has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE')
                and not has_table_privilege('service_role', c.oid, 'SELECT, INSERT, UPDATE, DELETE')
                and has_table_privilege('authenticated', c.oid, 'SELECT')
                and not has_table_privilege('authenticated', c.oid, 'INSERT, UPDATE, DELETE')
              then 'OK' else 'FAIL' end,
         'rls=' || c.relrowsecurity
  from pg_catalog.pg_class c where c.oid = to_regclass('public.withdrawal_reservations')

  union all
  select 5, 'transactions_type_check includes early_withdrawal_fee_refund',
         case when position('early_withdrawal_fee_refund' in pg_get_constraintdef(c.oid)) > 0 and c.convalidated then 'OK' else 'FAIL' end,
         pg_get_constraintdef(c.oid)
  from pg_catalog.pg_constraint c where c.conrelid = 'public.transactions'::regclass and c.conname = 'transactions_type_check'

  union all
  select 6, 'request IDs match the application vectors',
         case when public.referral_payout_request_id('42', 'referrer') = '2d0db65a-73b8-5a0f-bdef-4d498eb1cdc7'
               and public.referral_payout_request_id('42', 'referred') = '042f0c9b-0311-5a9a-a238-29e62af8dc51'
              then 'OK' else 'FAIL' end, 'referral 42'

  union all
  select 7, 'every held reservation belongs to a pending withdrawal of the same amount',
         case when count(*) = 0 then 'OK' else 'FAIL' end,
         count(*) || ' inconsistent hold(s)' || coalesce(': ' || string_agg(r.transaction_id::text, ', '), '')
  from public.withdrawal_reservations r left join public.transactions t on t.id = r.transaction_id
  where r.state = 'held' and (t.id is null or t.type <> 'withdrawal' or t.status <> 'pending'
                              or t.amount_usd <> r.amount or t.user_id <> r.user_id)

  union all
  select 8, 'no negative wallet balance',
         case when count(*) = 0 then 'OK' else 'FAIL' end, count(*) || ' wallet(s)'
  from public.wallets where balance_usd < 0

  union all
  select 9, 'no pending referral whose referred user already holds an unrecorded legacy credit',
         case when count(*) = 0 then 'OK' else 'FAIL' end,
         count(*) || ' referral(s)' || coalesce(': ' || string_agg(r.id::text, ', '), '')
  from public.referrals r
  where r.status = 'pending'
    and exists (select 1 from public.transactions t where t.user_id = r.referred_id and t.type = 'admin_credit'
                and t.admin_note = 'Referral bonus (you signed up with a code)'
                and not exists (select 1 from public.admin_wallet_adjustment_requests q where q.transaction_id = t.id))

  union all
  select 10, 'record snapshot (must equal the pre-flight snapshot when nothing ran in between)', 'INFO',
         'wallets ' || (select count(*) || '/' || coalesce(sum(balance_usd), 0) from public.wallets)
         || '; transactions ' || (select count(*) || '/' || coalesce(sum(amount_usd), 0) from public.transactions)
         || '; investments ' || (select count(*) || '/' || coalesce(sum(amount_usd), 0) from public.investments)
         || '; referrals ' || (select count(*) || '/' || count(*) filter (where status = 'paid') from public.referrals)
         || '; audit_logs ' || (select count(*) from public.audit_logs)
         || '; adjustment_requests ' || (select count(*) from public.admin_wallet_adjustment_requests)
)
select seq, check_name, result, detail from checks order by seq, check_name;

rollback;
