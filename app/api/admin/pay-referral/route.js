import { createClient as createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// Pays a referral through ONE database call: public.pay_referral
// (supabase/migrations/20261124000000_pay_referral.sql).
//
// The function runs with the admin's own session (no service role). In a
// single transaction it re-checks that the caller is an admin, locks the
// referral row (so concurrent requests for the same referral are
// serialised), refuses referrals that are already paid, credits each
// non-zero bonus through adjust_wallet_with_transaction with deterministic
// request IDs, recognises (never repeats) a credit an earlier partial
// payment already made, writes one audit entry per recipient, and marks the
// referral paid. Any failure rolls the whole payment back.
//
// Requires 20261124000000_pay_referral.sql in the database. Without it the
// call fails and nothing is paid.

const MAX_BIGINT = 9223372036854775807n

// referrals.id is BIGINT. Accept a positive safe integer (JSON number) or a
// decimal string; pass it on as a string so no precision is ever lost.
function parseReferralId(value) {
  let text
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) return null
    text = String(value)
  } else if (typeof value === 'string') {
    text = value.trim()
    if (!/^[1-9][0-9]{0,18}$/.test(text)) return null
  } else {
    return null
  }
  return BigInt(text) <= MAX_BIGINT ? text : null
}

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

export async function POST(request) {
  const authClient = await createServerClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  // Early refusal for non-admins; pay_referral enforces it again.
  const { data: profile } = await authClient.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

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
    const known = KNOWN_ERRORS.find(([pattern]) => pattern.test(message))
    if (known) return NextResponse.json({ error: message }, { status: known[1] })
    console.error('Referral payment failed.', error.code || 'pay_referral_error')
    // The database call is atomic, but if the connection failed after it
    // committed the outcome is unknown here. A retry can never pay twice.
    return NextResponse.json({ error: 'Referral payment did not complete. Reload to check its status, then retry if it is still pending.' }, { status: 500 })
  }

  return NextResponse.json({ success: true, referral: data })
}
