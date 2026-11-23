// End-to-end withdrawal and deposit controls against a disposable PostgreSQL
// 17 database with every real migration applied (including
// 20261127000000), using the REAL verify-transaction route and the real
// database functions, policies and RLS. Replaced by recorders: the crypto
// wallet (no key, no blockchain), the price source (fixed prices), Stripe
// (no API), deposit verification on-chain, audit and email. Nothing can
// leave the machine.
//
//   npm run test:integration      (requires Docker; never touches Supabase)
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, readdirSync, writeFileSync, mkdtempSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const dbDir = join(root, 'tests', 'db')
const container = `vestora-withdrawal-flow-${process.pid}`
const DB = 'flow'
const APP = 'https://vestoras.vercel.app'

// ── Recorders for every module that could move money ────────────────────
const stubDir = mkdtempSync(join(tmpdir(), 'vestora-wflow-'))
const stub = (name, body) => { writeFileSync(join(stubDir, name), body); return pathToFileURL(join(stubDir, name)).href }
const realUrl = (rel) => pathToFileURL(join(root, rel)).href
process.env.VESTORA_TEST_MODULE_OVERRIDES = JSON.stringify({
  '@/lib/wallet': stub('wallet.mjs', [
    `import { assertWithdrawalPayoutsEnabled } from '${realUrl('lib/financial-controls.js')}'`,
    'export async function sendCryptoPayout(c, a, amount, opts = {}) { assertWithdrawalPayoutsEnabled(); globalThis.__w.sends.push([c, a, amount]); return globalThis.__w.send(c, a, amount, opts.onBroadcast) }',
    'export async function getHotWalletBalance() { return 1000 }',
    'export function isValidPayoutAddress(c, a) { return /^0x[0-9a-fA-F]{40}$/.test(a || "") }',
  ].join('\n') + '\n'),
  '@/lib/crypto-price': stub('price.mjs', [
    `export { confirmedAmountAcceptable, PAYOUT_DECIMALS, cryptoAmountFor } from '${realUrl('lib/crypto-price.js')}'`,
    `import { cryptoAmountFor } from '${realUrl('lib/crypto-price.js')}'`,
    'export async function getPayoutQuote(c, usd) { const p = globalThis.__w.price; return { currency: c, amountUsd: Number(usd), priceUsd: p, cryptoAmount: cryptoAmountFor(c, usd, p), sources: [{ name: "coinbase", priceUsd: p }, { name: "kraken", priceUsd: p }], quotedAt: new Date().toISOString() } }',
  ].join('\n') + '\n'),
  '@/lib/stripe': stub('stripe.mjs', [
    `import { assertBankDepositPullsEnabled, assertWithdrawalPayoutsEnabled } from '${realUrl('lib/financial-controls.js')}'`,
    'export async function createBankPullPaymentIntent(p) { assertBankDepositPullsEnabled(); globalThis.__w.stripe.push(["pull", p]); return { id: "pi_1", status: "processing" } }',
    'export async function createWithdrawalTransfer(p) { assertWithdrawalPayoutsEnabled(); globalThis.__w.stripe.push(["transfer", p]); return { id: "tr_1" } }',
  ].join('\n') + '\n'),
  '@/lib/blockchain': stub('chain.mjs', 'export async function verifyTransaction() { return { found: true, succeeded: true, matchesAddress: true, amountMatches: true, confirmed: true } }\n'),
  '@/lib/audit': stub('audit.mjs', 'export async function logAdminAction(_c, e) { globalThis.__w.audits.push(e) }\n'),
  '@/lib/email': stub('email.mjs', [
    'const e = () => ({ subject: "s", title: "t", bodyHtml: "b" })',
    'export const depositVerifiedEmail = e, depositRejectedEmail = e, withdrawalVerifiedEmail = e, withdrawalRejectedEmail = e, investmentWithdrawalVerifiedEmail = e, investmentWithdrawalRejectedEmail = e',
    'export async function sendNotificationEmail(m) { globalThis.__w.emails.push(m) }',
  ].join('\n') + '\n'),
})
register('../helpers/alias-hooks.mjs', import.meta.url)

