-- Guest chat security upgrade, phase A: the state after 20261127000000 with
-- existing chat history (visitor threads with no ownership secret, a very
-- long old message, customer and admin messages) and financial records.
-- Reproduces the customer-chat weakness on the PREVIOUS permissions, then
-- snapshots every record table, the chat grants and the chat policies.
set client_min_messages = notice;

insert into public.profiles (id, role, full_name, email) values
  ('9a000000-0000-0000-0000-000000000001', 'admin', 'Admin', 'admin@example.test'),
  ('9c000000-0000-0000-0000-000000000002', 'user', 'Cara', 'cara@example.test');
insert into public.wallets (user_id, balance_usd) values
  ('9a000000-0000-0000-0000-000000000001', 0),
  ('9c000000-0000-0000-0000-000000000002', 321.45);
insert into public.transactions (user_id, type, amount_usd, status, payment_method) values
  ('9c000000-0000-0000-0000-000000000002', 'deposit', 75, 'pending', 'wire');
insert into public.guest_threads (id, name, email, last_message, last_sender, unread_count, guest_unread_count, locale) values
  ('9e000000-0000-4000-8000-000000000001', 'Old Visitor', 'old@example.test', 'Thanks!', 'admin', 2, 1, 'de'),
  ('9e000000-0000-4000-8000-000000000002', 'Another', 'another@example.test', 'Started a conversation', 'guest', 0, 0, 'en');
insert into public.guest_messages (thread_id, sender, body, translated_body, translated_locale) values
  ('9e000000-0000-4000-8000-000000000001', 'guest', 'Hello, how do I register?', null, null),
  ('9e000000-0000-4000-8000-000000000001', 'admin', 'Use the sign-up page.', 'Nutzen Sie die Registrierungsseite.', 'de'),
  ('9e000000-0000-4000-8000-000000000001', 'guest', repeat('very long old message ', 250), null, null);
insert into public.messages (user_id, sender, body, read) values
  ('9c000000-0000-0000-0000-000000000002', 'user', 'Where is my deposit?', true),
  ('9c000000-0000-0000-0000-000000000002', 'admin', 'Admin: it is pending review.', false);

-- The weakness this migration closes, reproduced on the previous permissions:
-- a customer could rewrite the text of the admin's reply in their own thread.
do $$
declare n bigint;
begin
  perform set_config('request.jwt.claim.sub', '9c000000-0000-0000-0000-000000000002', true);
  set local role authenticated;
  update public.messages set body = 'Admin: please send me your password' where sender = 'admin';
  get diagnostics n = row_count;
  raise notice '%  before the migration: a customer could rewrite the admin''s reply in their thread (% row) [rolled back]', case when n = 1 then 'PASS' else 'FAIL' end, n;
  raise exception 'undo demonstration';
exception when raise_exception then
  if sqlerrm <> 'undo demonstration' then raise; end if;
end $$;
-- Before the migration, the admin could also write a message as the visitor.
do $$
begin
  perform set_config('request.jwt.claim.sub', '9a000000-0000-0000-0000-000000000001', true);
  set local role authenticated;
  insert into public.guest_messages (thread_id, sender, body) values ('9e000000-0000-4000-8000-000000000002', 'guest', 'written by the admin as the visitor');
  raise notice 'PASS  before the migration: any admin session could insert a message with sender guest [rolled back]';
  raise exception 'undo demonstration';
exception when raise_exception then
  if sqlerrm <> 'undo demonstration' then raise; end if;
end $$;

create schema snap;
create function snap.table_md5(t regclass, drop_cols text[] default '{}') returns text language plpgsql as $$
declare v text;
begin
  execute format('select md5(coalesce(string_agg(x, ''|'' order by x), '''')) from (select (to_jsonb(r) - %L::text[])::text as x from %s r) s', drop_cols, t) into v;
  return v;
end $$;
create table snap.rows as
  select t.name, snap.table_md5(to_regclass('public.' || t.name)) as md5,
         (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', t.name), false, true, '')))[1]::text::bigint as n
  from unnest(array['profiles', 'wallets', 'transactions', 'withdrawal_reservations', 'investments', 'referrals', 'audit_logs',
                    'settings', 'guest_threads', 'guest_messages', 'messages', 'financial_operation_controls',
                    'financial_operation_control_events', 'referral_payout_controls', 'admin_financial_operation_claims']) t(name)
  where to_regclass('public.' || t.name) is not null;
create table snap.acl as
  select c.relname, coalesce(c.relacl::text, '') as acl,
         coalesce((select string_agg(a.attname || '=' || a.attacl::text, ';' order by a.attname) from pg_attribute a
                   where a.attrelid = c.oid and a.attacl is not null), '') as col_acl
  from pg_class c
  where c.oid in ('public.guest_threads'::regclass, 'public.guest_messages'::regclass, 'public.messages'::regclass,
                  'public.message_threads'::regclass, 'public.guest_messages_id_seq'::regclass);
create table snap.policies as
  select c.relname, pol.polname, pol.polcmd::text, pol.polpermissive,
         array_to_string(array(select rolname from pg_roles where oid = any(pol.polroles) order by 1), ',') as roles,
         coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') as qual,
         coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '') as with_check
  from pg_policy pol join pg_class c on c.oid = pol.polrelid
  where c.relname in ('guest_threads', 'guest_messages', 'messages');
create table snap.cols as
  select table_name::text, string_agg(column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, ''), ', ' order by ordinal_position) as cols
  from information_schema.columns where table_schema = 'public' and table_name in ('guest_threads', 'guest_messages', 'messages')
  group by table_name;
create table snap.constraints as
  select conrelid::regclass::text as tbl, string_agg(conname || ' ' || pg_get_constraintdef(oid), ', ' order by conname) as defs
  from pg_constraint where conrelid in ('public.guest_threads'::regclass, 'public.guest_messages'::regclass, 'public.messages'::regclass)
  group by conrelid;
