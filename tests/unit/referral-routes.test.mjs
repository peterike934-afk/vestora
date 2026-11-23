// Route-level tests for the referral-programme API routes, loaded from the
// real source files with in-memory Supabase clients, a mocked email
// provider and a mocked fetch (no network, no database, no real email).
import test from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

register('../helpers/alias-hooks.mjs', import.meta.url)

const APP = 'https://vestoras.vercel.app'
const SECRET = 'k'.repeat(48)
const ADMIN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const CUSTOMER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const BASE_ENV = { VESTORA_APP_URL: APP, RESEND_API_KEY: 're_test_mock', MARKETING_UNSUBSCRIBE_SECRET: SECRET, REFERRAL_CAMPAIGN_ENABLED: 'true', CRON_SECRET: 'cron-secret-value',
  MARKETING_POSTAL_ADDRESS: '100 Example Street, Suite 1, Example City, EX 00000, USA' }

// Network is never used: terms check answers from this flag.
let termsPublished = false
const fetchCalls = []
globalThis.fetch = async (url, init) => { fetchCalls.push([String(url), init?.method]); return { ok: termsPublished, status: termsPublished ? 200 : 404 } }

function setEnv(overrides = {}) {
  for (const k of Object.keys(BASE_ENV)) delete process.env[k]
  Object.assign(process.env, BASE_ENV, overrides)
  for (const [k, v] of Object.entries(overrides)) if (v === undefined) delete process.env[k]
}
setEnv()

function world({ user = { id: ADMIN }, role = 'admin', rpc = {}, serviceRpc = {}, control = null } = {}) {
  const t = { authCalls: [], serviceCalls: [], afterCallbacks: [], sent: [] }
  t.auth = {
    auth: { getUser: async () => ({ data: { user } }) },
    from: (table) => {
      const q = { select: () => q, eq: () => q, in: () => q, order: () => q,
        single: async () => {
          if (table === 'profiles') return { data: user ? { role } : null, error: null }
          if (table === 'settings') return { data: { referral_program_enabled: true, referral_referrer_bonus_usd: 30, referral_referred_bonus_usd: 12.5 }, error: null }
          throw new Error(`unexpected ${table}`)
        },
        maybeSingle: async () => ({ data: table === 'marketing_campaign_controls' ? control : null, error: null }) }
      return q
    },
    rpc: async (name, args) => { t.authCalls.push([name, args]); return (rpc[name] ?? (() => ({ data: null, error: { message: `unexpected ${name}` } })))(args) },
  }
  t.service = {
    rpc: async (name, args) => { t.serviceCalls.push([name, args]); return (serviceRpc[name] ?? (() => ({ data: [], error: null })))(args) },
    from: () => { throw new Error('service table access not expected') },
    auth: { admin: { getUserById: async (id) => ({ data: { user: { id, email: `${id.slice(0, 4)}person@example.test` } }, error: null }) } },
  }
  t.resend = async (payload, options) => { t.sent.push({ payload, options }); return { data: { id: 'msg' }, error: null } }
  globalThis.__t = t
  return t
}
// Admin pages send same-origin JSON; that is the default here.
const SAME_ORIGIN = { 'content-type': 'application/json', origin: APP, 'sec-fetch-site': 'same-origin', host: 'vestoras.vercel.app' }
const req = (body, url = 'https://vestoras.vercel.app/x', headers = SAME_ORIGIN) => ({ url, headers: new Headers(headers), json: async () => { if (body instanceof Error) throw body; return body } })

const reject = (await import('@/app/api/admin/referrals/reject/route')).POST
const retry = (await import('@/app/api/admin/referrals/notifications/retry/route')).POST
const campaign = await import('@/app/api/admin/referrals/campaign/route')
const unsubscribe = await import('@/app/api/marketing/unsubscribe/route')
const cron = (await import('@/app/api/cron/referral-notifications/route')).GET
const { signUnsubscribeToken } = await import('@/lib/unsubscribe-token')

// ── Reject ─────────────────────────────────────────────────────────────
test('reject: admin session calls reject_referral once with reason and private note', async () => {
  const t = world({ rpc: { reject_referral: (a) => ({ data: { id: 42, status: 'rejected', rejection_reason: a.p_reason }, error: null }) } })
  const res = await reject(req({ referralId: 42, reason: 'duplicate_account', privateNote: '  same device as #40  ' }))
  assert.equal(res.status, 200)
  assert.deepEqual(t.authCalls, [['reject_referral', { p_referral_id: '42', p_reason: 'duplicate_account', p_private_note: 'same device as #40' }]])
  assert.equal(t.serviceCalls.length, 0, 'no service role for the rejection itself')
  assert.equal(t.afterCallbacks.length, 1, 'notification send scheduled after the response')
})

