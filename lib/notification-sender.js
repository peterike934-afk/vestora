import 'server-only'

import { randomUUID } from 'node:crypto'
import { renderReferralEmail, renderReferralCampaignEmail } from '@/lib/referral-email'
import { getReferralAppUrl, referralLink } from '@/lib/referral-app-url'
import { unsubscribeUrl } from '@/lib/unsubscribe-token'
import { getMarketingPostalAddress } from '@/lib/referral-campaign'

// Sends emails recorded in the notification_deliveries ledger, following the
// welcome-email pattern exactly:
//   claim (database re-checks preferences/consent/pause) -> send with an
//   idempotency key per attempt -> record the provider outcome.
//   'sent' only with a provider message id; 'failed' only for a definite
//   provider rejection; anything ambiguous is 'uncertain' and is NEVER resent
//   automatically (a retry needs explicit approval, plus provider evidence
//   for an uncertain one).
// The sender only reads the ledger and recipient contact details. It never
// touches referrals, wallets or transactions, so an email problem cannot
// affect attribution, approval or payment.
//
// Recovery, with nothing resent blindly:
//   - pending: sent right after the event (after()) and by the daily cron;
//   - recipient lookup failed (Auth/database briefly unavailable): released
//     back to 'pending' (the provider was never called); after 5 attempts
//     it becomes 'failed' for an admin;
//   - 'sending' older than 15 minutes (process stopped mid-send): marked
//     'uncertain', never resent automatically;
//   - outcome could not be recorded: stays 'sending', then 'uncertain'.

export const FROM_ADDRESS = 'Vestora <no-reply@vestorainvestment.com>'
const STALE_SENDING_MINUTES = 15

export function classifyProviderResult(result) {
  if (result?.data?.id) return { outcome: 'sent', providerMessageId: result.data.id, failureCode: null }
  if (result?.error) {
    const status = Number(result.error.statusCode)
    const ambiguous = [408, 409, 425, 429].includes(status)
    const rejected = status >= 400 && status < 500 && !ambiguous
    return {
      outcome: rejected ? 'failed' : 'uncertain',
      providerMessageId: null,
      failureCode: Number.isInteger(status) ? `provider_${status}` : 'provider_response_uncertain',
    }
  }
  return { outcome: 'uncertain', providerMessageId: null, failureCode: 'provider_message_id_missing' }
}

export function createResendSender(apiKey) {
  // Imported lazily so builds and tests without the provider still work.
  return async (payload, options) => {
    const { Resend } = await import('resend')
    return new Resend(apiKey).emails.send(payload, options)
  }
}

async function rpc(db, name, args) {
  const { data, error } = await db.rpc(name, args)
  if (error) throw Object.assign(new Error(`${name} failed`), { code: error.code || 'database_error' })
  return data
}

async function recoverStale(db, category, now) {
  const rows = await rpc(db, 'list_notification_deliveries', { p_status: 'sending', p_category: category, p_limit: 100 }) || []
  let recovered = 0
  for (const row of rows) {
    const started = row.sending_started_at ? Date.parse(row.sending_started_at) : NaN
    if (Number.isFinite(started) && now() - started > STALE_SENDING_MINUTES * 60_000) {
      if (await rpc(db, 'recover_stale_notification_delivery', { p_delivery_id: row.delivery_id, p_stale_after_minutes: STALE_SENDING_MINUTES })) recovered++
    }
  }
  return recovered
}

// The address comes from Supabase Auth (the verified login email), not from
// profiles.email, which is only copied at signup.
//   { ok: true, ... }                     recipient found
//   { ok: false, retry: false, code }     account definitely has no email / does not exist
//   { ok: false, retry: true, code }      lookup failed (temporary): try again later
async function recipientOf(db, userId) {
  let authData, authError, profile, profileError
  try {
    ;[{ data: authData, error: authError }, { data: profile, error: profileError }] = await Promise.all([
      db.auth.admin.getUserById(userId),
      db.from('profiles').select('full_name, referral_code').eq('id', userId).single(),
    ])
  } catch {
    return { ok: false, retry: true, code: 'recipient_lookup_failed' }
  }
  if (authError) {
    const status = Number(authError.status ?? authError.statusCode)
    return status === 404
      ? { ok: false, retry: false, code: 'recipient_not_found' }
      : { ok: false, retry: true, code: 'recipient_lookup_failed' }
  }
  if (profileError) return { ok: false, retry: true, code: 'recipient_lookup_failed' }
  if (!authData?.user) return { ok: false, retry: false, code: 'recipient_not_found' }
  if (!authData.user.email) return { ok: false, retry: false, code: 'recipient_email_missing' }
  return { ok: true, email: authData.user.email, full_name: profile?.full_name, referral_code: profile?.referral_code }
}

/**
 * Processes up to `limit` pending deliveries of one category.
 * category 'transactional' — referral notices; 'marketing' — one campaign
 * (requires campaignKey and campaignAllowed: published terms + enabled).
 */
