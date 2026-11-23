-- Production fidelity for the support chats (from the Production schema-only
-- dump of 2026-11-23, backup-before-27 run 20261123-165558Z): the exact
-- definitions of guest_threads, guest_messages, messages and the
-- message_threads view, with their constraints, index, RLS policies and
-- table grants. Test-only; loaded by tests/db/run.mjs and the integration
-- tests after production_auth_profiles.sql. Never run against Production.

CREATE TABLE public.guest_threads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_message text,
    last_sender text,
    last_created_at timestamp with time zone DEFAULT now() NOT NULL,
    unread_count integer DEFAULT 0 NOT NULL,
    guest_unread_count integer DEFAULT 0 NOT NULL,
    locale text DEFAULT 'en'::text,
    CONSTRAINT guest_threads_last_sender_check CHECK ((last_sender = ANY (ARRAY['guest'::text, 'admin'::text])))
);
ALTER TABLE ONLY public.guest_threads ADD CONSTRAINT guest_threads_pkey PRIMARY KEY (id);

CREATE TABLE public.guest_messages (
    id bigint NOT NULL,
    thread_id uuid NOT NULL,
    sender text NOT NULL,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    translated_body text,
    translated_locale text,
    CONSTRAINT guest_messages_sender_check CHECK ((sender = ANY (ARRAY['guest'::text, 'admin'::text])))
);
ALTER TABLE public.guest_messages ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.guest_messages_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
ALTER TABLE ONLY public.guest_messages ADD CONSTRAINT guest_messages_pkey PRIMARY KEY (id);
CREATE INDEX guest_messages_thread_id_created_at_idx ON public.guest_messages USING btree (thread_id, created_at);
ALTER TABLE ONLY public.guest_messages
    ADD CONSTRAINT guest_messages_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES public.guest_threads(id) ON DELETE CASCADE;

CREATE TABLE public.messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    sender text NOT NULL,
    body text NOT NULL,
    read boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    translated_body text,
    translated_locale text,
    CONSTRAINT messages_sender_check CHECK ((sender = ANY (ARRAY['user'::text, 'admin'::text])))
);
ALTER TABLE ONLY public.messages ADD CONSTRAINT messages_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

CREATE VIEW public.message_threads WITH (security_invoker='true') AS
 SELECT id AS user_id,
    full_name,
    email,
    ( SELECT m2.body
           FROM public.messages m2
          WHERE (m2.user_id = p.id)
          ORDER BY m2.created_at DESC
         LIMIT 1) AS last_message,
    ( SELECT m2.sender
           FROM public.messages m2
          WHERE (m2.user_id = p.id)
          ORDER BY m2.created_at DESC
         LIMIT 1) AS last_sender,
    ( SELECT m2.created_at
           FROM public.messages m2
          WHERE (m2.user_id = p.id)
          ORDER BY m2.created_at DESC
         LIMIT 1) AS last_created_at,
    ( SELECT count(*) AS count
           FROM public.messages m2
          WHERE ((m2.user_id = p.id) AND (m2.sender = 'user'::text) AND (m2.read = false))) AS unread_count
   FROM public.profiles p
  WHERE (EXISTS ( SELECT 1
           FROM public.messages m3
          WHERE (m3.user_id = p.id)))
  ORDER BY ( SELECT m2.created_at
           FROM public.messages m2
          WHERE (m2.user_id = p.id)
          ORDER BY m2.created_at DESC
         LIMIT 1) DESC;

CREATE POLICY "Admins can send messages as admin" ON public.messages FOR INSERT WITH CHECK ((public.is_admin() AND (sender = 'admin'::text)));
CREATE POLICY "Admins can update messages" ON public.messages FOR UPDATE USING (public.is_admin());
CREATE POLICY "Users can mark admin replies in their thread as read" ON public.messages FOR UPDATE USING (((auth.uid() = user_id) AND (sender = 'admin'::text))) WITH CHECK (((auth.uid() = user_id) AND (sender = 'admin'::text)));
CREATE POLICY "Users can send their own messages" ON public.messages FOR INSERT WITH CHECK (((auth.uid() = user_id) AND (sender = 'user'::text)));
CREATE POLICY "Users can view their own messages" ON public.messages FOR SELECT USING (((auth.uid() = user_id) OR public.is_admin()));
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

ALTER TABLE public.guest_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guest_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE public.guest_messages TO anon;
GRANT ALL ON TABLE public.guest_messages TO authenticated;
GRANT ALL ON TABLE public.guest_messages TO service_role;
GRANT ALL ON SEQUENCE public.guest_messages_id_seq TO anon;
GRANT ALL ON SEQUENCE public.guest_messages_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.guest_messages_id_seq TO service_role;
GRANT ALL ON TABLE public.guest_threads TO anon;
GRANT ALL ON TABLE public.guest_threads TO authenticated;
GRANT ALL ON TABLE public.guest_threads TO service_role;
GRANT ALL ON TABLE public.messages TO anon;
GRANT ALL ON TABLE public.messages TO authenticated;
GRANT ALL ON TABLE public.messages TO service_role;
GRANT ALL ON TABLE public.message_threads TO anon;
GRANT ALL ON TABLE public.message_threads TO authenticated;
GRANT ALL ON TABLE public.message_threads TO service_role;
-- profiles must be readable by the policies above (as in Production).
GRANT SELECT ON TABLE public.profiles TO anon, authenticated, service_role;
