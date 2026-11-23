// Route-level tests for app/api/admin/verify-transaction/route.js, the only
// route that can move real money. The real route file is loaded with its
// payment modules replaced by recorders (no blockchain, no Stripe, no
// network) and an in-memory model of the database functions with the same
// contract as 20261127000000 (switches, valid hold, one active claim). The
// real switch, network, address-tolerance and same-origin logic is used.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const dir = mkdtempSync(join(tmpdir(), 'vestora-verify-'))
const put = (name, body) => { writeFileSync(join(dir, name), body); return pathToFileURL(join(dir, name)).href }
const real = (rel) => readFileSync(join(root, rel), 'utf8')

const fcUrl = put('fc.mjs', real('lib/financial-controls.js'))
const netUrl = put('net.mjs', real('lib/blockchain-network.js'))
const originUrl = put('origin.mjs', real('lib/request-origin.js'))
const priceRealUrl = put('price-real.mjs', real('lib/crypto-price.js').replace("import 'server-only'\n", ''))
const stubs = {
  '@/lib/supabase/server': put('server.mjs', 'export async function createClient() { return globalThis.__v.auth }\n'),
  '@/lib/supabase/admin': put('admin.mjs', 'export function createAdminClient() { return globalThis.__v.service }\n'),
  '@/lib/audit': put('audit.mjs', 'export async function logAdminAction(_c, entry) { globalThis.__v.audits.push(entry) }\n'),
  '@/lib/blockchain': put('chain.mjs', 'export async function verifyTransaction(...a) { return globalThis.__v.chain(...a) }\n'),
  '@/lib/wallet': put('wallet.mjs', [
    `import { assertWithdrawalPayoutsEnabled } from '${fcUrl}'`,
    // Same order as lib/wallet.js: the library refuses before anything else.
    'export async function sendCryptoPayout(c, a, amount, opts = {}) { assertWithdrawalPayoutsEnabled(); globalThis.__v.sends.push([c, a, amount]); return globalThis.__v.send(c, a, amount, opts.onBroadcast) }',
    'export async function getHotWalletBalance(c) { return globalThis.__v.hotBalance(c) }',
    'export function isValidPayoutAddress(c, a) { return globalThis.__v.validAddress(c, a) }',
  ].join('\n') + '\n'),
  '@/lib/stripe': put('stripe.mjs', [
    `import { assertBankDepositPullsEnabled, assertWithdrawalPayoutsEnabled } from '${fcUrl}'`,
    'export async function createBankPullPaymentIntent(p, o) { assertBankDepositPullsEnabled(); globalThis.__v.stripe.push(["paymentIntent", p, o]); return globalThis.__v.paymentIntent(p) }',
    'export async function createWithdrawalTransfer(p, o) { assertWithdrawalPayoutsEnabled(); globalThis.__v.stripe.push(["transfer", p, o]); return globalThis.__v.transfer(p) }',
  ].join('\n') + '\n'),
  '@/lib/crypto-price': put('price.mjs', [
    `export { confirmedAmountAcceptable, PAYOUT_DECIMALS, cryptoAmountFor } from '${priceRealUrl}'`,
    'export async function getPayoutQuote(c, usd) { globalThis.__v.quotes++; return globalThis.__v.quote(c, usd) }',
  ].join('\n') + '\n'),
  '@/lib/blockchain-network': netUrl,
  '@/lib/financial-controls': fcUrl,
  '@/lib/request-origin': originUrl,
  '@/lib/email': put('email.mjs', [
    'const e = () => ({ subject: "s", title: "t", bodyHtml: "b" })',
    'export const depositVerifiedEmail = e, depositRejectedEmail = e, withdrawalVerifiedEmail = e, withdrawalRejectedEmail = e, investmentWithdrawalVerifiedEmail = e, investmentWithdrawalRejectedEmail = e',
    'export async function sendNotificationEmail(m) { globalThis.__v.emails.push(m) }',
  ].join('\n') + '\n'),
  'next/server': put('next.mjs', 'export const NextResponse = { json: (body, init = {}) => ({ status: init.status ?? 200, body }) }\n'),
}
let source = real('app/api/admin/verify-transaction/route.js')
for (const [spec, url] of Object.entries(stubs)) {
  assert.equal(source.split(`from "${spec}"`).length - 1, 1, `route imports ${spec} once`)
  source = source.replace(`from "${spec}"`, `from "${url}"`)
}
assert.equal((source.match(/^import /gm) || []).length, Object.keys(stubs).length, 'no other imports')
const { POST, GET } = await import(put('route.mjs', source))
const { PaymentDisabledError, WITHDRAWAL_PAYOUTS_DISABLED_CODE } = await import(fcUrl)