export async function processNotificationDeliveries({
  db,
  sendEmail,
  category = 'transactional',
  campaignKey = null,
  campaignAllowed = false,
  limit = 25,
  env = process.env,
  now = () => Date.now(),
  newId = randomUUID,
  logger = console,
}) {
  const summary = { status: 'ok', claimed: 0, sent: 0, failed: 0, uncertain: 0, released: 0, notClaimed: 0, recovered: 0 }

  // Configuration first: if anything is missing, claim nothing (emails stay
  // pending instead of being marked failed).
  let appUrl
  try {
    appUrl = getReferralAppUrl(env)
  } catch {
    logger.error('Referral emails not sent: VESTORA_APP_URL is missing or not a verified origin.')
    return { ...summary, status: 'not_configured' }
  }
  if (typeof sendEmail !== 'function') {
    logger.error('Referral emails not sent: email provider is not configured.')
    return { ...summary, status: 'not_configured' }
  }
  if (category === 'marketing') {
    if (!campaignKey || !campaignAllowed) return { ...summary, status: 'campaign_blocked' }
    if (!env.MARKETING_UNSUBSCRIBE_SECRET || env.MARKETING_UNSUBSCRIBE_SECRET.length < 32) {
      logger.error('Campaign emails not sent: MARKETING_UNSUBSCRIBE_SECRET is not configured.')
      return { ...summary, status: 'not_configured' }
    }
    if (!getMarketingPostalAddress(env)) {
      logger.error('Campaign emails not sent: MARKETING_POSTAL_ADDRESS is not configured.')
      return { ...summary, status: 'not_configured' }
    }
  }

  let settings = null
  if (category === 'marketing') {
    const { data, error } = await db.from('settings')
      .select('referral_program_enabled, referral_referrer_bonus_usd, referral_referred_bonus_usd').eq('id', true).single()
    if (error) return { ...summary, status: 'settings_unavailable' }
    if (!data?.referral_program_enabled) return { ...summary, status: 'programme_disabled' }
    settings = data
  }

  summary.recovered = await recoverStale(db, category, now)
  const pending = await rpc(db, 'list_notification_deliveries', {
    p_status: 'pending', p_category: category, p_limit: Math.max(1, Math.min(Number(limit) || 25, 100)), p_campaign_key: campaignKey,
  }) || []

  for (const { delivery_id: deliveryId } of pending) {
    const attemptId = newId()
    const claimed = (await rpc(db, 'claim_notification_delivery', { p_delivery_id: deliveryId, p_attempt_id: attemptId }))?.[0]
    if (!claimed) { summary.notClaimed++; continue }   // skipped, paused, or taken by another run
    summary.claimed++

    const complete = async (outcome, providerMessageId, failureCode) => {
      summary[outcome]++
      try {
        await rpc(db, 'complete_notification_delivery', {
          p_delivery_id: deliveryId, p_attempt_id: claimed.attempt_id, p_expected_attempt_count: claimed.attempt_count,
          p_outcome: outcome, p_provider_message_id: providerMessageId, p_failure_code: failureCode,
        })
      } catch (err) {
        // Left in 'sending'; recovered to 'uncertain' later, never resent blindly.
        logger.error('Could not record email delivery outcome.', err.code || 'database_error')
      }
    }

    const recipient = await recipientOf(db, claimed.recipient_user_id)
    if (!recipient.ok && recipient.retry) {
      // Nothing was sent: put it back in the queue for the next run.
      try {
        const released = await rpc(db, 'release_notification_delivery', {
          p_delivery_id: deliveryId, p_attempt_id: claimed.attempt_id, p_expected_attempt_count: claimed.attempt_count, p_reason: recipient.code,
        })
        if (released === 'failed') summary.failed++
        else summary.released++
      } catch (err) {
        // Left in 'sending'; becomes 'uncertain' later for an admin to review.
        logger.error('Could not release email delivery after a recipient lookup failure.', err.code || 'database_error')
      }
      continue
    }
    if (!recipient.ok) { await complete('failed', null, recipient.code); continue }

    let message
    try {
      const ctx = { appUrl, recipientName: recipient.full_name, amountUsd: claimed.payload?.amount_usd, reason: claimed.payload?.reason }
      if (claimed.category === 'marketing') {
        message = renderReferralCampaignEmail({
          ...ctx,
          referrerBonusUsd: settings.referral_referrer_bonus_usd,
          referredBonusUsd: settings.referral_referred_bonus_usd,
          referralLink: referralLink(appUrl, recipient.referral_code),
          unsubscribeUrl: unsubscribeUrl(appUrl, claimed.recipient_user_id, env),
          postalAddress: getMarketingPostalAddress(env),
        })
      } else {
        message = renderReferralEmail(claimed.event_type, ctx)
      }
    } catch {
      await complete('failed', null, 'render_failed')
      continue
    }

    let result
    try {
      result = await sendEmail(
        { from: FROM_ADDRESS, to: recipient.email, subject: message.subject, html: message.html, text: message.text,
          ...(message.headers ? { headers: message.headers } : {}) },
        { idempotencyKey: `notify/${deliveryId}/${claimed.attempt_id}` },
      )
    } catch {
      await complete('uncertain', null, 'provider_response_uncertain')
      continue
    }
    const { outcome, providerMessageId, failureCode } = classifyProviderResult(result)
    await complete(outcome, providerMessageId, failureCode)
  }
  return summary
}

// Used after referral events (verification, payment, rejection). Never throws:
// email problems are logged and left in the ledger for the next run.
export async function sendPendingReferralNotifications({ db, env = process.env, logger = console, limit = 25 } = {}) {
  try {
    const client = db ?? (await import('@/lib/supabase/admin')).createAdminClient()
    const sendEmail = env.RESEND_API_KEY ? createResendSender(env.RESEND_API_KEY) : null
    return await processNotificationDeliveries({ db: client, sendEmail, category: 'transactional', limit, env, logger })
  } catch (err) {
    logger.error('Referral notification run failed; emails stay queued.', err?.code || 'error')
    return { status: 'error' }
  }
}
