import 'server-only'

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { checkSameOriginJson } from '@/lib/request-origin'

// Website-visitor ("guest") support chat: ownership, validation and rate
// limits shared by the /api/guest-chat routes.
//
// OWNERSHIP. Starting a chat creates a random 256-bit secret. Its SHA-256
// is stored on the thread (guest_threads.guest_token_hash) and the secret
// itself goes only to the visitor's browser, in an HttpOnly cookie scoped
// to /api/guest-chat. Every guest route finds the thread from that cookie
// and compares hashes in constant time. A thread ID on its own (in a URL,
// a request body or localStorage) grants nothing.
//
// IDENTITY. These routes only ever write messages with sender 'guest'. The
// admin replies from the admin dashboard, where the database itself
// (RLS policy "Admins can reply to guests as admin", 20261128000000) only
// accepts a signed-in admin and only with sender 'admin'.
//
// RATE LIMITS. Counted in the database (guest_chat_rate_limit_hit), so they
// hold across Vercel's serverless instances. Visitor addresses are hashed
// before they are used as counter names; no IP address is stored.

export const COOKIE_NAME = 'vestora_guest_chat'
const COOKIE_PATH = '/api/guest-chat'
const COOKIE_MAX_AGE = 180 * 24 * 60 * 60 // 180 days

export const MAX_MESSAGE_LENGTH = 2000
export const MAX_NAME_LENGTH = 100
export const MAX_EMAIL_LENGTH = 254
const MAX_BODY_BYTES = 8 * 1024
const LOCALES = new Set(['en', 'es', 'es-MX', 'pt-BR', 'de', 'ar', 'zh', 'ru'])

// [name, limit, window in seconds]. Generous for a person typing, tight for
// a script.
export const LIMITS = {
  startPerIpHour: ['start:ip:h', 5, 3600],
  startPerIpDay: ['start:ip:d', 20, 86400],
  startAllHour: ['start:all:h', 200, 3600],
  sendPerThreadMinute: ['send:thread:m', 10, 60],
  sendPerThreadDay: ['send:thread:d', 300, 86400],
  sendPerIpMinute: ['send:ip:m', 30, 60],
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/
// NUL and other control characters except tab, line feed and carriage return.
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/

export const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v)
export const sha256Hex = (v) => createHash('sha256').update(String(v)).digest('hex')

export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  })
}

export const genericError = () => json({ error: 'Something went wrong. Please try again.' }, 500)
export const rateLimited = () => json({ error: 'Too many requests. Please wait a moment and try again.', code: 'RATE_LIMITED' }, 429, { 'retry-after': '60' })
export const sessionRequired = () => json({ error: 'Please start a chat first.', code: 'GUEST_SESSION_REQUIRED' }, 401)

// ── Request checks ────────────────────────────────────────────────────────

// Same-site JSON only (no cross-site form posts), at most 8 KB, a JSON object.
export async function readJsonObject(request) {
  const origin = checkSameOriginJson(request)
  if (!origin.ok) return { error: json({ error: origin.error }, origin.status) }
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return { error: json({ error: 'Request too large.' }, 413) }
  let text
  try { text = await request.text() } catch { return { error: json({ error: 'Invalid request.' }, 400) } }
  if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) return { error: json({ error: 'Request too large.' }, 413) }
  let body
  try { body = JSON.parse(text) } catch { return { error: json({ error: 'Invalid request.' }, 400) } }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: json({ error: 'Invalid request.' }, 400) }
  return { body }
}

export function validateMessage(value) {
  if (typeof value !== 'string') return { error: 'Message must be text.' }
  const text = value.trim()
  if (!text) return { error: 'Message cannot be empty.' }
  if ([...text].length > MAX_MESSAGE_LENGTH) return { error: `Message is too long (maximum ${MAX_MESSAGE_LENGTH} characters).` }
  if (CONTROL_RE.test(text)) return { error: 'Message contains characters that are not allowed.' }
  return { value: text }
}

