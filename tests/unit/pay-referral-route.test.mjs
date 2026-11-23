// Route-level tests for app/api/admin/pay-referral/route.js (pay_referral).
//
// The real route file is loaded with its imports pointed at in-memory
// stand-ins: an admin session client whose rpc('pay_referral') reproduces
// the database function's contract (admin check, "Already paid" after the
// first payment, all-or-nothing), and NextResponse. No database or network.
// The database behaviour itself is covered by tests/db/suites/pay_referral.sql.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const dir = mkdtempSync(join(tmpdir(), 'vestora-pay-referral-'))
const stub = (name, body) => {
  const file = join(dir, name)
  writeFileSync(file, body)
  return pathToFileURL(file).href
}
const stubs = {
  '@/lib/supabase/server': stub('server.mjs', 'export async function createClient() { return globalThis.__refTest.auth }\n'),
  // The real ID parser (a pure function), copied so it loads as an ES module.
  '@/lib/referral-id': stub('referral-id.mjs', readFileSync(join(root, 'lib', 'referral-id.js'), 'utf8')),
  // The real payout kill switch (a pure function), copied the same way.
  '@/lib/referral-payouts': stub('referral-payouts.mjs', readFileSync(join(root, 'lib', 'referral-payouts.js'), 'utf8')),
  // The real same-origin check (a pure function), copied the same way.
  '@/lib/request-origin': stub('request-origin.mjs', readFileSync(join(root, 'lib', 'request-origin.js'), 'utf8')),
  // Email sending is scheduled with after(); recorded here, never run.
  '@/lib/notification-sender': stub('sender.mjs', 'export async function sendPendingReferralNotifications() { globalThis.__refTest.sends++ }\n'),
  'next/server': stub('next.mjs', [
    'export const NextResponse = { json: (body, init = {}) => ({ status: init.status ?? 200, body }) }',
    'export function after(fn) { globalThis.__refTest.after.push(fn) }',
  ].join('\n') + '\n'),
}
// PAY_REFERRAL_ROUTE lets a reviewer run these tests against another version of the route.
const original = readFileSync(process.env.PAY_REFERRAL_ROUTE || join(root, 'app', 'api', 'admin', 'pay-referral', 'route.js'), 'utf8')
let source = original
for (const [spec, url] of Object.entries(stubs)) {
  const n = source.split(`from '${spec}'`).length - 1
  assert.equal(n, 1, `route imports ${spec} exactly once`)
  source = source.replace(`from '${spec}'`, `from '${url}'`)
}
assert.equal((source.match(/^import /gm) || []).length, 6, 'route has no other imports')
const { POST, GET } = await import(stub('route.mjs', source))

// Never inherit the kill switch from the shell running the tests.
delete process.env.REFERRAL_PAYOUTS_ENABLED

// payouts: the REFERRAL_PAYOUTS_ENABLED value for this test (null = not set).
// dbSwitch: the database switch (20261126000000), as pay_referral sees it.
// The older tests below are about the payment itself, so they switch both on.
function world({ user = { id: 'admin-1' }, role = 'admin', rpcError = null, referral = { id: '42', status: 'pending' }, payouts = 'true', dbSwitch = true } = {}) {
  if (payouts === null) delete process.env.REFERRAL_PAYOUTS_ENABLED
  else process.env.REFERRAL_PAYOUTS_ENABLED = payouts
  const s = { calls: [], payments: 0, referral, rpcError, after: [], sends: 0, bodyRead: 0, dbSwitch, tables: [] }
  s.auth = {
    auth: { getUser: async () => ({ data: { user } }) },
    from: (table) => {
      s.tables.push(table)
      if (table === 'referral_payout_controls') {
        // RLS: admins only; others see no row.
        return { select: () => ({ maybeSingle: async () => ({ data: role === 'admin' ? { payouts_enabled: s.dbSwitch, updated_at: '2026-11-23T00:00:00Z' } : null, error: null }) }) }
      }
      assert.equal(table, 'profiles')
      return { select: () => ({ eq: () => ({ single: async () => ({ data: user ? { role } : null }) }) }) }
    },
    rpc: async (name, params) => {
      s.calls.push([name, params])
      if (s.rpcError) return { data: null, error: s.rpcError }
      // Same order as pay_referral: admin check, then the database switch.
      if (role !== 'admin') return { data: null, error: { message: 'Only admins can pay referrals' } }
      if (!s.dbSwitch) return { data: null, error: { message: 'Referral payouts are disabled', code: 'P0001' } }
      if (params.p_referral_id !== s.referral.id) return { data: null, error: { message: 'Referral not found' } }
      if (s.referral.status === 'paid') return { data: null, error: { message: 'Already paid' } }
      s.referral.status = 'paid'
      s.payments++
      return { data: { referralId: Number(s.referral.id), status: 'paid', credits: [] }, error: null }
    },
  }
  globalThis.__refTest = s
  return s
}
// A same-origin JSON request, exactly as the admin page's fetch sends it.
const APP = 'https://vestoras.vercel.app'
const SAME_ORIGIN = { 'content-type': 'application/json', origin: APP, 'sec-fetch-site': 'same-origin', host: 'vestoras.vercel.app' }
const request = (json, headers = SAME_ORIGIN) => ({ url: `${APP}/api/admin/pay-referral`, headers: new Headers(headers), json })
const pay = (referralId, headers) => POST(request(async () => { globalThis.__refTest.bodyRead++; return { referralId } }, headers))

