-- Support chat security: website-visitor ("guest") chat and registered
-- customer chat.
--
-- Changes no existing row: every guest thread, guest message, customer
-- message, profile and financial record is kept exactly as it is. Adds two
-- nullable columns to guest_threads, one rate-limit table, three functions
-- and one trigger, and replaces the chat table grants and the two guest
-- chat RLS policies.
--
-- 1. VISITOR OWNERSHIP. guest_threads.guest_token_hash holds the SHA-256 of
--    a random secret that only the visitor's browser has (an HttpOnly
--    cookie set by /api/guest-chat/start). The guest API routes serve a
--    thread only to a request that presents that secret; the thread ID
--    alone is no longer enough. Threads created before this migration have
--    no secret yet: guest_chat_claim_legacy_thread lets the original visitor
--    bind one ONCE, by presenting the thread ID their browser stored AND
--    the email address they gave when they started the chat.
-- 2. NO DIRECT ACCESS FOR VISITORS. anon loses every privilege on
--    guest_threads, guest_messages and messages. Visitors reach their own
--    thread only through the server routes.
-- 3. ADMIN ONLY, AND ONLY AS ADMIN. The "admins manage ..." policies
--    (ALL commands) are replaced by: admins may read guest threads and
--    messages, reset the admin unread counter, and insert messages whose
--    sender is 'admin'. Nobody but postgres can update or delete a guest
--    message (no UPDATE/DELETE privilege for anon, authenticated or the
--    service role).
-- 4. CUSTOMER CHAT. "Users can mark admin replies in their thread as read"
--    let a customer rewrite the text of the admin's replies in their own
--    thread (it allowed UPDATE of every column). Customers and the admin
--    may now update only the read flag; nobody can delete messages through
--    the API. The policies themselves are unchanged.
-- 5. CONSISTENT THREAD SUMMARY. A trigger maintains last_message,
--    last_sender, last_created_at and the two unread counters for every
--    new guest message, in the same transaction (it replaces the
--    read-then-write updates in the application, which could lose counts).
-- 6. RATE LIMITS. guest_chat_rate_limits and guest_chat_rate_limit_hit
--    give the server routes shared counters that work across Vercel's
--    serverless instances. Buckets are opaque hashes (no IP address is
--    stored). Only the service role can call it.
-- 7. LENGTH LIMITS for new rows (existing rows are not re-checked):
--    message text 1-4000 characters (not blank), visitor name up to 200,
--    email up to 320.
--
-- Requires 20261127000000_financial_operation_controls.sql. Does not touch
-- any financial table, function or switch. Rollback:
-- supabase/rollback/20261128000000_guest_chat_security_rollback.sql.

do $$
declare
  v_list text;