const APP = 'https://vestoras.vercel.app'
const SAME = { 'content-type': 'application/json', origin: APP, 'sec-fetch-site': 'same-origin', host: 'vestoras.vercel.app' }
const ADMIN = 'aaaaaaaa-0000-4000-8000-000000000001'
const USER = 'bbbbbbbb-0000-4000-8000-000000000002'
const ETH_ADDR = '0x00000000000000000000000000000000000000Aa'

// ------------------------------------------------------------ in-memory world
function world({ role = 'admin', signedIn = true, app = {}, db = {}, txns = [], holds = {}, quote, send } = {}) {
  for (const [k, v] of [['WITHDRAWAL_PAYOUTS_ENABLED', app.withdrawals], ['BANK_DEPOSIT_PULLS_ENABLED', app.pulls], ['BLOCKCHAIN_NETWORK', 'network' in app ? app.network : 'mainnet']]) {
    if (v === undefined || v === null) delete process.env[k]; else process.env[k] = v
  }
  // Stripe itself is replaced by a recorder; a dummy key only lets the route
  // reach the (mocked, guarded) Stripe call instead of its "not configured" exit.
  process.env.STRIPE_SECRET_KEY = 'sk_test_not_real_mocked'
  const v = {
    txns: new Map(txns.map((t) => [t.id, { status: 'pending', ...t }])),
    holds: new Map(Object.entries(holds).map(([k, h]) => [k, { ...h }])), // fresh copy per test
    claims: new Map(),
    balances: new Map([[USER, 100]]),
    db: { withdrawal_payouts: false, bank_deposit_pulls: false, ...db },
    rpc: [], sends: [], stripe: [], audits: [], emails: [], quotes: 0, sessionReads: 0,
  }
  v.quote = quote || ((c, usd) => ({ currency: c, amountUsd: Number(usd), priceUsd: 2000, cryptoAmount: (Number(usd) / 2000).toFixed(8), sources: [{ name: 'coinbase', priceUsd: 2000 }, { name: 'kraken', priceUsd: 2000 }], quotedAt: '2026-11-23T00:00:00.000Z' }))
  v.send = send || (async (c, a, amount, onBroadcast) => { await onBroadcast?.('0xhash1'); return { txHash: '0xhash1' } })
  v.hotBalance = async () => 1000
  v.validAddress = (c, a) => typeof a === 'string' && !a.includes('bad')
  v.chain = async () => ({ found: true, succeeded: true, matchesAddress: true, amountMatches: true, confirmed: true })
  v.paymentIntent = async () => ({ id: 'pi_1', status: 'processing' })
  v.transfer = async () => ({ id: 'tr_1' })
  const err = (message) => ({ data: null, error: { message } })
  const claimOf = (id, token) => { const c = v.claims.get(id); return c && c.token === token ? c : null }
  v.auth = {
    auth: { getUser: async () => { v.sessionReads++; return { data: { user: signedIn ? { id: ADMIN } : null } } } },
    from: (table) => {
      const q = { select: () => q, eq: () => q,
        single: async () => ({ data: table === 'profiles' ? { role } : null, error: null }),
        then: (res) => res({ data: table === 'financial_operation_controls' ? Object.entries(v.db).map(([operation, enabled]) => ({ operation, enabled })) : [], error: null }) }
      return q
    },
    rpc: async (name, a) => {
      v.rpc.push(name)
      const t = v.txns.get(a.p_transaction_id)
      if (name === 'claim_transaction_for_approval') {
        if (!t || t.status !== 'pending') return err('Transaction is no longer pending')
        if (t.type === 'withdrawal') {
          if (!v.db.withdrawal_payouts) return err('Withdrawal payouts are disabled')
          const h = v.holds.get(t.id)
          if (!h || h.state !== 'held' || h.amount !== t.amount_usd) return err('Withdrawal has no valid funds hold; manual review required')
        } else if (t.type === 'deposit' && t.payment_method === 'bank' && !v.db.bank_deposit_pulls) {
          return err('Bank deposit pulls are disabled')
        }
        const c = v.claims.get(t.id)
        if (c && c.state !== 'released') return err('Transaction already has an active or completed processing claim')
        const token = `tok-${t.id}-${v.rpc.length}`
        v.claims.set(t.id, { token, state: 'processing', evidence: {} })
        return { data: token, error: null }
      }
      if (name === 'record_transaction_claim_evidence') {
        const c = claimOf(a.p_transaction_id, a.p_claim_token)
        if (!c || c.state !== 'processing') return err('No matching processing claim')
        Object.assign(c.evidence, a.p_provider_evidence)
        return { data: null, error: null }
      }
      if (name === 'release_transaction_claim' || name === 'mark_transaction_claim_uncertain') {
        const c = claimOf(a.p_transaction_id, a.p_claim_token)
        if (!c || c.state !== 'processing') return err('No matching processing claim')
        c.state = name === 'release_transaction_claim' ? 'released' : 'uncertain'
        Object.assign(c.evidence, a.p_provider_evidence)
        return { data: null, error: null }
      }
      if (name === 'finalize_transaction_approval') {
        const c = claimOf(a.p_transaction_id, a.p_claim_token)
        if (!c || c.state !== 'processing') return err('No matching active approval claim')
        c.state = 'completed'
        t.status = 'verified'
        t.sent_tx_hash = c.evidence.sentTxHash ?? null
        if (t.type === 'deposit') v.balances.set(t.user_id, v.balances.get(t.user_id) + t.amount_usd)
        if (t.type === 'withdrawal') v.holds.get(t.id).state = 'consumed'
        return { data: { newBalance: v.balances.get(t.user_id) }, error: null }
      }
      if (name === 'reject_pending_transaction') {
        if (!t || t.status !== 'pending') return err('Transaction is no longer pending')
        t.status = 'rejected'
        const h = v.holds.get(t.id)
        if (h?.state === 'held') { h.state = 'released'; v.balances.set(t.user_id, v.balances.get(t.user_id) + h.amount) }
        return { data: null, error: null }
      }
      return err(`unexpected rpc ${name}`)
    },
  }
  v.service = {
    from: (table) => {
      let id = null
      const q = { select: () => q, eq: (_c, val) => { id = val; return q },
        single: async () => {
          if (table === 'transactions') { const t = v.txns.get(id); return t ? { data: { ...t }, error: null } : { data: null, error: { message: 'none' } } }
          if (table === 'profiles') return { data: { email: 'c@example.test', email_notifications: true, stripe_customer_id: 'cus_1', stripe_connect_account_id: 'acct_1', stripe_connect_onboarded: true }, error: null }
          if (table === 'linked_bank_accounts') return { data: { stripe_payment_method_id: 'pm_1', status: 'active' }, error: null }
          if (table === 'settings') return { data: { eth_deposit_address: ETH_ADDR }, error: null }
          return { data: null, error: { message: 'unexpected' } }
        },
        update: (obj) => ({ eq: async (_c, val) => { Object.assign(v.txns.get(val) || {}, obj); return { error: null } } }) }
      return q
    },
  }
  globalThis.__v = v
  return v
}
const req = (body, headers = SAME) => ({ url: `${APP}/api/admin/verify-transaction`, headers: new Headers(headers), json: async () => body })
const verify = (id, extra = {}, headers) => POST(req({ transactionId: id, action: 'verify', ...extra }, headers))
const cryptoW = (over = {}) => ({ id: 'w1', user_id: USER, type: 'withdrawal', amount_usd: 50, payment_method: 'crypto', crypto_currency: 'ETH', crypto_amount: 99, destination_address: ETH_ADDR, ...over })
const HELD = { w1: { state: 'held', amount: 50 } }
const BOTH_ON = { app: { withdrawals: 'true', pulls: 'true' }, db: { withdrawal_payouts: true, bank_deposit_pulls: true } }
function nothingMoved(v, label) {
  assert.deepEqual(v.sends, [], `${label}: no crypto sent`)
  assert.deepEqual(v.stripe, [], `${label}: no Stripe call`)
}

