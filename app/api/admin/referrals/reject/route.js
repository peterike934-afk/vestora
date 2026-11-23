import { createClient as createServerClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/admin-session'
import { parseReferralId } from '@/lib/referral-id'
import { isReferralRejectionReason } from '@/lib/referral-reasons'
import { sendPendingReferralNotifications } from '@/lib/notification-sender'
import { checkSameOriginJson } from '@/lib/request-origin'
import { after, NextResponse } from 'next/server'

// Rejects a pending referral through public.reject_referral, with the
// admin's own session. The database re-checks admin status, locks the
// referral, refuses paid/rejected ones, stores the neutral public reason on
// the referral and the private note in an admin-only table, writes the audit
// entry, and queues the customer notices in the same transaction. Emails are
// sent after the response and can never affect the rejection.

const KNOWN_ERRORS = [
  [/Already paid/, 409],
  [/Already rejected/, 409],
  [/Referral not found/, 404],
  [/Only admins/, 403],
  [/Invalid rejection reason/, 400],
]
const MAX_NOTE = 2000

// Time for after() to send the notices on Vercel (seconds).
export const maxDuration = 60

export async function POST(request) {
  const origin = checkSameOriginJson(request)
  if (!origin.ok) return NextResponse.json({ error: origin.error }, { status: origin.status })

  const authClient = await createServerClient()
  const admin = await requireAdmin(authClient)
  if (admin.error) return NextResponse.json({ error: admin.error.message }, { status: admin.error.status })

  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  const referralId = parseReferralId(body?.referralId)
  if (!referralId) return NextResponse.json({ error: 'A valid referralId is required' }, { status: 400 })
  if (!isReferralRejectionReason(body?.reason)) return NextResponse.json({ error: 'A valid rejection reason is required' }, { status: 400 })
  const note = typeof body?.privateNote === 'string' ? body.privateNote.trim() : ''
  if (note.length > MAX_NOTE) return NextResponse.json({ error: `Private note is limited to ${MAX_NOTE} characters` }, { status: 400 })

  const { data, error } = await authClient.rpc('reject_referral', {
    p_referral_id: referralId,
    p_reason: body.reason,
    p_private_note: note || null,
  })

  if (error) {
    const message = error.message || ''
    const known = KNOWN_ERRORS.find(([pattern]) => pattern.test(message))
    if (known) return NextResponse.json({ error: message }, { status: known[1] })
    console.error('Referral rejection failed.', error.code || 'reject_referral_error')
    return NextResponse.json({ error: 'Referral rejection did not complete. Reload to check its status.' }, { status: 500 })
  }

  after(() => sendPendingReferralNotifications())
  return NextResponse.json({ success: true, referral: data })
}
