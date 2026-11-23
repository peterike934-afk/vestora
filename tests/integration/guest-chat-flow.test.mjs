// Support chat security, end to end, against a disposable PostgreSQL 17
// database with every real migration applied (including 20261128000000)
// and the Production chat tables (tests/db/production_chat_baseline.sql).
// Uses the REAL /api/guest-chat route files and the REAL admin/customer
// chat functions in lib/queries.js. Each Supabase client is replaced by a
// stand-in that runs the same queries in the database as the role the real
// client would use: the service role (server routes), anon (a visitor with
// the public key), or authenticated with a user ID (customer or admin
// session), so row-level security and grants are the real ones.
//
//   npm run test:integration      (requires Docker; never touches Supabase)
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync, mkdtempSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const dbDir = join(root, 'tests', 'db')
const container = `vestora-guest-chat-${process.pid}`
const DB = 'chat'
const APP = 'https://vestoras.vercel.app'

// The browser Supabase client used by lib/queries.js becomes the signed-in
// test user's session.
const stubDir = mkdtempSync(join(tmpdir(), 'vestora-chat-'))
writeFileSync(join(stubDir, 'browser.mjs'), 'export function createClient() { return globalThis.__t.browser }\n')
process.env.VESTORA_TEST_MODULE_OVERRIDES = JSON.stringify({ '@/lib/supabase/client': pathToFileURL(join(stubDir, 'browser.mjs')).href })
register('../helpers/alias-hooks.mjs', import.meta.url)

const realFetch = globalThis.fetch
globalThis.fetch = async (url) => { throw new Error(`unexpected network access in test: ${url}`) }

// ── Disposable database ───────────────────────────────────────────────────
function psqlRaw(sql) {
  const res = spawnSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', DB, '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-f', '-'], { input: sql, encoding: 'utf8' })
  return { ok: res.status === 0, out: (res.stdout || '').trim(), err: res.stderr || '' }
}
function sqlAdmin(sql) { const r = psqlRaw(sql); if (!r.ok) throw new Error(r.err); return r.out }
const lit = (v) => (v === null || v === undefined ? 'null'
  : typeof v === 'number' || typeof v === 'boolean' ? String(v)
  : typeof v === 'object' ? `${lit(JSON.stringify(v))}::jsonb`
  : `'${String(v).replace(/'/g, "''")}'`)
const ident = (c) => { if (!/^[a-z_][a-z0-9_]*$/.test(c)) throw new Error(`bad column ${c}`); return c }
const cols = (c) => (c === '*' ? '*' : c.split(',').map((x) => ident(x.trim())).join(', '))

