import { createHash, timingSafeEqual } from 'node:crypto'
import { sendPendingReferralNotifications } from '@/lib/notification-sender'

// Scheduled backstop for transactional referral emails (registration,
// payment, rejection, admin attention). They are normally sent right after
// the event; this run picks up anything left pending (for example when the
// after-response send was cut short) and turns stale sends into 'uncertain'.
// It never sends promotional campaign emails and never resends an email
// that might already have been delivered.
export const runtime = 'nodejs'
export const maxDuration = 60

const BATCH = 50
const BUDGET_MS = 45_000
const MAX_BATCHES = 20

function sameSecret(given, expected) {
  // Compare fixed-length digests so the check takes the same time whatever is sent.
  const a = createHash('sha256').update(String(given)).digest()
  const b = createHash('sha256').update(String(expected)).digest()
  return timingSafeEqual(a, b)
}

export async function GET(request) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || !cronSecret.trim()) {
    console.error('Referral notification cron rejected: CRON_SECRET is not configured.')
    return new Response('Unauthorized', { status: 401 })
  }
  if (!sameSecret(request.headers.get('authorization') || '', `Bearer ${cronSecret}`)) {
    return new Response('Unauthorized', { status: 401 })
  }

  // Full batches are followed by another one until the queue is empty or the
  // time budget is used; a batch that released a delivery (recipient lookup
  // failed) ends the run, so a failing lookup is retried tomorrow rather
  // than in a tight loop.
  const started = Date.now()
  const batches = []
  let result
  do {
    result = await sendPendingReferralNotifications({ limit: BATCH })
    batches.push(result)
  } while (result.status === 'ok' && result.claimed + result.notClaimed >= BATCH && !result.released
           && batches.length < MAX_BATCHES && Date.now() - started < BUDGET_MS)

  const total = batches.reduce((t, r) => {
    for (const k of ['claimed', 'sent', 'failed', 'uncertain', 'released', 'notClaimed', 'recovered']) t[k] = (t[k] || 0) + (r[k] || 0)
    return t
  }, {})
  return Response.json({ ok: batches.every((r) => r.status !== 'error'), result: { status: result.status, batches: batches.length, ...total } })
}
