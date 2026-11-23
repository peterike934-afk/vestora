-- Referral payout freeze (20261126000000_referral_payout_freeze.sql), all
-- migrations applied, on the Production-fidelity auth.users / profiles fixture.
-- Covers: freeze on by default; direct RPC and direct table writes refused;
-- deliberate, audited enabling; payment when enabled; disabling again;
-- pay_referral otherwise identical to 20261124000000; delivery release;
-- campaign audit trail.
set client_min_messages = notice;

-- Production: referrals.id is GENERATED ALWAYS AS IDENTITY.
alter table public.referrals alter column id set generated always;

create function public.t_ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if coalesce(cond, false) then raise notice 'PASS  %', label; else raise notice 'FAIL  %', label; end if;
end $$;
create function public.t_err(stmt text, fragment text, label text) returns void language plpgsql as $$
begin
  execute stmt;
  raise notice 'FAIL  % (no error raised)', label;
exception when others then
  if position(fragment in sqlerrm) > 0 then raise notice 'PASS  %  [%]', label, sqlerrm;
  else raise notice 'FAIL  % (got: %)', label, sqlerrm; end if;
end $$;
create function public.t_as(u uuid, stmt text) returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), false);
  set local role authenticated;
  execute stmt into v;
  return v;
end $$;
create function public.t_service(stmt text) returns text language plpgsql as $$
declare v text;
begin
  set local role service_role;
  execute stmt into v;
  return v;
end $$;
create function public.t_anon(stmt text) returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claim.sub', '', false);
  set local role anon;
  execute stmt into v;
  return v;
end $$;
create function public.t_signup(email text, code text, confirmed boolean) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at)
  values (v, email,
          case when code is null then jsonb_build_object('full_name', split_part(email, '@', 1))
               else jsonb_build_object('full_name', split_part(email, '@', 1), 'referral_code', code) end,
          case when confirmed then now() end);
  insert into public.wallets (user_id, balance_usd) values (v, 0);
  return v;
end $$;
create function public.t_code(u uuid) returns text language sql as $$ select referral_code from public.profiles where id = u $$;
create function public.t_ref_of(u uuid) returns bigint language sql as $$ select id from public.referrals where referred_id = u $$;
create function public.t_bal(u uuid) returns numeric language sql as $$ select balance_usd from public.wallets where user_id = u $$;
-- Everything a payment could change, as one comparable string.
create function public.t_money() returns text language sql as $$
  select md5(coalesce((select string_agg(user_id || ':' || balance_usd, ',' order by user_id) from public.wallets), '')
    || coalesce((select string_agg(to_jsonb(r)::text, ',' order by r.id) from public.referrals r), '')
    || (select count(*) from public.transactions)::text
    || (select count(*) from public.audit_logs)::text
    || (select count(*) from public.admin_wallet_adjustment_requests)::text
    || (select count(*) from public.notification_deliveries where event_type like 'referral_paid%')::text) $$;
create function public.t_switch() returns boolean language sql as $$ select payouts_enabled from public.referral_payout_controls $$;
create function public.t_events() returns bigint language sql as $$ select count(*) from public.referral_payout_control_events $$;

insert into public.settings (id, referral_program_enabled, referral_referrer_bonus_usd, referral_referred_bonus_usd)
values (true, true, 30, 12.50);

-- Worst case for the write guard: client roles hold every table privilege on
-- referrals and an RLS policy lets admins write anything. (Production's
-- referrals policies and grants were not supplied; the guard must refuse
-- direct writes whatever they are.)
grant select, insert, update, delete on public.referrals to authenticated, service_role;
alter table public.referrals enable row level security;
create policy t_admins_write_anything on public.referrals for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy t_service_anything on public.referrals for all to service_role using (true) with check (true);

