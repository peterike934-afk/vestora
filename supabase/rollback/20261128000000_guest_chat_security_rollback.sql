-- Rollback of 20261128000000_guest_chat_security.sql. Restores the previous
-- chat grants and the two "admins manage ..." policies exactly as they were
-- in Production, and removes the trigger, functions, rate-limit table,
-- length constraints and ownership columns.
--
-- WARNING: this REOPENS the guest chat weaknesses the migration closed. Roll
-- the application back to the previous version first (the new guest chat
-- routes need the ownership columns and rate-limit function). Every chat
-- thread and message is kept; only the visitors' ownership secrets (hashes)
-- are dropped.

do $$
begin
  if current_user <> 'postgres' then
    raise exception 'Run this rollback as postgres';
  end if;
  if to_regprocedure('public.guest_chat_rate_limit_hit(text, integer, integer)') is null then
    raise exception '20261128000000_guest_chat_security.sql is not applied';
  end if;
end;
$$;

drop trigger vestora_guest_message_thread_summary on public.guest_messages;
drop function public._guest_message_thread_summary();
drop function public.guest_chat_claim_legacy_thread(uuid, text, text);
drop function public.guest_chat_rate_limit_hit(text, integer, integer);
drop table public.guest_chat_rate_limits;

drop policy "Admins can read guest threads" on public.guest_threads;
drop policy "Admins can mark guest threads read" on public.guest_threads;
drop policy "Admins can read guest messages" on public.guest_messages;
drop policy "Admins can reply to guests as admin" on public.guest_messages;

CREATE POLICY "admins manage guest_messages" ON public.guest_messages USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));
CREATE POLICY "admins manage guest_threads" ON public.guest_threads USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));

-- Column-level grants are removed by revoking the table privilege.
revoke all on table public.guest_threads, public.guest_messages, public.messages, public.message_threads
  from anon, authenticated, service_role;
grant all on table public.guest_threads, public.guest_messages, public.messages, public.message_threads
  to anon, authenticated, service_role;
grant all on sequence public.guest_messages_id_seq to anon, authenticated, service_role;

alter table public.messages drop constraint messages_body_length;
alter table public.guest_messages drop constraint guest_messages_body_length;
alter table public.guest_threads
  drop constraint guest_threads_name_length,
  drop constraint guest_threads_email_length,
  drop column token_issued_at,
  drop column guest_token_hash;