// ------------------------------------------------------------ defaults: frozen
test('default (nothing configured): every withdrawal kind is refused before the claim; nothing is sent', async () => {
  for (const t of [cryptoW(), cryptoW({ payment_method: 'bank', crypto_currency: null, destination_address: null }), cryptoW({ payment_method: 'wire', crypto_currency: null, destination_address: null })]) {
    const v = world({ txns: [t], holds: HELD })
    const res = await verify('w1', { confirmedCryptoAmount: '0.025' })
    assert.equal(res.status, 503, t.payment_method)
    assert.equal(res.body.code, 'WITHDRAWAL_PAYOUTS_DISABLED')
    assert.deepEqual(v.rpc, [], `${t.payment_method}: no claim`)
    assert.equal(v.quotes, 0, 'no price lookup either')
    nothingMoved(v, t.payment_method)
    assert.equal(v.txns.get('w1').status, 'pending')
  }
})

test('default: a bank-pull deposit is refused before the claim; no PaymentIntent, no bank debit', async () => {
  const v = world({ txns: [{ id: 'd1', user_id: USER, type: 'deposit', amount_usd: 500, payment_method: 'bank', linked_bank_account_id: 'lb1' }] })
  const res = await verify('d1')
  assert.deepEqual([res.status, res.body.code], [503, 'BANK_DEPOSIT_PULLS_DISABLED'])
  assert.deepEqual(v.rpc, [])
  nothingMoved(v, 'bank pull')
})

