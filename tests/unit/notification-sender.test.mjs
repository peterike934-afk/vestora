// Unit tests for lib/notification-sender.js with an in-memory ledger and a
// mocked email provider. The real database functions are exercised against
// PostgreSQL 17 by tests/integration/referral-app-flow.test.mjs.
import test from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

register('../helpers/alias-hooks.mjs', import.meta.url)
const { processNotificationDeliveries, sendPendingReferralNotifications, classifyProviderResult, FROM_ADDRESS } =
  await import('@/lib/notification-sender')

const APP = 'https://vestoras.vercel.app'
const POSTAL = '100 Example Street, Suite 1, Example City, EX 00000, USA'
const ENV = { VESTORA_APP_URL: APP, RESEND_API_KEY: 're_test_mock', MARKETING_UNSUBSCRIBE_SECRET: 's'.repeat(40), MARKETING_POSTAL_ADDRESS: POSTAL }
const LEDGER_FUNCTIONS = new Set(['list_notification_deliveries', 'claim_notification_delivery', 'complete_notification_delivery', 'recover_stale_notification_delivery', 'release_notification_delivery'])
const silent = { error: () => {}, warn: () => {}, log: () => {} }

const USERS = {
  '11111111-1111-4111-8111-111111111111': { email: 'rita@example.test', full_name: 'Rita Ref', referral_code: 'RITA0001', consent: true },
  '22222222-2222-4222-8222-222222222222': { email: 'ben@example.test', full_name: 'Ben New', referral_code: 'BEN00002', consent: true },
  '33333333-3333-4333-8333-333333333333': { email: null, full_name: 'No Mail', referral_code: 'NOMAIL03', consent: true },
}

// Minimal ledger with the same contract as the database functions.
function fakeDb({ rows = [], settings = { referral_program_enabled: true, referral_referrer_bonus_usd: 30, referral_referred_bonus_usd: 12.5 }, paused = {}, failComplete = false, lookup = null } = {}) {
  const db = { rows: rows.map((r) => ({ status: 'pending', attempt_count: 0, payload: {}, campaign_key: null, ...r })), calls: [], paused }
  db.rpc = async (name, args) => {
    db.calls.push(name)
    if (!LEDGER_FUNCTIONS.has(name)) return { data: null, error: { message: `unexpected ${name}` } }
    if (name === 'list_notification_deliveries') {
      const list = db.rows.filter((r) => r.status === args.p_status && r.category === args.p_category
        && (args.p_campaign_key == null || r.campaign_key === args.p_campaign_key)).slice(0, args.p_limit)
      return { data: list.map((r) => ({ delivery_id: r.id, campaign_key: r.campaign_key, sending_started_at: r.sending_started_at })), error: null }
    }
    if (name === 'claim_notification_delivery') {
      const r = db.rows.find((x) => x.id === args.p_delivery_id)
      if (!r || r.status !== 'pending') return { data: [], error: null }
      if (r.category === 'marketing' && (db.paused[r.campaign_key] ?? true)) return { data: [], error: null }
      if (r.category === 'marketing' && !USERS[r.recipient_user_id]?.consent) { r.status = 'skipped'; return { data: [], error: null } }
      Object.assign(r, { status: 'sending', attempt_id: args.p_attempt_id, attempt_count: r.attempt_count + 1 })
      return { data: [{ delivery_id: r.id, attempt_id: r.attempt_id, attempt_count: r.attempt_count, event_type: r.event_type, category: r.category, recipient_user_id: r.recipient_user_id, payload: r.payload, campaign_key: r.campaign_key }], error: null }
    }
    if (name === 'complete_notification_delivery') {
      if (failComplete) return { data: null, error: { message: 'connection reset', code: '08006' } }
      const r = db.rows.find((x) => x.id === args.p_delivery_id)
      if (r.attempt_id !== args.p_attempt_id || r.attempt_count !== args.p_expected_attempt_count) return { data: false, error: null }
      Object.assign(r, { status: args.p_outcome, provider_message_id: args.p_provider_message_id, failure_code: args.p_failure_code })
      return { data: true, error: null }
    }
    if (name === 'release_notification_delivery') {
      // Same contract as the database function (20261126000000).
      const r = db.rows.find((x) => x.id === args.p_delivery_id)
      if (!r || r.status !== 'sending' || r.attempt_id !== args.p_attempt_id || r.attempt_count !== args.p_expected_attempt_count) return { data: null, error: null }
      Object.assign(r, r.attempt_count >= 5 ? { status: 'failed', failure_code: `${args.p_reason}_repeated` } : { status: 'pending', failure_code: args.p_reason })
      return { data: r.status, error: null }
    }
    if (name === 'recover_stale_notification_delivery') {
      const r = db.rows.find((x) => x.id === args.p_delivery_id)
      r.status = 'uncertain'
      r.failure_code = 'stale_sending'
      return { data: true, error: null }
    }
  }
  db.from = (table) => {
    db.calls.push(`from:${table}`)
    const q = { _eq: null, select() { return q }, eq(col, val) { q._eq = val; return q },
      async single() {
        if (table === 'settings') return settings ? { data: settings, error: null } : { data: null, error: { message: 'no row' } }
        if (table === 'profiles') { const u = USERS[q._eq]; return u ? { data: { full_name: u.full_name, referral_code: u.referral_code }, error: null } : { data: null, error: { message: 'no row' } } }
        throw new Error(`unexpected table ${table}`)
      } }
    return q
  }
  db.auth = { admin: { getUserById: async (id) => {
    db.calls.push('auth.getUserById')
    if (lookup) return lookup(id)
    return USERS[id] ? { data: { user: { id, email: USERS[id].email } }, error: null } : { data: { user: null }, error: { message: 'User not found', status: 404 } }
  } } }
  return db
}

