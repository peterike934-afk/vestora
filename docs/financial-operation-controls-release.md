# Financial operation controls release runbook (20261127000000)

Covers withdrawal payouts, Bank Pull (Stripe bank debits) and Bank Transfer.
Nothing here is applied automatically. Production steps are run by the owner.

## What the release does

- **Three independent switches, all OFF by default.** A payout or bank pull happens
  only when all three allow it:
  1. Database: `public.financial_operation_controls` (`withdrawal_payouts`,
     `bank_deposit_pulls`), changed only by `postgres` through
     `public.set_financial_operation_enabled(...)` with an operator, a reason and
     the confirmation phrase; every change is logged append-only in
     `financial_operation_control_events`.
  2. Application: `WITHDRAWAL_PAYOUTS_ENABLED` / `BANK_DEPOSIT_PULLS_ENABLED`
     must be exactly `true`.
  3. Payment library: `lib/wallet.js` and `lib/stripe.js` refuse before any key
     is loaded or any provider is called.
- **Valid hold required.** An approval needs a `held` reservation for the same
  customer and the same amount. Withdrawals without one (created before holds)
  are refused with "no valid funds hold; manual review required" and are not
  rejected, refunded or changed.
- **Server-calculated crypto amount.** The customer no longer types a crypto
  amount. The admin opens a quote (Coinbase and Kraken, must agree within 1%),
  confirms the amount, and the server re-quotes and pays the lower of the two
  (within 1%). The transaction hash is saved the moment it is broadcast; a send
  that fails after broadcast becomes `uncertain` and is never retried
  automatically.
- **Customer inserts.** Customers can insert only pending crypto or Bank
  Transfer (`wire`) deposit claims with no verification or payout fields set.
  Withdrawals are created only through `request_withdrawal`.
- **`BLOCKCHAIN_NETWORK`** must be `mainnet` or `testnet`. If it is unset, crypto
  deposit checks and payouts are refused (nothing defaults silently).
- **USDT contract** corrected to `0xdAC17F958D2ee523a2206206994597C13D831ec7`.
- **Bank Transfer** stays available (admin-controlled by
  `settings.bank_wire_enabled`); balances are credited only when an admin
  approves. **Bank Pull** is shown as "Coming Soon" and its endpoints return 503.

## Behaviour change to tell the admin

After the migration, pending withdrawals that have no funds hold can no longer
be approved from the dashboard. They stay pending for manual review. Count them
before the release (read-only):

```sql
select count(*) from public.transactions t
where t.type = 'withdrawal' and t.status = 'pending'
  and not exists (select 1 from public.withdrawal_reservations r
                  where r.transaction_id = t.id and r.state = 'held');
```

## Steps (owner only)

1. Fresh backup (same kit as the previous release).
2. Vercel (the `vestoras` project): set `BLOCKCHAIN_NETWORK=mainnet`. Do **not**
   set `WITHDRAWAL_PAYOUTS_ENABLED` or `BANK_DEPOSIT_PULLS_ENABLED`.
3. Check the migration file checksum (SHA-256):
   `fd1bf3ae0fe66a489b4e990fc9d3d6c254114e4bcf936332b59af438aa2a5a74`
4. Apply as `postgres` in one transaction (`psql -1 -v ON_ERROR_STOP=1 -f ...`).
   It refuses to run unless 20261126000000 is applied, both functions match the
   20261122000000 sources, and the insert policy is the expected Production one.
5. Deploy the application.
6. Check that the admin dashboard banner shows both operations disabled, and
   that `GET /api/admin/verify-transaction` reports `enabled: false` for both.

Enabling payouts later is a separate decision: set the environment variable,
redeploy, then as postgres:

```sql
select public.set_financial_operation_enabled('withdrawal_payouts', true,
  '<operator>', '<reason>', 'ENABLE WITHDRAWAL PAYOUTS');
```

Disabling needs no phrase: `select public.set_financial_operation_enabled('withdrawal_payouts', false, '<operator>', '<reason>');`

## Rollback

Application first (redeploy the previous build). Database rollback
(`supabase/rollback/20261127000000_financial_operation_controls_rollback.sql`,
SHA-256 `f869f3ae81b39e6737d2bb37f7768b065366ecb4bbddf08f6aa4f80eb641f459`)
restores the previous functions, grants and insert policy exactly and keeps the
switch tables and log. It **removes the database freeze**, so it must only be
run with the application switches unset.
