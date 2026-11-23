import { createClient as createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/admin-session'
import { CAMPAIGN_KEY, ENQUEUE_CONFIRMATION, MAX_BATCH_SIZE, getCampaignGate, maskEmail } from '@/lib/referral-campaign'
import { createResendSender, processNotificationDeliveries } from '@/lib/notification-sender'
import { checkSameOriginJson } from '@/lib/request-origin'
import { NextResponse } from 'next/server'

// Referral-programme announcement campaign (marketing email, consent only).
//   GET  — dry run: gate status, live amounts, exact recipient count and a
//          masked sample, campaign state and ledger counts. Writes nothing.
//   POST — { action: 'enqueue', confirm }  queue (starts PAUSED)
//          { action: 'resume' | 'pause' }   campaign switch
//          { action: 'send-batch', batchSize }  send one bounded batch
// Everything except 'pause' requires the gate: published terms at
// /legal/referral-terms, REFERRAL_CAMPAIGN_ENABLED=true, provider and
// unsubscribe secret configured. Consent and pause are re-checked by the
// database for every single email when it is claimed.

// A batch of up to 50 emails, sent one after another (seconds).
export const maxDuration = 60

const STATUSES = ['pending', 'sending', 'sent', 'failed', 'uncertain', 'skipped']

async function ledgerCounts(service) {
  const counts = {}
  for (const status of STATUSES) {
    const { data } = await service.rpc('list_notification_deliveries', {
      p_status: status, p_category: 'marketing', p_limit: 500, p_campaign_key: CAMPAIGN_KEY,
    })
    counts[status] = (data || []).length
  }
  return counts
}

export async function GET() {
  const authClient = await createServerClient()
  const admin = await requireAdmin(authClient)
  if (admin.error) return NextResponse.json({ error: admin.error.message }, { status: admin.error.status })

  const gate = await getCampaignGate()
  const service = createAdminClient()
  const [{ data: recipients, error: previewError }, { data: settings }, { data: control }] = await Promise.all([
    service.rpc('preview_marketing_campaign_recipients'),
    authClient.from('settings').select('referral_program_enabled, referral_referrer_bonus_usd, referral_referred_bonus_usd').eq('id', true).single(),
    authClient.from('marketing_campaign_controls').select('paused, updated_at').eq('campaign_key', CAMPAIGN_KEY).maybeSingle(),
  ])
  if (previewError) return NextResponse.json({ error: 'Recipient preview failed' }, { status: 500 })

  const sample = []
  for (const r of (recipients || []).slice(0, 5)) {
    const { data } = await service.auth.admin.getUserById(r.recipient_user_id)
    sample.push(maskEmail(data?.user?.email))
  }

  return NextResponse.json({
    campaignKey: CAMPAIGN_KEY,
    gate: { allowed: gate.allowed, termsPublished: gate.termsPublished, enabled: gate.enabled, blockers: gate.blockers },
    programme: settings
      ? { enabled: settings.referral_program_enabled, referrerBonusUsd: settings.referral_referrer_bonus_usd, referredBonusUsd: settings.referral_referred_bonus_usd }
      : null,
    eligibleRecipients: (recipients || []).length,
    sampleRecipients: sample,
    campaign: control ? { queued: true, paused: control.paused, updatedAt: control.updated_at } : { queued: false, paused: true },
    deliveries: await ledgerCounts(service),
    enqueueConfirmation: ENQUEUE_CONFIRMATION,
    maxBatchSize: MAX_BATCH_SIZE,
  })
}

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
  const action = body?.action
  if (!['enqueue', 'resume', 'pause', 'send-batch'].includes(action)) {
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }
  const service = createAdminClient()

  // Pausing is always allowed, even when the gate is closed.
  if (action === 'pause') {
    const { error } = await service.rpc('set_marketing_campaign_paused', { p_campaign_key: CAMPAIGN_KEY, p_paused: true, p_actor: admin.user.id })
    if (error) return NextResponse.json({ error: /Unknown campaign/.test(error.message || '') ? 'Campaign has not been queued' : 'Could not pause' }, { status: 409 })
    return NextResponse.json({ success: true, paused: true })
  }

  const gate = await getCampaignGate()
  if (!gate.allowed) return NextResponse.json({ error: 'Campaign is blocked', blockers: gate.blockers }, { status: 409 })

  if (action === 'enqueue') {
    if (body.confirm !== ENQUEUE_CONFIRMATION) {
      return NextResponse.json({ error: `Type "${ENQUEUE_CONFIRMATION}" to queue the campaign` }, { status: 400 })
    }
    const { data, error } = await service.rpc('enqueue_marketing_campaign', { p_campaign_key: CAMPAIGN_KEY, p_actor: admin.user.id })
    if (error) return NextResponse.json({ error: 'Could not queue the campaign' }, { status: 500 })
    return NextResponse.json({ success: true, queued: data, paused: true })
  }

  if (action === 'resume') {
    const { error } = await service.rpc('set_marketing_campaign_paused', { p_campaign_key: CAMPAIGN_KEY, p_paused: false, p_actor: admin.user.id })
    if (error) return NextResponse.json({ error: /Unknown campaign/.test(error.message || '') ? 'Campaign has not been queued' : 'Could not resume' }, { status: 409 })
    return NextResponse.json({ success: true, paused: false })
  }

  // send-batch
  const size = Number.parseInt(body.batchSize, 10)
  if (!Number.isInteger(size) || size < 1 || size > MAX_BATCH_SIZE) {
    return NextResponse.json({ error: `Batch size must be between 1 and ${MAX_BATCH_SIZE}` }, { status: 400 })
  }
  const result = await processNotificationDeliveries({
    db: service,
    sendEmail: createResendSender(process.env.RESEND_API_KEY),
    category: 'marketing',
    campaignKey: CAMPAIGN_KEY,
    campaignAllowed: true,
    limit: size,
  })
  return NextResponse.json({ success: true, result })
}