// A Supabase client stand-in: PostgREST-shaped calls executed as `role`.
function client({ role, sub = null }) {
  const run = (query) => {
    const pre = [`set role ${role};`, `set "request.jwt.claim.sub" = '${sub || ''}';`]
    const r = psqlRaw(`${pre.join('\n')}\n${query}`)
    if (!r.ok) { const m = /ERROR:\s+(.*)/.exec(r.err); return { data: null, error: { message: m ? m[1].trim() : r.err.trim() } } }
    return { data: r.out ? JSON.parse(r.out) : null, error: null }
  }
  const from = (table) => {
    const st = { op: 'select', cols: '*', returning: null, filters: [], order: '', values: null }
    const where = () => (st.filters.length ? `where ${st.filters.join(' and ')}` : '')
    const exec = async (mode) => {
      let sql
      if (st.op === 'select') {
        sql = `select coalesce(json_agg(t), '[]'::json) from (select ${cols(st.cols)} from public.${table} ${where()} ${st.order}) t;`
      } else if (st.op === 'insert') {
        const keys = Object.keys(st.values)
        const ret = st.returning ? cols(st.returning) : '1 as ok'
        sql = `with x as (insert into public.${table} (${keys.map(ident).join(', ')}) values (${keys.map((k) => lit(st.values[k])).join(', ')}) returning ${ret})
               select coalesce(json_agg(x), '[]'::json) from x;`
      } else {
        const ret = st.returning ? cols(st.returning) : '1 as ok'
        sql = `with x as (update public.${table} set ${Object.entries(st.values).map(([k, v]) => `${ident(k)} = ${lit(v)}`).join(', ')} ${where()} returning ${ret})
               select coalesce(json_agg(x), '[]'::json) from x;`
      }
      const r = run(sql)
      if (r.error) return r
      if (st.op !== 'select' && !st.returning) return { data: null, error: null }
      if (mode === 'single') return r.data.length === 1 ? { data: r.data[0], error: null } : { data: null, error: { message: r.data.length ? 'multiple rows' : 'no rows' } }
      if (mode === 'maybe') return r.data.length <= 1 ? { data: r.data[0] ?? null, error: null } : { data: null, error: { message: 'multiple rows' } }
      // select(..., { count: 'exact', head: true }): only the row count.
      if (st.count) return { data: st.head ? null : r.data, count: r.data.length, error: null }
      return r
    }
    const b = {
      select: (c = '*', o = {}) => { if (st.op === 'select') { st.cols = c; st.count = Boolean(o.count); st.head = Boolean(o.head) } else st.returning = c; return b },
      insert: (v) => { st.op = 'insert'; st.values = v; return b },
      update: (v) => { st.op = 'update'; st.values = v; return b },
      eq: (c, v) => { st.filters.push(`${ident(c)} = ${lit(v)}`); return b },
      is: (c, v) => { st.filters.push(`${ident(c)} is ${v === null ? 'null' : lit(v)}`); return b },
      order: (c, o = {}) => { st.order = `order by ${ident(c)} ${o.ascending === false ? 'desc' : 'asc'}`; return b },
      single: () => exec('single'),
      maybeSingle: () => exec('maybe'),
      then: (res, rej) => exec('list').then(res, rej),
    }
    return b
  }
  return {
    run,
    from,
    rpc: async (name, args = {}) => run(`select to_json(public.${ident(name)}(${Object.entries(args).map(([k, v]) => `${ident(k)} => ${lit(v)}`).join(', ')}));`),
  }
}
const service = () => client({ role: 'service_role' })
const anonKey = () => client({ role: 'anon' })
const session = (id) => client({ role: 'authenticated', sub: id })

// ── Requests as a browser would send them ─────────────────────────────────
let start, send, messages, unread, endSession
let queries
let admin, cara, dan
const sha256 = (v) => createHash('sha256').update(v).digest('hex')

