// Unit tests for lib/guest-chat.js (website-visitor chat): message and
// start-form validation, the ownership cookie, visitor address grouping
// for rate limits, and the routes' behaviour when the limiter refuses.
// No database and no network: the service client is an in-memory stand-in.
//
//   node --test tests/unit/guest-chat.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
import { createHash } from 'node:crypto'

register('../helpers/alias-hooks.mjs', import.meta.url)
const gc = await import('@/lib/guest-chat')
const { POST: send } = await import('@/app/api/guest-chat/send/route')
const { POST: start } = await import('@/app/api/guest-chat/start/route')

const headers = (h) => { const m = new Map(Object.entries(h).map(([k, v]) => [k.toLowerCase(), v])); return { get: (k) => m.get(k.toLowerCase()) ?? null } }
const req = (h = {}, text = '') => ({ url: 'https://vestoras.vercel.app/api/guest-chat/send', headers: headers(h), text: async () => text })

test('message validation: text only, trimmed, 1-2000 characters, no control characters', () => {
  assert.deepEqual(gc.validateMessage('  hello \n'), { value: 'hello' })
  assert.deepEqual(gc.validateMessage('line one\nline two\ttab'), { value: 'line one\nline two\ttab' })
  assert.equal(gc.validateMessage('😀'.repeat(2000)).value.length, 4000, '2000 emoji are 2000 characters')
  for (const bad of ['', '   ', '\n\t', 42, null, undefined, {}, ['x'], true, 'x'.repeat(2001), 'a\u0000b', 'a\u001bb', 'a\u007fb']) {
    assert.ok(gc.validateMessage(bad).error, JSON.stringify(bad)?.slice(0, 30))
  }
})

test('start validation: name, email, locale, legacy thread id', () => {
  const ok = gc.validateStart({ name: ' Ana ', email: ' ana@example.com ', locale: 'pt-BR' })
  assert.deepEqual(ok.value, { name: 'Ana', email: 'ana@example.com', locale: 'pt-BR', legacyThreadId: null })
  assert.equal(gc.validateStart({ name: 'A', email: 'a@b.co', locale: 'xx' }).value.locale, 'en')
  assert.equal(gc.validateStart({ name: 'A', email: 'a@b.co', legacyThreadId: '11111111-1111-4111-8111-111111111111' }).value.legacyThreadId, '11111111-1111-4111-8111-111111111111')
  for (const bad of [{}, { name: 'A' }, { email: 'a@b.co' }, { name: '', email: 'a@b.co' }, { name: 'A', email: 'nope' },
    { name: 'A', email: 'a@b' }, { name: 'A', email: `${'a'.repeat(250)}@b.co` }, { name: 'n'.repeat(101), email: 'a@b.co' },
    { name: '<b>', email: 'a@b.co' }, { name: 'A\u0000', email: 'a@b.co' }, { name: 1, email: 'a@b.co' },
    { name: 'A', email: 'a@b.co', legacyThreadId: 'x' }, { name: 'A', email: 'a@b.co', legacyThreadId: 5 }]) {
    assert.ok(gc.validateStart(bad).error, JSON.stringify(bad).slice(0, 60))
  }
})

test('ownership token: 256-bit random, only its SHA-256 is stored, cookie is HttpOnly and scoped', () => {
  const a = gc.newGuestToken(), b = gc.newGuestToken()
  assert.notEqual(a.token, b.token)
  assert.match(a.token, /^[A-Za-z0-9_-]{43}$/)
  assert.equal(Buffer.from(a.token, 'base64url').length, 32)
  assert.equal(a.hash, createHash('sha256').update(a.token).digest('hex'))
  const id = '11111111-1111-4111-8111-111111111111'
  const c = gc.guestCookie(id, a.token)
  assert.match(c, /^vestora_guest_chat=11111111-1111-4111-8111-111111111111\.[A-Za-z0-9_-]{43}; Path=\/api\/guest-chat; Max-Age=15552000; HttpOnly; SameSite=Lax/)
  const env = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'
  try {
    assert.match(gc.guestCookie(id, a.token), /; Secure$/)
    assert.match(gc.clearGuestCookie(), /^vestora_guest_chat=; Path=\/api\/guest-chat; Max-Age=0; HttpOnly; SameSite=Lax; Secure$/)
  } finally { process.env.NODE_ENV = env }
})

