-- Support chat security (20261128000000_guest_chat_security.sql), all
-- migrations applied. Proves at the database level, for every role the
-- Supabase API exposes (anon, authenticated customer, authenticated admin,
-- service role), that:
--   - visitors (anon) have no direct access to any chat table;
--   - only an admin can read guest chats, and can only write as 'admin';
--   - nobody can modify or delete a guest message, and customers can no
--     longer rewrite the admin's replies in their own thread;
--   - the thread summary/unread counters are kept by the trigger;
--   - legacy threads can be claimed once, with the right email only;
--   - the rate-limit counter works and is callable by the service role only.
set client_min_messages = notice;

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
  perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), true);
  set local role authenticated;
  execute stmt into v;
  return v;
end $$;
create function public.t_service(stmt text) returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claim.sub', '', true);
  set local role service_role;
  execute stmt into v;
  return v;
end $$;
create function public.t_anon(stmt text) returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claim.sub', '', true);
  set local role anon;
  execute stmt into v;
  return v;
end $$;
-- Rows changed by an UPDATE/DELETE run as a role (0 = filtered by RLS).
create function public.t_rows(who text, u uuid, stmt text) returns bigint language plpgsql as $$
declare n bigint;
begin
  perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), true);
  execute format('set local role %I', who);
  execute stmt;
  get diagnostics n = row_count;
  return n;
end $$;

-- ── Fixture (as postgres) ─────────────────────────────────────────────────
-- aa..01 admin, cc..02 customer Cara, dd..03 customer Dan.
insert into public.profiles (id, role, full_name, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'admin', 'Admin', 'admin@example.test'),
  ('cccccccc-0000-0000-0000-000000000002', 'user', 'Cara', 'cara@example.test'),
  ('dddddddd-0000-0000-0000-000000000003', 'user', 'Dan', 'dan@example.test');
-- Two visitors' threads (with ownership hashes) and one legacy thread.
insert into public.guest_threads (id, name, email, last_message, last_sender, guest_token_hash) values
  ('11111111-1111-4111-8111-111111111111', 'Vera Visitor', 'vera@example.test', 'Started a conversation', 'guest', repeat('a', 64)),
  ('22222222-2222-4222-8222-222222222222', 'Walt Visitor', 'walt@example.test', 'Started a conversation', 'guest', repeat('b', 64)),
  ('33333333-3333-4333-8333-333333333333', 'Lena Legacy', '  Lena@Example.TEST ', 'old', 'guest', null);
insert into public.guest_messages (thread_id, sender, body) values
  ('11111111-1111-4111-8111-111111111111', 'guest', 'Vera: how do I verify my email?'),
  ('22222222-2222-4222-8222-222222222222', 'guest', 'Walt: private question');
insert into public.messages (user_id, sender, body) values
  ('cccccccc-0000-0000-0000-000000000002', 'user', 'Cara: deposit question'),
  ('cccccccc-0000-0000-0000-000000000002', 'admin', 'Admin: original reply to Cara'),
  ('dddddddd-0000-0000-0000-000000000003', 'user', 'Dan: private');
update public.guest_threads set unread_count = 0, guest_unread_count = 0;

-- ── 1. Visitors (anon) have no direct database access ─────────────────────
select public.t_err($q$select public.t_anon('select count(*)::text from public.guest_threads')$q$, 'permission denied', 'anon cannot read guest threads');
select public.t_err($q$select public.t_anon('select count(*)::text from public.guest_messages')$q$, 'permission denied', 'anon cannot read guest messages');
select public.t_err($q$select public.t_anon($x$insert into public.guest_messages (thread_id, sender, body) values ('11111111-1111-4111-8111-111111111111', 'admin', 'fake admin') returning id::text$x$)$q$,
  'permission denied', 'anon cannot insert a guest message (as admin)');
