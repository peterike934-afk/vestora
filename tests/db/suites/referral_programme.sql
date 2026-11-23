-- Referral programme (20261125000000_referral_programme.sql), all migrations
-- applied, on the Production-fidelity auth.users / profiles fixture.
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
-- Run one statement as a signed-in customer/admin, or as the service role.
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
-- Sign up exactly as Supabase Auth does: one auth.users row; the existing
-- on_auth_user_created trigger creates the profile.
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
create function public.t_confirm(u uuid) returns void language sql as $$ update auth.users set email_confirmed_at = now() where id = u $$;
create function public.t_code(u uuid) returns text language sql as $$ select referral_code from public.profiles where id = u $$;
create function public.t_intent(u uuid) returns text language sql as $$
  select coalesce((select status || '/' || coalesce(outcome, '-') from public.referral_signup_intents where user_id = u), 'none') $$;
create function public.t_ref_of(u uuid) returns bigint language sql as $$ select id from public.referrals where referred_id = u $$;
create function public.t_notes_for(r bigint) returns text language sql as $$
  select string_agg(event_type || ':' || status, ',' order by event_type) from public.notification_deliveries where referral_id = r $$;

insert into public.settings (id, referral_program_enabled, referral_referrer_bonus_usd, referral_referred_bonus_usd)
values (true, true, 30, 12.50);

\echo '=== Setup: an admin and a referrer, both through the real signup path'
select public.t_signup('admin@test.local', null, true) as admin_id \gset
set session_replication_role = replica;  -- the Production guard only lets admins change roles
update public.profiles set role = 'admin', full_name = 'Admin One' where id = :'admin_id';
set session_replication_role = origin;
select public.t_signup('rita@test.local', null, true) as rita \gset
select public.t_ok(public.t_code(:'rita') ~ '^[A-Z0-9]{8}$', 'referrer has a Production-style referral code');
select public.t_ok(public.t_intent(:'rita') = 'none', 'signup without a code: no intent');

\echo '=== 1. Successful referral: captured at signup, attributed only after verification'
select public.t_signup('ben@test.local', public.t_code(:'rita'), false) as ben \gset
select public.t_ok(public.t_intent(:'ben') = 'captured/-' and public.t_ref_of(:'ben') is null,
                   'unverified: code captured, no referral yet');
select public.t_confirm(:'ben');
select public.t_ok(public.t_intent(:'ben') = 'attributed/attributed', 'verified: intent attributed');
select public.t_ok((select referrer_id = :'rita' and status = 'pending' and referrer_bonus_usd = 30 and referred_bonus_usd = 12.50
                    from public.referrals where referred_id = :'ben'),
                   'pending referral with the LIVE settings amounts (30 / 12.50), not hardcoded values');
select public.t_ok((select referred_by = :'rita' from public.profiles where id = :'ben'), 'profile.referred_by set to the referrer');
select public.t_ok(public.t_notes_for(public.t_ref_of(:'ben')) = 'referral_registered_referred:pending,referral_registered_referrer:pending',
                   'two "registered" notifications queued (referrer and referred)');
select public.t_ok((select bool_and(payload = jsonb_build_object('referral_id', referral_id)) from public.notification_deliveries
                    where referral_id = public.t_ref_of(:'ben')), 'registration notice payload carries no amount (no reward promised)');

\echo '=== Idempotency and device independence'
update auth.users set email_confirmed_at = null where id = :'ben';
select public.t_confirm(:'ben');
select public._referral_process_intent(:'ben');
select public.t_ok((select count(*) from public.referrals where referred_id = :'ben') = 1
                   and (select count(*) from public.notification_deliveries where referral_id = public.t_ref_of(:'ben')) = 2,
                   're-verification and re-processing: still one referral, still two notices');
select public.t_signup('cara@test.local', '  ' || lower(public.t_code(:'rita')) || ' ', false) as cara \gset
select public.t_confirm(:'cara');
select public.t_ok(public.t_intent(:'cara') = 'attributed/attributed',
                   'code entered in lower case with spaces is normalised; attributed with no client call at all');

\echo '=== Auto-confirmed signup and profile created after the intent'
select public.t_signup('dina@test.local', public.t_code(:'rita'), true) as dina \gset
select public.t_ok(public.t_intent(:'dina') = 'attributed/attributed', 'already-verified signup attributed immediately');
alter table auth.users disable trigger on_auth_user_created;
select gen_random_uuid() as ed \gset
insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at)
  values (:'ed', 'ed@test.local', jsonb_build_object('referral_code', public.t_code(:'rita')), now());