\echo '=== Setup: admin, referrer, a referred customer, one existing PAID referral'
select public.t_signup('admin@test.local', null, true) as admin_id \gset
set session_replication_role = replica;
update public.profiles set role = 'admin', full_name = 'Admin One' where id = :'admin_id';
set session_replication_role = origin;
select public.t_signup('rita@test.local', null, true) as rita \gset
select public.t_signup('ben@test.local', public.t_code(:'rita'), true) as ben \gset
select public.t_ref_of(:'ben') as ref1 \gset
-- An already-paid referral from before (inserted as postgres; no money moved here).
select public.t_signup('olga@test.local', null, true) as olga \gset
insert into public.referrals (referrer_id, referred_id, referrer_bonus_usd, referred_bonus_usd, status, paid_at)
values (:'rita', :'olga', 25, 10, 'paid', '2026-01-02T03:04:05Z') returning id as old_paid \gset
select to_jsonb(r)::text as old_paid_row from public.referrals r where id = :old_paid \gset
select public.t_ok(:ref1 is not null and (select status from public.referrals where id = :ref1) = 'pending', 'setup: one pending referral (ben) and one old paid referral');

\echo '=== 1. Frozen by default'
select public.t_ok(public.t_switch() = false and (select count(*) from public.referral_payout_controls) = 1, 'switch row exists and payouts are OFF');
select public.t_ok(public.t_events() = 1 and (select operator = 'migration 20261126000000' and not payouts_enabled from public.referral_payout_control_events), 'one log entry: frozen by the migration');

\echo '=== 2. Direct RPC while frozen: refused, nothing changes'
select public.t_money() as before_money \gset
select public.t_err(format('select public.t_as(%L, %L)', :'admin_id', format('select public.pay_referral(%s)::text', :ref1)),
                    'Referral payouts are disabled', 'admin calling pay_referral directly (PostgREST RPC) is refused');
select public.t_ok(public.t_money() = :'before_money', 'no wallet, referral, transaction, audit, adjustment or "paid" email change');
select public.t_ok(public.t_bal(:'rita') = 0 and public.t_bal(:'ben') = 0, 'both balances still 0');
select public.t_err(format('select public.t_as(%L, %L)', :'ben', format('select public.pay_referral(%s)::text', :ref1)),
                    'Only admins', 'customer: admin check runs first (freeze state not revealed)');
select public.t_err(format('select public.t_anon(%L)', format('select public.pay_referral(%s)::text', :ref1)),
                    'permission denied', 'anonymous caller cannot execute pay_referral');
select public.t_err(format('select public.t_service(%L)', format('select public.pay_referral(%s)::text', :ref1)),
                    'permission denied', 'service role cannot execute pay_referral');

\echo '=== 3. Direct table writes are refused for every client role (worst-case RLS and grants)'
select public.t_err(format('select public.t_as(%L, %L)', :'admin_id', format('update public.referrals set status = ''paid'', paid_at = now() where id = %s returning id::text', :ref1)),
                    'controlled functions', 'admin cannot mark a referral paid directly');
select public.t_err(format('select public.t_as(%L, %L)', :'admin_id', format('update public.referrals set referrer_bonus_usd = 10000 where id = %s returning id::text', :ref1)),
                    'controlled functions', 'admin cannot change bonus amounts directly');
select public.t_err(format('select public.t_as(%L, %L)', :'admin_id', format('update public.referrals set status = ''rejected'', reviewed_by = %L, reviewed_at = now(), rejection_reason = ''other'' where id = %s returning id::text', :'admin_id', :ref1)),
                    'controlled functions', 'admin cannot reject directly (bypassing reject_referral and its audit entry)');
select public.t_err(format('select public.t_as(%L, %L)', :'admin_id', format('delete from public.referrals where id = %s returning id::text', :ref1)),
                    'controlled functions', 'admin cannot delete a referral');
select public.t_err(format('select public.t_as(%L, %L)', :'admin_id', format('insert into public.referrals (referrer_id, referred_id, referrer_bonus_usd, referred_bonus_usd) values (%L, %L, 1, 1) returning id::text', :'ben', :'rita')),
                    'controlled functions', 'admin cannot insert a referral');