test('reject: auth, validation and database refusals', async () => {
  let t = world({ user: null })
  assert.equal((await reject(req({ referralId: 1, reason: 'other' }))).status, 401)
  t = world({ role: 'user' })
  assert.equal((await reject(req({ referralId: 1, reason: 'other' }))).status, 403)
  assert.equal(t.authCalls.length, 0)
  for (const body of [{ referralId: 'x', reason: 'other' }, { referralId: 1, reason: 'fraud' }, { referralId: 1 }, { referralId: 1, reason: 'other', privateNote: 'n'.repeat(2001) }, new SyntaxError('bad')]) {
    t = world()
    assert.equal((await reject(req(body))).status, 400, JSON.stringify(body))
    assert.equal(t.authCalls.length, 0)
  }
  for (const [message, status] of [['Already paid', 409], ['Already rejected', 409], ['Referral not found', 404], ['Only admins can reject referrals', 403]]) {
    world({ rpc: { reject_referral: () => ({ data: null, error: { message } }) } })
    const res = await reject(req({ referralId: 5, reason: 'other' }))
    assert.equal(res.status, status, message)
    assert.equal(globalThis.__t.afterCallbacks.length, 0, 'no emails after a refused rejection')
  }
  world({ rpc: { reject_referral: () => ({ data: null, error: { message: 'deadlock detected at relation "referrals"', code: '40P01' } }) } })
  const res = await reject(req({ referralId: 5, reason: 'other' }))
  assert.equal(res.status, 500)
  assert.doesNotMatch(res.body.error, /deadlock|relation/)
})

test('reject: the after() email run cannot fail the request even if sending breaks', async () => {
  const t = world({ rpc: { reject_referral: () => ({ data: { id: 1 }, error: null }) }, serviceRpc: { list_notification_deliveries: () => { throw new Error('db down') } } })
  const res = await reject(req({ referralId: 1, reason: 'other' }))
  assert.equal(res.status, 200)
  const out = await t.afterCallbacks[0]()
  assert.equal(out.status, 'error')
})

// ── Retry ──────────────────────────────────────────────────────────────
const DELIVERY = '0f0e0d0c-0b0a-4908-8706-050403020100'
test('retry: admin only, note required, passes operator and evidence to the ledger function', async () => {
  let t = world({ role: 'user' })
  assert.equal((await retry(req({ deliveryId: DELIVERY, note: 'x' }))).status, 403)
  assert.equal(t.serviceCalls.length, 0)
  t = world()
  assert.equal((await retry(req({ deliveryId: 'nope', note: 'x' }))).status, 400)
  assert.equal((await retry(req({ deliveryId: DELIVERY, note: '   ' }))).status, 400)
  assert.equal(t.serviceCalls.length, 0)

  t = world({ serviceRpc: { retry_notification_delivery: () => ({ data: true, error: null }) } })
  const res = await retry(req({ deliveryId: DELIVERY, note: 'mailbox fixed', providerEvidence: 'Resend: bounced' }))
  assert.equal(res.status, 200)
  assert.deepEqual(t.serviceCalls[0], ['retry_notification_delivery', { p_delivery_id: DELIVERY, p_operator: `admin:${ADMIN}`, p_note: 'mailbox fixed', p_provider_evidence: 'Resend: bounced' }])

  world({ serviceRpc: { retry_notification_delivery: () => ({ data: false, error: null }) } })
  assert.equal((await retry(req({ deliveryId: DELIVERY, note: 'again' }))).status, 409, 'sent/pending emails cannot be retried')
  world({ serviceRpc: { retry_notification_delivery: () => ({ data: null, error: { message: 'provider evidence is required to retry an uncertain delivery' } }) } })
  assert.equal((await retry(req({ deliveryId: DELIVERY, note: 'again' }))).status, 400)
})