select public.t_err($q$select public.t_anon($x$insert into public.guest_threads (name, email) values ('x', 'x@x.test') returning id::text$x$)$q$, 'permission denied', 'anon cannot create a guest thread directly');
select public.t_err($q$select public.t_rows('anon', null, $x$update public.guest_messages set body = 'changed'$x$)$q$, 'permission denied', 'anon cannot modify guest messages');
select public.t_err($q$select public.t_rows('anon', null, $x$delete from public.guest_messages$x$)$q$, 'permission denied', 'anon cannot delete guest messages');
select public.t_err($q$select public.t_rows('anon', null, $x$update public.guest_threads set guest_token_hash = null$x$)$q$, 'permission denied', 'anon cannot change a thread ownership secret');
select public.t_err($q$select public.t_anon('select count(*)::text from public.messages')$q$, 'permission denied', 'anon cannot read customer messages');
select public.t_err($q$select public.t_anon('select count(*)::text from public.message_threads')$q$, 'permission denied', 'anon cannot read the customer thread list');
select public.t_err($q$select public.t_anon($x$select public.guest_chat_rate_limit_hit('x', 1, 60)::text$x$)$q$, 'permission denied', 'anon cannot call the rate-limit counter');
select public.t_err($q$select public.t_anon($x$select public.guest_chat_claim_legacy_thread('33333333-3333-4333-8333-333333333333', 'lena@example.test', repeat('c', 64))::text$x$)$q$,
  'permission denied', 'anon cannot claim a legacy thread directly');
select public.t_err($q$select public.t_anon('truncate public.guest_messages')$q$, 'permission denied', 'anon cannot truncate guest messages');

-- ── 2. A signed-in customer (not admin) ───────────────────────────────────
select public.t_ok(public.t_as('cccccccc-0000-0000-0000-000000000002', 'select count(*)::text from public.guest_threads') = '0', 'customer sees no guest threads (RLS)');
select public.t_ok(public.t_as('cccccccc-0000-0000-0000-000000000002', 'select count(*)::text from public.guest_messages') = '0', 'customer sees no guest messages (RLS)');
select public.t_err($q$select public.t_as('cccccccc-0000-0000-0000-000000000002', $x$insert into public.guest_messages (thread_id, sender, body) values ('11111111-1111-4111-8111-111111111111', 'admin', 'I am the admin') returning id::text$x$)$q$,
  'row-level security', 'customer cannot send a guest message as admin');
select public.t_err($q$select public.t_as('cccccccc-0000-0000-0000-000000000002', $x$insert into public.guest_messages (thread_id, sender, body) values ('11111111-1111-4111-8111-111111111111', 'guest', 'hi') returning id::text$x$)$q$,
  'row-level security', 'customer cannot write into a visitor''s thread');
select public.t_err($q$select public.t_rows('authenticated', 'cccccccc-0000-0000-0000-000000000002', $x$update public.guest_messages set body = 'changed'$x$)$q$, 'permission denied', 'customer cannot modify guest messages');
select public.t_ok(public.t_rows('authenticated', 'cccccccc-0000-0000-0000-000000000002', 'update public.guest_threads set unread_count = 0') = 0, 'customer cannot touch guest threads (RLS: 0 rows)');
select public.t_err($q$select public.t_rows('authenticated', 'cccccccc-0000-0000-0000-000000000002', $x$update public.guest_threads set guest_token_hash = repeat('f', 64)$x$)$q$, 'permission denied', 'customer cannot set a thread ownership secret');

-- ── 3. The admin ──────────────────────────────────────────────────────────
select public.t_ok(public.t_as('aaaaaaaa-0000-0000-0000-000000000001', 'select count(*)::text from public.guest_threads') = '3', 'admin sees every guest thread');
select public.t_ok(public.t_as('aaaaaaaa-0000-0000-0000-000000000001', $x$with m as (insert into public.guest_messages (thread_id, sender, body) values ('11111111-1111-4111-8111-111111111111', 'admin', 'Admin: check your inbox') returning sender) select sender from m$x$) = 'admin',
  'admin can reply to a visitor (sender admin)');
select public.t_ok((select last_sender = 'admin' and last_message = 'Admin: check your inbox' and guest_unread_count = 1 and unread_count = 0
                    from public.guest_threads where id = '11111111-1111-4111-8111-111111111111'), 'trigger: admin reply updates the thread summary and the visitor''s unread badge');
select public.t_err($q$select public.t_as('aaaaaaaa-0000-0000-0000-000000000001', $x$insert into public.guest_messages (thread_id, sender, body) values ('11111111-1111-4111-8111-111111111111', 'guest', 'pretending to be Vera') returning id::text$x$)$q$,
  'row-level security', 'admin cannot write a message as the visitor');
select public.t_err($q$select public.t_as('aaaaaaaa-0000-0000-0000-000000000001', $x$insert into public.guest_messages (thread_id, sender, body, translated_body) values ('11111111-1111-4111-8111-111111111111', 'admin', 'a', 'b') returning id::text$x$)$q$,
  'permission denied', 'admin inserts only thread, sender and text (no other columns)');