select public.t_ok(public.t_intent(:'ed') = 'captured/-', 'no profile yet: intent waits');
alter table auth.users enable trigger on_auth_user_created;
insert into public.profiles (id, email, full_name) values (:'ed', 'ed@test.local', 'ed');
select public.t_ok(public.t_intent(:'ed') = 'attributed/attributed', 'profile created later: attributed by the profile trigger');

\echo '=== 2. Invalid referral links (signup still succeeds)'
select public.t_signup('eve@test.local', 'NOPE1234', true) as eve \gset
select public.t_ok(public.t_intent(:'eve') = 'not_attributed/unknown_code' and public.t_ref_of(:'eve') is null
                   and exists (select 1 from public.profiles where id = :'eve'), 'unknown code: not attributed, account created');
select public.t_signup('fay@test.local', '<script>x</script>', true) as fay \gset
select public.t_ok(public.t_intent(:'fay') = 'not_attributed/invalid_code', 'malformed code rejected');
select public.t_signup('gus@test.local', repeat('A', 200), true) as gus \gset
select public.t_ok(public.t_intent(:'gus') = 'not_attributed/invalid_code'
                   and (select length(referral_code) from public.referral_signup_intents where user_id = :'gus') = 64,
                   'over-long code stored truncated and rejected');

\echo '=== 3. Self-referral and duplicate attribution'
select public.t_signup('hal@test.local', null, true) as hal \gset
insert into public.referral_signup_intents (user_id, referral_code) values (:'hal', public.t_code(:'hal'));
select public._referral_process_intent(:'hal');
select public.t_ok(public.t_intent(:'hal') = 'not_attributed/self_referral' and public.t_ref_of(:'hal') is null, 'self-referral refused');
select public.t_signup('ivy@test.local', null, true) as ivy \gset
insert into public.referrals (referrer_id, referred_id, referrer_bonus_usd, referred_bonus_usd) values (:'rita', :'ivy', 30, 12.50);
select public.t_signup('otto@test.local', null, true) as otto \gset
insert into public.referral_signup_intents (user_id, referral_code) values (:'ivy', public.t_code(:'otto'));
select public._referral_process_intent(:'ivy');
select public.t_ok(public.t_intent(:'ivy') = 'not_attributed/already_referred'
                   and (select count(*) from public.referrals where referred_id = :'ivy') = 1, 'already referred: no second referral');
select public.t_err(format('insert into public.referrals (referrer_id, referred_id, referrer_bonus_usd, referred_bonus_usd) values (%L, %L, 1, 1)', :'otto', :'ivy'),
                    'duplicate key', 'database refuses a second referral for the same customer');

\echo '=== 4. No retroactive attribution; legacy function withdrawn'
select public.t_signup('jon@test.local', null, true) as jon \gset
update auth.users set raw_user_meta_data = raw_user_meta_data || jsonb_build_object('referral_code', public.t_code(:'rita')),
                      email_confirmed_at = null where id = :'jon';
select public.t_confirm(:'jon');
select public.t_ok(public.t_intent(:'jon') = 'none' and public.t_ref_of(:'jon') is null,
                   'code added to an existing account later: never attributed');
select public.t_err(format('select public.t_as(%L, %L)', :'jon', format('select public.apply_referral_code(%L)::text', public.t_code(:'rita'))),
                    'permission denied', 'apply_referral_code withdrawn for signed-in customers');
select public.t_err(format('select public.t_anon(%L)', 'select public.apply_referral_code(''ABC'')::text'), 'permission denied', 'apply_referral_code withdrawn for anon');
select public.t_err(format('select public.t_service(%L)', 'select public.apply_referral_code(''ABC'')::text'), 'permission denied', 'apply_referral_code withdrawn for service_role');
select public.t_ok(public.t_ref_of(:'jon') is null and (select referred_by from public.profiles where id = :'jon') is null,
                   'old-app call fails cleanly: nothing attributed, account unchanged');

