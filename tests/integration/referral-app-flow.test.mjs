// End-to-end referral-programme application flow against a disposable
// PostgreSQL 17 database with every real migration applied, on the
// Production-fidelity auth/profiles fixture used by tests/db.
//
// Real code under test: the API routes (pay, reject, retry, campaign,
// unsubscribe), lib/notification-sender.js, the email templates, and the
// database functions/triggers/RLS. Mocked: the Resend SDK (no email can
// leave the machine) and fetch (the terms-page check). The Supabase clients
// are replaced by a small adapter that runs each call through psql as the
// matching database role (authenticated with the user's id, or
// service_role), so grants and RLS apply as in Supabase.
//
//   npm run test:integration      (requires Docker; never touches Supabase)
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

register('../helpers/alias-hooks.mjs', import.meta.url)

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const dbDir = join(root, 'tests', 'db')
const container = `vestora-referral-app-${process.pid}`
const DB = 'flow'
const APP = 'https://vestoras.vercel.app'

// ── Environment: mock-only, nothing real ───────────────────────────────
// REFERRAL_PAYOUTS_ENABLED starts unset (payouts off, the default). Step 2b
// checks that, and step 3 turns payouts on explicitly.
for (const k of Object.keys(process.env)) if (/RESEND|SUPABASE|VESTORA|MARKETING|REFERRAL_CAMPAIGN|REFERRAL_PAYOUTS|CRON/.test(k)) delete process.env[k]
Object.assign(process.env, {
  VESTORA_APP_URL: APP,
  RESEND_API_KEY: 're_mock_never_real',
  MARKETING_UNSUBSCRIBE_SECRET: 'integration-test-secret-'.padEnd(48, 'x'),
  MARKETING_POSTAL_ADDRESS: '100 Example Street, Suite 1, Example City, EX 00000, USA',
  REFERRAL_CAMPAIGN_ENABLED: 'true',
})
let termsPublished = false
const realFetch = globalThis.fetch
globalThis.fetch = async (url) => {
  if (String(url) === `${APP}/legal/referral-terms`) return { ok: termsPublished, status: termsPublished ? 200 : 404 }
  throw new Error(`unexpected network access in test: ${url}`)
}

// ── Disposable database ────────────────────────────────────────────────
function psqlRaw(sql, { stopOnError = true } = {}) {
  const res = spawnSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', DB, '-q', '-At', '-v', `ON_ERROR_STOP=${stopOnError ? 1 : 0}`, '-f', '-'],
    { input: sql, encoding: 'utf8' })
  return { ok: res.status === 0, out: (res.stdout || '').trim(), err: res.stderr || '' }
}
function sqlAdmin(sql) {
  const r = psqlRaw(sql)
  if (!r.ok) throw new Error(r.err)
  return r.out
}
// psql prints json_agg output over several lines; parse the whole output.
const json = (sql) => { const out = sqlAdmin(sql); return out ? JSON.parse(out) : null }
const lit = (v) => (v === null || v === undefined ? 'null' : typeof v === 'number' || typeof v === 'boolean' ? String(v) : `'${String(v).replace(/'/g, "''")}'`)