// ── Campaign ───────────────────────────────────────────────────────────
const PREVIEW_ONLY = new Set(['preview_marketing_campaign_recipients', 'list_notification_deliveries'])
test('campaign GET is a dry run: reports blockers and recipients, writes nothing, sends nothing', async () => {
  termsPublished = false
  const t = world({ serviceRpc: { preview_marketing_campaign_recipients: () => ({ data: [{ recipient_user_id: CUSTOMER }, { recipient_user_id: ADMIN }], error: null }) } })
  const res = await campaign.GET()
  assert.equal(res.status, 200)
  assert.equal(res.body.gate.allowed, false)
  assert.equal(res.body.gate.termsPublished, false)
  assert.match(res.body.gate.blockers.join(' '), /referral terms/)
  assert.equal(res.body.eligibleRecipients, 2)
  assert.ok(res.body.sampleRecipients.every((e) => /^\w\*+@example\.test$/.test(e)), 'masked')
  assert.deepEqual(res.body.programme, { enabled: true, referrerBonusUsd: 30, referredBonusUsd: 12.5 })
  assert.ok(t.serviceCalls.every(([n]) => PREVIEW_ONLY.has(n)), t.serviceCalls.map(([n]) => n).join(','))
  assert.equal(t.authCalls.length, 0)
  assert.equal(t.sent.length, 0)
  assert.deepEqual(fetchCalls.at(-1), [`${APP}/legal/referral-terms`, 'GET'])
})

test('campaign: non-admins cannot preview or act', async () => {
  for (const [user, status] of [[null, 401], [{ id: CUSTOMER }, 403]]) {
    const t = world({ user, role: 'user' })
    assert.equal((await campaign.GET()).status, status)
    assert.equal((await campaign.POST(req({ action: 'pause' }))).status, status)
    assert.equal(t.serviceCalls.length, 0)
  }
})

test('campaign: every sending action is refused while terms are unpublished; pause always works', async () => {
  termsPublished = false
  for (const body of [{ action: 'enqueue', confirm: 'QUEUE referral-launch' }, { action: 'resume' }, { action: 'send-batch', batchSize: 5 }]) {
    const t = world()
    const res = await campaign.POST(req(body))
    assert.equal(res.status, 409, body.action)
    assert.match(res.body.blockers.join(' '), /referral terms/)
    assert.equal(t.serviceCalls.length, 0, `${body.action}: nothing written`)
    assert.equal(t.sent.length, 0)
  }
  const t = world({ serviceRpc: { set_marketing_campaign_paused: () => ({ data: null, error: null }) } })
  assert.equal((await campaign.POST(req({ action: 'pause' }))).status, 200)
  assert.deepEqual(t.serviceCalls[0], ['set_marketing_campaign_paused', { p_campaign_key: 'referral-launch', p_paused: true, p_actor: ADMIN }])
})

test('campaign: REFERRAL_CAMPAIGN_ENABLED off blocks even with published terms', async () => {
  termsPublished = true
  setEnv({ REFERRAL_CAMPAIGN_ENABLED: undefined })
  try {
    const t = world()
    const res = await campaign.POST(req({ action: 'enqueue', confirm: 'QUEUE referral-launch' }))
    assert.equal(res.status, 409)
    assert.equal(t.serviceCalls.length, 0)
  } finally { setEnv(); termsPublished = false }
})

test('campaign: enqueue needs the exact confirmation phrase; batch size is bounded', async () => {
  termsPublished = true
  try {
    for (const confirm of [undefined, '', 'queue referral-launch', 'QUEUE referral-launch ', 'yes']) {
      const t = world()
      assert.equal((await campaign.POST(req({ action: 'enqueue', confirm }))).status, 400, String(confirm))
      assert.equal(t.serviceCalls.length, 0)
    }
    let t = world({ serviceRpc: { enqueue_marketing_campaign: () => ({ data: 3, error: null }) } })
    const res = await campaign.POST(req({ action: 'enqueue', confirm: 'QUEUE referral-launch' }))
    assert.deepEqual([res.status, res.body.queued, res.body.paused], [200, 3, true])
    assert.deepEqual(t.serviceCalls, [['enqueue_marketing_campaign', { p_campaign_key: 'referral-launch', p_actor: ADMIN }]], 'the queueing admin is recorded')

    for (const batchSize of [0, -1, 51, 'abc', null]) {
      t = world()
      assert.equal((await campaign.POST(req({ action: 'send-batch', batchSize }))).status, 400, String(batchSize))
      assert.equal(t.serviceCalls.length, 0)
    }
    t = world()
    assert.equal((await campaign.POST(req({ action: 'explode' }))).status, 400)
  } finally { termsPublished = false }
})