\echo '=== 5. Unverified and ineligible'
select public.t_signup('kim@test.local', public.t_code(:'rita'), false) as kim \gset
select public.t_ok(public.t_intent(:'kim') = 'captured/-' and public.t_ref_of(:'kim') is null, 'never verified: never attributed');
select public.t_signup('lea@test.local', public.t_code(:'rita'), false) as lea \gset
update public.settings set referral_program_enabled = false where id;
select public.t_confirm(:'lea');
update public.settings set referral_program_enabled = true where id;
update auth.users set email_confirmed_at = null where id = :'lea';
select public.t_confirm(:'lea');
select public.t_ok(public.t_intent(:'lea') = 'not_attributed/program_disabled' and public.t_ref_of(:'lea') is null,
                   'programme off at verification: not attributed, and not retried later');

\echo '=== 6. Attribution errors never block signup or verification'
alter table public.referrals add constraint t_block_inserts check (referred_bonus_usd < 0) not valid;
select public.t_signup('max@test.local', public.t_code(:'rita'), true) as max \gset
alter table public.referrals drop constraint t_block_inserts;
select public.t_ok(exists (select 1 from auth.users where id = :'max') and exists (select 1 from public.profiles where id = :'max'),
                   'signup completed despite an attribution failure');
select public.t_ok((select status = 'error' and error_sqlstate = '23514' from public.referral_signup_intents where user_id = :'max')
                   and public.t_ref_of(:'max') is null, 'failure recorded for review (sqlstate), no partial referral');
select public.t_ok((select count(*) from public.notification_deliveries where event_type = 'referral_admin_attention' and recipient_user_id = :'admin_id') = 1,
                   'admin "attention" notification queued');

\echo '=== 7. Rejection: neutral public reason, private note stays private'
select public.t_err(format('select public.t_as(%L, %L)', :'rita', format('select public.reject_referral(%s, ''not_eligible'')::text', public.t_ref_of(:'dina'))),
                    'Only admins', 'customer cannot reject');
select public.t_err(format('select public.t_as(%L, %L)', :'admin_id', format('select public.reject_referral(%s, ''fraud'')::text', public.t_ref_of(:'dina'))),
                    'Invalid rejection reason', 'only the fixed neutral reasons are accepted');
select public.t_as(:'admin_id', format('select public.reject_referral(%s, ''not_eligible'', ''Suspected fraud ring: same device as acct 77'')::text', public.t_ref_of(:'dina')));
select public.t_ok((select status = 'rejected' and rejection_reason = 'not_eligible' and reviewed_by = :'admin_id' and reviewed_at is not null
                    from public.referrals where referred_id = :'dina'), 'referral rejected with reviewer and public reason');
select public.t_ok((select count(*) from public.referral_review_notes where referral_id = public.t_ref_of(:'dina')) = 1, 'private note stored separately');
select public.t_ok(public.t_notes_for(public.t_ref_of(:'dina')) like '%referral_rejected_referred:pending,referral_rejected_referrer:pending%',
                   'both customers notified of the rejection');
select public.t_ok(not exists (select 1 from public.notification_deliveries where payload::text ilike '%fraud%' or payload::text ilike '%device%'),
                   'no notification payload contains the private note');
select public.t_ok(not exists (select 1 from public.audit_logs where reason ilike '%fraud%'), 'audit entry has the reason code, not the note');
select public.t_ok(public.t_as(:'rita', format('select count(*)::text from public.referral_review_notes where referral_id = %s', public.t_ref_of(:'dina'))) = '0',
                   'customer cannot read review notes');
select public.t_ok(public.t_as(:'admin_id', format('select count(*)::text from public.referral_review_notes where referral_id = %s', public.t_ref_of(:'dina'))) = '1',
                   'admin can read review notes');
select public.t_ok(public.t_as(:'dina', 'select string_agg(row_to_json(h)::text, '','') from public.get_my_referral_history() h') not ilike '%fraud%'
                   and public.t_as(:'dina', 'select status || ''/'' || rejection_reason from public.get_my_referral_history()') = 'rejected/not_eligible',
                   'referred customer sees the neutral reason only');
select public.t_err(format('select public.t_as(%L, %L)', :'admin_id', format('select public.pay_referral(%s)::text', public.t_ref_of(:'dina'))),
                    'not pending', 'a rejected referral cannot be paid');
select public.t_err(format('select public.t_as(%L, %L)', :'admin_id', format('select public.reject_referral(%s, ''other'')::text', public.t_ref_of(:'dina'))),
                    'Already rejected', 'cannot reject twice');