for (const k of Object.keys(process.env)) if (/WITHDRAWAL_PAYOUTS|BANK_DEPOSIT_PULLS|BLOCKCHAIN_NETWORK|STRIPE|PLATFORM_|INFURA|RESEND/.test(k)) delete process.env[k]
process.env.BLOCKCHAIN_NETWORK = 'mainnet'
process.env.STRIPE_SECRET_KEY = 'sk_test_not_real_stripe_is_mocked'
const realFetch = globalThis.fetch
globalThis.fetch = async (url) => { throw new Error(`unexpected network access in test: ${url}`) }

// ── Disposable database and a Supabase-client stand-in (as in referral-app-flow) ──
function psqlRaw(sql) {
  const res = spawnSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', DB, '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-f', '-'], { input: sql, encoding: 'utf8' })
  return { ok: res.status === 0, out: (res.stdout || '').trim(), err: res.stderr || '' }
}
function sqlAdmin(sql) { const r = psqlRaw(sql); if (!r.ok) throw new Error(r.err); return r.out }
const lit = (v) => (v === null || v === undefined ? 'null' : typeof v === 'number' || typeof v === 'boolean' ? String(v) : `'${String(v).replace(/'/g, "''")}'`)
let functionKinds = {}
function client({ role, sub = null, user = null }) {
  const run = (query) => {
    const pre = [`set role ${role};`]
    if (sub) pre.push(`set "request.jwt.claim.sub" = '${sub}';`)
    const r = psqlRaw(`${pre.join('\n')}\n${query}`)
    if (!r.ok) { const m = /ERROR:\s+(.*)/.exec(r.err); return { data: null, error: { message: m ? m[1].trim() : r.err.trim() } } }
    return { data: r.out ? JSON.parse(r.out) : null, error: null }
  }
  return {
    run,
    rpc: async (name, args = {}) => {
      const kind = functionKinds[name]
      if (!kind) return { data: null, error: { message: `function public.${name} does not exist` } }
      const params = Object.entries(args).map(([k, v]) => `${k} => ${v !== null && typeof v === 'object' ? `${lit(JSON.stringify(v))}::jsonb` : lit(v)}`).join(', ')
      if (kind === 'void') { const r = run(`select public.${name}(${params});`); return r.error ? r : { data: null, error: null } }
      return run(`select to_json(public.${name}(${params}));`)
    },
    from: (table) => {
      const filters = []
      let cols = '*'
      const one = async () => {
        const r = run(`select coalesce(json_agg(t), '[]'::json) from (select ${cols} from public.${table} ${filters.length ? `where ${filters.join(' and ')}` : ''}) t;`)
        if (r.error) return r
        return r.data.length === 1 ? { data: r.data[0], error: null } : { data: null, error: { message: r.data.length ? 'multiple rows' : 'no rows' } }
      }
      const q = { select: (c2) => { cols = c2; return q }, eq: (col, v) => { filters.push(`${col} = ${lit(v)}`); return q }, single: one, maybeSingle: one,
        update: (obj) => ({ eq: async (col, v) => run(`update public.${table} set ${Object.entries(obj).map(([k, val]) => `${k} = ${val !== null && typeof val === 'object' ? `${lit(JSON.stringify(val))}::jsonb` : lit(val)}`).join(', ')} where ${col} = ${lit(v)};`) }) }
      return q
    },
    auth: { getUser: async () => ({ data: { user } }) },
  }
}
const service = () => client({ role: 'service_role' })
const asUser = (id) => client({ role: 'authenticated', sub: id, user: { id } })