test('application switch on, database switch off: the database refuses the claim; nothing is sent', async () => {
  let v = world({ app: { withdrawals: 'true' }, txns: [cryptoW()], holds: HELD })
  let res = await verify('w1', { confirmedCryptoAmount: '0.025' })
  assert.deepEqual([res.status, res.body.code], [503, 'WITHDRAWAL_PAYOUTS_DISABLED'])
  assert.deepEqual(v.rpc, ['claim_transaction_for_approval'])
  nothingMoved(v, 'db off')
  v = world({ app: { pulls: 'true' }, txns: [{ id: 'd1', user_id: USER, type: 'deposit', amount_usd: 500, payment_method: 'bank', linked_bank_account_id: 'lb1' }] })
  res = await verify('d1')
  assert.deepEqual([res.status, res.body.code], [503, 'BANK_DEPOSIT_PULLS_DISABLED'])
  nothingMoved(v, 'db pulls off')
})

test('payment library refuses even if the route were bypassed: claim released, never marked uncertain', async () => {
  const v = world({ ...BOTH_ON, txns: [cryptoW()], holds: HELD,
    send: async () => { throw new PaymentDisabledError(WITHDRAWAL_PAYOUTS_DISABLED_CODE, 'off') } })
  const res = await verify('w1', { confirmedCryptoAmount: '0.025' })
  assert.deepEqual([res.status, res.body.code], [503, 'WITHDRAWAL_PAYOUTS_DISABLED'])
  assert.equal(v.claims.get('w1').state, 'released', 'nothing was sent, so the claim is released')
  assert.equal(v.txns.get('w1').status, 'pending')
})

