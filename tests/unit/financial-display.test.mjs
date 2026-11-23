// Unit tests for the financial display changes on the Production pages
// (release/financial-integrity): the matured-withdrawal preview, transaction
// labels/signs for the fee and fee-refund types, and their translations.
//
// The functions are read from the real page files (they are plain,
// self-contained functions inside client components) and evaluated on their
// own, so the pages are tested exactly as shipped without changing them.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const page = (name) => readFileSync(join(root, 'app', '[locale]', '(dashboard)', name, 'page.js'), 'utf8')

// Returns the top-level function `name` from source (from its declaration
// to the first closing brace at column 0).
function extract(source, name) {
  const start = source.indexOf(`function ${name}(`)
  assert.ok(start >= 0, `${name} found`)
  const end = source.indexOf('\n}', start)
  return new Function(`${source.slice(start, end + 2)}\nreturn ${name}`)()
}

const portfolio = page('portfolio')
const wallet = page('wallet')
const dashboard = page('dashboard')
const calculatePreview = extract(portfolio, 'calculatePreview')
const walletMeta = extract(wallet, 'txnMeta')
const dashboardMeta = extract(dashboard, 'txnIconMeta')
const t = (key) => key

// Plan P12 from tests/db/suites/_integrity_helpers.sql: 12% APY, 90 days.
const matured = (fields) => ({
  is_matured: true, apy_percent: 12, term_days: 90, started_at: '2026-01-01T00:00:00Z',
  remaining_principal: 1000, claimed_interest: 0, withdrawn_claimed_interest: 0, early_withdrawal_fee_usd: 25, ...fields,
})

test('preview, matured, nothing claimed: full-term interest floored to cents (server: 1029.58)', () => {
  const p = calculatePreview(matured(), 1000)
  assert.equal(p.interestEarned, 29.58)
  assert.equal(p.payout, 1029.58)
  assert.equal(p.fee, 0)
})

test('preview, matured, partial 400 before any claim (server: 411.83)', () => {
  const p = calculatePreview(matured(), 400)
  assert.equal(p.interestEarned, 11.83)
  assert.equal(p.payout, 411.83)
})

test('preview, matured after claiming all interest: principal only (server: 1000 and 400)', () => {
  assert.equal(calculatePreview(matured({ claimed_interest: 29.58 }), 1000).payout, 1000)
  assert.equal(calculatePreview(matured({ claimed_interest: 29.58 }), 400).payout, 400)
})

test('preview uses only interest claimed on the remaining principal (withdrawn_claimed_interest excluded)', () => {
  // 1000 invested, 29.58 claimed, 400 withdrawn (11.832 of the claim allocated to it):
  // the remaining 600 carries 17.748 claimed, so withdrawing it adds nothing more.
  const inv = matured({ remaining_principal: 600, claimed_interest: 29.58, withdrawn_claimed_interest: 11.832 })
  assert.equal(calculatePreview(inv, 600).interestEarned, 0)
  // Without the allocation the whole 29.58 would be charged to 600 (still 0, never negative).
  assert.equal(calculatePreview({ ...inv, withdrawn_claimed_interest: 0 }, 600).interestEarned, 0)
  // Half claimed on the remaining principal: half the full-term interest is left.
  const half = matured({ claimed_interest: 14.79 })
  assert.equal(calculatePreview(half, 1000).interestEarned, 14.79)
})

test('preview, early withdrawal: unchanged Production behaviour (flat fee, no interest)', () => {
  const p = calculatePreview(matured({ is_matured: false, started_at: new Date().toISOString() }), 400)
  assert.equal(p.interestEarned, 0)
  assert.equal(p.fee, 25)
  assert.equal(p.payout, 375)
})

test('preview: empty or zero amount gives no preview', () => {
  assert.equal(calculatePreview(matured(), ''), null)
  assert.equal(calculatePreview(matured(), 0), null)
})

for (const [name, meta] of [['wallet', walletMeta], ['dashboard', dashboardMeta]]) {
  test(`${name}: fee is a debit, fee refund is a credit, both labelled`, () => {
    const fee = meta('early_withdrawal_fee', t)
    const refund = meta('early_withdrawal_fee_refund', t)
    assert.equal(fee.label, 'txnTypes.earlyWithdrawalFee')
    assert.equal(refund.label, 'txnTypes.earlyWithdrawalFeeRefund')
    assert.match(fee.color, /red/)
    assert.match(refund.color, /green/)
  })
}

test('wallet: an investment withdrawal is money into the wallet (credit)', () => {
  const m = walletMeta('investment_withdrawal', t)
  assert.match(m.color, /green/)
  assert.equal(m.label, 'txnTypes.investmentWithdrawal')
})

test('wallet and dashboard amount signs: fee negative; refund and investment withdrawal positive', () => {
  const sign = (source) => source.match(/const isNegative = ([^\n;]+)/)[1]
  for (const source of [wallet, dashboard]) {
    const isNegative = new Function('tx', `return ${sign(source)}`)
    assert.equal(isNegative({ type: 'early_withdrawal_fee' }), true)
    assert.equal(isNegative({ type: 'withdrawal' }), true)
    assert.equal(isNegative({ type: 'admin_debit' }), true)
    assert.equal(isNegative({ type: 'early_withdrawal_fee_refund' }), false)
    assert.equal(isNegative({ type: 'investment_withdrawal' }), false)
    assert.equal(isNegative({ type: 'deposit' }), false)
  }
})

test('every locale is valid JSON with both new labels in Dashboard and Wallet', () => {
  const dir = join(root, 'messages')
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'))
  assert.equal(files.length, 8)
  for (const f of files) {
    const m = JSON.parse(readFileSync(join(dir, f), 'utf8'))
    for (const ns of ['Dashboard', 'Wallet']) {
      assert.ok(m[ns].txnTypes.earlyWithdrawalFee, `${f} ${ns}.earlyWithdrawalFee`)
      assert.ok(m[ns].txnTypes.earlyWithdrawalFeeRefund, `${f} ${ns}.earlyWithdrawalFeeRefund`)
    }
  }
})