\echo '=== 8. Payment exactly once through pay_referral'
select public.t_as(:'admin_id', format('select public.pay_referral(%s)::text', public.t_ref_of(:'ben')));
select public.t_ok((select status = 'paid' and reviewed_by = :'admin_id' from public.referrals where referred_id = :'ben'), 'paid; paying admin recorded as reviewer');
select public.t_ok((select balance_usd from public.wallets where user_id = :'rita') = 30 and (select balance_usd from public.wallets where user_id = :'ben') = 12.50,
                   'wallets credited with the referral amounts');
select public.t_ok((select string_agg(event_type || '=' || (payload ->> 'amount_usd'), ',' order by event_type) from public.notification_deliveries
                    where referral_id = public.t_ref_of(:'ben') and event_type like 'referral_paid%') = 'referral_paid_referred=12.50,referral_paid_referrer=30',
                   'payment notices carry the amounts actually paid');
select public.t_err(format('select public.t_as(%L, %L)', :'admin_id', format('select public.pay_referral(%s)::text', public.t_ref_of(:'ben'))),
                    'Already paid', 'duplicate payout refused');
select public.t_err(format('select public.t_as(%L, %L)', :'admin_id', format('select public.reject_referral(%s, ''other'')::text', public.t_ref_of(:'ben'))),
                    'Already paid', 'a paid referral cannot be rejected');
select public.t_ok((select count(*) from public.notification_deliveries where referral_id = public.t_ref_of(:'ben') and event_type like 'referral_paid%') = 2,
                   'still exactly two payment notices');
select public.t_ok(public.t_as(:'ben', 'select my_role || ''/'' || status || ''/'' || my_bonus_usd from public.get_my_referral_history()') = 'referred/paid/12.50'
                   and public.t_as(:'rita', format('select count(*)::text from public.get_my_referral_history() where status = ''paid'' and my_bonus_usd = 30')) = '1',
                   'both dashboards show the referral and their own reward');

\echo '=== 9. Delivery ledger: claim, complete, failures, retries'
select id as d1 from public.notification_deliveries where delivery_key = 'referral:' || public.t_ref_of(:'ben') || ':registered:referrer' \gset
select gen_random_uuid() as a1 \gset
select public.t_ok(public.t_service(format('select count(*)::text from public.claim_notification_delivery(%L, %L)', :'d1', :'a1')) = '1', 'service role claims a pending delivery');
select public.t_ok(public.t_service(format('select count(*)::text from public.claim_notification_delivery(%L, gen_random_uuid())', :'d1')) = '0', 'a second claim gets nothing (no double send)');
select public.t_ok(public.t_service(format('select public.complete_notification_delivery(%L, gen_random_uuid(), 1, ''sent'')::text', :'d1')) = 'false', 'completion with a stale attempt id is ignored');
select public.t_ok(public.t_service(format('select public.complete_notification_delivery(%L, %L, 1, ''sent'', ''msg_1'')::text', :'d1', :'a1')) = 'true',
                   'completion of the current attempt accepted');
select public.t_ok((select status = 'sent' and provider_message_id = 'msg_1' from public.notification_deliveries where id = :'d1'), 'marked sent');
select id as d2 from public.notification_deliveries where delivery_key = 'referral:' || public.t_ref_of(:'ben') || ':paid:referred' \gset
select gen_random_uuid() as a2 \gset
select public.t_service(format('select count(*)::text from public.claim_notification_delivery(%L, %L)', :'d2', :'a2'));
select public.t_service(format('select public.complete_notification_delivery(%L, %L, 1, ''failed'', null, ''provider_500'')::text', :'d2', :'a2'));
select public.t_ok((select status from public.referrals where referred_id = :'ben') = 'paid'
                   and (select balance_usd from public.wallets where user_id = :'ben') = 12.50, 'email delivery failure leaves the payment untouched');