let functionKinds = {}
// A Supabase-client stand-in: rpc / from().select().eq().single() / auth.
function client({ role, sub = null, user = null }) {
  const run = (query) => {
    const pre = [`set role ${role};`]
    if (sub) pre.push(`set "request.jwt.claim.sub" = '${sub}';`)
    const r = psqlRaw(`${pre.join('\n')}\n${query}`)
    if (!r.ok) {
      const m = /ERROR:\s+(.*)/.exec(r.err)
      return { data: null, error: { message: m ? m[1].trim() : r.err.trim() } }
    }
    return { data: r.out ? JSON.parse(r.out) : null, error: null }
  }
  const c = {
    calls: [],
    rpc: async (name, args = {}) => {
      c.calls.push(name)
      const kind = functionKinds[name]
      if (!kind) return { data: null, error: { message: `function public.${name} does not exist` } }
      const params = Object.entries(args).map(([k, v]) => `${k} => ${lit(v)}`).join(', ')
      if (kind === 'set') return run(`select coalesce(json_agg(t), '[]'::json) from public.${name}(${params}) t;`)
      if (kind === 'void') { const r = run(`select public.${name}(${params});`); return r.error ? r : { data: null, error: null } }
      return run(`select to_json(public.${name}(${params}));`)
    },
    from: (table) => {
      const filters = []
      let cols = '*'
      const one = (required) => async () => {
        const where = filters.length ? `where ${filters.join(' and ')}` : ''
        const r = run(`select coalesce(json_agg(t), '[]'::json) from (select ${cols} from public.${table} ${where}) t;`)
        if (r.error) return r
        if (r.data.length > 1) return { data: null, error: { message: 'multiple rows' } }
        if (!r.data.length) return required ? { data: null, error: { message: 'no rows' } } : { data: null, error: null }
        return { data: r.data[0], error: null }
      }
      const q = {
        select: (c2) => { cols = c2; return q },
        eq: (col, v) => { filters.push(`${col} = ${lit(v)}`); return q },
        in: (col, vs) => { filters.push(`${col} in (${vs.map(lit).join(',') || 'null'})`); return q },
        order: () => q,
        single: one(true),
        maybeSingle: one(false),
      }
      return q
    },
    auth: {
      getUser: async () => ({ data: { user } }),
      admin: {
        getUserById: async (id) => {
          const u = json(`select json_build_object('id', id, 'email', email) from auth.users where id = ${lit(id)};`)
          return u ? { data: { user: u }, error: null } : { data: { user: null }, error: { message: 'User not found' } }
        },
      },
    },
  }
  return c
}
const service = () => client({ role: 'service_role' })
const asUser = (id) => client({ role: 'authenticated', sub: id, user: { id } })

// ── Mocked email provider ──────────────────────────────────────────────
let outbox = []
let providerScript = []
function useWorld(authId) {
  globalThis.__t = { auth: authId ? asUser(authId) : null, service: service(), afterCallbacks: [], resend: mockResend }
  return globalThis.__t
}
async function mockResend(payload, options, apiKey) {
  assert.equal(apiKey, 're_mock_never_real')
  outbox.push({ payload, options })
  const next = providerScript.length ? providerScript.shift() : null
  if (next instanceof Error) throw next
  return next ?? { data: { id: `mock_${outbox.length}` }, error: null }
}
async function runAfter(t) {
  for (const fn of t.afterCallbacks.splice(0)) await fn()
}

// ── Helpers in the database ────────────────────────────────────────────
function signup(email, code = null, confirmed = true) {
  const id = randomUUID()
  const meta = code ? { full_name: email.split('@')[0], referral_code: code } : { full_name: email.split('@')[0] }
  sqlAdmin(`insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values ('${id}', ${lit(email)}, ${lit(JSON.stringify(meta))}::jsonb, ${confirmed ? 'now()' : 'null'});
            insert into public.wallets (user_id, balance_usd) values ('${id}', 0);`)
  return id
}
const confirm = (id) => sqlAdmin(`update auth.users set email_confirmed_at = now() where id = '${id}';`)
const codeOf = (id) => sqlAdmin(`select referral_code from public.profiles where id = '${id}';`)
const referralOf = (id) => json(`select row_to_json(r) from public.referrals r where referred_id = '${id}';`)
const balance = (id) => Number(sqlAdmin(`select balance_usd from public.wallets where user_id = '${id}';`))
const deliveries = (where) => json(`select coalesce(json_agg(d order by d.event_type, d.created_at), '[]') from public.notification_deliveries d where ${where};`)
const financialSnapshot = () => sqlAdmin(`select md5(coalesce((select string_agg(user_id || ':' || balance_usd, ',' order by user_id) from public.wallets), '') ||
  coalesce((select string_agg(id || ':' || status || ':' || coalesce(paid_at::text, ''), ',' order by id) from public.referrals), '') ||
  coalesce((select count(*)::text from public.transactions), ''));`)