select public.t_err($q$select public.t_rows('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001', $x$update public.guest_messages set body = 'rewritten'$x$)$q$, 'permission denied', 'admin cannot rewrite guest messages');
select public.t_err($q$select public.t_rows('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001', $x$delete from public.guest_messages$x$)$q$, 'permission denied', 'admin cannot delete guest messages through the API');
select public.t_ok(public.t_rows('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001', $x$update public.guest_threads set unread_count = 0 where id = '22222222-2222-4222-8222-222222222222'$x$) = 1, 'admin can mark a guest thread read');
select public.t_err($q$select public.t_rows('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001', $x$update public.guest_threads set last_message = 'x'$x$)$q$, 'permission denied', 'admin can change only the unread counter of a thread');
select public.t_err($q$select public.t_rows('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001', $x$delete from public.guest_threads$x$)$q$, 'permission denied', 'admin cannot delete guest threads through the API');

-- ── 4. The service role (used only by the server routes) ──────────────────
select public.t_ok(public.t_service($x$with m as (insert into public.guest_messages (thread_id, sender, body) values ('22222222-2222-4222-8222-222222222222', 'guest', 'Walt: second') returning sender) select sender from m$x$) = 'guest', 'service role can add a visitor message');
select public.t_ok((select last_sender = 'guest' and last_message = 'Walt: second' and unread_count = 1
                    from public.guest_threads where id = '22222222-2222-4222-8222-222222222222'), 'trigger: visitor message updates the summary and the admin unread counter');
select public.t_err($q$select public.t_rows('service_role', null, $x$update public.guest_messages set body = 'changed'$x$)$q$, 'permission denied', 'service role cannot modify guest messages');
select public.t_err($q$select public.t_rows('service_role', null, $x$delete from public.guest_messages$x$)$q$, 'permission denied', 'service role cannot delete guest messages');
select public.t_err($q$select public.t_rows('service_role', null, $x$delete from public.guest_threads$x$)$q$, 'permission denied', 'service role cannot delete guest threads');
select public.t_err($q$select public.t_service('truncate public.guest_messages')$q$, 'permission denied', 'service role cannot truncate guest messages');
select public.t_err($q$select public.t_service('select count(*)::text from public.guest_chat_rate_limits')$q$, 'permission denied', 'rate-limit counters are not readable directly');

-- Rate limit: 3 per window, separate buckets, invalid input refused.
select public.t_ok(public.t_service($x$select string_agg(public.guest_chat_rate_limit_hit('t:bucket1', 3, 3600)::text, ',') from generate_series(1, 5)$x$) = 'true,true,true,false,false',
  'rate limit: the 4th and 5th hits in a window are refused');
select public.t_ok(public.t_service($x$select public.guest_chat_rate_limit_hit('t:bucket2', 3, 3600)::text$x$) = 'true', 'rate limit: another bucket has its own count');
select public.t_err($q$select public.t_service($x$select public.guest_chat_rate_limit_hit('', 3, 60)::text$x$)$q$, 'Invalid rate limit request', 'rate limit: empty bucket refused');
select public.t_err($q$select public.t_service($x$select public.guest_chat_rate_limit_hit('x', 0, 60)::text$x$)$q$, 'Invalid rate limit request', 'rate limit: zero limit refused');
select public.t_err($q$select public.t_service($x$select public.guest_chat_rate_limit_hit('x', 1, 100000)::text$x$)$q$, 'Invalid rate limit request', 'rate limit: window over a day refused');
select public.t_err($q$select public.t_as('aaaaaaaa-0000-0000-0000-000000000001', $x$select public.guest_chat_rate_limit_hit('x', 1000, 60)::text$x$)$q$, 'permission denied', 'rate limit: not callable by signed-in users (even the admin)');

