-- Production definitions of public.referrals, public.audit_logs and
-- public.log_admin_action, as supplied by the project owner (2026-11-23).
--
-- Tables: structure, nullability, defaults, keys and checks follow the
-- supplied definitions exactly.
--
-- NOT SUPPLIED, so NOT reproduced here (see the gaps listed in the report):
--   * referrals.id has no stated default/identity: tests always pass an id.
--   * ON DELETE / ON UPDATE actions of the foreign keys, constraint names,
--     indexes other than the stated keys, triggers, RLS policies and grants
--     on both tables.
--
-- log_admin_action follows the supplied description (2026-11-23): SECURITY
-- DEFINER, owner postgres, SET search_path TO 'public', v_admin_id from
-- auth.uid(), checks public.is_admin(), admin_name and target_user_name from
-- profiles.full_name, COALESCE(v_admin_name, 'Unknown admin'), inserts into
-- audit_logs, returns the new id. The exact source text was not supplied, so
-- these details are ASSUMED:
--   - a failed is_admin() check raises (message text unknown)
--   - the order of the steps; no COALESCE on target_user_name
-- EXECUTE grants reproduce the supplied production ACL exactly (asserted by
-- tests/db/suites/pay_referral.sql).
--
-- Test-only switch: set test.fail_audit = 'on' to make log_admin_action
-- raise (used to prove audit failures roll the whole payment back).

create table public.referrals (
  id bigint primary key,
  referrer_id uuid not null references public.profiles (id),
  referred_id uuid not null unique references public.profiles (id),
  referrer_bonus_usd numeric not null,
  referred_bonus_usd numeric not null,
  status text not null default 'pending' check (status in ('pending', 'paid')),
  created_at timestamp with time zone not null default now(),
  paid_at timestamp with time zone
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid references public.profiles (id),
  admin_name text not null,
  target_user_id uuid references public.profiles (id),
  target_user_name text,
  action text not null,
  amount_usd numeric,
  reason text,
  ip_address text,
  created_at timestamp with time zone not null default now()
);

create function public.log_admin_action(
  p_action text, p_target_user_id uuid, p_amount_usd numeric, p_reason text, p_ip_address text
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_admin_id uuid;
  v_admin_name text;
  v_target_name text;
  v_id uuid;
begin
  -- Test-only switch (not in production).
  if current_setting('test.fail_audit', true) = 'on' then
    raise exception 'audit_logs insert failed (test switch)';
  end if;

  v_admin_id := auth.uid();
  if not public.is_admin() then
    raise exception 'Only admins can write audit logs';
  end if;

  select full_name into v_admin_name from profiles where id = v_admin_id;
  select full_name into v_target_name from profiles where id = p_target_user_id;

  insert into audit_logs (admin_id, admin_name, target_user_id, target_user_name, action, amount_usd, reason, ip_address)
  values (v_admin_id, coalesce(v_admin_name, 'Unknown admin'), p_target_user_id, v_target_name,
          p_action, p_amount_usd, p_reason, p_ip_address)
  returning id into v_id;
  return v_id;
end;
$$;
alter function public.log_admin_action(text, uuid, numeric, text, text) owner to postgres;
-- Production ACL (supplied 2026-11-23):
--   {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
revoke all on function public.log_admin_action(text, uuid, numeric, text, text) from public;
grant execute on function public.log_admin_action(text, uuid, numeric, text, text) to anon, authenticated, service_role;