// The same entry point the routes schedule with after() and the cron calls.
const sendTransactional = async () =>
  (await import('@/lib/notification-sender')).sendPendingReferralNotifications({ logger: { error: (...a) => process.env.FLOW_DEBUG && console.error('[sender]', ...a) } })

let routes
let admin
before(async () => {
  try { execFileSync('docker', ['rm', '-f', container], { stdio: 'ignore' }) } catch {}
  execFileSync('docker', ['run', '-d', '--rm', '--name', container, '-e', 'POSTGRES_PASSWORD=localtest', 'postgres:17'], { stdio: 'ignore' })
  let ready = false
  for (let i = 0; i < 120 && !ready; i++) {
    const logs = spawnSync('docker', ['logs', container], { encoding: 'utf8' })
    ready = /PostgreSQL init process complete/.test(`${logs.stdout}${logs.stderr}`)
      && spawnSync('docker', ['exec', container, 'pg_isready', '-U', 'postgres', '-q']).status === 0
    if (!ready) await new Promise((r) => setTimeout(r, 500))
  }
  if (!ready) throw new Error('database did not start')
  spawnSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-q', '-c', `create database ${DB};`])
  for (const f of ['base_schema.sql', 'production_baseline.sql', 'referral_baseline.sql', 'production_auth_profiles.sql', 'supabase_default_privileges.sql']) {
    sqlAdmin(readFileSync(join(dbDir, f), 'utf8'))
  }
  const migrationsDir = join(root, 'supabase', 'migrations')
  for (const m of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) sqlAdmin(readFileSync(join(migrationsDir, m), 'utf8'))
  sqlAdmin(`alter table public.referrals alter column id set generated always;
            insert into public.settings (id, referral_program_enabled, referral_referrer_bonus_usd, referral_referred_bonus_usd) values (true, true, 30, 12.50);`)
  functionKinds = Object.fromEntries(sqlAdmin(`select proname || '|' || case when proretset then 'set' when prorettype = 'void'::regtype then 'void' else 'scalar' end
    from pg_proc where pronamespace = 'public'::regnamespace;`).split('\n').map((l) => l.split('|')))

  admin = signup('admin@example.test')
  sqlAdmin(`set session_replication_role = replica; update public.profiles set role = 'admin', full_name = 'Admin One' where id = '${admin}'; set session_replication_role = origin;`)

  routes = {
    pay: (await import('@/app/api/admin/pay-referral/route')).POST,
    reject: (await import('@/app/api/admin/referrals/reject/route')).POST,
    retry: (await import('@/app/api/admin/referrals/notifications/retry/route')).POST,
    campaign: await import('@/app/api/admin/referrals/campaign/route'),
    unsubscribe: await import('@/app/api/marketing/unsubscribe/route'),
  }
})
after(() => {
  globalThis.fetch = realFetch
  try { execFileSync('docker', ['rm', '-f', container], { stdio: 'ignore' }) } catch {}
})
// Same-origin JSON, as the admin page sends it.
const body = (b) => ({ url: `${APP}/api/admin/x`, headers: new Headers({ 'content-type': 'application/json', origin: APP, 'sec-fetch-site': 'same-origin', host: 'vestoras.vercel.app' }), json: async () => b })
const ENABLE_DB_PAYOUTS = `select public.set_referral_payouts_enabled(true, 'integration test', 'payments under test', 'ENABLE REFERRAL PAYOUTS');`