-- ── 5. Legacy threads: claimed once, only with the original email ─────────
select public.t_ok(public.t_service($x$select public.guest_chat_claim_legacy_thread('33333333-3333-4333-8333-333333333333', 'someone@else.test', repeat('c', 64))::text$x$) = 'false', 'legacy claim with a different email is refused');
select public.t_ok(public.t_service($x$select public.guest_chat_claim_legacy_thread('11111111-1111-4111-8111-111111111111', 'vera@example.test', repeat('c', 64))::text$x$) = 'false', 'a thread that already has an owner cannot be claimed (even with its email)');
select public.t_ok((select guest_token_hash = repeat('a', 64) from public.guest_threads where id = '11111111-1111-4111-8111-111111111111'), 'the owned thread keeps its original secret');
select public.t_ok(public.t_service($x$select public.guest_chat_claim_legacy_thread('33333333-3333-4333-8333-333333333333', 'lena@example.test', repeat('d', 64))::text$x$) = 'true', 'legacy claim with the original email (case and spaces ignored) succeeds');
select public.t_ok(public.t_service($x$select public.guest_chat_claim_legacy_thread('33333333-3333-4333-8333-333333333333', 'lena@example.test', repeat('e', 64))::text$x$) = 'false', 'a legacy thread can be claimed only once');
select public.t_ok((select guest_token_hash = repeat('d', 64) and token_issued_at is not null from public.guest_threads where id = '33333333-3333-4333-8333-333333333333'), 'the first claim''s secret is kept');
select public.t_err($q$select public.t_service($x$select public.guest_chat_claim_legacy_thread('33333333-3333-4333-8333-333333333333', 'lena@example.test', 'not-a-hash')::text$x$)$q$, 'Invalid guest chat claim', 'legacy claim with a malformed hash is refused');
select public.t_err($q$update public.guest_threads set guest_token_hash = 'ABC' where id = '22222222-2222-4222-8222-222222222222'$q$, 'guest_threads_token_hash_format', 'ownership secret must be a SHA-256 hex hash');

-- ── 6. Registered-customer chat ───────────────────────────────────────────
select public.t_ok(public.t_as('cccccccc-0000-0000-0000-000000000002', $x$with m as (insert into public.messages (user_id, sender, body) values ('cccccccc-0000-0000-0000-000000000002', 'user', 'Cara: follow-up') returning sender) select sender from m$x$) = 'user',
  'customer can send a message in their own thread');
select public.t_ok(public.t_as('cccccccc-0000-0000-0000-000000000002', $x$select count(*)::text from public.messages$x$) = '3', 'customer reads only their own thread');
select public.t_err($q$select public.t_as('cccccccc-0000-0000-0000-000000000002', $x$insert into public.messages (user_id, sender, body) values ('cccccccc-0000-0000-0000-000000000002', 'admin', 'fake admin') returning id::text$x$)$q$,
  'row-level security', 'customer cannot send a message as admin');
select public.t_err($q$select public.t_as('cccccccc-0000-0000-0000-000000000002', $x$insert into public.messages (user_id, sender, body) values ('dddddddd-0000-0000-0000-000000000003', 'user', 'into Dan''s thread') returning id::text$x$)$q$,
  'row-level security', 'customer cannot write into another customer''s thread');
select public.t_err($q$select public.t_rows('authenticated', 'cccccccc-0000-0000-0000-000000000002', $x$update public.messages set body = 'Admin: send your password to me' where sender = 'admin'$x$)$q$,
  'permission denied', 'customer cannot rewrite the admin''s reply (was possible before)');
select public.t_ok((select body = 'Admin: original reply to Cara' from public.messages where sender = 'admin' and user_id = 'cccccccc-0000-0000-0000-000000000002'), 'the admin''s reply is unchanged');
select public.t_ok(public.t_rows('authenticated', 'cccccccc-0000-0000-0000-000000000002', $x$update public.messages set read = true where sender = 'admin' and read = false$x$) = 1, 'customer can still mark the admin''s reply as read');
select public.t_ok(public.t_rows('authenticated', 'cccccccc-0000-0000-0000-000000000002', $x$update public.messages set read = true where user_id = 'dddddddd-0000-0000-0000-000000000003'$x$) = 0, 'customer cannot touch another customer''s messages');
select public.t_err($q$select public.t_rows('authenticated', 'cccccccc-0000-0000-0000-000000000002', $x$delete from public.messages$x$)$q$, 'permission denied', 'customer cannot delete messages');
select public.t_ok(public.t_as('aaaaaaaa-0000-0000-0000-000000000001', $x$with m as (insert into public.messages (user_id, sender, body) values ('dddddddd-0000-0000-0000-000000000003', 'admin', 'Admin: reply to Dan') returning sender) select sender from m$x$) = 'admin',
  'admin can reply to a customer');