// ------------------------------------------------------------ crypto amount
test('crypto: the customer-typed amount is never used; an admin-confirmed server quote is required', async () => {
  let v = world({ ...BOTH_ON, txns: [cryptoW()], holds: HELD })
  let res = await verify('w1')
  assert.equal(res.status, 400, 'no confirmed amount')
  assert.match(res.body.error, /quote/)
  nothingMoved(v, 'unconfirmed')
  for (const wrong of ['99', '0.0300', '0.0240', 'abc', '-1']) {
    v = world({ ...BOTH_ON, txns: [cryptoW()], holds: HELD })
    res = await verify('w1', { confirmedCryptoAmount: wrong })
    assert.ok([400, 409].includes(res.status), `${wrong} -> ${res.status}`)
    assert.deepEqual(v.rpc, [], `${wrong}: refused before the claim`)
    nothingMoved(v, `wrong ${wrong}`)
  }
  v = world({ ...BOTH_ON, txns: [cryptoW()], holds: HELD })
  res = await verify('w1', { confirmedCryptoAmount: '0.030' })
  assert.equal(res.status, 409)
  assert.equal(res.body.quote.cryptoAmount, '0.02500000', 'the fresh server amount is returned for re-confirmation')
})

test('crypto: pays the confirmed server amount once; hash saved at broadcast, before finalizing', async () => {
  const order = []
  const v = world({ ...BOTH_ON, txns: [cryptoW()], holds: HELD,
    send: async (c, a, amount, onBroadcast) => { order.push('broadcast'); await onBroadcast('0xabc'); order.push(`evidence:${globalThis.__v.claims.get('w1').evidence.sentTxHash}`); return { txHash: '0xabc' } } })
  const res = await verify('w1', { confirmedCryptoAmount: '0.025' })
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.deepEqual(v.sends, [['ETH', ETH_ADDR, '0.02500000']], 'server-calculated amount, not the customer-typed 99 ETH')
  assert.deepEqual(order, ['broadcast', 'evidence:0xabc'], 'hash persisted before the send even returned')
  assert.deepEqual(v.rpc, ['claim_transaction_for_approval', 'record_transaction_claim_evidence', 'record_transaction_claim_evidence', 'finalize_transaction_approval'])
  assert.equal(v.txns.get('w1').status, 'verified')
  assert.equal(v.txns.get('w1').sent_tx_hash, '0xabc')
  assert.equal(v.holds.get('w1').state, 'consumed')
  assert.equal(v.balances.get(USER), 100, 'balance unchanged at payout: the funds were already held')
  assert.equal(res.body.payoutCryptoAmount, '0.02500000')
})

test('crypto: never pays more than the fresh fair amount, even if the admin confirmed slightly more', async () => {
  const v = world({ ...BOTH_ON, txns: [cryptoW()], holds: HELD })
  const res = await verify('w1', { confirmedCryptoAmount: '0.0252' }) // within 1%, above 0.025
  assert.equal(res.status, 200)
  assert.deepEqual(v.sends, [['ETH', ETH_ADDR, '0.02500000']])
})

test('crypto: invalid destination, missing network, or price unavailable are refused before the claim', async () => {
  let v = world({ ...BOTH_ON, txns: [cryptoW({ destination_address: '0xbad' })], holds: HELD })
  assert.equal((await verify('w1', { confirmedCryptoAmount: '0.025' })).status, 409)
  nothingMoved(v, 'bad address'); assert.deepEqual(v.rpc, [])
  v = world({ ...BOTH_ON, app: { ...BOTH_ON.app, network: null }, txns: [cryptoW()], holds: HELD })
  let res = await verify('w1', { confirmedCryptoAmount: '0.025' })
  assert.equal(res.status, 503); assert.match(res.body.error, /BLOCKCHAIN_NETWORK/)
  nothingMoved(v, 'no network'); assert.deepEqual(v.rpc, [])
  v = world({ ...BOTH_ON, txns: [cryptoW()], holds: HELD, quote: () => { throw new Error('A trusted price source is unavailable') } })
  res = await verify('w1', { confirmedCryptoAmount: '0.025' })
  assert.equal(res.status, 503); nothingMoved(v, 'no price'); assert.deepEqual(v.rpc, [])
})