// ── The flow ───────────────────────────────────────────────────────────
let rita, ben
test('1. signup with a referral link -> attribution on verification -> "registered" emails sent once', async () => {
  rita = signup('rita@example.test')
  ben = signup('ben@example.test', codeOf(rita), false)
  assert.equal(referralOf(ben), null, 'not attributed before verification')
  confirm(ben)
  const ref = referralOf(ben)
  assert.equal(ref.status, 'pending')
  assert.deepEqual([Number(ref.referrer_bonus_usd), Number(ref.referred_bonus_usd)], [30, 12.5], 'live settings amounts')

  useWorld()
  outbox = []
  const r = await sendTransactional()
  assert.deepEqual([r.status, r.sent], ['ok', 2])
  assert.deepEqual(outbox.map((m) => m.payload.to).sort(), ['ben@example.test', 'rita@example.test'])
  for (const m of outbox) {
    assert.match(m.options.idempotencyKey, /^notify\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/)
    assert.doesNotMatch(`${m.payload.html}${m.payload.text}`, /\$\s?\d/, 'no reward amount promised')
    assert.match(m.payload.html, /pending review/)
    assert.match(m.payload.html, /https:\/\/vestoras\.vercel\.app\/referrals/)
  }
  assert.ok(deliveries(`referral_id = ${ref.id}`).every((d) => d.status === 'sent' && d.provider_message_id))

  // Duplicate run (e.g. cron + after() overlap): nothing sent twice.
  const again = await sendTransactional()
  assert.equal(again.claimed, 0)
  assert.equal(outbox.length, 2)
})

test('2. customer dashboard shows "pending" with the customer\'s own amount only', async () => {
  const { data, error } = await asUser(ben).rpc('get_my_referral_history')
  assert.equal(error, null)
  assert.equal(data.length, 1)
  assert.deepEqual([data[0].my_role, data[0].status, Number(data[0].my_bonus_usd)], ['referred', 'pending', 12.5])
  const r = await asUser(rita).rpc('get_my_referral_history')
  assert.deepEqual([r.data[0].my_role, Number(r.data[0].my_bonus_usd)], ['referrer', 30])
})

test('2b. payout kill switch off by default: a real admin request is refused and the database is untouched', async () => {
  assert.equal(process.env.REFERRAL_PAYOUTS_ENABLED, undefined, 'not configured')
  const ref = referralOf(ben)
  const ledger = () => sqlAdmin(`select (select count(*) from public.audit_logs) || '/' || (select count(*) from public.notification_deliveries);`)
  const before = { money: financialSnapshot(), ledger: ledger(), referral: JSON.stringify(ref) }
  for (const value of [undefined, '', 'TRUE', '1']) {
    if (value === undefined) delete process.env.REFERRAL_PAYOUTS_ENABLED
    else process.env.REFERRAL_PAYOUTS_ENABLED = value
    const t = useWorld(admin)
    const res = await routes.pay(body({ referralId: ref.id }))
    assert.equal(res.status, 503, `REFERRAL_PAYOUTS_ENABLED=${JSON.stringify(value)}`)
    assert.equal(res.body.code, 'REFERRAL_PAYOUTS_DISABLED')
    assert.equal(t.afterCallbacks.length, 0, 'no email run scheduled')
  }
  delete process.env.REFERRAL_PAYOUTS_ENABLED
  // A customer still gets 403, not the switch status.
  useWorld(rita)
  const customer = await routes.pay(body({ referralId: ref.id }))
  assert.equal(customer.status, 403)
  assert.equal(customer.body.code, undefined)

  assert.equal(financialSnapshot(), before.money, 'wallets, referrals and transactions unchanged')
  assert.equal(ledger(), before.ledger, 'no audit entries or notifications written')
  assert.equal(JSON.stringify(referralOf(ben)), before.referral, 'referral row unchanged')
  assert.deepEqual([balance(rita), balance(ben)], [0, 0])
})

test('2c. app switch ON but the database payout switch OFF (20261126000000 default): refused by the database, untouched', async () => {
  assert.equal(sqlAdmin('select payouts_enabled from public.referral_payout_controls;'), 'f', 'database switch off after the migration')
  const ref = referralOf(ben)
  const before = financialSnapshot()
  process.env.REFERRAL_PAYOUTS_ENABLED = 'true'
  try {
    const t = useWorld(admin)
    const res = await routes.pay(body({ referralId: ref.id }))
    assert.equal(res.status, 503, JSON.stringify(res.body))
    assert.equal(res.body.code, 'REFERRAL_PAYOUTS_DISABLED')
    assert.equal(t.afterCallbacks.length, 0)
    // Bypassing the app entirely: the admin's own session calling the RPC.
    const direct = await asUser(admin).rpc('pay_referral', { p_referral_id: String(ref.id) })
    assert.match(direct.error?.message || '', /Referral payouts are disabled/)
  } finally {
    delete process.env.REFERRAL_PAYOUTS_ENABLED
  }
  assert.equal(financialSnapshot(), before, 'nothing paid')
  assert.equal(referralOf(ben).status, 'pending')
})

