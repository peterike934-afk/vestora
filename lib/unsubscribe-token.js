import 'server-only'

import { createHmac, timingSafeEqual } from 'node:crypto'

// Signed, per-customer unsubscribe tokens for marketing emails. The token
// proves the link came from Vestora for this customer; it grants nothing
// except withdrawing marketing consent.
const PREFIX = 'vestora:marketing-unsubscribe:v1:'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function secret(env) {
  const value = env.MARKETING_UNSUBSCRIBE_SECRET
  if (!value || value.length < 32) throw new Error('MARKETING_UNSUBSCRIBE_SECRET must be at least 32 characters.')
  return value
}

export function signUnsubscribeToken(userId, env = process.env) {
  if (!UUID.test(String(userId))) throw new Error('Invalid user id.')
  return createHmac('sha256', secret(env)).update(PREFIX + String(userId).toLowerCase()).digest('base64url')
}

export function verifyUnsubscribeToken(userId, token, env = process.env) {
  if (!UUID.test(String(userId || '')) || typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return false
  const expected = Buffer.from(signUnsubscribeToken(userId, env))
  const given = Buffer.from(token)
  return expected.length === given.length && timingSafeEqual(expected, given)
}

export function unsubscribeUrl(appUrl, userId, env = process.env) {
  const params = new URLSearchParams({ u: String(userId).toLowerCase(), t: signUnsubscribeToken(userId, env) })
  return `${appUrl}/api/marketing/unsubscribe?${params}`
}
