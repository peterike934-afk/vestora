-- Permissions, phase B: 20261122000000, 20261123000000 and 20261124000000
-- applied on top of the phase A snapshot. Every change must be one of the
-- intended grants below; nothing existing may widen or narrow.
set client_min_messages = notice;
create or replace function public.t_ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if coalesce(cond, false) then raise notice 'PASS  %', label; else raise notice 'FAIL  %', label; end if;
end $$;

create table public.t_perm_expected (kind text, name text, role text, priv text);
insert into public.t_perm_expected values
  ('function', 'public.request_withdrawal(uuid, numeric, text, text, numeric, text, text)'::regprocedure::text, 'authenticated', 'EXECUTE'),
  ('function', 'public.investment_accrued_interest(numeric, numeric, numeric, timestamptz, timestamptz)'::regprocedure::text, 'authenticated', 'EXECUTE'),
  ('function', 'public.investment_accrued_interest(numeric, numeric, numeric, timestamptz, timestamptz)'::regprocedure::text, 'service_role', 'EXECUTE'),
  ('function', 'public.investment_claimable_gains(uuid, uuid)'::regprocedure::text, 'authenticated', 'EXECUTE'),
  ('function', 'public.investment_claimable_gains(uuid, uuid)'::regprocedure::text, 'service_role', 'EXECUTE'),
  ('function', 'public.pay_referral(bigint)'::regprocedure::text, 'authenticated', 'EXECUTE'),
  ('table', 'public.withdrawal_reservations'::regclass::text, 'authenticated', 'SELECT');

do $$
declare r record; v_bad int := 0;
begin
  -- Existing objects: any change at all.
  for r in
    select b.kind, b.name, b.role, b.priv, b.allowed as before, a.allowed as after
    from public.t_perm_before b left join public.t_perms() a using (kind, name, role, priv)
    where a.allowed is distinct from b.allowed
  loop
    v_bad := v_bad + 1;
    raise notice 'DIAG  existing % % %/% changed: % -> %', r.kind, r.name, r.role, r.priv, r.before, coalesce(r.after::text, 'object dropped');
  end loop;
  perform public.t_ok(v_bad = 0, 'no existing function or table gains or loses any permission');

  -- New objects: granted exactly the intended set, nothing else.
  v_bad := 0;
  for r in
    select a.kind, a.name, a.role, a.priv from public.t_perms() a
    where a.allowed and not exists (select 1 from public.t_perm_before b where (b.kind, b.name, b.role, b.priv) = (a.kind, a.name, a.role, a.priv))
    except select * from public.t_perm_expected
  loop
    v_bad := v_bad + 1;
    raise notice 'DIAG  unintended grant: % % to % (%)', r.kind, r.name, r.role, r.priv;
  end loop;
  perform public.t_ok(v_bad = 0, 'new functions and tables: no unintended grant (Supabase defaults revoked)');

  select count(*) into v_bad from public.t_perm_expected e
  where not exists (select 1 from public.t_perms() a where a.allowed and (a.kind, a.name, a.role, a.priv) = (e.kind, e.name, e.role, e.priv));
  perform public.t_ok(v_bad = 0, 'new functions and tables: every intended grant present');
end $$;

select public.t_ok(not has_function_privilege('anon', p.oid, 'EXECUTE') and not has_function_privilege('service_role', p.oid, 'EXECUTE'),
                   'pay_referral: anon and service_role cannot execute (no service-role payout path)')
from pg_proc p where p.oid = 'public.pay_referral(bigint)'::regprocedure;
select public.t_ok((select bool_and(p.prosecdef = false or exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'))
                    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname not like 't\_%'),
                   'every SECURITY DEFINER function in public has a fixed search_path');
select public.t_ok((select bool_and(pg_get_userbyid(p.proowner) = 'postgres')
                    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.proname not like 't\_%'),
                   'every SECURITY DEFINER function in public is owned by postgres');