begin
  if current_user <> 'postgres' then
    raise exception 'Apply this migration as postgres';
  end if;
  if to_regclass('public.financial_operation_controls') is null then
    raise exception 'Apply 20261127000000_financial_operation_controls.sql first';
  end if;
  if to_regclass('public.guest_chat_rate_limits') is not null
     or to_regprocedure('public.guest_chat_rate_limit_hit(text, integer, integer)') is not null
     or exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = 'guest_threads' and column_name = 'guest_token_hash') then
    raise exception 'Guest chat security objects already exist: this migration was applied before';
  end if;

  -- Every table and column used here must exist as in Production.
  select string_agg(w.t || '.' || w.c, ', ') into v_list
  from (values ('guest_threads', 'id'), ('guest_threads', 'name'), ('guest_threads', 'email'),
               ('guest_threads', 'last_message'), ('guest_threads', 'last_sender'), ('guest_threads', 'last_created_at'),
               ('guest_threads', 'unread_count'), ('guest_threads', 'guest_unread_count'), ('guest_threads', 'locale'),
               ('guest_messages', 'id'), ('guest_messages', 'thread_id'), ('guest_messages', 'sender'),
               ('guest_messages', 'body'), ('guest_messages', 'created_at'),
               ('messages', 'id'), ('messages', 'user_id'), ('messages', 'sender'), ('messages', 'body'),
               ('messages', 'read')) w(t, c)
  where not exists (select 1 from information_schema.columns c
                    where c.table_schema = 'public' and c.table_name = w.t and c.column_name = w.c);
  if v_list is not null then
    raise exception 'Chat tables are missing expected columns: %', v_list;
  end if;
  if to_regclass('public.message_threads') is null or to_regclass('public.guest_messages_id_seq') is null then
    raise exception 'public.message_threads or public.guest_messages_id_seq is missing';
  end if;

  -- The RLS policies must be exactly the reviewed Production set: an extra
  -- permissive policy would silently widen access.
  select string_agg(c.relname || ': ' || pol.polname, ' | ' order by c.relname, pol.polname) into v_list
  from pg_catalog.pg_policy pol join pg_catalog.pg_class c on c.oid = pol.polrelid
  where c.oid in ('public.guest_threads'::regclass, 'public.guest_messages'::regclass, 'public.messages'::regclass);
  if v_list is distinct from
     'guest_messages: admins manage guest_messages | guest_threads: admins manage guest_threads'
     || ' | messages: Admins can send messages as admin | messages: Admins can update messages'
     || ' | messages: Users can mark admin replies in their thread as read'
     || ' | messages: Users can send their own messages | messages: Users can view their own messages' then
    raise exception 'Unexpected RLS policies on the chat tables: %', coalesce(v_list, 'none');
  end if;

  -- No unreviewed triggers on the chat tables.
  select string_agg(t.tgrelid::regclass::text || '.' || t.tgname, ', ') into v_list
  from pg_catalog.pg_trigger t
  where not t.tgisinternal
    and t.tgrelid in ('public.guest_threads'::regclass, 'public.guest_messages'::regclass, 'public.messages'::regclass);
  if v_list is not null then
    raise exception 'Unexpected triggers on the chat tables: %', v_list;
  end if;

  select string_agg(c.relname, ', ') into v_list
  from pg_catalog.pg_class c
  where c.oid in ('public.guest_threads'::regclass, 'public.guest_messages'::regclass, 'public.messages'::regclass)
    and (pg_catalog.pg_get_userbyid(c.relowner) <> 'postgres' or not c.relrowsecurity);
  if v_list is not null then
    raise exception 'Chat tables must be owned by postgres with row level security enabled: %', v_list;
  end if;
end;
$$;

-- ===========================================================================
-- 1. Visitor ownership secret (hash only) and length limits for new rows
-- ===========================================================================
alter table public.guest_threads
  add column guest_token_hash text
    constraint guest_threads_token_hash_format check (guest_token_hash ~ '^[0-9a-f]{64}$'),
  add column token_issued_at timestamptz;

comment on column public.guest_threads.guest_token_hash is
  'SHA-256 (hex) of the visitor''s chat secret, held only in their browser as an HttpOnly cookie. NULL for threads started before 20261128000000 until the visitor claims them once.';

alter table public.guest_threads
  add constraint guest_threads_name_length check (pg_catalog.char_length(name) <= 200) not valid,
  add constraint guest_threads_email_length check (pg_catalog.char_length(email) <= 320) not valid;
alter table public.guest_messages
  add constraint guest_messages_body_length
    check (pg_catalog.char_length(pg_catalog.btrim(body)) between 1 and 4000) not valid;
alter table public.messages
  add constraint messages_body_length
    check (pg_catalog.char_length(pg_catalog.btrim(body)) between 1 and 4000) not valid;

-- ===========================================================================
-- 2-3. Guest chat: no visitor access, admin read / reply-as-admin only
-- ===========================================================================
drop policy "admins manage guest_messages" on public.guest_messages;
drop policy "admins manage guest_threads" on public.guest_threads;

create policy "Admins can read guest threads" on public.guest_threads
  for select to authenticated using (public.is_admin());
create policy "Admins can mark guest threads read" on public.guest_threads
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins can read guest messages" on public.guest_messages
  for select to authenticated using (public.is_admin());
create policy "Admins can reply to guests as admin" on public.guest_messages
  for insert to authenticated with check (public.is_admin() and sender = 'admin');

revoke all on table public.guest_threads, public.guest_messages from public, anon, authenticated, service_role;
revoke all on sequence public.guest_messages_id_seq from public, anon, authenticated, service_role;
-- Admin dashboard (RLS above limits these to the admin):
grant select on table public.guest_threads to authenticated;
grant update (unread_count) on table public.guest_threads to authenticated;
grant select on table public.guest_messages to authenticated;
grant insert (thread_id, sender, body) on table public.guest_messages to authenticated;
-- Server routes (service role): create threads, set the ownership secret,
-- reset the visitor's unread counter, add visitor messages. No deletes and
-- no message updates.
grant select, insert, update on table public.guest_threads to service_role;
grant select, insert on table public.guest_messages to service_role;