function request(path, { method = 'GET', body, raw, cookie, ip = '203.0.113.10', headers = {} } = {}) {
  const text = raw !== undefined ? raw : body === undefined ? '' : JSON.stringify(body)
  const h = new Map(Object.entries({
    host: 'vestoras.vercel.app',
    origin: APP,
    'sec-fetch-site': 'same-origin',
    'x-vercel-forwarded-for': ip,
    'x-real-ip': ip,
    'x-forwarded-for': ip,
    ...(method !== 'GET' ? { 'content-type': 'application/json' } : {}),
    ...(cookie ? { cookie } : {}),
    ...headers,
  }).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k.toLowerCase(), String(v)]))
  return {
    url: `${APP}${path}`,
    method,
    headers: { get: (k) => h.get(k.toLowerCase()) ?? null },
    text: async () => text,
  }
}
async function call(handler, path, opts) {
  globalThis.__t = { ...(globalThis.__t || {}), service: service() }
  const res = await handler(request(path, opts))
  const body = await res.json()
  return { status: res.status, body, setCookie: res.headers.get('set-cookie') }
}
// A visitor: own IP and cookie jar, like one browser.
let ipCounter = 20
function visitor(name, email = `${name.toLowerCase()}@example.test`) {
  const v = { name, email, ip: `198.51.100.${ipCounter++}`, cookie: null, threadId: null }
  const keep = (r) => { const m = /^vestora_guest_chat=([^;]*)/.exec(r.setCookie || ''); if (m) v.cookie = m[1] ? `vestora_guest_chat=${m[1]}` : null; return r }
  v.start = async (extra = {}) => { const r = keep(await call(start, '/api/guest-chat/start', { method: 'POST', ip: v.ip, cookie: v.cookie, body: { name: v.name, email: v.email, locale: 'en', ...extra } })); if (r.status === 200) v.threadId = r.body.threadId; return r }
  v.send = (body, extra = {}) => call(send, '/api/guest-chat/send', { method: 'POST', ip: v.ip, cookie: v.cookie, body: { body, ...extra } })
  v.read = (qs = '') => call(messages, `/api/guest-chat/messages${qs}`, { ip: v.ip, cookie: v.cookie })
  v.unread = (qs = '') => call(unread, `/api/guest-chat/unread-count${qs}`, { ip: v.ip, cookie: v.cookie })
  v.forget = async () => keep(await call(endSession, '/api/guest-chat/session', { method: 'DELETE', ip: v.ip, cookie: v.cookie, raw: '' }))
  return v
}
const asBrowser = (id) => { globalThis.__t = { ...(globalThis.__t || {}), browser: session(id) } }
const threadRow = (id) => JSON.parse(sqlAdmin(`select row_to_json(t) from public.guest_threads t where id = '${id}';`))
const bodies = (r) => (r.body.messages || []).map((m) => m.body)
const guestMessageCount = () => Number(sqlAdmin('select count(*) from public.guest_messages;'))

before(async () => {
  try { execFileSync('docker', ['rm', '-f', container], { stdio: 'ignore' }) } catch {}
  execFileSync('docker', ['run', '-d', '--rm', '--name', container, '-e', 'POSTGRES_PASSWORD=localtest', 'postgres:17'], { stdio: 'ignore' })
  let ready = false
  for (let i = 0; i < 120 && !ready; i++) {
    const logs = spawnSync('docker', ['logs', container], { encoding: 'utf8' })
    ready = /PostgreSQL init process complete/.test(`${logs.stdout}${logs.stderr}`) && spawnSync('docker', ['exec', container, 'pg_isready', '-U', 'postgres', '-q']).status === 0
    if (!ready) await new Promise((r) => setTimeout(r, 500))
  }
  if (!ready) throw new Error('database did not start')
  spawnSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-q', '-c', `create database ${DB};`])
  for (const f of ['base_schema.sql', 'production_baseline.sql', 'referral_baseline.sql', 'production_auth_profiles.sql', 'production_chat_baseline.sql', 'supabase_default_privileges.sql']) sqlAdmin(readFileSync(join(dbDir, f), 'utf8'))
  const migrationsDir = join(root, 'supabase', 'migrations')
  for (const m of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) sqlAdmin(readFileSync(join(migrationsDir, m), 'utf8'))
  const person = (role, name) => {
    const id = randomUUID()
    sqlAdmin(`insert into public.profiles (id, role, full_name, email) values ('${id}', '${role}', '${name}', '${name.toLowerCase()}@example.test');`)
    return id
  }
  admin = person('admin', 'Admin')
  cara = person('user', 'Cara')
  dan = person('user', 'Dan')
  ;({ POST: start } = await import('@/app/api/guest-chat/start/route'))
  ;({ POST: send } = await import('@/app/api/guest-chat/send/route'))
  ;({ GET: messages } = await import('@/app/api/guest-chat/messages/route'))
  ;({ GET: unread } = await import('@/app/api/guest-chat/unread-count/route'))
  ;({ DELETE: endSession } = await import('@/app/api/guest-chat/session/route'))
  queries = await import('@/lib/queries')
})
after(() => {
  globalThis.fetch = realFetch
  try { execFileSync('docker', ['rm', '-f', container], { stdio: 'ignore' }) } catch {}
})