function mailer(responses = []) {
  const sent = []
  const fn = async (payload, options) => {
    sent.push({ payload, options })
    const next = responses.length ? responses.shift() : { data: { id: `msg_${sent.length}` }, error: null }
    if (next instanceof Error) throw next
    return next
  }
  fn.sent = sent
  return fn
}

let n = 0
const newId = () => `attempt-${++n}`
const tx = (id, event_type, recipient_user_id, payload = {}) => ({ id, category: 'transactional', event_type, recipient_user_id, payload })

test('provider outcome classification', () => {
  assert.equal(classifyProviderResult({ data: { id: 'm1' } }).outcome, 'sent')
  for (const s of [400, 401, 403, 404, 422]) assert.equal(classifyProviderResult({ error: { statusCode: s } }).outcome, 'failed', String(s))
  for (const s of [408, 409, 425, 429, 500, 502, 503]) assert.equal(classifyProviderResult({ error: { statusCode: s } }).outcome, 'uncertain', String(s))
  assert.equal(classifyProviderResult({ error: { message: 'no status' } }).outcome, 'uncertain')
  assert.equal(classifyProviderResult({ data: {} }).outcome, 'uncertain')
  assert.equal(classifyProviderResult(undefined).outcome, 'uncertain')
})

test('sends pending transactional emails once, with a per-attempt idempotency key', async () => {
  const db = fakeDb({ rows: [tx('d1', 'referral_registered_referrer', '11111111-1111-4111-8111-111111111111', { referral_id: 7 }), tx('d2', 'referral_paid_referred', '22222222-2222-4222-8222-222222222222', { referral_id: 7, amount_usd: 12.5 })] })
  const send = mailer()
  const r = await processNotificationDeliveries({ db, sendEmail: send, env: ENV, newId, logger: silent })
  assert.deepEqual([r.status, r.claimed, r.sent, r.failed, r.uncertain], ['ok', 2, 2, 0, 0])
  assert.equal(send.sent.length, 2)
  assert.equal(send.sent[0].payload.from, FROM_ADDRESS)
  assert.equal(send.sent[0].payload.to, 'rita@example.test')
  assert.match(send.sent[0].options.idempotencyKey, /^notify\/d1\/attempt-\d+$/)
  assert.match(send.sent[1].payload.html, /\$12\.50/)
  assert.deepEqual(db.rows.map((x) => [x.status, x.provider_message_id]), [['sent', 'msg_1'], ['sent', 'msg_2']])

  // Running again (duplicate request / cron overlap) sends nothing more.
  const again = await processNotificationDeliveries({ db, sendEmail: send, env: ENV, newId, logger: silent })
  assert.equal(again.claimed, 0)
  assert.equal(send.sent.length, 2)
})

