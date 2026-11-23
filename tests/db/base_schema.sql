-- Test-only stand-in for the parts of Vestora's Supabase schema that the
-- financial migrations depend on. Applied ONLY to a disposable local
-- Postgres container by tests/db/run.mjs. Never run against production.
--
-- public.investments mirrors the production column list exactly
-- (column, type, default), as exported from Supabase on 2026-11-22.
-- Other tables carry only the columns the migrations reference.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

create schema auth;
-- Referenced by the email-delivery migration's foreign key.
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

-- full_name: used by log_admin_action (tests/db/referral_baseline.sql).
-- Type text and nullable are assumed (a NULL name must be possible: the
-- production function falls back to 'Unknown admin').
create table public.profiles (id uuid primary key, role text not null default 'user', full_name text);

create table public.wallets (
  user_id uuid primary key references public.profiles(id),
  balance_usd numeric default 0,
  updated_at timestamptz not null default now()
);

create table public.investment_plans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  apy_percent numeric not null,
  term_days integer not null,
  min_amount numeric not null default 0,
  early_withdrawal_fee_usd numeric,
  is_active boolean not null default true
);

-- Production column list (Supabase export) and production constraints.
create table public.investments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id),
  plan_id uuid references public.investment_plans(id),
  amount_usd numeric check (amount_usd > 0),
  started_at timestamptz default now(),
  matures_at timestamptz,
  status text default 'active'::text check (status = any (array['active', 'matured', 'withdrawn', 'cancelled'])),
  created_at timestamptz default now(),
  withdrawn_principal numeric default 0,
  claimed_interest numeric default 0,
  admin_profit numeric default 0
);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  type text not null check (type = any (array['deposit', 'withdrawal', 'admin_credit', 'admin_debit', 'investment_withdrawal', 'investment_interest_claim', 'early_withdrawal_fee', 'investment_cancelled'])),
  amount_usd numeric not null,
  status text not null default 'pending' check (status = any (array['pending', 'verified', 'rejected'])),
  admin_note text,
  verified_by uuid,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  investment_id uuid references public.investments(id),
  principal_portion numeric,
  forfeited_interest numeric,
  fee_charged numeric,
  payment_method text,
  crypto_currency text,
  crypto_amount numeric,
  destination_address text,
  linked_bank_account_id uuid,
  stripe_payment_intent_id text,
  stripe_payment_intent_status text,
  sent_tx_hash text,
  sent_at timestamptz,
  send_error text,
  related_transaction_id uuid references public.transactions(id) on delete set null
);

-- Production keys the single settings row by id = true.
create table public.settings (
  id boolean primary key default true,
  min_withdrawal_usd numeric,
  daily_withdrawal_limit_usd numeric
);

create function public.is_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select role = 'admin' from public.profiles where id = auth.uid()), false)
$$;
grant execute on function public.is_admin() to authenticated;

-- Users may insert their own pending transactions (mirrors how deposits
-- are created from the browser today).
alter table public.transactions enable row level security;
create policy own_select on public.transactions for select to authenticated using (user_id = auth.uid());
-- Production policy: users may insert only their own deposits and withdrawals.
create policy own_insert on public.transactions for insert to authenticated
  with check (user_id = auth.uid() and type = any (array['deposit', 'withdrawal']) and status = 'pending');
grant select, insert on public.transactions to authenticated;
alter table public.wallets enable row level security;
create policy own_wallet on public.wallets for select to authenticated using (user_id = auth.uid());
grant select on public.wallets to authenticated;