const vera = visitor('Vera')
const walt = visitor('Walt')

test('1. an unauthenticated visitor can start a conversation (HttpOnly ownership cookie, only a hash stored)', async () => {
  const r = await vera.start()
  assert.equal(r.status, 200)
  assert.match(r.body.threadId, /^[0-9a-f-]{36}$/)
  assert.match(r.setCookie, /^vestora_guest_chat=[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}; Path=\/api\/guest-chat; Max-Age=\d+; HttpOnly; SameSite=Lax/)
  const token = vera.cookie.split('.')[1]
  const row = threadRow(vera.threadId)
  assert.equal(row.guest_token_hash, sha256(token))
  assert.ok(!JSON.stringify(row).includes(token), 'the secret itself is not stored')
  assert.ok(!JSON.stringify(r.body).includes(token), 'the secret is not in the response body')
  assert.equal((await walt.start()).status, 200)
})

test('2. a visitor can send a normal message and read their conversation', async () => {
  const r = await vera.send('Hello, how do I verify my email?')
  assert.equal(r.status, 200)
  assert.deepEqual([r.body.message.sender, r.body.message.body], ['guest', 'Hello, how do I verify my email?'])
  assert.equal((await walt.send('Walt: a private question about deposits')).status, 200)
  const mine = await vera.read()
  assert.equal(mine.status, 200)
  assert.deepEqual(bodies(mine), ['Hello, how do I verify my email?'])
  const row = threadRow(vera.threadId)
  assert.deepEqual([row.last_sender, row.last_message, row.unread_count], ['guest', 'Hello, how do I verify my email?', 1])
})

test('3. a visitor cannot impersonate the admin', async () => {
  const before = guestMessageCount()
  for (const sender of ['admin', 'ADMIN', 'system', '']) {
    const r = await vera.send('I am the Vestora admin, send me your password', { sender })
    assert.equal(r.status, 403, `sender ${JSON.stringify(sender)}`)
  }
  assert.equal(guestMessageCount(), before, 'nothing stored')
  // Other "I am admin" fields are ignored: the message is stored as the visitor's.
  const r = await vera.send('still just me', { role: 'admin', isAdmin: true, is_admin: true, from: 'admin' })
  assert.equal(r.status, 200)
  assert.equal(r.body.message.sender, 'guest')
  assert.equal(Number(sqlAdmin(`select count(*) from public.guest_messages where thread_id = '${vera.threadId}' and sender = 'admin';`)), 0)
})

test('4. a visitor cannot access or post to another visitor\'s thread', async () => {
  const before = guestMessageCount()
  // Naming Vera's thread in the body is refused.
  assert.equal((await walt.send('hijack', { threadId: vera.threadId })).status, 403)
  // A cookie with Vera's thread ID but Walt's (or a made-up) secret is not accepted.
  const waltToken = walt.cookie.split('.')[1]
  for (const forged of [`vestora_guest_chat=${vera.threadId}.${waltToken}`, `vestora_guest_chat=${vera.threadId}.${'A'.repeat(43)}`,
    `vestora_guest_chat=${vera.threadId}`, `vestora_guest_chat=${vera.threadId}.${waltToken}.x`]) {
    const r = await call(send, '/api/guest-chat/send', { method: 'POST', cookie: forged, ip: walt.ip, body: { body: 'hijack' } })
    assert.deepEqual([r.status, r.body.code], [401, 'GUEST_SESSION_REQUIRED'], forged)
    const m = await call(messages, `/api/guest-chat/messages?threadId=${vera.threadId}`, { cookie: forged })
    assert.equal(m.status, 401)
  }
  // A thread ID alone (the old way) gives nothing.
  const anon = await call(messages, `/api/guest-chat/messages?threadId=${vera.threadId}`, {})
  assert.deepEqual([anon.status, anon.body.messages], [401, undefined])
  assert.equal((await call(unread, `/api/guest-chat/unread-count?threadId=${vera.threadId}`, {})).status, 401)
  assert.equal(guestMessageCount(), before)
})