select public.t_err(format('select public.t_service(%L)', format('select public.retry_notification_delivery(%L, '''', ''x'')::text', :'d2')), 'operator', 'retry needs an operator and a note');
select public.t_ok(public.t_service(format('select public.retry_notification_delivery(%L, ''ops@vestora'', ''provider outage resolved'')::text', :'d2')) = 'true',
                   'approved retry accepted');
select public.t_ok((select status = 'pending' and recovery_note like 'ops@vestora:%' from public.notification_deliveries where id = :'d2'), 'approved retry re-queues it');
select gen_random_uuid() as a3 \gset
select public.t_ok(public.t_service(format('select attempt_count::text from public.claim_notification_delivery(%L, %L)', :'d2', :'a3')) = '2', 'retry is attempt 2');
select public.t_service(format('select public.complete_notification_delivery(%L, %L, 2, ''uncertain'', null, ''timeout'')::text', :'d2', :'a3'));
select public.t_err(format('select public.t_service(%L)', format('select public.retry_notification_delivery(%L, ''ops'', ''again'')::text', :'d2')),
                    'provider evidence', 'uncertain delivery cannot be retried without provider evidence');
update public.profiles set email_notifications = false where id = :'cara';
select id as d3 from public.notification_deliveries where delivery_key = 'referral:' || public.t_ref_of(:'cara') || ':registered:referred' \gset
select public.t_ok(public.t_service(format('select count(*)::text from public.claim_notification_delivery(%L, gen_random_uuid())', :'d3')) = '0',
                   'customer with notifications off: nothing handed to the sender');
select public.t_ok((select status = 'skipped' and skip_reason = 'notifications_disabled' from public.notification_deliveries where id = :'d3'),
                   'customer with notifications off: skipped, not sent');
select public.t_err(format('select public.t_as(%L, %L)', :'rita', format('select count(*)::text from public.claim_notification_delivery(%L, gen_random_uuid())', :'d1')),
                    'permission denied', 'customers cannot use the ledger functions');
select public.t_ok(public.t_as(:'rita', 'select count(*)::text from public.notification_deliveries') = '0', 'customers cannot read the ledger');
select public.t_ok(public.t_as(:'admin_id', 'select (count(*) > 0)::text from public.notification_deliveries') = 'true', 'admins can read the ledger');

\echo '=== 10. Marketing consent'
select public.t_ok((select bool_and(not marketing_consent) from public.profiles), 'nobody has marketing consent by default');
select public.t_err(format('select public.t_as(%L, %L)', :'rita', format('update public.profiles set marketing_consent = true where id = %L returning id::text', :'rita')),
                    'controlled functions', 'customer cannot grant consent by editing the profile');
select public.t_err(format('select public.t_as(%L, %L)', :'rita', format('update public.profiles set referral_code = ''VESTORA1'' where id = %L returning id::text', :'rita')),
                    'controlled functions', 'customer cannot change their referral code');
select public.t_err(format('select public.t_as(%L, %L)', :'jon', format('update public.profiles set referred_by = %L where id = %L returning id::text', :'rita', :'jon')),
                    'controlled functions', 'customer cannot set referred_by');
select public.t_ok(public.t_as(:'rita', format('update public.profiles set email_notifications = false where id = %L returning email_notifications::text', :'rita')) = 'false',
                   'unrelated profile fields still editable (account notifications)');
select public.t_as(:'rita', 'select public.set_my_marketing_consent(true, ''settings'')::text');
select public.t_as(:'rita', 'select public.set_my_marketing_consent(true, ''settings'')::text');
select public.t_ok((select marketing_consent from public.profiles where id = :'rita')
                   and (select count(*) from public.marketing_consent_events where user_id = :'rita') = 1, 'consent granted once, one audit record (no-op repeat not logged)');
select public.t_as(:'rita', 'select public.set_my_marketing_consent(false, ''announcement_prompt'')::text');
select public.t_ok(not (select marketing_consent from public.profiles where id = :'rita')
                   and (select string_agg(granted::text || '/' || source, ',' order by id) from public.marketing_consent_events where user_id = :'rita')
                       = 'true/settings,false/announcement_prompt', 'withdrawal recorded');
select public.t_err(format('select public.t_as(%L, %L)', :'rita', 'select public.set_my_marketing_consent(true, ''unsubscribe_link'')::text'),
                    'Invalid consent request', 'customers cannot use internal consent sources');
select public.t_err(format('select public.t_as(%L, %L)', :'rita', format('insert into public.marketing_consent_events (user_id, granted, source) values (%L, true, ''settings'') returning id::text', :'rita')),
                    'permission denied', 'customers cannot write consent records');
select public.t_ok(public.t_as(:'ben', 'select count(*)::text from public.marketing_consent_events') = '0', 'customers see only their own consent history');
select public.t_err(format('select public.t_service(%L)', format('update public.profiles set marketing_consent = true where id = %L returning id::text', :'ben')),
                    'controlled functions', 'service role cannot set consent directly either');
select public.t_as(:'ben', 'select public.set_my_marketing_consent(true, ''announcement_prompt'')::text');
select public.t_err(format('select public.t_as(%L, %L)', :'ben', format('select public.record_marketing_unsubscribe(%L)::text', :'ben')), 'permission denied', 'unsubscribe function is server-only');
select public.t_ok(public.t_service(format('select public.record_marketing_unsubscribe(%L)::text', :'ben')) = 'true', 'unsubscribe accepted');
select public.t_ok(not (select marketing_consent from public.profiles where id = :'ben')
                   and (select source from public.marketing_consent_events where user_id = :'ben' order by id desc limit 1) = 'unsubscribe_link',
                   'unsubscribe link withdraws consent and is recorded');

\echo '=== 11. Promotional campaign: consenting, verified, active customers only'
select public.t_as(:'cara', 'select public.set_my_marketing_consent(true, ''settings'')::text');                         -- eligible
select public.t_as(:'kim', 'select public.set_my_marketing_consent(true, ''settings'')::text');                          -- consent but email unverified
select public.t_as(:'eve', 'select public.set_my_marketing_consent(true, ''settings'')::text');                          -- consent but suspended (below)
select public.t_as(:'admin_id', 'select public.set_my_marketing_consent(true, ''settings'')::text');                     -- admin, not a customer
set session_replication_role = replica;
update public.profiles set status = 'suspended' where id = :'eve';
set session_replication_role = origin;
-- 20261126000000: the service role queues with the admin recorded (two-argument form).
select public.t_err(format('select public.t_as(%L, %L)', :'rita', format('select public.enqueue_marketing_campaign(''referral-launch'', %L)::text', :'rita')), 'permission denied', 'customers cannot enqueue campaigns');
select public.t_err(format('select public.t_service(%L)', format('select public.enqueue_marketing_campaign(''Bad Key!'', %L)::text', :'admin_id')), 'Invalid campaign key', 'campaign key validated');
select public.t_err(format('select public.t_as(%L, %L)', :'admin_id', 'select count(*)::text from public.preview_marketing_campaign_recipients()'),
                    'permission denied', 'recipient preview is server-only');
select public.t_ok(public.t_service('select string_agg(recipient_user_id::text, '','') from public.preview_marketing_campaign_recipients()') = :'cara',
                   'dry-run preview: exactly the one eligible customer, nothing written');
select public.t_ok((select count(*) from public.notification_deliveries where category = 'marketing') = 0
                   and to_regclass('public.marketing_campaign_controls') is not null
                   and (select count(*) from public.marketing_campaign_controls) = 0, 'preview wrote nothing');
select public.t_ok(public.t_service(format('select public.enqueue_marketing_campaign(''referral-launch'', %L)::text', :'admin_id')) = '1', 'campaign queued exactly one email');
select public.t_ok((select recipient_user_id from public.notification_deliveries where campaign_key = 'referral-launch') = :'cara',
                   'only the one consenting, verified, active customer is queued');
select public.t_ok(public.t_service(format('select public.enqueue_marketing_campaign(''referral-launch'', %L)::text', :'admin_id')) = '0', 're-running the campaign queues nobody twice');
select public.t_ok((select paused from public.marketing_campaign_controls where campaign_key = 'referral-launch'), 'a new campaign starts PAUSED');
select id as d4 from public.notification_deliveries where campaign_key = 'referral-launch' \gset
select public.t_ok(public.t_service(format('select count(*)::text from public.claim_notification_delivery(%L, gen_random_uuid())', :'d4')) = '0',
                   'paused campaign: nothing handed to the sender');
select public.t_ok((select status from public.notification_deliveries where id = :'d4') = 'pending', 'paused campaign: the email stays pending (not lost)');
select public.t_ok(public.t_service('select count(*)::text from public.list_notification_deliveries(''pending'', ''transactional'', 500)')::int > 0
                   and public.t_service('select string_agg(delivery_id::text, '','') from public.list_notification_deliveries(''pending'', ''marketing'', 500)') = :'d4',
                   'listing separates marketing from transactional emails');
select public.t_err(format('select public.t_service(%L)', format('select public.set_marketing_campaign_paused(''referral-launch'', false, %L)::text', :'rita')),
                    'Only admins', 'only an admin actor can resume a campaign');
select public.t_err(format('select public.t_as(%L, %L)', :'admin_id', format('select public.set_marketing_campaign_paused(''referral-launch'', false, %L)::text', :'admin_id')),
                    'permission denied', 'campaign switch is server-only (admin route verifies the admin)');
select public.t_service(format('select public.set_marketing_campaign_paused(''referral-launch'', false, %L)::text', :'admin_id'));
select public.t_ok((select not paused and updated_by = :'admin_id' from public.marketing_campaign_controls where campaign_key = 'referral-launch'),
                   'admin resumed the campaign (recorded)');
select public.t_as(:'cara', 'select public.set_my_marketing_consent(false, ''settings'')::text');
select public.t_ok(public.t_service(format('select count(*)::text from public.claim_notification_delivery(%L, gen_random_uuid())', :'d4')) = '0',
                   'consent withdrawn after queueing: nothing handed to the sender');
select public.t_ok((select status = 'skipped' and skip_reason = 'no_marketing_consent' from public.notification_deliveries where id = :'d4'),
                   'consent withdrawn after queueing: the email is skipped');

\echo '=== 12. Permissions on every new function'
select public.t_ok(not exists (
  select 1 from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.proname in ('_enqueue_notification', '_referral_review_fields', '_referral_notifications', '_referral_process_intent',
                      '_referral_capture_signup_intent', '_referral_on_email_confirmed', '_referral_on_profile_created',
                      '_guard_profile_referral_and_consent', 'reject_referral', 'get_my_referral_history',
                      'list_notification_deliveries', 'set_marketing_campaign_paused', 'preview_marketing_campaign_recipients', 'claim_notification_delivery', 'complete_notification_delivery',
                      'recover_stale_notification_delivery', 'retry_notification_delivery', 'set_my_marketing_consent',
                      'record_marketing_unsubscribe', 'enqueue_marketing_campaign')
    and has_function_privilege('anon', p.oid, 'EXECUTE')), 'anon can execute none of the new functions');
select public.t_ok((select array_agg(proname::text order by proname) from pg_proc
                    where pronamespace = 'public'::regnamespace and has_function_privilege('authenticated', oid, 'EXECUTE')
                      and proname in ('_enqueue_notification', '_referral_process_intent', 'reject_referral', 'get_my_referral_history',
                                      'claim_notification_delivery', 'set_my_marketing_consent', 'record_marketing_unsubscribe', 'enqueue_marketing_campaign'))
                   = array['get_my_referral_history', 'reject_referral', 'set_my_marketing_consent'],
                   'authenticated: only history, reject (admin-checked) and own consent');
select public.t_ok((select bool_and(pg_get_userbyid(proowner) = 'postgres' and exists (select 1 from unnest(proconfig) c where c like 'search_path=%'))
                    from pg_proc where pronamespace = 'public'::regnamespace and proname in (
                      '_enqueue_notification', '_referral_review_fields', '_referral_notifications', '_referral_process_intent',
                      '_referral_capture_signup_intent', '_referral_on_email_confirmed', '_referral_on_profile_created',
                      '_guard_profile_referral_and_consent', 'reject_referral', 'get_my_referral_history',
                      'list_notification_deliveries', 'set_marketing_campaign_paused', 'preview_marketing_campaign_recipients', 'claim_notification_delivery', 'complete_notification_delivery',
                      'recover_stale_notification_delivery', 'retry_notification_delivery', 'set_my_marketing_consent',
                      'record_marketing_unsubscribe', 'enqueue_marketing_campaign')), 'every new function owned by postgres with a fixed search_path');
select public.t_ok(not has_table_privilege('anon', 'public.notification_deliveries', 'SELECT')
                   and not has_table_privilege('authenticated', 'public.referral_signup_intents', 'INSERT, UPDATE, DELETE')
                   and not has_table_privilege('authenticated', 'public.marketing_consent_events', 'INSERT, UPDATE, DELETE')
                   and not has_table_privilege('authenticated', 'public.marketing_campaign_controls', 'INSERT, UPDATE, DELETE')
                   and not has_table_privilege('service_role', 'public.marketing_campaign_controls', 'INSERT, UPDATE, DELETE')
                   and not has_table_privilege('service_role', 'public.notification_deliveries', 'INSERT, UPDATE, DELETE'),
                   'no direct writes to the new tables by client roles');