select public.t_err(format('select public.t_service(%L)', format('update public.referrals set status = ''paid'' where id = %s returning id::text', :ref1)),
                    'controlled functions', 'service role cannot mark a referral paid directly');
select public.t_err(format('select public.t_service(%L)', format('update public.referrals set referred_bonus_usd = 999 where id = %s returning id::text', :ref1)),
                    'controlled functions', 'service role cannot change amounts');
select public.t_err(format('update public.referrals set status = ''paid'', paid_at = now() where id = %s', :ref1),
                    'Referral payouts are disabled', 'even postgres cannot mark a referral paid while frozen (no false "paid" email)');
select public.t_ok(public.t_money() = :'before_money', 'still nothing changed');

\echo '=== 4. Nobody but postgres can change the switch; direct edits are refused'
select public.t_err(format('select public.t_as(%L, %L)', :'admin_id', 'select public.set_referral_payouts_enabled(true, ''me'', ''x'', ''ENABLE REFERRAL PAYOUTS'')::text'),
                    'permission denied', 'admin cannot call set_referral_payouts_enabled');
select public.t_err(format('select public.t_service(%L)', 'select public.set_referral_payouts_enabled(true, ''svc'', ''x'', ''ENABLE REFERRAL PAYOUTS'')::text'),
                    'permission denied', 'service role cannot call set_referral_payouts_enabled');
select public.t_err(format('select public.t_as(%L, %L)', :'admin_id', 'update public.referral_payout_controls set payouts_enabled = true where id returning id::text'),
                    'permission denied', 'admin cannot update the switch table');
select public.t_err(format('select public.t_service(%L)', 'update public.referral_payout_controls set payouts_enabled = true where id returning id::text'),
                    'permission denied', 'service role cannot update the switch table');
select public.t_err('update public.referral_payout_controls set payouts_enabled = true where id',
                    'Use public.set_referral_payouts_enabled', 'postgres: a direct UPDATE of the switch is refused (no unaudited change)');
select public.t_err('delete from public.referral_payout_controls',
                    'cannot be deleted', 'the switch row cannot be deleted');
select public.t_err('truncate public.referral_payout_controls',
                    'cannot be deleted', 'the switch table cannot be truncated');
select public.t_err($$insert into public.referral_payout_control_events (payouts_enabled, operator, reason) values (true, 'x', 'forged')$$,
                    'Use public.set_referral_payouts_enabled', 'the change log cannot be written directly');
select public.t_err($$update public.referral_payout_control_events set reason = 'edited'$$,
                    'append-only', 'the change log cannot be edited');
select public.t_err('delete from public.referral_payout_control_events',
                    'cannot be deleted', 'the change log cannot be deleted');
select public.t_err('truncate public.referral_payout_control_events',
                    'cannot be deleted', 'the change log cannot be truncated');
select public.t_ok(public.t_as(:'admin_id', 'select payouts_enabled::text from public.referral_payout_controls') = 'false',
                   'admins can read the switch (OFF)');
select public.t_ok(public.t_as(:'ben', 'select count(*)::text from public.referral_payout_controls') = '0'
                   and public.t_as(:'ben', 'select count(*)::text from public.referral_payout_control_events') = '0',
                   'customers cannot see the switch or its log');