let POST
let admin, cara, dan
const ADDR = '0x00000000000000000000000000000000000000Aa'
function world(authId, { send } = {}) {
  globalThis.__t = { auth: asUser(authId), service: service() }
  globalThis.__w = { sends: [], stripe: [], audits: [], emails: [], price: 2000,
    send: send || (async (c, a, amount, onBroadcast) => { await onBroadcast?.('0xbroadcast1'); return { txHash: '0xbroadcast1' } }) }
  return globalThis.__w
}
const req = (body) => ({ url: `${APP}/api/admin/verify-transaction`, headers: new Headers({ 'content-type': 'application/json', origin: APP, 'sec-fetch-site': 'same-origin', host: 'vestoras.vercel.app' }), json: async () => body })
const verify = (id, extra = {}) => POST(req({ transactionId: id, action: 'verify', ...extra }))
const row = (id) => JSON.parse(sqlAdmin(`select row_to_json(t) from public.transactions t where id = '${id}';`))
const claim = (id) => { const out = sqlAdmin(`select row_to_json(c) from public.admin_financial_operation_claims c where transaction_id = '${id}';`); return out ? JSON.parse(out) : null }
const hold = (id) => sqlAdmin(`select coalesce((select state from public.withdrawal_reservations where transaction_id = '${id}'), 'none');`)
const balance = (id) => Number(sqlAdmin(`select balance_usd from public.wallets where user_id = '${id}';`))
const others = () => sqlAdmin(`select md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by t.id), '')) from public.transactions t where t.user_id = '${dan}';`) + sqlAdmin(`select balance_usd from public.wallets where user_id = '${dan}';`)
function signup(email, wallet) {
  const id = randomUUID()
  sqlAdmin(`insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values ('${id}', ${lit(email)}, '{"full_name": "x"}'::jsonb, now());
            insert into public.wallets (user_id, balance_usd) values ('${id}', ${wallet});`)
  return id
}
function requestWithdrawal(user, amount, method, cur = null, cryp = null, dest = null) {
  const r = asUser(user).run(`select to_json(public.request_withdrawal('${randomUUID()}', ${amount}, ${lit(method)}, ${lit(cur)}, ${cryp ?? 'null'}, ${lit(dest)}));`)
  if (r.error) throw new Error(r.error.message)
  return r.data.transactionId
}

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
  // Supabase grants the service role full access to these Production tables;
  // the minimal test baseline (created before default privileges) does not.
  sqlAdmin('grant all on public.transactions, public.wallets, public.profiles to service_role;')
  const migrationsDir = join(root, 'supabase', 'migrations')
  for (const m of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) sqlAdmin(readFileSync(join(migrationsDir, m), 'utf8'))
  sqlAdmin(`insert into public.settings (id, min_withdrawal_usd, daily_withdrawal_limit_usd) values (true, 10, 100000) on conflict (id) do update set min_withdrawal_usd = 10, daily_withdrawal_limit_usd = 100000;`)
  functionKinds = Object.fromEntries(sqlAdmin(`select proname || '|' || case when proretset then 'set' when prorettype = 'void'::regtype then 'void' else 'scalar' end
    from pg_proc where pronamespace = 'public'::regnamespace;`).split('\n').map((l) => l.split('|')))
  admin = signup('admin@example.test', 0)
  sqlAdmin(`set session_replication_role = replica; update public.profiles set role = 'admin' where id = '${admin}'; set session_replication_role = origin;`)
  cara = signup('cara@example.test', 500)
  dan = signup('dan@example.test', 75)
  POST = (await import('@/app/api/admin/verify-transaction/route')).POST
})
after(() => {
  globalThis.fetch = realFetch
  try { execFileSync('docker', ['rm', '-f', container], { stdio: 'ignore' }) } catch {}
})

let w1
test('1. customer requests a crypto withdrawal: funds held, typed crypto amount NOT stored', () => {
  w1 = requestWithdrawal(cara, 100, 'crypto', 'ETH', 3, ADDR)
  assert.equal(balance(cara), 400)
  assert.equal(hold(w1), 'held')
  assert.equal(row(w1).crypto_amount, null)
})