test('3. admin pays through the route: wallets credited once, "paid" emails with amounts; duplicate refused', async () => {
  // Payouts explicitly enabled from here on (the kill switch is checked in 2b).
  process.env.REFERRAL_PAYOUTS_ENABLED = 'true'
  sqlAdmin(ENABLE_DB_PAYOUTS)
  const ref = referralOf(ben)
  let t = useWorld(admin)
  outbox = []
  const res = await routes.pay(body({ referralId: ref.id }))
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.deepEqual([balance(rita), balance(ben)], [30, 12.5])
  await runAfter(t)
  assert.equal(outbox.length, 2)
  const byTo = Object.fromEntries(outbox.map((m) => [m.payload.to, m.payload]))
  assert.match(byTo['rita@example.test'].html, /\$30\.00/)
  assert.match(byTo['ben@example.test'].html, /\$12\.50/)

  t = useWorld(admin)
  const dup = await routes.pay(body({ referralId: ref.id }))
  assert.equal(dup.status, 400)
  assert.equal(dup.body.error, 'Already paid')
  assert.equal(t.afterCallbacks.length, 0)
  assert.deepEqual([balance(rita), balance(ben)], [30, 12.5], 'not paid twice')
  const rej = await routes.reject(body({ referralId: ref.id, reason: 'other' }))
  assert.equal(rej.status, 409, 'a paid referral cannot be rejected')

  const hist = await asUser(ben).rpc('get_my_referral_history')
  assert.equal(hist.data[0].status, 'paid')
})

test('4. a non-admin cannot pay or reject (route and database both refuse)', async () => {
  const cara = signup('cara@example.test', codeOf(rita))
  const ref = referralOf(cara)
  useWorld(rita)
  assert.equal((await routes.pay(body({ referralId: ref.id }))).status, 403)
  assert.equal((await routes.reject(body({ referralId: ref.id, reason: 'other' }))).status, 403)
  // Even bypassing the route, the database refuses a customer session.
  const direct = await asUser(rita).rpc('reject_referral', { p_referral_id: ref.id, p_reason: 'other', p_private_note: null })
  assert.match(direct.error.message, /Only admins/)
  const directPay = await asUser(rita).rpc('pay_referral', { p_referral_id: String(ref.id) })
  assert.match(directPay.error.message, /Only admins/)
  assert.equal(referralOf(cara).status, 'pending')
  // Deliver cara's "registered" emails now so test 5 sees only rejection emails.
  useWorld()
  assert.equal((await sendTransactional()).sent, 2)
})