test('cookie parsing: exact name, well-formed thread ID and secret only', () => {
  const tok = 'A'.repeat(43)
  const id = '11111111-1111-4111-8111-111111111111'
  assert.deepEqual(gc.parseGuestCookie(req({ cookie: `other=1; vestora_guest_chat=${id}.${tok}; x=y` })), { threadId: id, token: tok })
  assert.deepEqual(gc.parseGuestCookie(req({ cookie: `vestora_guest_chat=${id.toUpperCase()}.${tok}` })).threadId, id)
  for (const bad of [undefined, '', 'vestora_guest_chat=', `vestora_guest_chat=${id}`, `vestora_guest_chat=${id}.short`,
    `vestora_guest_chat=${id}.${tok}.extra`, `vestora_guest_chat=not-a-uuid.${tok}`, `xvestora_guest_chat=${id}.${tok}`,
    `vestora_guest_chat=${id}.${'A'.repeat(42)}+`]) {
    assert.equal(gc.parseGuestCookie(req(bad === undefined ? {} : { cookie: bad })), null, String(bad))
  }
})

test('visitor address for rate limits: Vercel header first; IPv6 grouped by /64', () => {
  assert.equal(gc.clientAddress(req({ 'x-vercel-forwarded-for': '203.0.113.5', 'x-forwarded-for': '10.0.0.1' })), '203.0.113.5')
  assert.equal(gc.clientAddress(req({ 'x-real-ip': '203.0.113.6', 'x-forwarded-for': '10.0.0.1' })), '203.0.113.6')
  assert.equal(gc.clientAddress(req({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' })), '203.0.113.7')
  assert.equal(gc.clientAddress(req({})), 'unknown')
  const a = gc.clientAddress(req({ 'x-vercel-forwarded-for': '2001:db8:1:2::1' }))
  assert.equal(a, '2001:db8:1:2::/64')
  assert.equal(gc.clientAddress(req({ 'x-vercel-forwarded-for': '2001:DB8:1:2:ffff:eeee:dddd:cccc' })), a)
  assert.equal(gc.clientAddress(req({ 'x-vercel-forwarded-for': '2001:db8::5' })), '2001:db8:0:0::/64')
  assert.notEqual(gc.clientAddress(req({ 'x-vercel-forwarded-for': '2001:db8:1:3::1' })), a)
})

test('request body: same-site JSON object, at most 8 KB', async () => {
  const good = { 'content-type': 'application/json', origin: 'https://vestoras.vercel.app', host: 'vestoras.vercel.app' }
  assert.deepEqual((await gc.readJsonObject(req(good, '{"body":"hi"}'))).body, { body: 'hi' })
  for (const [h, text, status] of [
    [good, '{bad', 400], [good, '"str"', 400], [good, 'null', 400], [good, '[1]', 400],
    [good, JSON.stringify({ body: 'x'.repeat(9000) }), 413],
    [{ ...good, 'content-length': '100000' }, '{}', 413],
    [{ ...good, 'content-type': 'text/plain' }, '{}', 415],
    [{ ...good, origin: 'https://evil.example' }, '{}', 403],
    [{ ...good, 'sec-fetch-site': 'cross-site' }, '{}', 403],
  ]) {
    const r = await gc.readJsonObject(req(h, text))
    assert.equal(r.error?.status, status, `${JSON.stringify(h).slice(0, 40)} ${text.slice(0, 20)}`)
  }
})

test('routes: sender other than guest is refused before anything else; a refused limit returns 429 with no details', async () => {
  const calls = []
  globalThis.__t = {
    service: {
      rpc: async (name, args) => { calls.push([name, args]); return { data: false, error: null } },
      from: () => { throw new Error('must not query when rate limited') },
    },
  }
  const h = { 'content-type': 'application/json', origin: 'https://vestoras.vercel.app', host: 'vestoras.vercel.app', 'x-vercel-forwarded-for': '203.0.113.9' }
  const asAdmin = await send(req(h, JSON.stringify({ body: 'hi', sender: 'admin' })))
  assert.equal(asAdmin.status, 403)
  assert.equal(calls.length, 0)
  const limited = await send(req(h, JSON.stringify({ body: 'hi' })))
  assert.equal(limited.status, 429)
  assert.equal(limited.headers.get('retry-after'), '60')
  assert.equal((await limited.json()).code, 'RATE_LIMITED')
  assert.equal(calls[0][0], 'guest_chat_rate_limit_hit')
  assert.match(calls[0][1].p_bucket, /^send:ip:m:[0-9a-f]{40}$/, 'bucket is a hash: no IP address stored')
  assert.ok(!calls[0][1].p_bucket.includes('203.0.113.9'))
  const s = await start(req(h, JSON.stringify({ name: 'A', email: 'a@b.co' })))
  assert.equal(s.status, 429)
  // Limiter unavailable: fail closed, and the error text is not passed on.
  globalThis.__t.service.rpc = async () => ({ data: null, error: { message: 'permission denied for function guest_chat_rate_limit_hit' } })
  const errors = console.error
  console.error = () => {}
  try {
    const closed = await start(req(h, JSON.stringify({ name: 'A', email: 'a@b.co' })))
    assert.equal(closed.status, 429)
    assert.ok(!JSON.stringify(await closed.json()).includes('permission'))
  } finally { console.error = errors }
})