test('the sender only ever calls ledger functions (never referral, wallet or payment functions)', async () => {
  const db = fakeDb({ rows: [tx('d1', 'referral_rejected_referred', '22222222-2222-4222-8222-222222222222', { referral_id: 7, reason: 'not_eligible' })] })
  await processNotificationDeliveries({ db, sendEmail: mailer([{ error: { statusCode: 500 } }]), env: ENV, newId, logger: silent })
  const rpcs = db.calls.filter((c) => !c.startsWith('from:') && c !== 'auth.getUserById')
  assert.ok(rpcs.every((c) => LEDGER_FUNCTIONS.has(c)), rpcs.join(','))
  assert.deepEqual([...new Set(db.calls.filter((c) => c.startsWith('from:')))], ['from:profiles'])
})

test('definite provider rejection -> failed; ambiguous/throw -> uncertain; neither is resent automatically', async () => {
  const db = fakeDb({ rows: [
    tx('d1', 'referral_registered_referrer', '11111111-1111-4111-8111-111111111111'),
    tx('d2', 'referral_registered_referred', '22222222-2222-4222-8222-222222222222'),
    tx('d3', 'referral_registered_referrer', '11111111-1111-4111-8111-111111111111'),
  ] })
  const send = mailer([{ error: { statusCode: 422, message: 'invalid to' } }, { error: { statusCode: 429 } }, new Error('socket hang up')])
  const r = await processNotificationDeliveries({ db, sendEmail: send, env: ENV, newId, logger: silent })
  assert.deepEqual([r.sent, r.failed, r.uncertain], [0, 1, 2])
  assert.deepEqual(db.rows.map((x) => [x.status, x.failure_code]), [['failed', 'provider_422'], ['uncertain', 'provider_429'], ['uncertain', 'provider_response_uncertain']])
  const again = await processNotificationDeliveries({ db, sendEmail: send, env: ENV, newId, logger: silent })
  assert.equal(again.claimed, 0)
  assert.equal(send.sent.length, 3, 'no automatic resend')
})

test('account without an email, or deleted account -> failed without calling the provider', async () => {
  const db = fakeDb({ rows: [tx('d1', 'referral_registered_referred', '33333333-3333-4333-8333-333333333333'), tx('d2', 'referral_registered_referred', '44444444-4444-4444-8444-444444444444')] })
  const send = mailer()
  const r = await processNotificationDeliveries({ db, sendEmail: send, env: ENV, newId, logger: silent })
  assert.equal(send.sent.length, 0)
  assert.equal(r.failed, 2)
  assert.deepEqual(db.rows.map((x) => [x.status, x.failure_code]), [['failed', 'recipient_email_missing'], ['failed', 'recipient_not_found']])
})

test('temporary recipient lookup failure -> released back to pending (provider never called), sent on a later run', async () => {
  const rows = [tx('d1', 'referral_registered_referrer', '11111111-1111-4111-8111-111111111111'), tx('d2', 'referral_registered_referred', '22222222-2222-4222-8222-222222222222')]
  const failures = [
    () => ({ data: null, error: { message: 'Service unavailable', status: 503 } }),
    () => { throw new Error('fetch failed') },
  ]
  for (const failure of failures) {
    const db = fakeDb({ rows: rows.map((r) => ({ ...r })), lookup: failure })
    const send = mailer()
    const r = await processNotificationDeliveries({ db, sendEmail: send, env: ENV, newId, logger: silent })
    assert.equal(send.sent.length, 0, 'nothing sent')
    assert.deepEqual([r.claimed, r.released, r.failed, r.uncertain], [2, 2, 0, 0])
    assert.deepEqual(db.rows.map((x) => [x.status, x.failure_code]), [['pending', 'recipient_lookup_failed'], ['pending', 'recipient_lookup_failed']])
    // Auth is back: the next run sends both, once.
    const later = fakeDb({ rows: db.rows })
    const r2 = await processNotificationDeliveries({ db: later, sendEmail: send, env: ENV, newId, logger: silent })
    assert.deepEqual([r2.sent, send.sent.length], [2, 2])
    assert.ok(later.rows.every((x) => x.status === 'sent'))
  }
})

test('profile lookup failure -> released too; after 5 attempts it is failed for an admin', async () => {
  const db = fakeDb({ rows: [{ ...tx('d1', 'referral_registered_referrer', '11111111-1111-4111-8111-111111111111'), attempt_count: 4 }] })
  db.from = (table) => {
    db.calls.push(`from:${table}`)
    const q = { select() { return q }, eq() { return q }, async single() { return { data: null, error: { message: 'timeout', code: '57014' } } } }
    return q
  }
  const send = mailer()
  const r = await processNotificationDeliveries({ db, sendEmail: send, env: ENV, newId, logger: silent })
  assert.equal(send.sent.length, 0)
  assert.deepEqual([r.released, r.failed], [0, 1])
  assert.deepEqual([db.rows[0].status, db.rows[0].failure_code], ['failed', 'recipient_lookup_failed_repeated'])
})