// ------------------------------------------------------------ holds, races, uncertainty
test('a withdrawal without a valid hold (legacy or directly inserted) cannot be paid; it stays pending', async () => {
  for (const holds of [{}, { w1: { state: 'released', amount: 50 } }, { w1: { state: 'held', amount: 49.99 } }]) {
    const v = world({ ...BOTH_ON, txns: [cryptoW()], holds })
    const res = await verify('w1', { confirmedCryptoAmount: '0.025' })
    assert.equal(res.status, 409)
    assert.match(res.body.error, /no valid funds hold; manual review required/)
    nothingMoved(v, JSON.stringify(holds))
    assert.equal(v.txns.get('w1').status, 'pending')
    assert.equal(v.balances.get(USER), 100, 'no balance change')
  }
})

test('two simultaneous approvals of one withdrawal: exactly one payout', async () => {
  let release
  const gate = new Promise((r) => { release = r })
  const v = world({ ...BOTH_ON, txns: [cryptoW()], holds: HELD,
    send: async (c, a, amount, onBroadcast) => { await gate; await onBroadcast('0xone'); return { txHash: '0xone' } } })
  const first = verify('w1', { confirmedCryptoAmount: '0.025' })
  await new Promise((r) => setImmediate(r))
  const second = await verify('w1', { confirmedCryptoAmount: '0.025' })
  release()
  const firstRes = await first
  assert.equal(firstRes.status, 200)
  assert.equal(second.status, 409, 'second approval refused by the active claim')
  assert.equal(v.sends.length, 1)
})

test('broadcast then failure: marked uncertain WITH the hash, never released; a retry sends nothing', async () => {
  const v = world({ ...BOTH_ON, txns: [cryptoW()], holds: HELD,
    send: async (c, a, amount, onBroadcast) => { await onBroadcast('0xsent'); const e = new Error('confirmation timeout'); e.txHash = '0xsent'; throw e } })
  const res = await verify('w1', { confirmedCryptoAmount: '0.025' })
  assert.equal(res.status, 503)
  assert.equal(res.body.sentTxHash, '0xsent')
  const c = v.claims.get('w1')
  assert.equal(c.state, 'uncertain')
  assert.equal(c.evidence.sentTxHash, '0xsent')
  assert.equal(v.txns.get('w1').status, 'pending')
  const retry = await verify('w1', { confirmedCryptoAmount: '0.025' })
  assert.equal(retry.status, 409)
  assert.equal(v.sends.length, 1, 'never sent twice')
})

test('Stripe withdrawal transfer: definite rejection releases; ambiguous outcome is uncertain', async () => {
  const bankW = cryptoW({ payment_method: 'bank', crypto_currency: null, destination_address: null })
  let v = world({ ...BOTH_ON, txns: [bankW], holds: HELD })
  v.transfer = async () => { const e = new Error('invalid account'); e.statusCode = 400; e.type = 'StripeInvalidRequestError'; throw e }
  let rejected = await verify('w1')
  assert.equal(rejected.body.error, 'invalid account', 'the transfer was attempted and definitively refused')
  assert.equal(v.stripe.length, 1)
  assert.equal(v.claims.get('w1').state, 'released')
  v = world({ ...BOTH_ON, txns: [bankW], holds: HELD })
  v.transfer = async () => { const e = new Error('timeout'); e.statusCode = 500; e.type = 'StripeAPIError'; throw e }
  const res = await verify('w1')
  assert.equal(res.status, 503)
  assert.equal(v.stripe.length, 1)
  assert.equal(v.claims.get('w1').state, 'uncertain')
  v = world({ ...BOTH_ON, txns: [bankW], holds: HELD })
  assert.equal((await verify('w1')).status, 200)
  assert.deepEqual(v.stripe.map((s) => [s[0], s[1].amount, s[2].idempotencyKey]), [['transfer', 5000, 'vestora-transaction-w1-bank-withdrawal']])
})