test('campaign: send-batch processes at most batchSize marketing emails via the mocked provider', async () => {
  termsPublished = true
  try {
    const listed = []
    const t = world({ serviceRpc: {
      list_notification_deliveries: (a) => { listed.push(a); return { data: [], error: null } },
    } })
    t.service.from = () => { const q = { select: () => q, eq: () => q, single: async () => ({ data: { referral_program_enabled: true, referral_referrer_bonus_usd: 30, referral_referred_bonus_usd: 12.5 }, error: null }) }; return q }
    const res = await campaign.POST(req({ action: 'send-batch', batchSize: 7 }))
    assert.equal(res.status, 200)
    assert.equal(res.body.result.status, 'ok')
    const pending = listed.find((a) => a.p_status === 'pending')
    assert.deepEqual([pending.p_category, pending.p_campaign_key, pending.p_limit], ['marketing', 'referral-launch', 7])
  } finally { termsPublished = false }
})

// ── Cross-site protection on every state-changing admin route ─────────
test('admin POST routes refuse cross-site and non-JSON requests before reading the session', async () => {
  const routes = [
    ['reject', reject, { referralId: 1, reason: 'other' }],
    ['retry', retry, { deliveryId: DELIVERY, note: 'x' }],
    ['campaign', campaign.POST, { action: 'pause' }],
  ]
  const bad = [
    [{ ...SAME_ORIGIN, 'content-type': 'text/plain' }, 415],
    [{ ...SAME_ORIGIN, 'content-type': 'application/x-www-form-urlencoded' }, 415],
    [{ ...SAME_ORIGIN, 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' }, 403],
    [{ 'content-type': 'application/json', origin: 'https://evil.example', host: 'vestoras.vercel.app' }, 403],
  ]
  for (const [name, route, body] of routes) {
    for (const [headers, status] of bad) {
      const t = world()
      let sessionRead = false
      t.auth.auth.getUser = async () => { sessionRead = true; return { data: { user: { id: ADMIN } } } }
      const res = await route(req(body, 'https://vestoras.vercel.app/x', headers))
      assert.equal(res.status, status, `${name} ${JSON.stringify(headers)}`)
      assert.equal(sessionRead, false, `${name}: session not read`)
      assert.deepEqual([t.authCalls.length, t.serviceCalls.length, t.afterCallbacks.length], [0, 0, 0], `${name}: nothing called`)
    }
  }
})

test('campaign gate also requires the sender postal address', async () => {
  termsPublished = true
  setEnv({ MARKETING_POSTAL_ADDRESS: undefined })
  try {
    const t = world()
    const res = await campaign.POST(req({ action: 'enqueue', confirm: 'QUEUE referral-launch' }))
    assert.equal(res.status, 409)
    assert.match(res.body.blockers.join(' '), /MARKETING_POSTAL_ADDRESS/)
    assert.equal(t.serviceCalls.length, 0)
  } finally { setEnv(); termsPublished = false }
})

// ── Unsubscribe ────────────────────────────────────────────────────────
const unsubUrl = (u, tok) => `${APP}/api/marketing/unsubscribe?u=${u}&t=${tok}`
test('unsubscribe GET only shows a confirmation page (link scanners change nothing)', async () => {
  const t = world()
  const res = await unsubscribe.GET(req(null, unsubUrl(CUSTOMER, signUnsubscribeToken(CUSTOMER))))
  assert.equal(res.status, 200)
  const html = await res.text()
  assert.match(html, /<form method="post"/)
  assert.equal(res.headers.get('cache-control'), 'no-store')
  assert.equal(t.serviceCalls.length, 0)
})

test('unsubscribe POST with a valid token withdraws consent; invalid tokens do nothing', async () => {
  let t = world({ serviceRpc: { record_marketing_unsubscribe: () => ({ data: true, error: null }) } })
  const res = await unsubscribe.POST(req(null, unsubUrl(CUSTOMER, signUnsubscribeToken(CUSTOMER))))
  assert.equal(res.status, 200)
  assert.deepEqual(t.serviceCalls, [['record_marketing_unsubscribe', { p_user_id: CUSTOMER }]])

  const valid = signUnsubscribeToken(CUSTOMER)
  for (const url of [unsubUrl(ADMIN, valid), unsubUrl(CUSTOMER, 'A'.repeat(43)), unsubUrl(CUSTOMER, ''), `${APP}/api/marketing/unsubscribe`, unsubUrl('<script>', valid)]) {
    t = world()
    for (const fn of [unsubscribe.GET, unsubscribe.POST]) {
      const r = await fn(req(null, url))
      assert.equal(r.status, 400, url)
      assert.doesNotMatch(await r.text(), /<script>/)
    }
    assert.equal(t.serviceCalls.length, 0)
  }
  world({ serviceRpc: { record_marketing_unsubscribe: () => ({ data: null, error: { message: 'x' } }) } })
  assert.equal((await unsubscribe.POST(req(null, unsubUrl(CUSTOMER, valid)))).status, 500)
})

test('unsubscribe without MARKETING_UNSUBSCRIBE_SECRET fails closed: 503 page, nothing changed', async () => {
  const valid = signUnsubscribeToken(CUSTOMER)
  setEnv({ MARKETING_UNSUBSCRIBE_SECRET: undefined })
  try {
    for (const fn of [unsubscribe.GET, unsubscribe.POST]) {
      const t = world({ serviceRpc: { record_marketing_unsubscribe: () => ({ data: true, error: null }) } })
      const r = await fn(req(null, unsubUrl(CUSTOMER, valid)))
      assert.equal(r.status, 503)
      assert.match(await r.text(), /Settings/)
      assert.equal(t.serviceCalls.length, 0)
    }
  } finally { setEnv() }
})

// ── Cron ───────────────────────────────────────────────────────────────
test('cron requires the bearer secret and only runs transactional emails', async () => {
  let t = world()
  assert.equal((await cron(req(null, APP, {}))).status, 401)
  assert.equal((await cron(req(null, APP, { authorization: 'Bearer wrong' }))).status, 401)
  assert.equal(t.serviceCalls.length, 0)
  setEnv({ CRON_SECRET: '' })
  assert.equal((await cron(req(null, APP, { authorization: 'Bearer ' }))).status, 401)
  setEnv()

  const listed = []
  t = world({ serviceRpc: { list_notification_deliveries: (a) => { listed.push(a); return { data: [], error: null } } } })
  const res = await cron(req(null, APP, { authorization: 'Bearer cron-secret-value' }))
  assert.equal(res.status, 200)
  assert.ok(listed.length > 0 && listed.every((a) => a.p_category === 'transactional'))
  assert.equal((await res.json()).result.batches, 1, 'empty queue: one batch')
  assert.equal((await cron(req(null, APP, { authorization: 'bearer cron-secret-value' }))).status, 401, 'exact match only')
})

test('cron drains a backlog in full batches of 50, bounded, and stops after a recipient lookup failure', async () => {
  const pendingRows = (n, prefix) => Array.from({ length: n }, (_, i) => ({ delivery_id: `${prefix}-${i}` }))
  // Two full batches, then 10, then empty: three batches; never a fourth.
  let lists = [pendingRows(50, 'a'), pendingRows(50, 'b'), pendingRows(10, 'c')]
  let t = world({ serviceRpc: {
    list_notification_deliveries: (a) => ({ data: a.p_status === 'pending' ? (lists.shift() || []) : [], error: null }),
    claim_notification_delivery: () => ({ data: [], error: null }),
  } })
  let res = await cron(req(null, APP, { authorization: 'Bearer cron-secret-value' }))
  assert.equal(res.status, 200)
  let out = (await res.json()).result
  assert.deepEqual([out.batches, out.notClaimed], [3, 110])

  // A full batch where a lookup failed (released): the run ends there.
  lists = [pendingRows(50, 'd'), pendingRows(50, 'e')]
  let claims = 0
  t = world({ serviceRpc: {
    list_notification_deliveries: (a) => ({ data: a.p_status === 'pending' ? (lists.shift() || []) : [], error: null }),
    claim_notification_delivery: (a) => { claims++; return { data: claims === 1 ? [{ delivery_id: a.p_delivery_id, attempt_id: a.p_attempt_id, attempt_count: 1, event_type: 'referral_registered_referrer', category: 'transactional', recipient_user_id: CUSTOMER, payload: {} }] : [], error: null } },
    release_notification_delivery: () => ({ data: 'pending', error: null }),
  } })
  t.service.auth.admin.getUserById = async () => ({ data: null, error: { message: 'unavailable', status: 503 } })
  t.service.from = () => { const q = { select: () => q, eq: () => q, single: async () => ({ data: { full_name: 'C', referral_code: 'CCCC1111' }, error: null }) }; return q }
  res = await cron(req(null, APP, { authorization: 'Bearer cron-secret-value' }))
  out = (await res.json()).result
  assert.deepEqual([out.batches, out.released, t.sent.length], [1, 1, 0])
  assert.ok(t.serviceCalls.some(([n]) => n === 'release_notification_delivery'))
})