test('bad payload (no amount on a paid email) -> failed render, never "$0.00"', async () => {
  const db = fakeDb({ rows: [tx('d1', 'referral_paid_referrer', '11111111-1111-4111-8111-111111111111', { referral_id: 1 })] })
  const send = mailer()
  const r = await processNotificationDeliveries({ db, sendEmail: send, env: ENV, newId, logger: silent })
  assert.equal(send.sent.length, 0)
  assert.equal(r.failed, 1)
  assert.equal(db.rows[0].failure_code, 'render_failed')
})

test('not configured (no provider key / app URL not allowlisted): claims nothing, emails stay pending', async () => {
  for (const env of [{ ...ENV, VESTORA_APP_URL: undefined }, { ...ENV, VESTORA_APP_URL: 'https://vestorainvestment.com' }]) {
    const db = fakeDb({ rows: [tx('d1', 'referral_registered_referrer', '11111111-1111-4111-8111-111111111111')] })
    const r = await processNotificationDeliveries({ db, sendEmail: mailer(), env, newId, logger: silent })
    assert.equal(r.status, 'not_configured')
    assert.deepEqual(db.calls, [])
    assert.equal(db.rows[0].status, 'pending')
  }
  const db = fakeDb({ rows: [tx('d1', 'referral_registered_referrer', '11111111-1111-4111-8111-111111111111')] })
  const r = await sendPendingReferralNotifications({ db, env: { ...ENV, RESEND_API_KEY: '' }, logger: silent })
  assert.equal(r.status, 'not_configured')
  assert.equal(db.rows[0].status, 'pending')
})

test('outcome that cannot be recorded stays "sending" (later recovered as uncertain), never resent', async () => {
  const db = fakeDb({ rows: [tx('d1', 'referral_registered_referrer', '11111111-1111-4111-8111-111111111111')], failComplete: true })
  const send = mailer()
  await processNotificationDeliveries({ db, sendEmail: send, env: ENV, newId, logger: silent })
  assert.equal(db.rows[0].status, 'sending')
  db.rows[0].sending_started_at = new Date(Date.now() - 16 * 60_000).toISOString()
  const later = fakeDb({ rows: db.rows })
  const r = await processNotificationDeliveries({ db: later, sendEmail: send, env: ENV, newId, logger: silent })
  assert.equal(r.recovered, 1)
  assert.equal(later.rows[0].status, 'uncertain')
  assert.equal(send.sent.length, 1, 'not resent')
})

test('a fresh "sending" row (another run in progress) is not recovered', async () => {
  const db = fakeDb({ rows: [{ ...tx('d1', 'referral_registered_referrer', '11111111-1111-4111-8111-111111111111'), status: 'sending', sending_started_at: new Date().toISOString() }] })
  const r = await processNotificationDeliveries({ db, sendEmail: mailer(), env: ENV, newId, logger: silent })
  assert.equal(r.recovered, 0)
  assert.equal(db.rows[0].status, 'sending')
})

test('sendPendingReferralNotifications never throws', async () => {
  const broken = { rpc: async () => { throw new Error('boom') }, from: () => { throw new Error('boom') }, auth: { admin: {} } }
  const r = await sendPendingReferralNotifications({ db: broken, env: ENV, logger: silent })
  assert.equal(r.status, 'error')
  // Without a db and without a configured service client it also only logs.
  globalThis.__t = {}
  const r2 = await sendPendingReferralNotifications({ env: ENV, logger: silent })
  assert.equal(r2.status, 'error')
})

const mk = (id, user) => ({ id, category: 'marketing', event_type: 'campaign_referral_launch', recipient_user_id: user, campaign_key: 'referral-launch' })

