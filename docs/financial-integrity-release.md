# Financial-integrity release runbook

Branch `release/financial-integrity`, based on Production `main` (`4377993`). Financial changes only: the V2 UI upgrade, Investment Chat and performance chart stay on `fix/investment-financial-integrity` for a later, separate release.

This release contains:
- withdrawal holds (`20261122000000`), including the withdraw page's switch to `request_withdrawal`;
- investment integrity fixes A–E (`20261123000000`);
- the atomic referral payout `pay_referral` (`20261124000000`), plus the route that calls it.

Every database script runs as `postgres`. The pre-flight and verification scripts are read-only. Migrations and rollbacks change the database and need explicit approval at each step.

## Why the steps must happen in this order

- **The old referral route must not run once migration 22 is in.** The route live on `main` pays referrals with a service-role read-then-write of `wallets.balance_usd`. If that runs at the same moment as a withdrawal hold, it overwrites the hold's debit. This is reproduced in `tests/db` plan 9. So referral payouts stay frozen from the first migration until the new route is live.
- **Partly paid referrals must be found first.** The old route's credits carry no request ID, so `pay_referral` cannot recognise a referral that the old route partly paid. Pre-flight checks 12 and 13 find these; mark each one paid by hand before `pay_referral` is used.
- **Each migration must be one transaction.** The migration files have no `BEGIN`/`COMMIT`, so run each as one transaction: `psql --single-transaction`, or the whole file in one run of the Supabase SQL editor.

## 0. Before the window
1. Get approval for:
   - committing the uncommitted work;
   - the PR and merge into `main`;
   - each database step below.
2. Commit the branch, open a PR, and let a Vercel Preview build pass. Do **not** merge yet.
3. Back up:
   - Supabase: confirm point-in-time recovery (or a daily backup) exists. Note the exact timestamp just before step 2 of the window.
   - Take a logical dump of the data: `pg_dump --data-only --schema=public` (or a CSV export) of `wallets`, `transactions`, `investments`, `referrals`, `audit_logs`, `admin_wallet_adjustment_requests`, `admin_financial_operation_claims` and `profiles`.
   - Export `pg_get_functiondef` for every function the migrations replace (pre-flight check 4) and `pg_get_viewdef('public.investments_with_value')`.
   - Keep these outside the repository, like `C:\vest\audit`.

## 1. Freeze (start of window)
- Tell the admins not to approve or reject deposits or withdrawals, cancel investments or pay referrals until step 7.
- Users may keep using the site. The database changes are compatible with the live `main` app; this is covered by the compatibility tests.

## 2. Pre-flight (read-only)
Run `supabase/release/financial_integrity_preflight.sql` as postgres and save the output.
- **Every row must be `OK` or `INFO`.**
- **Any `BLOCK` means stop.** Resolve it, then run the pre-flight again. In particular:
  - check 11 (approvals in flight);
  - checks 12 and 13 (legacy partial referral payments);
  - check 4 (a function changed since the 2026-11-22 export).
- **`REVIEW` means compare the definition by hand** (the view, the type-check constraint or the `log_admin_action` ACL).
- **Keep the check 19 snapshot.**

## 3. Apply the migrations in this order, as postgres, one transaction each
```
psql "<postgres connection>" --single-transaction -v ON_ERROR_STOP=1 -f supabase/migrations/20261122000000_withdrawal_reservations.sql
psql "<postgres connection>" --single-transaction -v ON_ERROR_STOP=1 -f supabase/migrations/20261123000000_investment_financial_integrity.sql
psql "<postgres connection>" --single-transaction -v ON_ERROR_STOP=1 -f supabase/migrations/20261124000000_pay_referral.sql
```
- **If one fails, it changes nothing.** Stop and do not continue with the next file.
- **Each file checks its own preconditions:** the role, the ordering, the `adjust_wallet_with_transaction` owner, SECURITY DEFINER and empty search path, `log_admin_action`, and the `referrals` columns. It aborts if any differs.

## 4. Verify the database (read-only)
Run `supabase/release/financial_integrity_verify.sql`.
- **Every row must be `OK` or `INFO`.**
- **Check 10's snapshot must equal pre-flight check 19**, as long as nothing ran in between.
- **Any `FAIL`:** go to Rollback B.

## 5. Deploy the application
Merge the PR into `main`, then promote or deploy to Production on Vercel (project `vestoras`). Note the previous deployment, the one running `4377993`, for an instant rollback.

## 6. Post-deployment checks
1. Run the verification script again. Everything must be `OK`.
2. Smoke tests (admin):
   - **Referrals:** pay one small pending referral. The referrer and referred are credited once each, there are two `referral_paid` audit entries, and the referral is `paid`. Click Pay again: the answer is "Already paid".
   - **Withdrawal hold:** as a user, request a small withdrawal. The balance drops by the amount, and the hold appears in `withdrawal_reservations`. Reject it as admin: the balance is restored.
   - **Pages:** the investment and portfolio pages load, and claimable gains match `investments_with_value`.
3. Check the Vercel and Supabase logs for errors on `/api/admin/pay-referral`, `request_withdrawal` and `claim_transaction_for_approval`.

## 7. Unfreeze
Admins resume normal work.

## Rollback

### A. Application only (first choice)
Use Vercel instant rollback to the previous Production deployment.
- The database may stay migrated: the old app works with it.
- **Exception:** the old referral route must NOT be used while migration 22 is in. Keep referral payouts frozen until the new app is back, or until Rollback B is complete.

### B. Database (only if a database defect is confirmed; do Rollback A first)
Run these as postgres, in this order. Each script is a single transaction. The `20261122000000` rollback refuses to run while `20261123000000` is still applied.
```
psql "<postgres connection>" -v ON_ERROR_STOP=1 -f supabase/rollback/20261124000000_pay_referral_rollback.sql
psql "<postgres connection>" -v ON_ERROR_STOP=1 -f supabase/rollback/20261123000000_investment_financial_integrity_rollback.sql
psql "<postgres connection>" -v ON_ERROR_STOP=1 -f supabase/rollback/20261122000000_withdrawal_reservations_rollback.sql
```
Then run the pre-flight script.
- **Checks 4 and 5 must be `OK` again:** the exact Production function and view text is back.
- **Expected after a rollback:** check 2 reports "2 of 4 markers" (the kept `withdrawal_reservations` table and the kept columns), and check 6 shows `REVIEW` (the kept refund type). Both are expected.

**What the rollbacks reverse:**
- function and view definitions (back to the exact Production text);
- the added functions (dropped);
- permissions (identical to before; covered by the tests);
- withdrawal holds still `held`: their amounts are returned to the wallets and the holds are marked `released`.

**What is kept on purpose:** these are real money movements and must never be deleted.
- every credit, debit, refund and audit entry written while the release was live;
- referral statuses;
- `withdrawal_reservations` (as the history of holds);
- the `early_withdrawal_fee_refund` transaction type and its unique index;
- the columns `investments.withdrawn_claimed_interest` and `transactions.claimed_interest_allocated`.

**Not reversible:** any payment already made. Correcting one needs a new, audited adjustment, never a deleted row. A point-in-time restore would also erase genuine customer activity since the snapshot, so it is a last resort.