test('2. customers cannot create withdrawals or pre-verified deposits directly; pending deposit claims work', () => {
  const c = asUser(cara)
  for (const sql of [
    `insert into public.transactions (user_id, type, amount_usd, payment_method, destination_address, crypto_currency) values ('${cara}', 'withdrawal', 10, 'crypto', '${ADDR}', 'ETH') returning id`,
    `insert into public.transactions (user_id, type, amount_usd, status, payment_method) values ('${cara}', 'deposit', 1000000, 'verified', 'crypto') returning id`,
    `insert into public.transactions (user_id, type, amount_usd, payment_method) values ('${cara}', 'deposit', 50, 'bank') returning id`,
  ]) assert.match(c.run(`with x as (${sql}) select to_json(x) from x;`).error?.message || '', /row-level security/, sql.slice(0, 80))
  const ok = c.run(`with x as (insert into public.transactions (user_id, type, amount_usd, payment_method, admin_note) values ('${cara}', 'deposit', 50, 'wire', 'Sent from: Cara | Bank reference: R1') returning id, status) select to_json(x) from x;`)
  assert.equal(ok.data.status, 'pending')
})

test('3. default: approval refused before any claim; nothing sent; database unchanged', async () => {
  const before = JSON.stringify([row(w1), hold(w1), balance(cara), others()])
  const v = world(admin)
  const res = await verify(w1, { confirmedCryptoAmount: '0.05' })
  assert.deepEqual([res.status, res.body.code], [503, 'WITHDRAWAL_PAYOUTS_DISABLED'])
  assert.deepEqual(v.sends, [])
  assert.equal(claim(w1), null)
  assert.equal(JSON.stringify([row(w1), hold(w1), balance(cara), others()]), before)
})

test('4. application switch alone is not enough: the database refuses the claim', async () => {
  process.env.WITHDRAWAL_PAYOUTS_ENABLED = 'true'
  const v = world(admin)
  const res = await verify(w1, { confirmedCryptoAmount: '0.05' })
  assert.deepEqual([res.status, res.body.code], [503, 'WITHDRAWAL_PAYOUTS_DISABLED'])
  assert.deepEqual(v.sends, [])
  assert.equal(claim(w1), null)
})

test('5. both switches on: server quote, admin confirms, paid exactly once, hash recorded, hold consumed', async () => {
  sqlAdmin(`select public.set_financial_operation_enabled('withdrawal_payouts', true, 'integration test', 'enable for test', 'ENABLE WITHDRAWAL PAYOUTS');`)
  let v = world(admin)
  const q = await POST(req({ transactionId: w1, action: 'quote' }))
  assert.equal(q.status, 200)
  assert.equal(q.body.quote.cryptoAmount, '0.05000000') // 100 USD at 2000
  assert.equal((await verify(w1, { confirmedCryptoAmount: '3' })).status, 409, 'the customer-typed 3 ETH is refused')
  assert.deepEqual(v.sends, [])
  const res = await verify(w1, { confirmedCryptoAmount: q.body.quote.cryptoAmount })
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.deepEqual(v.sends, [['ETH', ADDR, '0.05000000']])
  const t = row(w1)
  assert.deepEqual([t.status, t.sent_tx_hash], ['verified', '0xbroadcast1'])
  assert.equal(hold(w1), 'consumed')
  assert.equal(balance(cara), 400, 'no second debit')
  assert.equal(claim(w1).provider_evidence.payoutCryptoAmount, '0.05000000')
  v = world(admin)
  assert.equal((await verify(w1, { confirmedCryptoAmount: '0.05' })).status, 400, 'already processed')
  assert.deepEqual(v.sends, [])
})

test('6. two approvals of one withdrawal at the same moment: one payout', async () => {
  const w2 = requestWithdrawal(cara, 50, 'crypto', 'ETH', null, ADDR)
  let release
  const gate = new Promise((r) => { release = r })
  const v = world(admin, { send: async (c, a, amount, onBroadcast) => { await gate; await onBroadcast('0xonce'); return { txHash: '0xonce' } } })
  const first = verify(w2, { confirmedCryptoAmount: '0.025' })
  await new Promise((r) => setTimeout(r, 50))
  const second = await verify(w2, { confirmedCryptoAmount: '0.025' })
  release()
  assert.equal((await first).status, 200)
  assert.equal(second.status, 409)
  assert.equal(v.sends.length, 1)
  assert.equal(row(w2).sent_tx_hash, '0xonce')
})