test('campaign: blocked without the gate; paused sends nothing; consent re-checked per email', async () => {
  const rows = [mk('c1', '11111111-1111-4111-8111-111111111111'), mk('c2', '22222222-2222-4222-8222-222222222222')]
  // Gate closed (e.g. no published terms): nothing read, nothing claimed.
  let db = fakeDb({ rows })
  let r = await processNotificationDeliveries({ db, sendEmail: mailer(), category: 'marketing', campaignKey: 'referral-launch', campaignAllowed: false, env: ENV, newId, logger: silent })
  assert.equal(r.status, 'campaign_blocked')
  assert.deepEqual(db.calls, [])

  // Paused: listed but not claimed; stays pending.
  db = fakeDb({ rows, paused: { 'referral-launch': true } })
  const send = mailer()
  r = await processNotificationDeliveries({ db, sendEmail: send, category: 'marketing', campaignKey: 'referral-launch', campaignAllowed: true, env: ENV, newId, logger: silent })
  assert.deepEqual([r.claimed, r.notClaimed, send.sent.length], [0, 2, 0])
  assert.ok(db.rows.every((x) => x.status === 'pending'))

  // Resumed, but Ben withdrew consent after queueing: Ben is skipped.
  USERS['22222222-2222-4222-8222-222222222222'].consent = false
  try {
    db.paused['referral-launch'] = false
    r = await processNotificationDeliveries({ db, sendEmail: send, category: 'marketing', campaignKey: 'referral-launch', campaignAllowed: true, env: ENV, newId, logger: silent })
    assert.deepEqual([r.sent, r.notClaimed], [1, 1])
    assert.deepEqual(db.rows.map((x) => x.status), ['sent', 'skipped'])
    const m = send.sent[0]
    assert.equal(m.payload.to, 'rita@example.test')
    assert.match(m.payload.html, /\$30\.00[\s\S]*\$12\.50/, 'live settings amounts')
    assert.match(m.payload.html, /signup\?ref=RITA0001/)
    assert.match(m.payload.headers['List-Unsubscribe'], /^<https:\/\/vestoras\.vercel\.app\/api\/marketing\/unsubscribe\?u=11111111-1111-4111-8111-111111111111/)
    assert.ok(m.payload.html.includes(POSTAL) && m.payload.text.includes(POSTAL), 'postal address in both HTML and text')
  } finally {
    USERS['22222222-2222-4222-8222-222222222222'].consent = true
  }
})

test('campaign: programme disabled or settings unreadable -> nothing claimed', async () => {
  for (const [settings, status] of [[{ referral_program_enabled: false }, 'programme_disabled'], [null, 'settings_unavailable']]) {
    const db = fakeDb({ rows: [mk('c1', '11111111-1111-4111-8111-111111111111')], settings, paused: { 'referral-launch': false } })
    const r = await processNotificationDeliveries({ db, sendEmail: mailer(), category: 'marketing', campaignKey: 'referral-launch', campaignAllowed: true, env: ENV, newId, logger: silent })
    assert.equal(r.status, status)
    assert.equal(db.rows[0].status, 'pending')
  }
  const db = fakeDb({ rows: [mk('c1', '11111111-1111-4111-8111-111111111111')], paused: { 'referral-launch': false } })
  const r = await processNotificationDeliveries({ db, sendEmail: mailer(), category: 'marketing', campaignKey: 'referral-launch', campaignAllowed: true, env: { ...ENV, MARKETING_UNSUBSCRIBE_SECRET: '' }, newId, logger: silent })
  assert.equal(r.status, 'not_configured')
  // No (or an implausible) postal address: nothing claimed, nothing sent.
  for (const postal of [undefined, '', '   ', 'PO Box', 'x'.repeat(301), '<b>1 Main St, Town</b>']) {
    const d = fakeDb({ rows: [mk('c1', '11111111-1111-4111-8111-111111111111')], paused: { 'referral-launch': false } })
    const send = mailer()
    const res = await processNotificationDeliveries({ db: d, sendEmail: send, category: 'marketing', campaignKey: 'referral-launch', campaignAllowed: true, env: { ...ENV, MARKETING_POSTAL_ADDRESS: postal }, newId, logger: silent })
    assert.equal(res.status, 'not_configured', JSON.stringify(postal))
    assert.deepEqual([d.calls, send.sent.length, d.rows[0].status], [[], 0, 'pending'])
  }
})

test('the transactional run never picks up campaign emails', async () => {
  const db = fakeDb({ rows: [mk('c1', '11111111-1111-4111-8111-111111111111'), tx('d1', 'referral_registered_referrer', '11111111-1111-4111-8111-111111111111')], paused: { 'referral-launch': false } })
  const send = mailer()
  await processNotificationDeliveries({ db, sendEmail: send, env: ENV, newId, logger: silent })
  assert.equal(send.sent.length, 1)
  assert.deepEqual(db.rows.map((x) => x.status), ['pending', 'sent'])
})
