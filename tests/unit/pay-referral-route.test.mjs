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
  'next/server': stub('next.mjs', 'export const NextResponse = { json: (body, init = {}) => ({ status: init.status ?? 200, body }) }\n'),
}
// PAY_REFERRAL_ROUTE lets a reviewer run these tests against another version of the route.
const original = readFileSync(process.env.PAY_REFERRAL_ROUTE || join(root, 'app', 'api', 'admin', 'pay-referral', 'route.js'), 'utf8')
let source = original
for (const [spec, url] of Object.entries(stubs)) {
  const n = source.split(`from '${spec}'`).length - 1
  assert.equal(n, 1, `route imports ${spec} exactly once`)
  source = source.replace(`from '${spec}'`, `from '${url}'`)
}
assert.equal((source.match(/^import /gm) || []).length, 2, 'route has no other imports')
const { POST } = await import(stub('route.mjs', source))

function world({ user = { id: 'admin-1' }, role = 'admin', rpcError = null, referral = { id: '42', status: 'pending' } } = {}) {
  const s = { calls: [], payments: 0, referral, rpcError }
  s.auth = {
    auth: { getUser: async () => ({ data: { user } }) },
    from: (table) => {
      assert.equal(table, 'profiles')
      return { select: () => ({ eq: () => ({ single: async () => ({ data: user ? { role } : null }) }) }) }
    },
    rpc: async (name, params) => {
      s.calls.push([name, params])
      if (s.rpcError) return { data: null, error: s.rpcError }
      if (role !== 'admin') return { data: null, error: { message: 'Only admins can pay referrals' } }
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
const pay = (referralId) => POST({ json: async () => ({ referralId }) })

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
  const res = await POST({ json: async () => { throw new SyntaxError('bad json') } })
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