test('5. a visitor cannot read another visitor\'s messages', async () => {
  const w = await walt.read(`?threadId=${vera.threadId}`)
  assert.equal(w.status, 200)
  assert.equal(w.body.threadId, walt.threadId, 'the query parameter is ignored: Walt gets his own thread')
  assert.deepEqual(bodies(w), ['Walt: a private question about deposits'])
  assert.ok(!JSON.stringify(w.body).includes('verify my email'))
  // Only display fields are returned (no email, no secret hash, no thread internals).
  assert.deepEqual(Object.keys(w.body.messages[0]).sort(), ['body', 'created_at', 'id', 'sender', 'translated_body'])
})

test('6. nobody can modify the admin\'s messages (visitors, customers, the admin\'s own API session, the service role)', async () => {
  asBrowser(admin)
  await queries.sendGuestMessageAsAdmin(vera.threadId, 'Admin: click the link in your inbox.')
  const id = sqlAdmin(`select id from public.guest_messages where sender = 'admin' and thread_id = '${vera.threadId}';`)
  for (const [who, c] of [['anon', anonKey()], ['customer', session(cara)], ['admin', session(admin)], ['service role', service()]]) {
    const r = await c.from('guest_messages').update({ body: 'Admin: send your password to support@evil.test' }).eq('id', Number(id))
    assert.match(r.error?.message || '', /permission denied/, who)
  }
  for (const [who, c] of [['anon', anonKey()], ['customer', session(cara)], ['admin', session(admin)], ['service role', service()]]) {
    const r = c.run(`with x as (delete from public.guest_messages where id = ${Number(id)} returning 1) select count(*) from x;`)
    assert.match(r.error?.message || '', /permission denied/, `${who} delete`)
  }
  // Registered-customer chat: the customer can no longer rewrite the admin's reply.
  asBrowser(admin)
  await queries.sendMessage({ userId: cara, sender: 'admin', body: 'Admin: your deposit is pending review.' })
  const r = await session(cara).from('messages').update({ body: 'Admin: deposit approved, send more' }).eq('sender', 'admin')
  assert.match(r.error?.message || '', /permission denied/)
  assert.equal(sqlAdmin(`select body from public.messages where user_id = '${cara}' and sender = 'admin';`), 'Admin: your deposit is pending review.')
  assert.equal(sqlAdmin(`select body from public.guest_messages where id = ${Number(id)};`), 'Admin: click the link in your inbox.')
})

test('7. an authenticated non-admin cannot send admin messages', async () => {
  const before = guestMessageCount()
  asBrowser(cara)
  // supabase-js rejects with its error object (not an Error instance).
  const rls = (e) => /row-level security/.test(e?.message || '')
  await assert.rejects(queries.sendGuestMessageAsAdmin(walt.threadId, 'Vestora admin here: pay this address'), rls)
  await assert.rejects(queries.sendMessage({ userId: cara, sender: 'admin', body: 'fake admin reply' }), rls)
  await assert.rejects(queries.sendMessage({ userId: dan, sender: 'user', body: 'into Dan\'s thread' }), rls)
  // The visitor routes never look at a customer session, and refuse sender admin.
  globalThis.__t.auth = session(cara)
  assert.equal((await walt.send('as admin', { sender: 'admin' })).status, 403)
  assert.equal(guestMessageCount(), before)
  asBrowser(cara)
  assert.deepEqual(await queries.getGuestThreads(), [], 'a customer sees no visitor threads')
})