\echo '=== 5. Enabling needs postgres, an operator, a reason and the exact confirmation'
select public.t_err($$select public.set_referral_payouts_enabled(true, 'Ops', 'Launch')$$, 'ENABLE REFERRAL PAYOUTS', 'no confirmation: refused');
select public.t_err($$select public.set_referral_payouts_enabled(true, 'Ops', 'Launch', 'enable referral payouts')$$, 'ENABLE REFERRAL PAYOUTS', 'wrong-case confirmation: refused');
select public.t_err($$select public.set_referral_payouts_enabled(true, '  ', 'Launch', 'ENABLE REFERRAL PAYOUTS')$$, 'operator name', 'blank operator: refused');
select public.t_err($$select public.set_referral_payouts_enabled(true, 'Ops', '', 'ENABLE REFERRAL PAYOUTS')$$, 'reason', 'blank reason: refused');
select public.t_err($$select public.set_referral_payouts_enabled(null, 'Ops', 'x')$$, 'enabled (true) or disabled', 'missing state: refused');
select public.t_ok(public.t_switch() = false and public.t_events() = 1, 'refused attempts changed nothing and logged nothing');
select public.t_ok(public.set_referral_payouts_enabled(false, 'Ops', 'Already off') = '{"changed": false, "payoutsEnabled": false}'::jsonb
                   and public.t_events() = 1, 'disabling when already OFF: no change, no log entry');
select public.t_ok(public.set_referral_payouts_enabled(true, '  Ops Lead  ', ' Terms published; approved batch 1 ', 'ENABLE REFERRAL PAYOUTS')
                     = '{"changed": true, "payoutsEnabled": true}'::jsonb, 'enabled with operator, reason and confirmation');
select public.t_ok(public.t_switch() = true and (select updated_by from public.referral_payout_controls) = 'Ops Lead', 'switch ON, operator recorded on the switch');
select public.t_ok((select payouts_enabled and operator = 'Ops Lead' and reason = 'Terms published; approved batch 1' and database_user = 'postgres'
                    from public.referral_payout_control_events order by id desc limit 1) and public.t_events() = 2,
                   'log entry: enabled, operator, reason, database user');
select public.t_ok(public.set_referral_payouts_enabled(true, 'Ops', 'again', 'ENABLE REFERRAL PAYOUTS') = '{"changed": false, "payoutsEnabled": true}'::jsonb
                   and public.t_events() = 2, 'enabling twice: no second log entry');

\echo '=== 6. Enabled: authorised payment works exactly once; authorisation unchanged'
select public.t_err(format('select public.t_as(%L, %L)', :'ben', format('select public.pay_referral(%s)::text', :ref1)),
                    'Only admins', 'customer still refused while enabled');
select public.t_err(format('select public.t_service(%L)', format('select public.pay_referral(%s)::text', :ref1)),
                    'permission denied', 'service role still cannot execute pay_referral');
select public.t_as(:'admin_id', format('select public.pay_referral(%s)::text', :ref1)) as paid_result \gset
select public.t_ok((:'paid_result')::jsonb ->> 'status' = 'paid' and jsonb_array_length((:'paid_result')::jsonb -> 'credits') = 2, 'admin payment returns paid with two credits');
select public.t_ok(public.t_bal(:'rita') = 30 and public.t_bal(:'ben') = 12.50, 'balances credited once: 30 / 12.50');
select public.t_ok((select count(*) from public.transactions where user_id in (:'rita', :'ben') and type = 'admin_credit') = 2, 'two admin_credit transactions');
select public.t_ok((select count(*) from public.audit_logs where action = 'referral_paid') = 2, 'two referral_paid audit entries');
select public.t_ok((select status = 'paid' and paid_at is not null and reviewed_by = :'admin_id' from public.referrals where id = :ref1), 'referral paid; paying admin recorded');
select public.t_ok((select count(*) from public.notification_deliveries where referral_id = :ref1 and event_type like 'referral_paid%') = 2, 'two "paid" notices queued');
select public.t_err(format('select public.t_as(%L, %L)', :'admin_id', format('select public.pay_referral(%s)::text', :ref1)),
                    'Already paid', 'duplicate payment refused');
select public.t_ok(public.t_bal(:'rita') = 30 and public.t_bal(:'ben') = 12.50
                   and (select count(*) from public.transactions where type = 'admin_credit') = 2, 'duplicate credited nothing');
