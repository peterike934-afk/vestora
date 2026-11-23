# Vestora tests

```
npm run test:unit         # pure JavaScript (referral routes, email sender and templates, unsubscribe tokens, campaign gate; withdrawal preview, transaction labels and translations on the Production pages)
npm run test:db           # financial database tests in a disposable Docker Postgres
npm run test:integration  # referral-programme flow and withdrawal/deposit controls flow: real routes against all migrations on disposable Postgres 17 (Docker)
npm test                  # unit + database
```

Referral-programme tests never send email or touch the network: `tests/helpers/alias-hooks.mjs`
loads the real source files with `resend`, `next/server` and the Supabase client factories
replaced by in-memory stand-ins (`tests/helpers/stubs`), and the tests replace `fetch`.

`withdrawal-controls-flow.test.mjs` additionally replaces the crypto wallet, price
source, Stripe, on-chain deposit check, audit and email modules with recorders
(through `VESTORA_TEST_MODULE_OVERRIDES`, read by `alias-hooks.mjs`). No key is
loaded, no blockchain, bank or Stripe call is possible, and `fetch` throws.

## Database tests (`tests/db`)

`run.mjs` starts a throwaway `postgres:17` container (Production runs 17), builds
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
| `referral_programme.sql` (plus pay/reject and pay/pay races in `run.mjs`) | Referral programme (20261125000000) with payouts explicitly enabled: attribution at signup/verification only, self/duplicate referrals, live amounts, rejection with private notes, notification ledger, marketing consent, campaign queue/pause, permissions |
| `referral_upgrade_a_snapshot.sql` → `referral_upgrade_b_after.sql` → `referral_upgrade_c_after_rollback.sql` | Production-state upgrade to 20261125000000: no existing record changed, no consent invented; rollback keeps records; re-applying is refused |
| `referral_payout_freeze.sql` (plus switch/payment races in `run.mjs`) | Payout freeze (20261126000000): OFF by default; direct RPC by an admin refused; direct INSERT/UPDATE/DELETE on referrals refused for admin and service role even under an "admins write anything" policy; switch changeable only by postgres with operator, reason and confirmation, logged append-only; payment works exactly once when enabled; disabling waits for in-flight payments; `pay_referral` equals 20261124000000 plus only the check; recipient-lookup release; campaign audit trail |
| `freeze_upgrade_a_snapshot.sql` → `freeze_upgrade_b_after.sql` → `freeze_upgrade_c_after_rollback.sql` (plus guards in `run.mjs`) | Upgrade from the referral-programme state: 13 record tables and every other function unchanged; rollback restores `pay_referral` and `set_marketing_campaign_paused` exactly and keeps the switch log; refusal when applied before 25, on a changed `pay_referral`, on an unreviewed referrals trigger, and on re-application; a late error leaves nothing behind |
| `financial_controls.sql` (plus freeze/claim races and two simultaneous claims in `run.mjs`) | Financial operation controls (20261127000000): withdrawal payouts and bank-deposit pulls OFF by default; switch changeable only by postgres with confirmation phrase, logged append-only; approval needs a valid matching funds hold (legacy withdrawals blocked for manual review, nothing changed); amount, method and crypto-detail validation; `request_withdrawal` stores no customer-typed crypto amount and validates addresses; customers can insert only pending crypto/wire deposit claims and no withdrawals |
| `fc_upgrade_a_snapshot.sql` → `fc_upgrade_b_after.sql` → `fc_upgrade_c_after_rollback.sql` (plus guards in `run.mjs`) | Upgrade from the post-26 state: no record, other function or other policy changed; in-flight claim still finalises; rollback restores both functions, grants and the Production insert policy exactly and keeps the switch log; refusal before 26, on drifted functions, on an extra insert policy, on re-application; a late error leaves nothing behind |

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