test('8. the real admin can see guest conversations and reply; the visitor receives it', async () => {
  asBrowser(admin)
  const threads = await queries.getGuestThreads()
  assert.ok(threads.some((t) => t.id === walt.threadId && t.unread_count === 1))
  assert.deepEqual((await queries.getGuestMessages(walt.threadId)).map((m) => m.body), ['Walt: a private question about deposits'])
  await queries.markGuestThreadRead(walt.threadId)
  assert.equal(threadRow(walt.threadId).unread_count, 0)
  const msg = await queries.sendGuestMessageAsAdmin(walt.threadId, 'Admin: deposits are under Deposit > Bank Transfer.')
  assert.equal(msg.sender, 'admin')
  assert.equal((await walt.unread()).body.unreadCount, 1, 'the visitor\'s badge shows one new reply')
  const w = await walt.read()
  assert.deepEqual(w.body.messages.map((m) => [m.sender, m.body]), [
    ['guest', 'Walt: a private question about deposits'], ['admin', 'Admin: deposits are under Deposit > Bank Transfer.']])
  assert.equal((await walt.unread()).body.unreadCount, 0, 'reading resets the badge')
  // The visitor can continue the conversation.
  assert.equal((await walt.send('Thanks!')).status, 200)
  assert.equal(threadRow(walt.threadId).last_message, 'Thanks!')
})

test('9. rate limiting blocks excessive requests, per visitor and per network', async () => {
  // Stay inside one one-minute window.
  const s = new Date().getUTCSeconds()
  if (s > 45) await new Promise((r) => setTimeout(r, (61 - s) * 1000))
  const spammer = visitor('Spammer')
  assert.equal((await spammer.start()).status, 200)
  const statuses = []
  for (let i = 0; i < 12; i++) statuses.push((await spammer.send(`message ${i}`)).status)
  assert.deepEqual(statuses, [...Array(10).fill(200), 429, 429])
  const blocked = await spammer.send('one more')
  assert.deepEqual([blocked.body.code, blocked.body.error.includes('Too many')], ['RATE_LIMITED', true])
  // Starting conversations: 5 per hour from one address; spoofing
  // X-Forwarded-For does not help (Vercel's own header is used first).
  const ip = '192.0.2.77'
  const startFrom = (n, headers = {}) => call(start, '/api/guest-chat/start', { method: 'POST', ip, headers, body: { name: `Bot ${n}`, email: `bot${n}@example.test` } })
  const starts = []
  for (let i = 0; i < 5; i++) starts.push((await startFrom(i)).status)
  starts.push((await startFrom(5, { 'x-forwarded-for': '10.9.8.7' })).status)
  starts.push((await startFrom(6, { 'x-real-ip': '10.9.8.6', 'x-forwarded-for': '10.9.8.6' })).status)
  assert.deepEqual(starts, [200, 200, 200, 200, 200, 429, 429])
  // IPv6: addresses in the same /64 share one limit.
  const v6 = (suffix, n) => call(start, '/api/guest-chat/start', { method: 'POST', ip: `2001:db8:1:2::${suffix}`, body: { name: `V6 ${n}`, email: `v6${n}@example.test` } })
  const v6s = []
  for (let i = 0; i < 6; i++) v6s.push((await v6((i + 1).toString(16), i)).status)
  assert.deepEqual(v6s, [200, 200, 200, 200, 200, 429])
  // Other visitors are not affected.
  assert.equal((await visitor('Unrelated').start()).status, 200)
})