select public.t_err(format('select public.t_as(%L, %L)', :'admin_id', format('update public.referrals set referrer_bonus_usd = 1 where id = %s returning id::text', :ref1)),
                    'controlled functions', 'direct writes stay refused while payouts are enabled');
select public.t_ok((select to_jsonb(r)::text from public.referrals r where id = :old_paid) = :'old_paid_row', 'the old paid referral is untouched');

\echo '=== 7. Disabling again: the next payment is refused'
select public.t_signup('cara@test.local', public.t_code(:'rita'), true) as cara \gset
select public.t_ok(public.set_referral_payouts_enabled(false, 'Ops Lead', 'Freeze after batch 1') = '{"changed": true, "payoutsEnabled": false}'::jsonb
                   and public.t_events() = 3, 'disabled (no confirmation needed), logged');
select public.t_money() as before_money2 \gset
select public.t_err(format('select public.t_as(%L, %L)', :'admin_id', format('select public.pay_referral(%s)::text', public.t_ref_of(:'cara'))),
                    'Referral payouts are disabled', 'payment refused after disabling');
select public.t_ok(public.t_money() = :'before_money2' and public.t_bal(:'cara') = 0, 'nothing changed');
select public.t_as(:'admin_id', format('select public.reject_referral(%s, ''other'')::text', public.t_ref_of(:'cara')));
select public.t_ok((select status from public.referrals where referred_id = :'cara') = 'rejected',
                   'rejection still works while payouts are frozen (no money moves)');

\echo '=== 8. pay_referral is the 20261124000000 function plus only the freeze check'
select public.t_ok(md5(replace(replace(p.prosrc, chr(13), ''),
         E'\n  -- Payout freeze (20261126000000). Checked after the admin check and before\n  -- the referral is locked or anything is credited. The switch row stays\n  -- share-locked until this payment commits or rolls back.\n  if not public._referral_payouts_enabled() then\n    raise exception ''Referral payouts are disabled'';\n  end if;\n', ''))
         = '1ffe439817eee8875eea7b31ab33dafc', 'removing the inserted check gives exactly the 20261124000000 source')
from pg_proc p where p.oid = 'public.pay_referral(bigint)'::regprocedure;
select public.t_ok(p.prosecdef and p.proconfig = array['search_path=""'] and pg_get_userbyid(p.proowner) = 'postgres'
                   and p.proacl::text = '{postgres=X/postgres,authenticated=X/postgres}', 'SECURITY DEFINER, empty search_path, owner postgres, same EXECUTE grants')
from pg_proc p where p.oid = 'public.pay_referral(bigint)'::regprocedure;
select public.t_ok(position('_referral_payouts_enabled' in p.prosrc) < position('for update' in p.prosrc), 'freeze check comes before the referral row lock')
from pg_proc p where p.oid = 'public.pay_referral(bigint)'::regprocedure;

\echo '=== 9. release_notification_delivery: recipient lookup failures go back to the queue'
select public.t_signup('dina@test.local', public.t_code(:'rita'), true) as dina \gset
select id as d1 from public.notification_deliveries where referral_id = public.t_ref_of(:'dina') and event_type = 'referral_registered_referred' \gset
select public.t_service(format('select attempt_count::text from public.claim_notification_delivery(%L, %L)', :'d1', 'a0000000-0000-4000-8000-000000000001')) as n1 \gset
select public.t_ok((select status from public.notification_deliveries where id = :'d1') = 'sending', 'claimed: sending');
select public.t_ok(public.t_service(format('select coalesce(public.release_notification_delivery(%L, %L, %s, ''recipient_lookup_failed''), ''none'')', :'d1', 'a0000000-0000-4000-8000-000000000999', :n1)) = 'none'
                   and (select status from public.notification_deliveries where id = :'d1') = 'sending', 'another attempt cannot release it');
