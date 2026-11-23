import { createAdminClient } from '@/lib/supabase/admin'
import { verifyUnsubscribeToken } from '@/lib/unsubscribe-token'

// Marketing unsubscribe link from promotional emails.
//   GET  — confirmation page only (link scanners prefetch links, so GET
//          never changes anything).
//   POST — the page's button, or a mail client's RFC 8058 one-click request;
//          verifies the signed token, then withdraws marketing consent
//          (recorded as an 'unsubscribe_link' consent event).
// Account emails are not affected. No login needed; the token only allows
// withdrawing this one customer's marketing consent.

export const runtime = 'nodejs'

function page(title, message, form = '') {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title></head>
<body style="margin:0;padding:48px 16px;background:#f3f6f3;font-family:Arial,Helvetica,sans-serif;color:#173b2c;">
<main style="max-width:480px;margin:0 auto;background:#fff;border:1px solid #e1e9e3;border-radius:14px;padding:32px;">
<h1 style="font-size:20px;margin:0 0 12px;">${title}</h1><p style="font-size:15px;line-height:24px;color:#53665c;margin:0 0 20px;">${message}</p>${form}
</main></body></html>`
  return html
}

function htmlResponse(html, status = 200) {
  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } })
}

const INVALID = () => htmlResponse(page('Link not valid', 'This unsubscribe link is not valid. You can change your marketing email preference at any time in your Vestora account Settings.'), 400)

// Missing MARKETING_UNSUBSCRIBE_SECRET: links cannot be checked, so nothing
// changes and the customer is told how else to opt out (fails closed).
const UNAVAILABLE = () => htmlResponse(page('Temporarily unavailable', 'We cannot process unsubscribe links right now. Please try again later, or turn off marketing emails in your Vestora account Settings.'), 503)

// 'valid' | 'invalid' | 'unavailable'
function checkLink(userId, token) {
  try {
    return verifyUnsubscribeToken(userId, token) ? 'valid' : 'invalid'
  } catch {
    console.error('Unsubscribe link could not be checked: MARKETING_UNSUBSCRIBE_SECRET is not configured.')
    return 'unavailable'
  }
}

function readParams(url) {
  const params = new URL(url).searchParams
  return { userId: params.get('u') || '', token: params.get('t') || '' }
}

export async function GET(request) {
  const { userId, token } = readParams(request.url)
  const link = checkLink(userId, token)
  if (link === 'unavailable') return UNAVAILABLE()
  if (link !== 'valid') return INVALID()
  const action = `?u=${encodeURIComponent(userId)}&t=${encodeURIComponent(token)}`
  return htmlResponse(page(
    'Unsubscribe from Vestora marketing emails',
    'Press the button to stop receiving Vestora marketing emails. Emails about your account and your referrals are not affected.',
    `<form method="post" action="${action}"><button type="submit" style="padding:12px 22px;background:#1f6f4a;color:#fff;border:0;border-radius:8px;font-size:15px;font-weight:700;cursor:pointer;">Unsubscribe</button></form>`,
  ))
}

export async function POST(request) {
  const { userId, token } = readParams(request.url)
  const link = checkLink(userId, token)
  if (link === 'unavailable') return UNAVAILABLE()
  if (link !== 'valid') return INVALID()
  const { error } = await createAdminClient().rpc('record_marketing_unsubscribe', { p_user_id: userId })
  if (error) {
    console.error('Unsubscribe could not be recorded.', error.code || 'database_error')
    return htmlResponse(page('Something went wrong', 'We could not record your request. Please try again, or change your preference in your Vestora account Settings.'), 500)
  }
  return htmlResponse(page('You are unsubscribed', 'You will no longer receive Vestora marketing emails. You can opt in again at any time in your account Settings.'))
}
