# Referral-programme release runbook

Branch `feature/referral-programme`, built on PR #2 (`release/financial-integrity`, head `360beff`). Every database script runs as `postgres`. Pre-flight and verification scripts are read-only. Migrations, rollbacks and switch changes alter Production and each needs explicit approval.

This release contains:
- `20261125000000_referral_programme.sql`: attribution at signup/verification, admin rejection, the notification ledger, audited marketing consent. Runner kit: `C:\vest\backups\referral-programme\migrate-25\`.
- `20261126000000_referral_payout_freeze.sql`: the payout freeze inside `pay_referral`, the write guard on `referrals`, recipient-lookup recovery and the campaign audit trail. Runner kit: `C:\vest\backups\referral-programme\migrate-26\`.
- The application: referral emails, admin review (pay / reject / retry), consent, the in-app announcement, campaign tooling, the payout status banner, and cross-site protection on the admin routes.

| File | SHA-256 |
|---|---|
| `supabase/migrations/20261125000000_referral_programme.sql` | `67a40d0cd0c70d3338e94245992f6f453f75da046d678cd5d882d00391cc81f4` |
| `supabase/migrations/20261126000000_referral_payout_freeze.sql` | `e170927a084047f0728e85599b144a86c69bb1d697308cc620da77bf00d56af8` |

`.gitattributes` keeps `.sql` and `.sh` files LF on every checkout, so these checksums hold on any machine.

## Why the order matters

- **PR #2 must be live first.** Production `main` (`4377993`) still pays referrals through the old service-role route, which bypasses every database control. PR #2 replaces it with `pay_referral`.
- **Migration 25 withdraws `apply_referral_code`,** which the app on PR #2 still calls. Apply 25 only right before deploying this app. Referral signups between the two steps are not attributed.
- **Migration 26 replaces `pay_referral`.** Kit 25 fingerprints the 20261124000000 version. So 26 must run after kit 25 has verified, never before.
- **Payouts stay frozen in two places.** Payouts need BOTH the application switch `REFERRAL_PAYOUTS_ENABLED=true` and the database switch `referral_payout_controls.payouts_enabled = true`. Both start off. Withdrawal approvals are frozen separately and are not affected by anything here.

## Production execution procedure

1. **Before the window.**
   - Confirm a recent Supabase backup or PITR point and note the time.
   - Set the Vercel environment variables listed below. Leave `REFERRAL_PAYOUTS_ENABLED` and `REFERRAL_CAMPAIGN_ENABLED` unset.
   - Confirm the Preview isolation described below.
2. **Merge and deploy PR #2.** Wait until Production serves it. Admins still do not pay referrals.
3. **Apply migration 25.**
   - Run `powershell -ExecutionPolicy Bypass -File C:\vest\backups\referral-programme\migrate-25\apply_25.ps1`.
   - Continue only on `MIGRATION 20261125000000 COMMITTED AND VERIFIED`.
4. **Apply migration 26 straight away.**
   - Run `powershell -ExecutionPolicy Bypass -File C:\vest\backups\referral-programme\migrate-26\apply_26.ps1`.
   - Continue only on `MIGRATION 20261126000000 COMMITTED AND VERIFIED`.
   - Payouts are now frozen in the database.
5. **Deploy `feature/referral-programme` immediately.**
6. **Smoke checks, with no money moving and no real email to customers:**
   - `/admin/referrals` shows "Referral payouts are frozen", and the Pay button is disabled;
   - a direct `POST /api/admin/pay-referral` returns 503 `REFERRAL_PAYOUTS_DISABLED`;
   - the announcement is hidden, because `/legal/referral-terms` returns 404;
   - the campaign panel lists its blockers.
7. **If anything is wrong:** roll back the app deployment first, then the database, in reverse order:
   - `supabase/rollback/20261126000000_referral_payout_freeze_rollback.sql` (this removes the database freeze; re-freeze quickly);
   - then `supabase/rollback/20261125000000_referral_programme_rollback.sql`.

   Both keep every record they created. Neither migration can simply be re-applied after its rollback: its guard refuses, and a reviewed follow-up migration is needed.

A failed apply is one transaction, so it rolls back completely. The kit reports `NOT APPLIED - the transaction rolled back; Production unchanged` and never retries. Any outcome other than `COMMITTED AND VERIFIED` or `NOT APPLIED` means stop and inspect.

## Enabling referral payouts later (deliberate, audited)

Only after the business decision is made. Both steps are needed.

1. In the database, as `postgres` (Supabase SQL editor):
   ```sql
   select public.set_referral_payouts_enabled(true, '<operator name>', '<reason / approval reference>', 'ENABLE REFERRAL PAYOUTS');
   ```
   Every change is recorded in `referral_payout_control_events` (append-only), with the operator, the reason and the database user.
2. In Vercel Production, set `REFERRAL_PAYOUTS_ENABLED=true` and redeploy.

To freeze again, either step alone is enough. The database one takes effect immediately, after in-flight payments finish:
```sql
select public.set_referral_payouts_enabled(false, '<operator name>', '<reason>');
```

## Vercel environment variables

| Variable | Production | Preview | Secret | Notes |
|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | required | required: **a separate Supabase project** | no | Preview must not point at Production. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | required | required (Preview project's key) | public, but per project | |
| `SUPABASE_SERVICE_ROLE_KEY` | required | Preview project's key only | **yes** | Never the Production key in Preview. |
| `RESEND_API_KEY` | required (confirm it exists) | **leave unset** | **yes** | Without it Preview sends no email; welcome and referral emails stay queued. |
| `VESTORA_APP_URL` | `https://vestoras.vercel.app` | **leave unset** | no | Only this verified origin is accepted. Without it no referral email is sent. Do not use `vestorainvestment.com` until its DNS and HTTPS are verified (and the allow-list in `lib/referral-app-url.js` is updated). |
| `CRON_SECRET` | required (confirm it exists) | not needed | **yes** | Vercel runs crons on Production only. |
| `MARKETING_UNSUBSCRIBE_SECRET` | required, at least 32 random characters | leave unset, or a different test value | **yes** | **Never rotate after a campaign email is sent:** old unsubscribe links would stop working. |
| `MARKETING_POSTAL_ADDRESS` | required before any campaign | leave unset | no | The sender's valid physical postal address (CAN-SPAM). Supplied by Vestora; never guessed. |
| `REFERRAL_PAYOUTS_ENABLED` | **leave unset** (payouts frozen) | leave unset | no | Exactly `true` enables the app switch; anything else is off. |
| `REFERRAL_CAMPAIGN_ENABLED` | **leave unset** | leave unset | no | Exactly `true` lifts one campaign blocker; all the others still apply. |
| Existing (`STRIPE_*`, `PLATFORM_*_PRIVATE_KEY`, `INFURA_API_KEY`, …) | as today | **review**: no Production private keys in Preview | **yes** | Not changed by this release. Worth checking while in the settings. |

