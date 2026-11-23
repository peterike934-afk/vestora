# Vestora tests

```
npm run test:unit   # pure JavaScript (pay-referral route; withdrawal preview, transaction labels and translations on the Production pages)
npm run test:db     # financial database tests in a disposable Docker Postgres
npm test            # both
```

## Database tests (`tests/db`)

`run.mjs` starts a throwaway `postgres:16` container, builds
`base_schema.sql` (a stand-in for the parts of the Supabase schema the
migrations use; `public.investments` matches production exactly), applies
every file in `supabase/migrations` in filename order, and runs the suites in
`tests/db/suites`. Each suite gets a fresh database and the container is
removed afterwards. Requires Docker.

**It never connects to Supabase or any production database, and never uses
real customer data or funds.**

| Suite | Covers |
|---|---|
| `withdrawal_holds.sql` | Withdrawal holds at request time, duplicate and over-balance requests, limits, approval (single debit), rejection (refund + rejection note), withdrawals created before holds, released payouts, deposits, access control |
| `compat_a_before.sql` → `compat_b_after.sql` → `compat_c_after_rollback.sql` | Builds production-like state under the earlier migrations, applies the holds migration (all existing rows must be unchanged, in-flight approvals must complete), then the rollback script (held funds returned, functions restored to V2) |
| concurrency (in `run.mjs`) | Two simultaneous withdrawal requests against one balance; two simultaneous gains claims and two simultaneous full principal withdrawals on one investment |
| `defects_before_fix.sql` | Runs on the current production logic and confirms defects A–D exist (proves the integrity tests exercise real failures) |
| `investment_integrity.sql` | Fixes A–D: early-withdrawal fee approved/rejected/refunded (wallet vs payout, split, duplicates, cancellation), maturity interest never paid twice (full, partial, before/after claims), gains claims (pending, multiple, approval re-check, rejection, closed investment), full-withdrawal protection, one shared valuation; admin credit/debit and no-negative-balance regressions |
| `integrity_upgrade_a_before.sql` → `integrity_upgrade_b_after.sql` → `integrity_upgrade_c_after_rollback.sql` | Production-like state (historical unrefunded fee, in-flight withdrawal and claim) → integrity migration (records unchanged, valuation identical, in-flight items handled) → rollback (functions and view restored exactly, real refunds kept) |
| `referral_payments.sql` (plus concurrency in `run.mjs`) | LEGACY two-call referral payouts via `adjust_wallet_with_transaction` (kept because `pay_referral` must recognise partial payments of that kind): one credit per referral request ID, `verified_by`/`verified_at` recorded, second admin and non-admin refused, credits alongside withdrawal holds; simultaneous payments of one referral; reproduction of the old read-modify-write lost update vs. the new pattern under the same race |
| `pay_referral.sql` (plus preconditions, two-admin race and concurrent-edit wait in `run.mjs`) | `pay_referral`: atomic payout, request IDs equal to the JavaScript vectors, validation (self-referral, NaN/Infinity, negative, sub-cent, missing recipient), full rollback on wallet or audit failure, cross-admin recovery of an existing credit, inconsistent records abort, holds compatibility; `log_admin_action` production behaviour and ACL |
| `chain_a_snapshot.sql` → `chain_mid_after_migrations.sql` → `chain_b_after_rollbacks.sql` (plus guards in `run.mjs`) | All three migrations in order, then the three rollbacks in reverse: ordering guards; existing profiles, wallets, transactions, referrals and audit logs unchanged by migrating and by rolling back; every financial function and the view restored exactly |
| `permissions_a_snapshot.sql` → `permissions_b_after.sql` → `permissions_c_after_rollback.sql` | Under Supabase default grants (`supabase_default_privileges.sql`): the migrations grant exactly the intended access and change no existing permission; every SECURITY DEFINER function has a fixed search_path and owner postgres; the rollbacks restore every permission |
| release scripts (in `run.mjs`) | `supabase/release` pre-flight passes on production state, blocks on each planted hazard and is read-only; verification passes after the migrations with an unchanged record snapshot |

`referral_baseline.sql` holds the production `referrals` and `audit_logs`
definitions and `log_admin_action` (behaviour and ACL as supplied; exact
source text not available). `production_baseline.sql` holds the live definitions of `create_investment`,
`claim_investment_gains`, `request_investment_withdrawal` and
`investments_with_value` exported from Supabase, loaded before the
migrations so tests start from production's actual logic.
`_integrity_helpers.sql` is shared by the integrity suites (the runner
expands `\ir` includes because suites are piped to psql).

Suites print `PASS` / `FAIL` lines via `raise notice`; any `FAIL` or SQL error
fails the run.
