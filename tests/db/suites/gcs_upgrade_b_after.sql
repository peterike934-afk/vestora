-- Guest chat security upgrade, phase B: right after 20261128000000 on the
-- phase-A state. No existing record changed; old threads have no secret
-- yet (they can be claimed once); the old long message is kept (the new
-- length limit applies to new rows only); every financial switch is still off.
set client_min_messages = notice;

do $$
declare r record;
begin
  for r in select * from snap.rows loop
    if snap.table_md5(to_regclass('public.' || r.name),
                      case when r.name = 'guest_threads' then array['guest_token_hash', 'token_issued_at'] else '{}'::text[] end) = r.md5 then
      raise notice 'PASS  % unchanged by the migration (% rows)', r.name, r.n;
    else
      raise notice 'FAIL  % changed by the migration', r.name;
    end if;
  end loop;
end $$;

do $$ begin
  if (select count(*) = 2 and bool_and(guest_token_hash is null and token_issued_at is null) from public.guest_threads)
  then raise notice 'PASS  existing visitor threads have no ownership secret until their visitor claims them';
  else raise notice 'FAIL  existing visitor threads were given a secret'; end if;
  if (select count(*) = 1 from public.guest_messages where char_length(body) > 4000)
  then raise notice 'PASS  an existing message longer than the new limit is kept';
  else raise notice 'FAIL  existing long message missing'; end if;
  if (select count(*) = 1 from pg_constraint where conname = 'guest_messages_body_length' and not convalidated)
  then raise notice 'PASS  length limits apply to new rows only (NOT VALID)';
  else raise notice 'FAIL  length limit validated existing rows'; end if;
  if (select bool_and(not enabled) from public.financial_operation_controls)
     and (select count(*) = 2 from public.financial_operation_controls)
  then raise notice 'PASS  withdrawal payouts and Bank Pull switches still OFF';
  else raise notice 'FAIL  a financial operation switch is on'; end if;
  if (select bool_and(not payouts_enabled) from public.referral_payout_controls)
  then raise notice 'PASS  referral payouts still OFF';
  else raise notice 'FAIL  referral payouts switch is on'; end if;
end $$;

-- The old threads keep working for the admin.
do $$
declare n int;
begin
  perform set_config('request.jwt.claim.sub', '9a000000-0000-0000-0000-000000000001', true);
  set local role authenticated;
  select count(*) into n from public.guest_messages where thread_id = '9e000000-0000-4000-8000-000000000001';
  if n = 3 then raise notice 'PASS  admin still reads the full history of an existing visitor thread';
  else raise notice 'FAIL  admin sees % messages in the old thread', n; end if;
  select count(*) into n from public.messages;
  if n = 2 then raise notice 'PASS  admin still reads existing customer messages';
  else raise notice 'FAIL  admin sees % customer messages', n; end if;
end $$;
do $$
declare n int;
begin
  perform set_config('request.jwt.claim.sub', '9c000000-0000-0000-0000-000000000002', true);
  set local role authenticated;
  select count(*) into n from public.messages;
  if n = 2 then raise notice 'PASS  the customer still reads their existing conversation';
  else raise notice 'FAIL  customer sees % messages', n; end if;
end $$;
