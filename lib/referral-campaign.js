import 'server-only'

import { getReferralAppUrl } from '@/lib/referral-app-url'

// The referral-programme announcement campaign. It can only send when ALL of:
//   1. REFERRAL_CAMPAIGN_ENABLED is exactly 'true' (off by default; keeps
//      Preview deployments and accidental runs from sending anything);
//   2. the published referral terms answer at <app>/legal/referral-terms;
//   3. an admin has queued it (it starts paused) and then resumed it;
//   4. the provider, the unsubscribe secret and the sender's postal address
//      (MARKETING_POSTAL_ADDRESS, required in commercial email by CAN-SPAM)
//      are configured;
// and every email is re-checked for consent when claimed.
export const CAMPAIGN_KEY = 'referral-launch'
export const ENQUEUE_CONFIRMATION = `QUEUE ${CAMPAIGN_KEY}`
export const MAX_BATCH_SIZE = 50

// The sender's physical postal address shown in every promotional email.
// It must be a real, valid address provided by Vestora; nothing is assumed.
export function getMarketingPostalAddress(env = process.env) {
  const value = typeof env.MARKETING_POSTAL_ADDRESS === 'string' ? env.MARKETING_POSTAL_ADDRESS.trim().replace(/\s+/g, ' ') : ''
  if (value.length < 10 || value.length > 300 || /[<>]/.test(value)) return null
  return value
}

export async function checkReferralTermsPublished(appUrl, fetchImpl = fetch) {
  try {
    const res = await fetchImpl(`${appUrl}/legal/referral-terms`, { method: 'GET', redirect: 'follow', cache: 'no-store' })
    return res.ok
  } catch {
    return false
  }
}

export async function getCampaignGate({ env = process.env, fetchImpl = fetch } = {}) {
  let appUrl = null
  try { appUrl = getReferralAppUrl(env) } catch { /* reported below */ }
  const enabled = env.REFERRAL_CAMPAIGN_ENABLED === 'true'
  const termsPublished = appUrl ? await checkReferralTermsPublished(appUrl, fetchImpl) : false
  const blockers = []
  if (!appUrl) blockers.push('VESTORA_APP_URL is not set to the verified Production origin.')
  if (!termsPublished) blockers.push('Published referral terms were not found at /legal/referral-terms.')
  if (!enabled) blockers.push('REFERRAL_CAMPAIGN_ENABLED is not set to true.')
  if (!env.RESEND_API_KEY) blockers.push('The email provider is not configured.')
  if (!env.MARKETING_UNSUBSCRIBE_SECRET || env.MARKETING_UNSUBSCRIBE_SECRET.length < 32) blockers.push('MARKETING_UNSUBSCRIBE_SECRET is not configured.')
  if (!getMarketingPostalAddress(env)) blockers.push('MARKETING_POSTAL_ADDRESS (the sender’s postal address for promotional emails) is not configured.')
  return { appUrl, enabled, termsPublished, allowed: blockers.length === 0, blockers }
}

export function maskEmail(email) {
  const [local, domain] = String(email || '').split('@')
  if (!domain) return '(no email)'
  return `${local.slice(0, 1)}${'*'.repeat(Math.max(local.length - 1, 1))}@${domain}`
}