// What a refused payment must look like: 503, a clear code and message, the
// request body never read, no database call, nothing paid, no email scheduled.
function assertPayoutsDisabled(res, s, label) {
  assert.equal(res.status, 503, label)
  assert.equal(res.body.code, 'REFERRAL_PAYOUTS_DISABLED', label)
  assert.match(res.body.error, /Referral payouts are currently disabled/, label)
  assert.equal(res.body.success, undefined, label)
  assert.equal(s.bodyRead, 0, `${label}: request body not read`)
  assert.deepEqual(s.calls, [], `${label}: database not called`)
  assert.equal(s.payments, 0, `${label}: nothing paid`)
  assert.equal(s.referral.status, 'pending', `${label}: referral still pending`)
  assert.equal(s.after.length, 0, `${label}: no email scheduled`)
}

// ── Kill switch ──────────────────────────────────────────────────────────

test('kill switch: payouts are refused by default when REFERRAL_PAYOUTS_ENABLED is not set', async () => {
  const s = world({ payouts: null })
  assert.equal(process.env.REFERRAL_PAYOUTS_ENABLED, undefined)
  assertPayoutsDisabled(await pay(42), s, 'unset')
})

test('kill switch: any value other than exactly "true" fails closed', async () => {
  for (const value of ['', ' ', 'false', '0', '1', 'TRUE', 'True', 'yes', 'on', 'enabled', ' true', 'true ', 'true\n', '"true"']) {
    const s = world({ payouts: value })
    assertPayoutsDisabled(await pay(42), s, `REFERRAL_PAYOUTS_ENABLED=${JSON.stringify(value)}`)
  }
})

test('kill switch: a direct API request from a real admin is refused while disabled', async () => {
  // This is the exact request the Pay button sends, made without the admin
  // page. It is still refused, because the check is in the route, not the UI.
  const s = world({ payouts: null })
  assertPayoutsDisabled(await pay('42'), s, 'direct request')
  // Repeating the request, or sending a malformed body, changes nothing.
  assertPayoutsDisabled(await pay(42), s, 'repeated direct request')
  const bad = await POST(request(async () => { s.bodyRead++; throw new SyntaxError('bad json') }))
  assertPayoutsDisabled(bad, s, 'malformed body while disabled')
})

test('kill switch: an explicitly enabled switch lets an admin pay through pay_referral', async () => {
  const s = world({ payouts: 'true' })
  const res = await pay(42)
  assert.equal(res.status, 200)
  assert.equal(res.body.success, true)
  assert.deepEqual(s.calls, [['pay_referral', { p_referral_id: '42' }]])
  assert.equal(s.payments, 1)
  assert.equal(s.after.length, 1)
})

test('kill switch: read on every request, so turning it off takes effect without reloading the module', async () => {
  const s = world({ payouts: 'true' })
  s.referral = { id: '43', status: 'pending' }
  delete process.env.REFERRAL_PAYOUTS_ENABLED
  assertPayoutsDisabled(await pay(43), s, 'switched off after the module loaded')
})

test('kill switch: unauthorised users get 401/403 whether payouts are on or off', async () => {
  for (const payouts of [null, 'true']) {
    const anon = world({ user: null, payouts })
    const a = await pay(42)
    assert.equal(a.status, 401, `signed out, payouts=${payouts}`)
    assert.equal(a.body.code, undefined, 'switch state not revealed to signed-out users')
    assert.deepEqual(anon.calls, [])

    const customer = world({ role: 'user', payouts })
    const c = await pay(42)
    assert.equal(c.status, 403, `non-admin, payouts=${payouts}`)
    assert.equal(c.body.code, undefined, 'switch state not revealed to non-admins')
    assert.deepEqual(customer.calls, [])
    assert.equal(customer.payments, 0)
  }
})