test('10. invalid, malformed and oversized requests are rejected', async () => {
  const before = guestMessageCount()
  const cases = [
    ['empty', { body: '' }, 400], ['blank', { body: '   \n ' }, 400], ['number', { body: 42 }, 400],
    ['object', { body: { text: 'x' } }, 400], ['array', { body: ['x'] }, 400], ['missing', {}, 400],
    ['null byte', { body: 'hi\u0000there' }, 400], ['control char', { body: 'hi\u0007' }, 400],
    ['2001 characters', { body: 'x'.repeat(2001) }, 400],
  ]
  for (const [label, payload, status] of cases) {
    const r = await call(send, '/api/guest-chat/send', { method: 'POST', cookie: vera.cookie, ip: '198.51.100.200', body: payload })
    assert.equal(r.status, status, label)
  }
  assert.equal((await call(send, '/api/guest-chat/send', { method: 'POST', cookie: vera.cookie, ip: '198.51.100.201', body: { body: 'é'.repeat(2000) } })).status, 200, 'exactly 2000 characters is accepted')
  const bad = [
    ['malformed JSON', { raw: '{"body": "hi"' }, 400],
    ['JSON array body', { raw: '["hi"]' }, 400],
    ['over 8 KB', { raw: JSON.stringify({ body: 'x'.repeat(9000) }) }, 413],
    ['form content type', { raw: 'body=hi', headers: { 'content-type': 'application/x-www-form-urlencoded' } }, 415],
    ['cross-site', { body: { body: 'hi' }, headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' } }, 403],
  ]
  for (const [label, opts, status] of bad) {
    const r = await call(send, '/api/guest-chat/send', { method: 'POST', cookie: vera.cookie, ip: '198.51.100.202', ...opts })
    assert.equal(r.status, status, label)
  }
  // One address per case: a single address may start 5 chats per hour.
  for (const [i, [label, payload]] of [['no email', { name: 'A', email: '' }], ['bad email', { name: 'A', email: 'not-an-email' }],
    ['long name', { name: 'n'.repeat(101), email: 'a@b.test' }], ['html in name', { name: '<script>', email: 'a@b.test' }],
    ['email not text', { name: 'A', email: ['a@b.test'] }], ['bad legacy id', { name: 'A', email: 'a@b.test', legacyThreadId: '1 or 1=1' }]].entries()) {
    const r = await call(start, '/api/guest-chat/start', { method: 'POST', ip: `198.51.100.${210 + i}`, body: payload })
    assert.equal(r.status, 400, label)
  }
  assert.equal(guestMessageCount(), before + 1)
})

test('11. registered customer chat still works', async () => {
  asBrowser(cara)
  const sent = await queries.sendMessage({ userId: cara, sender: 'user', body: 'Cara: when will my deposit clear?' })
  assert.equal(sent.sender, 'user')
  assert.equal(await queries.getUnreadAdminMessageCount(cara), 1)
  await queries.markAdminMessagesRead(cara)
  assert.equal(await queries.getUnreadAdminMessageCount(cara), 0)
  assert.deepEqual((await queries.getMessages(cara)).map((m) => m.sender), ['admin', 'user'])
  assert.deepEqual(await queries.getMessages(dan), [], 'Cara cannot read Dan\'s thread')
  asBrowser(admin)
  assert.equal(await queries.getUnreadUserMessageCount(), 1)
  await queries.markThreadRead(cara)
  assert.equal(await queries.getUnreadUserMessageCount(), 0)
  const reply = await queries.sendMessage({ userId: cara, sender: 'admin', body: 'Admin: within one business day.' })
  assert.equal(reply.sender, 'admin')
})

test('12. direct database access with the public key or a customer session cannot bypass the controls', async () => {
  const a = anonKey()
  for (const [label, r] of [
    ['read threads', await a.from('guest_threads').select('id, email')],
    ['read messages', await a.from('guest_messages').select('*')],
    ['insert admin message', await a.from('guest_messages').insert({ thread_id: vera.threadId, sender: 'admin', body: 'fake' }).select('id').single()],
    ['create thread', await a.from('guest_threads').insert({ name: 'x', email: 'x@x.test' }).select('id').single()],
    ['steal ownership', await a.from('guest_threads').update({ guest_token_hash: '0'.repeat(64) }).eq('id', vera.threadId)],
    ['claim legacy thread', await a.rpc('guest_chat_claim_legacy_thread', { p_thread_id: vera.threadId, p_email: 'vera@example.test', p_token_hash: '0'.repeat(64) })],
    ['reset rate limits', await a.rpc('guest_chat_rate_limit_hit', { p_bucket: 'x', p_limit: 100000, p_window_seconds: 60 })],
    ['read customer messages', await a.from('messages').select('*')],
  ]) assert.match(r.error?.message || '', /permission denied/, label)
  const c = session(cara)
  assert.deepEqual((await c.from('guest_threads').select('id')).data, [], 'customer sees no visitor threads')
  assert.deepEqual((await c.from('guest_messages').select('id')).data, [], 'customer sees no visitor messages')
  assert.match((await c.from('guest_threads').update({ guest_token_hash: '0'.repeat(64) }).eq('id', vera.threadId)).error?.message || '', /permission denied/)
  assert.match((await c.rpc('guest_chat_rate_limit_hit', { p_bucket: 'x', p_limit: 100000, p_window_seconds: 60 })).error?.message || '', /permission denied/)
  assert.equal(threadRow(vera.threadId).guest_token_hash, sha256(vera.cookie.split('.')[1]), 'Vera still owns her thread')
  assert.equal((await vera.read()).status, 200)
})

test('13. a visitor whose chat started before this release can continue it once, with the same email', async () => {
  const legacyId = randomUUID()
  sqlAdmin(`insert into public.guest_threads (id, name, email, last_message, last_sender) values ('${legacyId}', 'Lena', 'Lena@Example.test', 'old', 'guest');
            insert into public.guest_messages (thread_id, sender, body) values ('${legacyId}', 'guest', 'Lena: my old question');`)
  // Someone who only knows the thread ID (wrong email) gets a NEW, empty conversation.
  const mallory = visitor('Mallory')
  const m = await mallory.start({ legacyThreadId: legacyId })
  assert.equal(m.status, 200)
  assert.notEqual(m.body.threadId, legacyId)
  assert.deepEqual(bodies(await mallory.read()), [])
  assert.equal(threadRow(legacyId).guest_token_hash, null)
  // The real visitor (thread ID from her browser + her email) continues her chat.
  const lena = visitor('Lena', ' lena@example.TEST ')
  const l = await lena.start({ legacyThreadId: legacyId })
  assert.deepEqual([l.status, l.body.threadId, l.body.continued], [200, legacyId, true])
  assert.deepEqual(bodies(await lena.read()), ['Lena: my old question'])
  // Only once: a later attempt, even with the right email, starts a new chat.
  const again = visitor('Lena2', 'lena@example.test')
  const a2 = await again.start({ legacyThreadId: legacyId })
  assert.notEqual(a2.body.threadId, legacyId)
  assert.deepEqual(bodies(await lena.read()), ['Lena: my old question'], 'Lena keeps access')
})

test('14. "Not you?" removes the conversation from this browser; it stays for the admin', async () => {
  const r = await vera.forget()
  assert.match(r.setCookie, /^vestora_guest_chat=; Path=\/api\/guest-chat; Max-Age=0; HttpOnly; SameSite=Lax/)
  assert.equal(vera.cookie, null)
  assert.equal((await vera.read()).status, 401)
  asBrowser(admin)
  assert.ok((await queries.getGuestMessages(vera.threadId)).length >= 3)
})

test('15. errors never expose database details, and the rate limiter fails closed', async () => {
  sqlAdmin('revoke execute on function public.guest_chat_rate_limit_hit(text, integer, integer) from service_role;')
  const errors = console.error
  console.error = () => {}
  try {
    const r = await visitor('Closed').start()
    assert.equal(r.status, 429)
    assert.ok(!/permission|function|relation|sql|postgres/i.test(JSON.stringify(r.body)), JSON.stringify(r.body))
  } finally {
    console.error = errors
    sqlAdmin('grant execute on function public.guest_chat_rate_limit_hit(text, integer, integer) to service_role;')
  }
  // Financial switches untouched by any of this.
  assert.equal(sqlAdmin('select bool_or(enabled)::text from public.financial_operation_controls;'), 'false')
  assert.equal(sqlAdmin('select bool_or(payouts_enabled)::text from public.referral_payout_controls;'), 'false')
})