select public.t_ok(public.t_rows('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001', $x$update public.messages set read = true where sender = 'user'$x$) = 3, 'admin can mark customer messages read');
select public.t_err($q$select public.t_rows('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001', $x$update public.messages set body = 'x'$x$)$q$, 'permission denied', 'admin cannot rewrite customer messages');
select public.t_ok(public.t_as('aaaaaaaa-0000-0000-0000-000000000001', $x$select count(*)::text from public.message_threads$x$) = '2', 'admin thread list (message_threads) still works');
select public.t_err($q$select public.t_rows('authenticated', 'cccccccc-0000-0000-0000-000000000002', $x$update public.message_threads set full_name = 'x'$x$)$q$, 'permission denied', 'the thread list view is read-only');

-- ── 7. Message length limits (new rows) ───────────────────────────────────
select public.t_err($q$select public.t_service($x$insert into public.guest_messages (thread_id, sender, body) values ('22222222-2222-4222-8222-222222222222', 'guest', '   ') returning id::text$x$)$q$, 'guest_messages_body_length', 'blank guest message refused by the database');
select public.t_err($q$select public.t_service($x$insert into public.guest_messages (thread_id, sender, body) values ('22222222-2222-4222-8222-222222222222', 'guest', repeat('x', 4001)) returning id::text$x$)$q$, 'guest_messages_body_length', 'guest message over 4000 characters refused by the database');
select public.t_err($q$select public.t_as('cccccccc-0000-0000-0000-000000000002', $x$insert into public.messages (user_id, sender, body) values ('cccccccc-0000-0000-0000-000000000002', 'user', repeat('x', 4001)) returning id::text$x$)$q$, 'messages_body_length', 'customer message over 4000 characters refused by the database');
select public.t_err($q$select public.t_service($x$insert into public.guest_threads (name, email) values (repeat('n', 201), 'a@b.test') returning id::text$x$)$q$, 'guest_threads_name_length', 'visitor name over 200 characters refused by the database');

-- ── 8. Catalog: policies, functions, grants ───────────────────────────────
select public.t_ok((select string_agg(c.relname || ':' || pol.polname || ':' || pol.polcmd::text || ':' || array_to_string(array(select rolname from pg_roles where oid = any(pol.polroles) order by 1), ','), ' | ' order by c.relname, pol.polname)
  from pg_policy pol join pg_class c on c.oid = pol.polrelid where c.relname in ('guest_threads', 'guest_messages'))
  = 'guest_messages:Admins can read guest messages:r:authenticated | guest_messages:Admins can reply to guests as admin:a:authenticated | guest_threads:Admins can mark guest threads read:w:authenticated | guest_threads:Admins can read guest threads:r:authenticated',
  'guest chat policies are exactly: admin read, admin reply as admin, admin mark read');
select public.t_ok((select count(*) = 5 from pg_policy where polrelid = 'public.messages'::regclass), 'customer chat policies unchanged (5)');
select public.t_ok((select bool_and(p.prosecdef and pg_get_userbyid(p.proowner) = 'postgres' and p.proconfig = array['search_path=""'])
  from pg_proc p where p.oid in ('public._guest_message_thread_summary()'::regprocedure, 'public.guest_chat_claim_legacy_thread(uuid, text, text)'::regprocedure,
                                 'public.guest_chat_rate_limit_hit(text, integer, integer)'::regprocedure)), 'new functions: security definer, owner postgres, empty search_path');
select public.t_ok((select string_agg(r.rolname || ':' || has_function_privilege(r.rolname, f.oid, 'execute')::text, ',' order by r.rolname)
  from pg_roles r, (values ('public.guest_chat_rate_limit_hit(text, integer, integer)'::regprocedure), ('public.guest_chat_claim_legacy_thread(uuid, text, text)'::regprocedure)) f(oid)
  where r.rolname in ('anon', 'authenticated', 'service_role')) = 'anon:false,anon:false,authenticated:false,authenticated:false,service_role:true,service_role:true',
  'rate-limit and claim functions: executable by the service role only');
select public.t_ok(not has_function_privilege('authenticated', 'public._guest_message_thread_summary()', 'execute')
  and not has_function_privilege('service_role', 'public._guest_message_thread_summary()', 'execute'), 'trigger function not executable by API roles');
select public.t_ok(not has_table_privilege('anon', 'public.guest_threads', 'select,insert,update,delete,truncate,references,trigger')
  and not has_table_privilege('anon', 'public.guest_messages', 'select,insert,update,delete,truncate,references,trigger')
  and not has_table_privilege('anon', 'public.messages', 'select,insert,update,delete,truncate,references,trigger')
  and not has_sequence_privilege('anon', 'public.guest_messages_id_seq', 'usage,select,update'), 'anon holds no privilege on any chat table or sequence');
