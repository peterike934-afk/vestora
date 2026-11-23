// Regression tests for app/api/admin/top-investors/route.js: the route used
// to return customer names, emails and deposit totals to anyone, without a
// session. Self-contained: the real route file is loaded with its two
// Supabase imports pointed at in-memory stand-ins (no database, no network).
//
//   node --test tests/unit/top-investors-route.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const dir = mkdtempSync(join(tmpdir(), 'vestora-top-investors-'))
const stub = (name, body) => {
  const file = join(dir, name)
  writeFileSync(file, body)
  return pathToFileURL(file).href
}
const stubs = {
  '@/lib/supabase/server': stub('server.mjs', 'export async function createClient() { return globalThis.__t.auth }\n'),
  '@/lib/supabase/admin': stub('admin.mjs', 'export function createAdminClient() { return globalThis.__t.service }\n'),
}
let source = readFileSync(join(root, 'app', 'api', 'admin', 'top-investors', 'route.js'), 'utf8')
for (const [spec, url] of Object.entries(stubs)) {
  assert.equal(source.split(`from '${spec}'`).length - 1, 1, `route imports ${spec} exactly once`)
  source = source.replace(`from '${spec}'`, `from '${url}'`)
}
assert.equal((source.match(/^import /gm) || []).length, 2, 'route has no other imports')
const { GET } = await import(stub('route.mjs', source))

const ADMIN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const CUSTOMER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const ROWS = [
  { user_id: 'u1', amount_usd: '100.50', profiles: { full_name: 'Ana One', email: 'ana@example.test' } },
  { user_id: 'u2', amount_usd: 300, profiles: { full_name: 'Ben Two', email: 'ben@example.test' } },
  { user_id: 'u1', amount_usd: 250, profiles: { full_name: 'Ana One', email: 'ana@example.test' } },
]

// user: the session's user (null = signed out); role: that user's profile role.
function world({ user = { id: ADMIN }, role = 'admin', rows = ROWS, queryError = null, getUserError = false } = {}) {
  const t = { serviceUsed: false, filters: [] }
  t.auth = {
    auth: { getUser: async () => (getUserError ? { data: { user: null }, error: { message: 'JWT expired' } } : { data: { user } }) },
    from: (table) => {
      assert.equal(table, 'profiles', 'the session client only reads the caller\'s own role')
      const q = { select: () => q, eq: () => q, single: async () => ({ data: user && role ? { role } : null, error: null }) }
      return q
    },
  }
  // Records any use of the service-role client; it must stay untouched for non-admins.
  const query = {
    select: (cols) => { t.filters.push(['select', cols]); return query },
    eq: (c, v) => { t.filters.push(['eq', c, v]); return query },
    in: (c, v) => { t.filters.push(['in', c, v]); return query },
    gte: (c, v) => { t.filters.push(['gte', c, v]); return query },
    then: (resolve) => resolve(queryError ? { data: null, error: queryError } : { data: rows, error: null }),
  }
  t.service = new Proxy({}, { get: (_, prop) => { t.serviceUsed = true; return prop === 'from' ? (table) => { t.filters.push(['from', table]); return query } : undefined } })
  globalThis.__t = t
  return t
}

const PERSONAL = /ana@example|ben@example|Ana One|Ben Two|350\.5|300/

test('signed out: 401, no customer data, the service-role client is never used', async () => {
  for (const opts of [{ user: null }, { getUserError: true }]) {
    const t = world(opts)
    const res = await GET()
    assert.equal(res.status, 401)
    assert.doesNotMatch(await res.text(), PERSONAL)
    assert.equal(t.serviceUsed, false)
    assert.equal(res.headers.get('cache-control'), 'no-store')
  }
})

test('signed-in customer (non-admin): 403, no customer data, service role never used', async () => {
  for (const role of ['user', 'support', '', null, 'Admin', 'ADMIN']) {
    const t = world({ user: { id: CUSTOMER }, role })
    const res = await GET()
    assert.equal(res.status, 403, `role ${JSON.stringify(role)}`)
    assert.doesNotMatch(await res.text(), PERSONAL)
    assert.equal(t.serviceUsed, false)
  }
})

test('admin: ranked monthly totals with the same fields the dashboard shows', async () => {
  const t = world()
  const res = await GET()
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('cache-control'), 'no-store')
  assert.deepEqual(await res.json(), { investors: [
    { userId: 'u1', fullName: 'Ana One', email: 'ana@example.test', total: 350.5 },
    { userId: 'u2', fullName: 'Ben Two', email: 'ben@example.test', total: 300 },
  ] })
  // Same query as before: this month's verified deposits and admin credits only.
  assert.deepEqual(t.filters.slice(0, 5).map((f) => (f[0] === 'gte' ? f.slice(0, 2) : f)), [
    ['from', 'transactions'],
    ['select', 'user_id, amount_usd, profiles!transactions_user_id_fkey(full_name, email)'],
    ['eq', 'status', 'verified'],
    ['in', 'type', ['deposit', 'admin_credit']],
    ['gte', 'created_at'],
  ])
  assert.equal(new Date(t.filters[4][2]).getDate(), 1, 'from the first of the month')
})

test('admin with no deposits this month: empty list', async () => {
  world({ rows: [] })
  const res = await GET()
  assert.deepEqual([res.status, await res.json()], [200, { investors: [] }])
})

test('database error: generic 500, the database message is not echoed', async () => {
  world({ queryError: { message: 'relation "transactions" does not exist', code: '42P01' } })
  const res = await GET()
  assert.equal(res.status, 500)
  assert.doesNotMatch(await res.text(), /relation|transactions/)
})
