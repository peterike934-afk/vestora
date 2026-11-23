-- Permissions, phase A: snapshot of who may execute every public function
-- and select/insert/update/delete every public table or view, in the
-- production state (before 20261122000000). Supabase default grants are
-- active (tests/db/supabase_default_privileges.sql).
create function public.t_perms()
returns table (kind text, name text, role text, priv text, allowed boolean)
language sql as $$
  select 'function', p.oid::regprocedure::text, r.role, 'EXECUTE', has_function_privilege(r.role, p.oid, 'EXECUTE')
  from pg_proc p cross join (values ('anon'), ('authenticated'), ('service_role')) r(role)
  where p.pronamespace = 'public'::regnamespace and p.proname not like 't\_%'
  union all
  select 'table', c.oid::regclass::text, r.role, pr.priv, has_table_privilege(r.role, c.oid, pr.priv)
  from pg_class c
  cross join (values ('anon'), ('authenticated'), ('service_role')) r(role)
  cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) pr(priv)
  where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v') and c.relname not like 't\_%'
$$;
create table public.t_perm_before as select * from public.t_perms();
-- SECURITY DEFINER functions that already lack a fixed search_path before
-- the migrations (pre-existing Production functions, e.g. handle_new_user).
create table public.t_secdef_unpinned_before as
  select p.oid::regprocedure::text as fn from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.proname not like 't\_%'
    and not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%');