test('kill switch: the check runs after the admin check, before the body is read and before the database call', () => {
  const code = original.replace(/^\s*\/\/.*$/gm, '')
  const admin = code.indexOf("profile?.role !== 'admin'")
  const gate = code.indexOf('if (!referralPayoutsEnabled())')
  const bodyRead = code.indexOf('request.json()')
  const rpc = code.indexOf(".rpc('pay_referral'")
  assert.ok(admin > 0 && gate > admin, 'gate comes after the admin check')
  assert.ok(bodyRead > gate && rpc > gate, 'gate comes before the body is read and before pay_referral')
})

// ── Database payout freeze (20261126000000) ───────────────────────────────

test('database freeze: app switch on but the database switch off -> the same 503, nothing paid', async () => {
  const s = world({ payouts: 'true', dbSwitch: false })
  const res = await pay(42)
  assert.equal(res.status, 503)
  assert.equal(res.body.code, 'REFERRAL_PAYOUTS_DISABLED')
  assert.match(res.body.error, /Referral payouts are currently disabled/)
  assert.deepEqual(s.calls, [['pay_referral', { p_referral_id: '42' }]], 'the database made the decision')
  assert.equal(s.payments, 0)
  assert.equal(s.after.length, 0, 'no email scheduled')
})

test('database freeze: a customer still gets 403 and never learns the switch state', async () => {
  for (const dbSwitch of [true, false]) {
    const s = world({ role: 'user', dbSwitch })
    const res = await pay(42)
    assert.equal(res.status, 403)
    assert.equal(res.body.code, undefined)
    assert.deepEqual(s.calls, [])
  }
})

test('payout status (GET): admins see both switches; payments need both', async () => {
  const cases = [
    [{ payouts: 'true', dbSwitch: true }, { enabled: true, application: true, database: true }],
    [{ payouts: 'true', dbSwitch: false }, { enabled: false, application: true, database: false }],
    [{ payouts: null, dbSwitch: true }, { enabled: false, application: false, database: true }],
    [{ payouts: null, dbSwitch: false }, { enabled: false, application: false, database: false }],
  ]
  for (const [opts, expected] of cases) {
    const s = world(opts)
    const res = await GET()
    assert.equal(res.status, 200)
    assert.deepEqual({ enabled: res.body.enabled, application: res.body.application, database: res.body.database }, expected, JSON.stringify(opts))
    assert.deepEqual(s.calls, [], 'GET never calls pay_referral')
  }
  world({ user: null })
  assert.equal((await GET()).status, 401)
  const c = world({ role: 'user' })
  assert.equal((await GET()).status, 403)
  assert.ok(!c.tables.includes('referral_payout_controls'), 'non-admins never reach the switch')
})

// ── Cross-site request protection ─────────────────────────────────────────

