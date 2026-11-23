-- Permissions, phase C: the three rollbacks applied in reverse order
-- (20261124000000, 20261123000000, 20261122000000). Every permission is
-- back to the phase A snapshot and every added function is gone. The
-- withdrawal_reservations table is deliberately kept by its rollback as the
-- record of every hold; it must stay as locked down as before.
select public.t_ok((select count(*) from public.t_perm_before b left join public.t_perms() a using (kind, name, role, priv)
                    where a.allowed is distinct from b.allowed) = 0,
                   'after full rollback: every permission identical to the production snapshot');
select public.t_ok((select count(*) from public.t_perms() a
                    where a.name <> 'withdrawal_reservations'
                      and not exists (select 1 from public.t_perm_before b where (b.kind, b.name) = (a.kind, a.name))) = 0,
                   'after full rollback: no added function remains (only the kept withdrawal_reservations record table)');
select public.t_ok((select array_agg(role || ':' || priv order by role, priv) from public.t_perms()
                    where name = 'withdrawal_reservations' and allowed) = array['authenticated:SELECT'],
                   'kept withdrawal_reservations: authenticated SELECT only (own rows by RLS), no other access');
