-- Shared helpers for the investment integrity suites (included by the runner).
set client_min_messages = notice;

create function public.t_ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if coalesce(cond, false) then raise notice 'PASS  %', label; else raise notice 'FAIL  %', label; end if;
end $$;
create function public.t_err(stmt text, fragment text, label text) returns void language plpgsql as $$
begin
  execute stmt;
  raise notice 'FAIL  % (no error raised)', label;
exception when others then
  if position(fragment in sqlerrm) > 0 then raise notice 'PASS  %  [%]', label, sqlerrm;
  else raise notice 'FAIL  % (got: %)', label, sqlerrm; end if;
end $$;
create function public.bal(u uuid) returns numeric language sql security definer as $$ select balance_usd from public.wallets where user_id = u $$;
create function public.tx(t uuid) returns public.transactions language sql security definer as $$ select * from public.transactions where id = t $$;
create function public.inv(i uuid) returns public.investments language sql security definer as $$ select * from public.investments where id = i $$;
create function public.fee_of(w uuid) returns uuid language sql security definer as $$
  select id from public.transactions where related_transaction_id = w and type = 'early_withdrawal_fee' $$;
create function public.refunds_of(f uuid) returns bigint language sql security definer as $$
  select count(*) from public.transactions where related_transaction_id = f and type = 'early_withdrawal_fee_refund' $$;
create function public.refund_amount(f uuid) returns numeric language sql security definer as $$
  select sum(amount_usd) from public.transactions where related_transaction_id = f and type = 'early_withdrawal_fee_refund' $$;
grant execute on function public.t_ok(boolean,text), public.t_err(text,text,text), public.bal(uuid), public.tx(uuid),
  public.inv(uuid), public.fee_of(uuid), public.refunds_of(uuid), public.refund_amount(uuid) to authenticated;
create table public.t_ids (k text primary key, v uuid);
grant select, insert on public.t_ids to authenticated;

-- as(user): act as that user; admin(): act as the admin.
create function public.t_user(u uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', u::text, false); end $$;

insert into public.settings (id, min_withdrawal_usd, daily_withdrawal_limit_usd) values (true, null, null);
insert into public.investment_plans (id, name, apy_percent, term_days, min_amount)
  values ('00000000-0000-0000-0000-00000000a012', 'P12', 12, 90, 100);
insert into public.profiles (id, role) values ('aaaaaaaa-0000-0000-0000-000000000001', 'admin');
insert into public.wallets (user_id, balance_usd) values ('aaaaaaaa-0000-0000-0000-000000000001', 0);

-- One user per scenario: uNN with wallet balance and one investment.
create function public.t_setup(k text, wallet numeric, amount numeric, days_ago numeric, admin_profit numeric default 0)
returns uuid language plpgsql as $$
declare u uuid := ('10000000-0000-0000-0000-0000000000' || k)::uuid; i uuid;
begin
  insert into public.profiles (id, role) values (u, 'user');
  insert into public.wallets (user_id, balance_usd) values (u, wallet);
  insert into public.investments (user_id, plan_id, amount_usd, started_at, matures_at, admin_profit)
    values (u, '00000000-0000-0000-0000-00000000a012', amount,
            now() - make_interval(secs => days_ago * 86400),
            now() - make_interval(secs => days_ago * 86400) + interval '90 days', admin_profit)
    returning id into i;
  insert into public.t_ids values ('u' || k, u), ('i' || k, i);
  return i;
end $$;
create function public.id(k text) returns uuid language sql as $$ select v from public.t_ids where k = $1 $$;
grant execute on function public.id(text), public.t_user(uuid) to authenticated;

-- Admin actions as the admin role.
create function public.t_approve(t uuid) returns jsonb language plpgsql as $$
declare tok uuid;
begin
  perform set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
  set local role authenticated;
  tok := public.claim_transaction_for_approval(t, 'approved in test');
  return public.finalize_transaction_approval(t, tok);
end $$;
create function public.t_reject(t uuid, note text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
  set local role authenticated;
  perform public.reject_pending_transaction(t, note);
end $$;
create function public.t_withdraw(k text, amount numeric) returns uuid language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', public.id('u' || k)::text, false);
  set local role authenticated;
  return public.request_investment_withdrawal(public.id('i' || k), amount);
end $$;
create function public.t_claim(k text) returns uuid language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', public.id('u' || k)::text, false);
  set local role authenticated;
  return public.claim_investment_gains(public.id('i' || k));
end $$;