test('5. rejection: neutral reason to both customers, private note never leaves the admin table', async () => {
  const cara = json(`select to_json(id) from auth.users where email = 'cara@example.test';`)
  const ref = referralOf(cara)
  const before = { rita: balance(rita), cara: balance(cara) }
  const t = useWorld(admin)
  outbox = []
  const NOTE = 'FRAUD-SIGNAL: same device fingerprint as account #77'
  const res = await routes.reject(body({ referralId: ref.id, reason: 'duplicate_account', privateNote: NOTE }))
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.equal(referralOf(cara).status, 'rejected')
  assert.deepEqual({ rita: balance(rita), cara: balance(cara) }, before, 'no money moved')
  await runAfter(t)
  assert.equal(outbox.length, 2)
  for (const m of outbox) {
    const all = `${m.payload.subject}${m.payload.html}${m.payload.text}`
    assert.match(all, /could not be accepted as a new customer for the referral programme/)
    assert.doesNotMatch(all, /FRAUD|fingerprint|#77/)
  }
  // Ledger payloads and the customer-facing history carry no note.
  assert.doesNotMatch(JSON.stringify(deliveries(`referral_id = ${ref.id}`)), /FRAUD|fingerprint/)
  const hist = await asUser(cara).rpc('get_my_referral_history')
  assert.deepEqual([hist.data[0].status, hist.data[0].rejection_reason], ['rejected', 'duplicate_account'])
  assert.doesNotMatch(JSON.stringify(hist.data), /FRAUD|fingerprint/)
  // Customers cannot read notes or deliveries; the admin can.
  const notesAsCustomer = await asUser(cara).from('referral_review_notes').select('note').eq('referral_id', ref.id).maybeSingle()
  assert.equal(notesAsCustomer.data, null)
  const notesAsAdmin = await asUser(admin).from('referral_review_notes').select('note').eq('referral_id', ref.id).single()
  assert.equal(notesAsAdmin.data.note, NOTE)

  // Duplicate rejection and payment after rejection are refused.
  useWorld(admin)
  assert.equal((await routes.reject(body({ referralId: ref.id, reason: 'other' }))).status, 409)
  const pay = await routes.pay(body({ referralId: ref.id }))
  assert.ok(pay.status >= 400, 'rejected referral cannot be paid')
  assert.deepEqual({ rita: balance(rita), cara: balance(cara) }, before)
})

test('6. provider failures never affect referrals or money; retries need approval (and evidence if uncertain)', async () => {
  const snapshot = financialSnapshot()
  const dan = signup('dan@example.test', codeOf(rita))
  const ref = referralOf(dan)
  const afterAttribution = financialSnapshot()
  useWorld()
  outbox = []
  providerScript = [{ data: null, error: { statusCode: 422, message: 'invalid recipient' } }, new Error('ECONNRESET')]
  const r = await sendTransactional()
  assert.deepEqual([r.failed, r.uncertain, r.sent], [1, 1, 0])
  assert.equal(referralOf(dan).status, 'pending', 'referral untouched by email failures')
  assert.equal(financialSnapshot(), afterAttribution, 'wallets/referrals/transactions untouched by email failures')
  assert.notEqual(snapshot, afterAttribution) // sanity: the snapshot does see the new referral

  // Nothing is resent automatically.
  assert.equal((await sendTransactional()).claimed, 0)
  assert.equal(outbox.length, 2)

  const ds = deliveries(`referral_id = ${ref.id}`)
  const failed = ds.find((d) => d.status === 'failed')
  const uncertain = ds.find((d) => d.status === 'uncertain')
  let t = useWorld(admin)
  assert.equal((await routes.retry(body({ deliveryId: uncertain.id, note: 'try again' }))).status, 400, 'uncertain needs evidence')
  assert.equal((await routes.retry(body({ deliveryId: failed.id, note: 'recipient fixed' }))).status, 200)
  assert.equal((await routes.retry(body({ deliveryId: uncertain.id, note: 'not delivered', providerEvidence: 'Resend log: no message for key' }))).status, 200)
  useWorld(rita)
  assert.equal((await routes.retry(body({ deliveryId: failed.id, note: 'x' }))).status, 403, 'customers cannot retry')

  t = useWorld(admin)
  outbox = []
  const resent = await sendTransactional()
  assert.equal(resent.sent, 2)
  const firstKeys = new Set()
  for (const m of outbox) {
    assert.match(m.options.idempotencyKey, /^notify\//)
    firstKeys.add(m.options.idempotencyKey)
  }
  assert.equal(firstKeys.size, 2)
  const after = deliveries(`referral_id = ${ref.id}`)
  assert.ok(after.every((d) => d.status === 'sent' && d.attempt_count === 2))
  assert.ok(after.every((d) => /^admin:/.test(d.recovery_note)))
  assert.equal(financialSnapshot(), afterAttribution)
  // Retrying a sent email is refused.
  assert.equal((await routes.retry(body({ deliveryId: failed.id, note: 'again' }))).status, 409)
})

test('7. customers with account emails turned off are skipped, not emailed', async () => {
  const eve = signup('eve@example.test', codeOf(rita), false)
  sqlAdmin(`update public.profiles set email_notifications = false where id = '${eve}';`)
  confirm(eve)
  useWorld()
  outbox = []
  await sendTransactional()
  assert.deepEqual(outbox.map((m) => m.payload.to), ['rita@example.test'])
  const eveRow = deliveries(`recipient_user_id = '${eve}'`)[0]
  assert.deepEqual([eveRow.status, eveRow.skip_reason], ['skipped', 'notifications_disabled'])
})

test('8. marketing consent: only explicit opt-in, audited, customers cannot set it directly', async () => {
  const direct = await asUser(rita).rpc('set_my_marketing_consent', { p_granted: true, p_source: 'unsubscribe_link' })
  assert.match(direct.error.message, /Invalid consent request/)
  const tamper = psqlRaw(`set role authenticated; set "request.jwt.claim.sub" = '${rita}'; update public.profiles set marketing_consent = true where id = '${rita}';`)
  assert.equal(tamper.ok, false, 'direct profile update refused')
  assert.equal(sqlAdmin(`select marketing_consent from public.profiles where id = '${rita}';`), 'f')

  for (const [id, source] of [[rita, 'announcement_prompt'], [ben, 'settings']]) {
    const r = await asUser(id).rpc('set_my_marketing_consent', { p_granted: true, p_source: source })
    assert.equal(r.error, null)
  }
  assert.equal(sqlAdmin(`select count(*) from public.marketing_consent_events where granted;`), '2')
})

test('9. campaign: blocked without published terms; dry run writes nothing; queue starts paused', async () => {
  termsPublished = false
  let t = useWorld(admin)
  const preview = await routes.campaign.GET()
  assert.equal(preview.status, 200)
  assert.equal(preview.body.gate.allowed, false)
  assert.equal(preview.body.eligibleRecipients, 2)
  assert.deepEqual(preview.body.campaign, { queued: false, paused: true })
  assert.equal(sqlAdmin(`select count(*) from public.notification_deliveries where category = 'marketing';`), '0')
  assert.equal(sqlAdmin(`select count(*) from public.marketing_campaign_controls;`), '0')

  for (const b of [{ action: 'enqueue', confirm: 'QUEUE referral-launch' }, { action: 'resume' }, { action: 'send-batch', batchSize: 5 }]) {
    assert.equal((await routes.campaign.POST(body(b))).status, 409, b.action)
  }
  assert.equal(sqlAdmin(`select count(*) from public.notification_deliveries where category = 'marketing';`), '0')

  termsPublished = true
  try {
    t = useWorld(admin)
    assert.equal((await routes.campaign.POST(body({ action: 'enqueue', confirm: 'wrong' }))).status, 400)
    const q = await routes.campaign.POST(body({ action: 'enqueue', confirm: 'QUEUE referral-launch' }))
    assert.deepEqual([q.status, q.body.queued, q.body.paused], [200, 2, true])
    const again = await routes.campaign.POST(body({ action: 'enqueue', confirm: 'QUEUE referral-launch' }))
    assert.equal(again.body.queued, 0, 'idempotent: no duplicate campaign emails')

    // Paused: a batch sends nothing.
    outbox = []
    const paused = await routes.campaign.POST(body({ action: 'send-batch', batchSize: 10 }))
    assert.deepEqual([paused.status, paused.body.result.sent, paused.body.result.notClaimed], [200, 0, 2], JSON.stringify(paused.body))
    assert.equal(outbox.length, 0)

    // A non-admin actor cannot resume, even with the service role.
    const forged = await service().rpc('set_marketing_campaign_paused', { p_campaign_key: 'referral-launch', p_paused: false, p_actor: rita })
    assert.match(forged.error.message, /Only admins/)
  } finally { termsPublished = false }
})

test('10. campaign: unsubscribe before sending is honoured; resume, batch, pause', async () => {
  termsPublished = true
  try {
    // Ben unsubscribes via the email link. GET changes nothing; POST does.
    const { unsubscribeUrl } = await import('@/lib/unsubscribe-token')
    const url = unsubscribeUrl(APP, ben)
    useWorld()
    const get = await routes.unsubscribe.GET({ url })
    assert.equal(get.status, 200)
    assert.equal(sqlAdmin(`select marketing_consent from public.profiles where id = '${ben}';`), 't', 'GET has no effect')
    const post = await routes.unsubscribe.POST({ url })
    assert.equal(post.status, 200)
    assert.equal(sqlAdmin(`select marketing_consent from public.profiles where id = '${ben}';`), 'f')
    assert.equal(sqlAdmin(`select source from public.marketing_consent_events where user_id = '${ben}' order by id desc limit 1;`), 'unsubscribe_link')
    const forged = await routes.unsubscribe.POST({ url: url.replace(ben, rita) })
    assert.equal(forged.status, 400, "a token cannot unsubscribe someone else")
    assert.equal(sqlAdmin(`select marketing_consent from public.profiles where id = '${rita}';`), 't')

    useWorld(admin)
    assert.equal((await routes.campaign.POST(body({ action: 'resume' }))).status, 200)
    outbox = []
    const r = await routes.campaign.POST(body({ action: 'send-batch', batchSize: 10 }))
    assert.deepEqual([r.body.result.sent, r.body.result.notClaimed], [1, 1])
    assert.deepEqual(outbox.map((m) => m.payload.to), ['rita@example.test'])
    const m = outbox[0].payload
    assert.match(m.html, /\$30\.00[\s\S]*\$12\.50/)
    assert.match(m.html, new RegExp(`signup\\?ref=${codeOf(rita)}`))
    assert.match(m.html, /legal\/referral-terms/)
    assert.match(m.headers['List-Unsubscribe'], /^<https:\/\/vestoras\.vercel\.app\/api\/marketing\/unsubscribe\?u=/)
    const benRow = deliveries(`recipient_user_id = '${ben}' and category = 'marketing'`)[0]
    assert.deepEqual([benRow.status, benRow.skip_reason], ['skipped', 'no_marketing_consent'])

    // Further batches send nothing more; pause works with the gate closed too.
    assert.equal((await routes.campaign.POST(body({ action: 'send-batch', batchSize: 10 }))).body.result.claimed, 0)
    termsPublished = false
    assert.equal((await routes.campaign.POST(body({ action: 'pause' }))).status, 200)
    assert.equal(sqlAdmin(`select paused from public.marketing_campaign_controls where campaign_key = 'referral-launch';`), 't')
  } finally { termsPublished = false }
})

test('11. the transactional sender and cron never send campaign emails; sender uses only ledger functions', async () => {
  const s = service()
  globalThis.__t = { service: s, resend: mockResend, afterCallbacks: [] }
  sqlAdmin(`update public.marketing_campaign_controls set paused = false;
            insert into public.notification_deliveries (delivery_key, category, event_type, recipient_user_id, campaign_key)
            values ('campaign:referral-launch:extra', 'marketing', 'campaign_referral_launch', '${admin}', 'referral-launch');`)
  outbox = []
  await sendTransactional()
  assert.equal(outbox.length, 0)
  assert.equal(deliveries(`delivery_key = 'campaign:referral-launch:extra'`)[0].status, 'pending')
  const allowed = new Set(['list_notification_deliveries', 'claim_notification_delivery', 'complete_notification_delivery', 'recover_stale_notification_delivery', 'release_notification_delivery'])
  assert.ok(s.calls.every((c) => allowed.has(c)), s.calls.join(','))
})

test('12. no-op safety: with the provider unconfigured nothing is claimed and nothing is lost', async () => {
  const fay = signup('fay@example.test', codeOf(rita))
  const key = process.env.RESEND_API_KEY
  delete process.env.RESEND_API_KEY
  try {
    useWorld()
    outbox = []
    const r = await sendTransactional()
    assert.equal(r.status, 'not_configured')
    assert.ok(deliveries(`referral_id = ${referralOf(fay).id}`).every((d) => d.status === 'pending'))
  } finally { process.env.RESEND_API_KEY = key }
  const r2 = await sendTransactional()
  assert.equal(r2.sent, 2)
})