test('cross-site: requests not proven same-origin JSON are refused before the session is even read', async () => {
  const cases = [
    ['form post (text/plain)', { ...SAME_ORIGIN, 'content-type': 'text/plain' }, 415],
    ['url-encoded form', { ...SAME_ORIGIN, 'content-type': 'application/x-www-form-urlencoded' }, 415],
    ['no content type', { origin: APP, 'sec-fetch-site': 'same-origin' }, 415],
    ['other site (Sec-Fetch-Site cross-site)', { ...SAME_ORIGIN, 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' }, 403],
    ['sibling site (Sec-Fetch-Site same-site)', { ...SAME_ORIGIN, 'sec-fetch-site': 'same-site' }, 403],
    ['foreign Origin header', { 'content-type': 'application/json', origin: 'https://evil.example', host: 'vestoras.vercel.app' }, 403],
    ['lookalike Origin', { 'content-type': 'application/json', origin: 'https://vestoras.vercel.app.evil.example', host: 'vestoras.vercel.app' }, 403],
  ]
  for (const [label, headers, status] of cases) {
    const s = world()
    let sessionRead = false
    s.auth.auth.getUser = async () => { sessionRead = true; return { data: { user: { id: 'admin-1' } } } }
    const res = await pay(42, headers)
    assert.equal(res.status, status, label)
    assert.equal(sessionRead, false, `${label}: session not read`)
    assert.deepEqual(s.calls, [], `${label}: database not called`)
    assert.equal(s.payments, 0, label)
  }
})

test('cross-site: same-origin requests (and header-less non-browser clients) proceed to the normal checks', async () => {
  let s = world()
  assert.equal((await pay(42)).status, 200, 'admin page fetch')
  s = world()
  assert.equal((await pay(42, { 'content-type': 'application/json; charset=utf-8', origin: APP, host: 'vestoras.vercel.app' })).status, 200, 'Origin only')
  s = world()
  assert.equal((await pay(42, { 'content-type': 'application/json' })).status, 200, 'no Origin/Sec-Fetch-Site (non-browser; still needs an admin session)')
  s = world({ user: null })
  assert.equal((await pay(42, { 'content-type': 'application/json' })).status, 401, 'non-browser without a session: 401')
  assert.deepEqual(s.calls, [])
})

// ── Payment behaviour (switch explicitly on) ──────────────────────────────

test('the route uses neither the service role nor the old two-call process', () => {
  const code = original.replace(/^\s*\/\/.*$/gm, '')
  assert.doesNotMatch(code, /SUPABASE_SERVICE_ROLE_KEY|service_role|@supabase\/supabase-js/)
  assert.doesNotMatch(code, /adjust_wallet_with_transaction|logAdminAction|from\('referrals'\)/)
  assert.equal((code.match(/\.rpc\(/g) || []).length, 1, 'exactly one database call')
})

test('pays through exactly one pay_referral call with the admin session', async () => {
  const s = world()
  const res = await pay(42)
  assert.equal(res.status, 200)
  assert.equal(res.body.success, true)
  assert.equal(res.body.referral.status, 'paid')
  assert.deepEqual(s.calls, [['pay_referral', { p_referral_id: '42' }]])
})

test('payment emails are scheduled only after a successful payment, and cannot affect it', async () => {
  const s = world()
  const res = await pay(42)
  assert.equal(res.status, 200)
  assert.equal(s.after.length, 1, 'one email run scheduled with after()')
  assert.equal(s.sends, 0, 'not run before the response')
  await s.after[0]()
  assert.equal(s.sends, 1)
  assert.equal(s.payments, 1, 'sending emails pays nothing')

  const refused = world({ rpcError: { message: 'Already paid' } })
  assert.equal((await pay(42)).status, 400)
  assert.equal(refused.after.length, 0, 'no emails after a refused payment')
})

test('a repeated request is refused as already paid and pays nothing more', async () => {
  const s = world()
  assert.equal((await pay(42)).status, 200)
  const again = await pay(42)
  assert.equal(again.status, 400)
  assert.equal(again.body.error, 'Already paid')
  assert.equal(s.payments, 1)
})

test('not signed in: 401, database not called', async () => {
  const s = world({ user: null })
  const res = await pay(42)
  assert.equal(res.status, 401)
  assert.equal(s.calls.length, 0)
})

test('signed-in non-admin: 403, database not called', async () => {
  const s = world({ role: 'user' })
  const res = await pay(42)
  assert.equal(res.status, 403)
  assert.equal(s.calls.length, 0)
})

test('invalid referral IDs are rejected before the database', async () => {
  for (const id of [undefined, null, 0, -1, 1.5, 2 ** 53, '0', '-1', '12abc', '1e3', '', ' ', '9223372036854775808', {}, [42], true]) {
    const s = world()
    const res = await pay(id)
    assert.equal(res.status, 400, `id ${JSON.stringify(id)}`)
    assert.equal(s.calls.length, 0, `id ${JSON.stringify(id)}`)
  }
})

test('BIGINT IDs are passed as exact decimal strings', async () => {
  const s = world({ referral: { id: '9223372036854775807', status: 'pending' } })
  const res = await pay('9223372036854775807')
  assert.equal(res.status, 200)
  assert.deepEqual(s.calls, [['pay_referral', { p_referral_id: '9223372036854775807' }]])
  const t = world()
  assert.equal((await pay(' 42 ')).status, 200)
  assert.deepEqual(t.calls, [['pay_referral', { p_referral_id: '42' }]])
})

test('malformed JSON body: 400, database not called', async () => {
  const s = world()
  const res = await POST(request(async () => { throw new SyntaxError('bad json') }))
  assert.equal(res.status, 400)
  assert.equal(s.calls.length, 0)
})

test('database refusals map to clear statuses with the database message', async () => {
  const cases = [
    ['Referral not found', 404],
    ['Wallet not found for this user', 404],
    ['Only admins can pay referrals', 403],
    ['Self-referrals cannot be paid', 409],
    ['Existing referrer credit x for referral 42 does not match; manual review required', 409],
    ['Referral 42 has invalid bonus amounts; manual review required', 409],
    ['Concurrent referral credit detected for referral 42; retry', 409],
  ]
  for (const [message, status] of cases) {
    world({ rpcError: { message } })
    const res = await pay(42)
    assert.equal(res.status, status, message)
    assert.equal(res.body.error, message)
  }
})

test('unexpected database errors are reported generically, not echoed', async () => {
  world({ rpcError: { message: 'relation "x" does not exist', code: '42P01' } })
  const res = await pay(42)
  assert.equal(res.status, 500)
  assert.doesNotMatch(res.body.error, /relation/)
})