test('7. broadcast then failure: uncertain with the hash in the database; never sent again', async () => {
  const w3 = requestWithdrawal(cara, 20, 'crypto', 'ETH', null, ADDR)
  const v = world(admin, { send: async (c, a, amount, onBroadcast) => { await onBroadcast('0xmaybe'); const e = new Error('timeout'); e.txHash = '0xmaybe'; throw e } })
  assert.equal((await verify(w3, { confirmedCryptoAmount: '0.01' })).status, 503)
  const c = claim(w3)
  assert.deepEqual([c.state, c.provider_evidence.sentTxHash], ['uncertain', '0xmaybe'])
  assert.equal(row(w3).status, 'pending')
  assert.equal(hold(w3), 'held', 'funds stay held until reconciled')
  assert.equal((await verify(w3, { confirmedCryptoAmount: '0.01' })).status, 409)
  assert.equal(v.sends.length, 1)
})

test('8. legacy withdrawal without a hold: blocked for manual review, nothing created or changed', async () => {
  const legacy = randomUUID()
  sqlAdmin(`insert into public.transactions (id, user_id, type, amount_usd, status, payment_method, crypto_currency, destination_address) values ('${legacy}', '${dan}', 'withdrawal', 30, 'pending', 'crypto', 'ETH', '${ADDR}');`)
  const before = [balance(dan), others()]
  const v = world(admin)
  const res = await verify(legacy, { confirmedCryptoAmount: '0.015' })
  assert.equal(res.status, 409)
  assert.match(res.body.error, /no valid funds hold; manual review required/)
  assert.deepEqual(v.sends, [])
  assert.deepEqual([hold(legacy), claim(legacy), row(legacy).status], ['none', null, 'pending'])
  assert.deepEqual([balance(dan), others()], before)
})

test('9. Bank Transfer deposit: credited only when the admin approves; no provider involved', async () => {
  const id = sqlAdmin(`select id from public.transactions where user_id = '${cara}' and payment_method = 'wire' and type = 'deposit';`)
  const before = balance(cara)
  const v = world(admin)
  assert.equal(balance(cara), before, 'a pending claim credits nothing')
  const res = await verify(id)
  assert.equal(res.status, 200)
  assert.equal(balance(cara), before + 50)
  assert.deepEqual([v.sends, v.stripe], [[], []])
})

test('10. Bank Pull deposit: refused by the application switch and then by the database; no Stripe call', async () => {
  const id = randomUUID()
  sqlAdmin(`insert into public.transactions (id, user_id, type, amount_usd, status, payment_method) values ('${id}', '${dan}', 'deposit', 200, 'pending', 'bank');`)
  let v = world(admin)
  let res = await verify(id)
  assert.deepEqual([res.status, res.body.code], [503, 'BANK_DEPOSIT_PULLS_DISABLED'])
  process.env.BANK_DEPOSIT_PULLS_ENABLED = 'true'
  try {
    v = world(admin)
    res = await verify(id)
    assert.deepEqual([res.status, res.body.code], [503, 'BANK_DEPOSIT_PULLS_DISABLED'], 'database switch still off')
    assert.deepEqual(v.stripe, [])
    assert.equal(claim(id), null)
  } finally { delete process.env.BANK_DEPOSIT_PULLS_ENABLED }
})

test('11. freezing again in the database stops the next payout immediately', async () => {
  sqlAdmin(`select public.set_financial_operation_enabled('withdrawal_payouts', false, 'integration test', 'freeze');`)
  const w4 = requestWithdrawal(cara, 15, 'crypto', 'ETH', null, ADDR)
  const v = world(admin)
  const res = await verify(w4, { confirmedCryptoAmount: '0.0075' })
  assert.deepEqual([res.status, res.body.code], [503, 'WITHDRAWAL_PAYOUTS_DISABLED'])
  assert.deepEqual(v.sends, [])
  assert.equal(sqlAdmin(`select count(*) from public.financial_operation_control_events where operation = 'withdrawal_payouts';`), '3')
  delete process.env.WITHDRAWAL_PAYOUTS_ENABLED
})