-- ===========================================================================
-- 4. Customer chat: only the read flag can change; no deletes; no anon
-- ===========================================================================
revoke all on table public.messages from anon;
revoke all on table public.message_threads from anon;
revoke insert, update, delete, truncate, references, trigger on table public.messages from authenticated;
grant insert (user_id, sender, body) on table public.messages to authenticated;
grant update (read) on table public.messages to authenticated;
revoke insert, update, delete, truncate, references, trigger on table public.message_threads from authenticated;

-- ===========================================================================
-- 5. Thread summary maintained by the database
-- ===========================================================================
create function public._guest_message_thread_summary()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.guest_threads
  set last_message = new.body,
      last_sender = new.sender,
      last_created_at = new.created_at,
      unread_count = unread_count + case when new.sender = 'guest' then 1 else 0 end,
      guest_unread_count = guest_unread_count + case when new.sender = 'admin' then 1 else 0 end
  where id = new.thread_id;
  return null;
end;
$$;

create trigger vestora_guest_message_thread_summary
  after insert on public.guest_messages
  for each row execute function public._guest_message_thread_summary();

-- ===========================================================================
-- 1. One-time claim of a thread started before this migration
-- ===========================================================================
create function public.guest_chat_claim_legacy_thread(p_thread_id uuid, p_email text, p_token_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_thread_id is null or p_email is null or pg_catalog.btrim(p_email) = ''
     or p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid guest chat claim';
  end if;

  -- Only a thread that has never had a secret, and only with the exact
  -- email (case and surrounding spaces ignored) the visitor gave.
  update public.guest_threads
  set guest_token_hash = p_token_hash,
      token_issued_at = pg_catalog.now()
  where id = p_thread_id
    and guest_token_hash is null
    and pg_catalog.lower(pg_catalog.btrim(email)) = pg_catalog.lower(pg_catalog.btrim(p_email));

  return found;
end;
$$;

-- ===========================================================================
-- 6. Shared rate-limit counters (fixed windows)
-- ===========================================================================
create table public.guest_chat_rate_limits (
  bucket text not null check (pg_catalog.char_length(bucket) between 1 and 200),
  window_start timestamptz not null,
  hits integer not null default 0 check (hits >= 0),
  primary key (bucket, window_start)
);
alter table public.guest_chat_rate_limits enable row level security;
revoke all on table public.guest_chat_rate_limits from public, anon, authenticated, service_role;

create function public.guest_chat_rate_limit_hit(p_bucket text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window timestamptz;
  v_hits integer;
begin
  if p_bucket is null or pg_catalog.char_length(p_bucket) not between 1 and 200
     or p_limit is null or p_limit < 1
     or p_window_seconds is null or p_window_seconds not between 1 and 86400 then
    raise exception 'Invalid rate limit request';
  end if;

  v_window := pg_catalog.to_timestamp(
    pg_catalog.floor(extract(epoch from pg_catalog.clock_timestamp()) / p_window_seconds) * p_window_seconds);

  insert into public.guest_chat_rate_limits as r (bucket, window_start, hits)
  values (p_bucket, v_window, 1)
  on conflict (bucket, window_start) do update set hits = r.hits + 1
  returning r.hits into v_hits;

  -- Occasional clean-up of finished windows.
  if pg_catalog.random() < 0.01 then
    delete from public.guest_chat_rate_limits
    where window_start < pg_catalog.clock_timestamp() - interval '2 days';
  end if;

  return v_hits <= p_limit;
end;
$$;

revoke all on function public._guest_message_thread_summary() from public, anon, authenticated, service_role;
revoke all on function public.guest_chat_claim_legacy_thread(uuid, text, text) from public, anon, authenticated;
revoke all on function public.guest_chat_rate_limit_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.guest_chat_claim_legacy_thread(uuid, text, text) to service_role;
grant execute on function public.guest_chat_rate_limit_hit(text, integer, integer) to service_role;
