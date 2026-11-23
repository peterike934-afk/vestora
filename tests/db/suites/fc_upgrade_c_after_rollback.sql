-- Phase C: rollback applied. Earlier functions and policy restored exactly; records kept.
set client_min_messages = notice;
select public.t_ok((select count(*) from public.t_fc_records() r join public.t_fc_snapshot s on s.k = r.k and s.v = r.v) = 8,
                   'rollback changed no existing record');
select public.t_ok(public.t_fc_functions() = (select v from public.t_fc_snapshot where k = 'functions'),
                   'every other function as before the migration');
select public.t_ok(public.t_fc_other_policies() = (select v from public.t_fc_snapshot where k = 'other_policies'),
                   'every other RLS policy as before');
select public.t_ok((select md5(replace(prosrc, chr(13), '')) from pg_proc where oid = 'public.claim_transaction_for_approval(uuid, text)'::regprocedure) = '8e37d7cc0cf29ce765e497cfd7b26b6e'
                   and (select md5(replace(prosrc, chr(13), '')) from pg_proc where oid = 'public.request_withdrawal(uuid, numeric, text, text, numeric, text, text)'::regprocedure) = '43f0483ce7afd6bd5e7c1b3cf5a9e8f7',
                   'claim and request_withdrawal restored exactly (20261122000000 sources)');
select public.t_ok((select proacl::text from pg_proc where oid = 'public.claim_transaction_for_approval(uuid, text)'::regprocedure) = (select v from public.t_fc_snapshot where k = 'claim_acl')
                   and (select proacl::text from pg_proc where oid = 'public.request_withdrawal(uuid, numeric, text, text, numeric, text, text)'::regprocedure) = (select v from public.t_fc_snapshot where k = 'request_acl'),
                   'grants restored');
select public.t_ok((select pol.polname || ' | ' || pg_get_expr(pol.polwithcheck, pol.polrelid) from pg_policy pol where pol.polrelid = 'public.transactions'::regclass and pol.polcmd = 'a')
                   = (select v from public.t_fc_snapshot where k = 'insert_policy'), 'previous customer insert policy restored exactly');
select public.t_ok(to_regprocedure('public.set_financial_operation_enabled(text, boolean, text, text, text)') is null
                   and to_regprocedure('public._financial_operation_enabled(text)') is null, 'switch functions removed');
select public.t_ok(to_regclass('public.financial_operation_controls') is not null and (select count(*) from public.financial_operation_control_events) = 2,
                   'switch rows and their log KEPT (records)');