export function validateStart(body) {
  const { name, email, locale, legacyThreadId } = body
  if (typeof name !== 'string' || typeof email !== 'string') return { error: 'Name and email are required.' }
  const n = name.trim()
  const e = email.trim()
  if (!n || !e) return { error: 'Name and email are required.' }
  if ([...n].length > MAX_NAME_LENGTH || CONTROL_RE.test(n) || /[<>]/.test(n)) return { error: 'Please enter a valid name.' }
  if (e.length > MAX_EMAIL_LENGTH || !EMAIL_RE.test(e)) return { error: 'Please enter a valid email address.' }
  if (legacyThreadId !== undefined && legacyThreadId !== null && !isUuid(legacyThreadId)) return { error: 'Invalid request.' }
  return {
    value: {
      name: n,
      email: e,
      locale: typeof locale === 'string' && LOCALES.has(locale) ? locale : 'en',
      legacyThreadId: legacyThreadId || null,
    },
  }
}

// ── Visitor session (cookie) ──────────────────────────────────────────────

export function newGuestToken() {
  const token = randomBytes(32).toString('base64url')
  return { token, hash: sha256Hex(token) }
}

function readCookie(request, name) {
  const header = request.headers.get('cookie') || ''
  for (const part of header.split(';')) {
    const i = part.indexOf('=')
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim()
  }
  return null
}

export function parseGuestCookie(request) {
  const raw = readCookie(request, COOKIE_NAME)
  if (!raw) return null
  const [threadId, token, extra] = raw.split('.')
  if (extra !== undefined || !isUuid(threadId) || !TOKEN_RE.test(token || '')) return null
  return { threadId: threadId.toLowerCase(), token }
}

const secureCookie = () => process.env.NODE_ENV === 'production' || process.env.VERCEL === '1'

export function guestCookie(threadId, token) {
  return [`${COOKIE_NAME}=${threadId}.${token}`, `Path=${COOKIE_PATH}`, `Max-Age=${COOKIE_MAX_AGE}`,
    'HttpOnly', 'SameSite=Lax', ...(secureCookie() ? ['Secure'] : [])].join('; ')
}

export function clearGuestCookie() {
  return [`${COOKIE_NAME}=`, `Path=${COOKIE_PATH}`, 'Max-Age=0', 'HttpOnly', 'SameSite=Lax',
    ...(secureCookie() ? ['Secure'] : [])].join('; ')
}

// Returns the visitor's own thread, or null. The thread must exist, have an
// ownership secret, and the cookie's secret must hash to it.
export async function authenticateGuest(request, service) {
  const cookie = parseGuestCookie(request)
  if (!cookie) return null
  const { data, error } = await service
    .from('guest_threads')
    .select('id, guest_token_hash, locale')
    .eq('id', cookie.threadId)
    .maybeSingle()
  if (error || !data?.guest_token_hash) return null
  const expected = Buffer.from(data.guest_token_hash, 'hex')
  const actual = createHash('sha256').update(cookie.token).digest()
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null
  return { threadId: data.id, locale: data.locale }
}

// ── Rate limits ───────────────────────────────────────────────────────────

// The visitor's address as Vercel reports it. Vercel sets these headers
// itself at its edge and does not pass on values sent by the client, so
// they cannot be spoofed on Vercel. IPv6 addresses are grouped by /64 (one
// customer network), so rotating addresses inside it does not help.
export function clientAddress(request) {
  const h = request.headers
  const raw = (h.get('x-vercel-forwarded-for') || h.get('x-real-ip') || h.get('x-forwarded-for') || '')
    .split(',')[0].trim().toLowerCase()
  if (!raw) return 'unknown'
  if (!raw.includes(':')) return raw
  const [head, tail = ''] = raw.split('%')[0].split('::')
  const left = head ? head.split(':') : []
  const right = raw.includes('::') && tail ? tail.split(':') : []
  const groups = raw.includes('::')
    ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right]
    : left
  return `${groups.slice(0, 4).map((g) => g || '0').join(':')}::/64`
}

// True if every listed limit still has room. Each call counts one hit
// against every limit. Fails closed: if the counter cannot be read, the
// request is refused.
export async function withinLimits(service, checks) {
  for (const [[name, limit, windowSeconds], subject] of checks) {
    const bucket = `${name}:${sha256Hex(`vestora-guest-chat|${name}|${subject}`).slice(0, 40)}`
    const { data, error } = await service.rpc('guest_chat_rate_limit_hit', {
      p_bucket: bucket, p_limit: limit, p_window_seconds: windowSeconds,
    })
    if (error) {
      console.error('guest chat rate limit unavailable:', error.message)
      return false
    }
    if (data !== true) return false
  }
  return true
}
