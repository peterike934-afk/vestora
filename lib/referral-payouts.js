// Server-side kill switch for referral payouts.
//
// Payouts are OFF unless the environment variable REFERRAL_PAYOUTS_ENABLED
// is exactly the string 'true'. Anything else turns them off, including the
// variable being missing or empty, 'TRUE', '1', 'yes' or 'true ' with a
// space. So a missing or mistyped setting always fails closed.
//
// The value is read on every request, never cached when the module loads.
// Changing it in Vercel takes effect on the next deployment, and nothing
// here ever turns payouts on by itself.
//
// This check sits in front of public.pay_referral and does not replace it.
// The database function still does its own admin check, locking and
// duplicate protection, unchanged.

export const REFERRAL_PAYOUTS_DISABLED_CODE = 'REFERRAL_PAYOUTS_DISABLED'

export const REFERRAL_PAYOUTS_DISABLED_MESSAGE =
  'Referral payouts are currently disabled. Nothing was paid and the referral is still pending.'

export function referralPayoutsEnabled(env = process.env) {
  return env?.REFERRAL_PAYOUTS_ENABLED === 'true'
}
