import { createClient as createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/admin-session'
import { sendPendingReferralNotifications } from '@/lib/notification-sender'
import { checkSameOriginJson } from '@/lib/request-origin'
import { after, NextResponse } from 'next/server'

// Admin-approved retry of a failed or uncertain referral email. The ledger
// function (service role only) requires an operator and a note, and for an
// 'uncertain' email also provider evidence that it was not delivered — so an
// email the provider may already have delivered is never sent twice blindly.
export const maxDuration = 60

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
  const deliveryId = typeof body?.deliveryId === 'string' && UUID.test(body.deliveryId) ? body.deliveryId : null
  const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 500) : ''
  const evidence = typeof body?.providerEvidence === 'string' ? body.providerEvidence.trim().slice(0, 1000) : ''
  if (!deliveryId) return NextResponse.json({ error: 'A valid deliveryId is required' }, { status: 400 })
  if (!note) return NextResponse.json({ error: 'A note explaining the retry is required' }, { status: 400 })

  const { data, error } = await createAdminClient().rpc('retry_notification_delivery', {
    p_delivery_id: deliveryId,
    p_operator: `admin:${admin.user.id}`,
    p_note: note,
    p_provider_evidence: evidence || null,
  })
  if (error) {
    const status = /provider evidence|operator/.test(error.message || '') ? 400 : 500
    return NextResponse.json({ error: status === 400 ? error.message : 'Retry could not be recorded' }, { status })
  }
  if (data !== true) return NextResponse.json({ error: 'Only failed or uncertain emails can be retried' }, { status: 409 })

  after(() => sendPendingReferralNotifications())
  return NextResponse.json({ success: true })
}
