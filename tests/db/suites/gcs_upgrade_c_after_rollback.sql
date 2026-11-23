-- Guest chat security upgrade, phase C: after the rollback script. Grants
-- (table and column), policies, columns and constraints are exactly as
-- before the migration; the new objects are gone; no record changed.
set client_min_messages = notice;

do $$
declare r record;
begin
  for r in select * from snap.rows loop
    if snap.table_md5(to_regclass('public.' || r.name)) = r.md5 then
      raise notice 'PASS  % unchanged after the rollback (% rows)', r.name, r.n;
    else
      raise notice 'FAIL  % changed after the rollback', r.name;
    end if;
  end loop;
end $$;

do $$ begin
  if not exists (
       (select relname, acl, col_acl from snap.acl
        except
        select c.relname, coalesce(c.relacl::text, ''),
               coalesce((select string_agg(a.attname || '=' || a.attacl::text, ';' order by a.attname) from pg_attribute a
                         where a.attrelid = c.oid and a.attacl is not null), '')
        from pg_class c
        where c.oid in ('public.guest_threads'::regclass, 'public.guest_messages'::regclass, 'public.messages'::regclass,
                        'public.message_threads'::regclass, 'public.guest_messages_id_seq'::regclass))
     ) and (select count(*) from snap.acl) = 5
     and not exists (select 1 from pg_attribute a where a.attacl is not null
                     and a.attrelid in ('public.guest_threads'::regclass, 'public.guest_messages'::regclass, 'public.messages'::regclass))
  then raise notice 'PASS  table, sequence and column grants restored exactly';
  else raise notice 'FAIL  grants differ from before the migration'; end if;

  if not exists (
       (select * from snap.policies
        except
        select c.relname, pol.polname, pol.polcmd::text, pol.polpermissive,
               array_to_string(array(select rolname from pg_roles where oid = any(pol.polroles) order by 1), ','),
               coalesce(pg_get_expr(pol.polqual, pol.polrelid), ''), coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '')
        from pg_policy pol join pg_class c on c.oid = pol.polrelid
        where c.relname in ('guest_threads', 'guest_messages', 'messages'))
       union all
       (select c.relname, pol.polname, pol.polcmd::text, pol.polpermissive,
               array_to_string(array(select rolname from pg_roles where oid = any(pol.polroles) order by 1), ','),
               coalesce(pg_get_expr(pol.polqual, pol.polrelid), ''), coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '')
        from pg_policy pol join pg_class c on c.oid = pol.polrelid
        where c.relname in ('guest_threads', 'guest_messages', 'messages')
        except
        select * from snap.policies))
  then raise notice 'PASS  chat RLS policies restored exactly (% policies)', (select count(*) from snap.policies);
  else raise notice 'FAIL  chat policies differ from before the migration'; end if;

  if not exists (
       (select * from snap.cols
        except
        select table_name::text, string_agg(column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, ''), ', ' order by ordinal_position)
        from information_schema.columns where table_schema = 'public' and table_name in ('guest_threads', 'guest_messages', 'messages')
        group by table_name))
     and not exists (
       (select * from snap.constraints
        except
        select conrelid::regclass::text, string_agg(conname || ' ' || pg_get_constraintdef(oid), ', ' order by conname)
        from pg_constraint where conrelid in ('public.guest_threads'::regclass, 'public.guest_messages'::regclass, 'public.messages'::regclass)
        group by conrelid))
  then raise notice 'PASS  chat columns and constraints restored exactly';
  else raise notice 'FAIL  chat columns or constraints differ'; end if;

  if to_regclass('public.guest_chat_rate_limits') is null
     and to_regprocedure('public.guest_chat_rate_limit_hit(text, integer, integer)') is null
     and to_regprocedure('public.guest_chat_claim_legacy_thread(uuid, text, text)') is null
     and to_regprocedure('public._guest_message_thread_summary()') is null
     and not exists (select 1 from pg_trigger where tgrelid = 'public.guest_messages'::regclass and not tgisinternal)
  then raise notice 'PASS  rate-limit table, functions and trigger removed';
  else raise notice 'FAIL  migration objects left behind'; end if;
end $$;