select public.t_service(format('select public.release_notification_delivery(%L, %L, %s, ''recipient_lookup_failed'')', :'d1', 'a0000000-0000-4000-8000-000000000001', :n1)) as rel1 \gset
select public.t_ok(:'rel1' = 'pending'
                   and (select status = 'pending' and failure_code = 'recipient_lookup_failed' from public.notification_deliveries where id = :'d1'), 'released to pending with the reason');
select public.t_ok(public.t_service(format('select coalesce(public.release_notification_delivery(%L, %L, %s, ''recipient_lookup_failed''), ''none'')', :'d1', 'a0000000-0000-4000-8000-000000000001', :n1)) = 'none',
                   'a pending delivery cannot be released again');
select public.t_err(format('select public.t_service(%L)', format('select public.release_notification_delivery(%L, %L, 1, ''Bad Reason!'')', :'d1', 'a0000000-0000-4000-8000-000000000001')),
                    'Invalid release reason', 'reason must be a short code');
update public.notification_deliveries set attempt_count = 4 where id = :'d1';
select public.t_service(format('select attempt_count::text from public.claim_notification_delivery(%L, %L)', :'d1', 'a0000000-0000-4000-8000-000000000005')) as n5 \gset
select public.t_service(format('select public.release_notification_delivery(%L, %L, %s, ''recipient_lookup_failed'')', :'d1', 'a0000000-0000-4000-8000-000000000005', :n5)) as rel5 \gset
select public.t_ok(:'rel5' = 'failed'
                   and (select status = 'failed' and failure_code = 'recipient_lookup_failed_repeated' from public.notification_deliveries where id = :'d1'),
                   'fifth attempt: failed for admin review instead of looping');
select public.t_err(format('select public.t_as(%L, %L)', :'admin_id', format('select public.release_notification_delivery(%L, %L, 1, ''x_y_z'')', :'d1', 'a0000000-0000-4000-8000-000000000005')),
                    'permission denied', 'admins (client sessions) cannot call it; service role only');

\echo '=== 10. Campaign audit trail'
update public.profiles set marketing_consent = true where id = :'rita';
select public.t_err(format('select public.t_service(%L)', 'select public.enqueue_marketing_campaign(''referral-launch'')::text'),
                    'permission denied', 'the one-argument enqueue is no longer available to the service role');
select public.t_err(format('select public.t_service(%L)', format('select public.enqueue_marketing_campaign(''referral-launch'', %L)::text', :'ben')),
                    'Only admins', 'queueing needs an admin');
select public.t_ok(public.t_service(format('select public.enqueue_marketing_campaign(''referral-launch'', %L)::text', :'admin_id')) = '1', 'admin queues: one consenting recipient');
select public.t_ok((select action = 'queued' and actor_id = :'admin_id' and queued_count = 1 from public.marketing_campaign_events order by id desc limit 1), 'event: queued, admin, count 1');
select public.t_ok((select paused from public.marketing_campaign_controls where campaign_key = 'referral-launch'), 'campaign starts paused');
select public.t_service(format('select public.set_marketing_campaign_paused(''referral-launch'', false, %L)::text', :'admin_id'));
select public.t_service(format('select public.set_marketing_campaign_paused(''referral-launch'', true, %L)::text', :'admin_id'));
select public.t_ok((select string_agg(action, ',' order by id) from public.marketing_campaign_events) = 'queued,resumed,paused', 'events: queued, resumed, paused (who and when)');
select public.t_ok(public.t_as(:'admin_id', 'select count(*)::text from public.marketing_campaign_events') = '3'
                   and public.t_as(:'ben', 'select count(*)::text from public.marketing_campaign_events') = '0', 'admins read the trail; customers cannot');
select public.t_err(format('select public.t_service(%L)', 'insert into public.marketing_campaign_events (campaign_key, action, actor_id) values (''referral-launch'', ''paused'', gen_random_uuid()) returning id::text'),
                    'permission denied', 'nobody writes campaign events directly');
