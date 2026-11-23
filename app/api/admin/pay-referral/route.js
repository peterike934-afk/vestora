import { createClient as createServerClient } from '@/lib/supabase/server'
import { parseReferralId } from '@/lib/referral-id'
import { sendPendingReferralNotifications } from '@/lib/notification-sender'
import { referralPayoutsEnabled, REFERRAL_PAYOUTS_DISABLED_CODE, REFERRAL_PAYOUTS_DISABLED_MESSAGE } from '@/lib/referral-payouts'
import { checkSameOriginJson } from '@/lib/request-origin'
import { after, NextResponse } from 'next/server'

// Pays a referral through ONE database call: public.pay_referral
// (supabase/migrations/20261124000000_pay_referral.sql, with the payout
// freeze check added by 20261126000000_referral_payout_freeze.sql).
//
// The function runs with the admin's own session (no service role). In a
// single transaction it re-checks that the caller is an admin, checks the
// database payout switch, locks the referral row (so concurrent requests for
// the same referral are serialised), refuses referrals that are already
// paid, credits each non-zero bonus through adjust_wallet_with_transaction
// with deterministic request IDs, recognises (never repeats) a credit an
// earlier partial payment already made, writes one audit entry per
// recipient, and marks the referral paid. Any failure rolls the whole
// payment back.
//
// TWO switches must both be on for a payment:
//   - REFERRAL_PAYOUTS_ENABLED=true in this deployment (lib/referral-payouts.js);
//   - public.referral_payout_controls.payouts_enabled in the database, which
//     only an operator connected as postgres can change, with an audit entry.
// Either one off: 503 REFERRAL_PAYOUTS_DISABLED and nothing is paid.
//
// The payment notices are queued by the database in the same transaction;
// they are SENT after the response (after()), so an email problem can never
// affect the payment. Anything after() does not finish is picked up by the
// daily cron.

// Time for after() to send the notices on Vercel (seconds).
export const maxDuration = 60

const DISABLED = () => NextResponse.json({ error: REFERRAL_PAYOUTS_DISABLED_MESSAGE, code: REFERRAL_PAYOUTS_DISABLED_CODE }, { status: 503 })

// Database messages from pay_referral are written for admins; anything not
// recognised is reported generically.
const KNOWN_ERRORS = [
  [/Already paid/, 400],
  [/Referral not found/, 404],
  [/Wallet not found/, 404],
  [/Only admins/, 403],
  [/Self-referrals cannot be paid/, 409],
  [/manual review required/, 409],
  [/invalid bonus amounts/, 409],
  [/not pending/, 409],
  [/Concurrent referral credit detected/, 409],
]

async function adminSession() {
  const authClient = await createServerClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return { response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) }
  // Early refusal for non-admins; pay_referral enforces it again.
  const { data: profile } = await authClient.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') return { response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { authClient }
}

// Payout status for the admin page (read-only). The database switch is read
// with the admin's session (RLS: admins only).
export async function GET() {
  const session = await adminSession()
  if (session.response) return session.response
  const { data, error } = await session.authClient.from('referral_payout_controls').select('payouts_enabled, updated_at').maybeSingle()
  const application = referralPayoutsEnabled()
  const database = !error && data?.payouts_enabled === true
  return NextResponse.json({
    enabled: application && database,
    application,
    database: error ? null : database,
    databaseUpdatedAt: data?.updated_at ?? null,
  })
}

export async function POST(request) {
  const origin = checkSameOriginJson(request)
  if (!origin.ok) return NextResponse.json({ error: origin.error }, { status: origin.status })

  const session = await adminSession()
  if (session.response) return session.response
  const { authClient } = session

  // Application kill switch (lib/referral-payouts.js). It's off unless
  // REFERRAL_PAYOUTS_ENABLED is exactly 'true', so a missing setting fails
  // closed. It's checked after the sign-in and admin checks, so only admins
  // learn whether payouts are on. It's checked before the request body is
  // read and before any database call, so a refused request pays nothing and
  // sends nothing.
  if (!referralPayoutsEnabled()) return DISABLED()

  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  const referralId = parseReferralId(body?.referralId)
  if (!referralId) return NextResponse.json({ error: 'A valid referralId is required' }, { status: 400 })

  const { data, error } = await authClient.rpc('pay_referral', { p_referral_id: referralId })

  if (error) {
    const message = error.message || ''
    // Database payout freeze (20261126000000): same answer as the app switch.
    if (/Referral payouts are disabled/.test(message)) return DISABLED()
    const known = KNOWN_ERRORS.find(([pattern]) => pattern.test(message))
    if (known) return NextResponse.json({ error: message }, { status: known[1] })
    console.error('Referral payment failed.', error.code || 'pay_referral_error')
    // The database call is atomic, but if the connection failed after it
    // committed the outcome is unknown here. A retry can never pay twice.
    return NextResponse.json({ error: 'Referral payment did not complete. Reload to check its status, then retry if it is still pending.' }, { status: 500 })
  }

  after(() => sendPendingReferralNotifications())
  return NextResponse.json({ success: true, referral: data })
}