### Testing on Preview without touching Production

- Point Preview at a separate Supabase project, or a Supabase branch, with its own keys. Apply the migrations there through the same kits, using that project's connection string. The kit refuses a connection string for any project other than Production's, so use the offline test copy approach in `migrate-26\offline-tests`, or run the migration files with `psql --single-transaction`.
- Leave `RESEND_API_KEY` and `VESTORA_APP_URL` unset on Preview. Every email then stays `pending` in the Preview ledger, visible to admins, and nothing is sent.
- Pushing a branch builds a Preview automatically. Check the Preview variables **before** pushing.

## Promotional campaign: launch blockers (all must be met)

The campaign fails closed. `GET /api/admin/referrals/campaign` lists whatever is still missing.

1. Referral terms, reviewed by a lawyer, published at `/legal/referral-terms`. The page must return HTTP 200, and the in-app announcement stays hidden until it does. Nothing in this release drafts or publishes terms.
2. `MARKETING_POSTAL_ADDRESS` set to Vestora's valid physical postal address. It is shown in every promotional email.
3. `MARKETING_UNSUBSCRIBE_SECRET` set (and never rotated afterwards). `RESEND_API_KEY` and `VESTORA_APP_URL` set.
4. `REFERRAL_CAMPAIGN_ENABLED=true`, set only when the launch is approved.
5. An admin queues the campaign by typing `QUEUE referral-launch`. It starts paused, an admin resumes it, and batches of at most 50 go out. Every email re-checks consent when it is sent, and every queue, pause and resume is recorded with the admin's ID.

Other requirements for lawful promotional email:
- Recipients are only customers who opted in explicitly. Consent is never assumed, and it is separate from account emails.
- Every promotional email carries a working one-click unsubscribe (`List-Unsubscribe` and `List-Unsubscribe-Post`) and a visible unsubscribe link. Unsubscribe requests take effect before the next email.
- The subject is not misleading. The sender is identified as Vestora.
- The sending domain (`no-reply@vestorainvestment.com` in Resend) is verified with SPF and DKIM, plus DMARC recommended. Check in Resend.
- Local rules for each market (e.g. GDPR/ePrivacy in the EU and UK, CASL in Canada, LGPD in Brazil) need the legal review. The seven translations need a native-speaker review.

## Email reliability (what recovers how)

| Situation | What happens | Resent automatically? |
|---|---|---|
| Event happened | Email queued in the same transaction; sent right after the response | n/a |
| After-response send cut short (function stopped) | Stays `pending`; the daily cron (00:30 UTC) sends it, in batches of 50 for up to about 45 s | yes. It was never sent. |
| Recipient lookup failed (Auth or database briefly unavailable) | Released back to `pending`; tried again on the next run; after 5 attempts becomes `failed` | yes, up to 5 attempts. Nothing was sent. |
| Process stopped mid-send | `sending` older than 15 min becomes `uncertain` | **no**. An admin retries only with Resend evidence that it was not delivered. |
| Provider rejected it | `failed` | no. An admin retries with a note. |
| Customer turned off account emails | `skipped` | no |

Email problems never touch referrals, wallets or payments. Admins see failed, uncertain and admin-alert emails, plus attribution errors, under **Needs attention** on `/admin/referrals`.
