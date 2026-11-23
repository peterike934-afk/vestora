// Bank deposit options: "Bank Transfer" (available, manual verification) and
// "Bank Pull" (visible, Coming Soon). Proves the Coming Soon message, that
// nothing on the deposit page can link or charge a bank account, and that
// the server refuses bank linking while bank pulls are disabled, without
// ever contacting Stripe. No network, no Stripe key.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const real = (rel) => readFileSync(join(root, rel), 'utf8')
const EXACT = "Coming Soon — We're working on it. This payment method will be available soon."

test('Bank Pull shows exactly the agreed English message; every language has the new strings', () => {
  const en = JSON.parse(real('messages/en.json'))
  assert.equal(en.Deposit.bankPull.comingSoon, EXACT)
  assert.equal(en.Deposit.methods.bank, 'Bank Pull')
  assert.equal(en.Deposit.methods.wire, 'Bank Transfer')
  for (const f of readdirSync(join(root, 'messages')).filter((n) => n.endsWith('.json'))) {
    const m = JSON.parse(real(`messages/${f}`))
    for (const [path, value] of [
      ['Deposit.bankPull.comingSoon', m.Deposit.bankPull?.comingSoon], ['Deposit.bankPull.badge', m.Deposit.bankPull?.badge],
      ['Deposit.methods.bank', m.Deposit.methods?.bank], ['Deposit.methods.wire', m.Deposit.methods?.wire],
      ['Deposit.wire.reference', m.Deposit.wire?.reference], ['Withdraw.crypto.amountUsd', m.Withdraw.crypto?.amountUsd],
      ['Withdraw.crypto.amountCalculated', m.Withdraw.crypto?.amountCalculated], ['Withdraw.requested.cryptoCalculated', m.Withdraw.requested?.cryptoCalculated],
    ]) assert.ok(typeof value === 'string' && value.trim(), `${f}: ${path}`)
    assert.match(m.Withdraw.crypto.amountCalculated, /\{currency\}/, `${f}: placeholder kept`)
    assert.match(m.Withdraw.requested.cryptoCalculated, /\{amount\}[\s\S]*\{currency\}|\{currency\}[\s\S]*\{amount\}/, `${f}: placeholders kept`)
  }
})

test('deposit page: Bank Pull renders only the message; no bank linking, no bank-pull submission', () => {
  const src = real('app/[locale]/(dashboard)/deposit/page.js')
  for (const forbidden of [/ConnectBankButton/, /getLinkedBankAccounts/, /create-fc-session/, /finalize-bank-link/, /paymentMethod:\s*'bank'/, /linkedBankAccountId/, /stripe/i]) {
    assert.doesNotMatch(src, forbidden, `deposit page must not contain ${forbidden}`)
  }
  const bankBlock = src.slice(src.indexOf("{method === 'bank' && ("), src.indexOf("{method === 'wire' && ("))
  assert.match(bankBlock, /t\('bankPull\.comingSoon'\)/)
  assert.doesNotMatch(bankBlock, /onClick|button|input|createTransaction/, 'the Bank Pull panel has no actions')
  assert.match(src, /onClick=\{\(\) => setMethod\('bank'\)\}/, 'Bank Pull tab stays visible and selectable')
  assert.match(src, /\{t\('bankPull\.badge'\)\}/)
})

test('deposit page: Bank Transfer shows Vestora bank details and submits a pending deposit claim for manual review', () => {
  const src = real('app/[locale]/(dashboard)/deposit/page.js')
  const wire = src.slice(src.indexOf("async function handleSubmitWire()"), src.indexOf("if (done)"))
  assert.match(wire, /paymentMethod: 'wire'/)
  assert.match(wire, /type: 'deposit'/)
  assert.match(wire, /Bank reference:/, 'optional bank reference is recorded for the admin')
  assert.doesNotMatch(wire, /status:/, 'status comes from createTransaction: always pending')
  for (const k of ['bank_name', 'bank_account_name', 'bank_routing_number', 'bank_account_number']) assert.match(src, new RegExp(`settings\\?\\.${k}`))
  assert.match(real('lib/queries.js'), /status: 'pending',/, 'createTransaction always inserts pending')
})

test('withdraw page: only a USD amount for crypto; no customer crypto amount is sent', () => {
  const src = real('app/[locale]/(dashboard)/withdraw/page.js')
  assert.doesNotMatch(src, /cryptoAmount/)
  assert.match(src, /t\('crypto\.amountCalculated'/)
  const q = real('lib/queries.js')
  assert.match(q, /p_crypto_amount: null,/)
})

// ---------------------------------------------------- bank-linking routes
const dir = mkdtempSync(join(tmpdir(), 'vestora-banklink-'))
const put = (name, body) => { writeFileSync(join(dir, name), body); return pathToFileURL(join(dir, name)).href }
const fcUrl = put('fc.mjs', real('lib/financial-controls.js'))
const routeStubs = {
  '@/lib/supabase/server': put('server.mjs', 'export async function createClient() { return { auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) }, from: () => { throw new Error("db not expected") } } }\n'),
  '@/lib/stripe': put('stripe.mjs', 'export function getStripe() { globalThis.__stripeCalls++; throw new Error("Stripe reached") }\n'),
  '@/lib/financial-controls': fcUrl,
  'next/server': put('next.mjs', 'export const NextResponse = { json: (body, init = {}) => ({ status: init.status ?? 200, body }) }\n'),
}
async function loadRoute(rel, name) {
  let src = real(rel)
  for (const [spec, url] of Object.entries(routeStubs)) {
    assert.equal(src.split(`from "${spec}"`).length - 1, 1, `${rel} imports ${spec} once`)
    src = src.replace(`from "${spec}"`, `from "${url}"`)
  }
  assert.equal((src.match(/^import /gm) || []).length, 4, `${rel}: no other imports`)
  return (await import(put(name, src))).POST
}
const createFc = await loadRoute('app/api/stripe/create-fc-session/route.js', 'create-fc.mjs')
const finalizeLink = await loadRoute('app/api/stripe/finalize-bank-link/route.js', 'finalize.mjs')

test('server: bank linking is refused while bank pulls are disabled, before any Stripe call', async () => {
  for (const v of [undefined, '', 'TRUE', '1', 'yes']) {
    if (v === undefined) delete process.env.BANK_DEPOSIT_PULLS_ENABLED; else process.env.BANK_DEPOSIT_PULLS_ENABLED = v
    globalThis.__stripeCalls = 0
    for (const route of [createFc, finalizeLink]) {
      const res = await route({ json: async () => ({ financialConnectionsAccountId: 'fca_1' }) })
      assert.equal(res.status, 503, `BANK_DEPOSIT_PULLS_ENABLED=${JSON.stringify(v)}`)
      assert.equal(res.body.code, 'BANK_DEPOSIT_PULLS_DISABLED')
    }
    assert.equal(globalThis.__stripeCalls, 0, 'Stripe never contacted')
  }
  // Only the switch stands in the way: with it on, the route reaches Stripe.
  process.env.BANK_DEPOSIT_PULLS_ENABLED = 'true'
  globalThis.__stripeCalls = 0
  await assert.rejects(createFc(), /Stripe reached/)
  assert.equal(globalThis.__stripeCalls, 1)
  delete process.env.BANK_DEPOSIT_PULLS_ENABLED
})