// ------------------------------------------------------------ allowed with switches off
test('Bank Transfer deposits are approved manually with all payment switches off; no provider is called', async () => {
  const v = world({ txns: [{ id: 'd2', user_id: USER, type: 'deposit', amount_usd: 250, payment_method: 'wire', admin_note: 'Sent from: Jane | Bank reference: REF123' }] })
  const res = await verify('d2')
  assert.equal(res.status, 200)
  assert.equal(v.txns.get('d2').status, 'verified')
  assert.equal(v.balances.get(USER), 350, 'credited only by the admin approval')
  nothingMoved(v, 'wire deposit')
})

test('rejections still work with payouts frozen (the hold is released back to the customer)', async () => {
  const v = world({ txns: [cryptoW()], holds: HELD })
  const res = await POST(req({ transactionId: 'w1', action: 'reject', adminNote: 'mismatch' }))
  assert.equal(res.status, 200)
  assert.equal(v.txns.get('w1').status, 'rejected')
  assert.equal(v.balances.get(USER), 150)
  nothingMoved(v, 'reject')
})

test('quote: read-only server calculation for the admin; works while frozen; writes and sends nothing', async () => {
  const v = world({ txns: [cryptoW()], holds: HELD })
  const res = await POST(req({ transactionId: 'w1', action: 'quote' }))
  assert.equal(res.status, 200)
  assert.equal(res.body.quote.cryptoAmount, '0.02500000')
  assert.equal(res.body.customerTypedCryptoAmount, 99)
  assert.deepEqual([res.body.destinationValid, res.body.payoutsEnabled, res.body.network], [true, false, 'mainnet'])
  assert.deepEqual(v.rpc, [])
  nothingMoved(v, 'quote')
  assert.equal((await POST(req({ transactionId: 'w1', action: 'quote' }))).status, 200)
  const dep = world({ txns: [{ id: 'd2', user_id: USER, type: 'deposit', amount_usd: 1, payment_method: 'wire' }] })
  assert.equal((await POST(req({ transactionId: 'd2', action: 'quote' }))).status, 400)
  assert.deepEqual(dep.rpc, [])
})

// ------------------------------------------------------------ access
test('cross-site and non-JSON requests are refused before the session is read', async () => {
  for (const [headers, status] of [
    [{ ...SAME, 'content-type': 'text/plain' }, 415],
    [{ ...SAME, 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' }, 403],
    [{ 'content-type': 'application/json', origin: 'https://evil.example', host: 'vestoras.vercel.app' }, 403],
  ]) {
    const v = world({ ...BOTH_ON, txns: [cryptoW()], holds: HELD })
    const res = await verify('w1', { confirmedCryptoAmount: '0.025' }, headers)
    assert.equal(res.status, status)
    assert.equal(v.sessionReads, 0)
    assert.deepEqual(v.rpc, [])
    nothingMoved(v, 'csrf')
  }
})

test('non-admins and signed-out users get 403; nothing is read or sent', async () => {
  for (const opts of [{ role: 'user' }, { signedIn: false }]) {
    const v = world({ ...BOTH_ON, txns: [cryptoW()], holds: HELD, ...opts })
    assert.equal((await verify('w1', { confirmedCryptoAmount: '0.025' })).status, 403)
    assert.equal((await GET()).status, 403)
    assert.deepEqual(v.rpc, [])
    nothingMoved(v, JSON.stringify(opts))
  }
})

test('status (GET): both layers reported; payouts need both', async () => {
  world({ app: { withdrawals: 'true' }, db: { withdrawal_payouts: false } })
  let res = await GET()
  assert.deepEqual(res.body.withdrawalPayouts, { application: true, database: false, enabled: false })
  assert.deepEqual(res.body.bankDepositPulls, { application: false, database: false, enabled: false })
  assert.equal(res.body.blockchainNetwork, 'mainnet')
  world({ ...BOTH_ON, app: { ...BOTH_ON.app, network: null } })
  res = await GET()
  assert.deepEqual(res.body.withdrawalPayouts, { application: true, database: true, enabled: true })
  assert.equal(res.body.blockchainNetwork, null)
})
