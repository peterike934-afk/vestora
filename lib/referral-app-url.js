import 'server-only'

// Base URL for every link in referral emails (referral links, dashboard,
// terms, unsubscribe). Only the verified Production origin is accepted:
// vestorainvestment.com did not respond over HTTPS when checked
// (2026-11-23), so it is deliberately NOT allowed here. Add it only after
// verifying it serves the app over valid HTTPS.
const VERIFIED_ORIGINS = new Set(['https://vestoras.vercel.app'])

export function getReferralAppUrl(env = process.env) {
  const configured = env.VESTORA_APP_URL
  if (!configured) throw new Error('VESTORA_APP_URL is required.')
  const url = new URL(configured)
  if (url.protocol !== 'https:' || !VERIFIED_ORIGINS.has(url.origin) || url.pathname !== '/'
      || url.search || url.hash || url.username || url.password) {
    throw new Error('VESTORA_APP_URL is not a verified Vestora HTTPS origin.')
  }
  return url.origin
}

export function referralLink(appUrl, referralCode) {
  if (!/^[A-Z0-9]{4,32}$/.test(String(referralCode || ''))) throw new Error('Invalid referral code.')
  return `${appUrl}/signup?ref=${encodeURIComponent(referralCode)}`
}
