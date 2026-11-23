// Unit tests for the money-moving safety layers in the libraries:
// application switches, explicit blockchain network, the verified USDT
// contract, server-side crypto pricing, and the guards inside lib/wallet.js
// and lib/stripe.js that refuse BEFORE any key is loaded or any provider is
// contacted. No network: fetch is replaced and fails the test if used
// unexpectedly; no private keys or Stripe keys are set.
import test from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
import { readFileSync } from 'node:fs'
import { getAddress } from 'ethers'

register('../helpers/alias-hooks.mjs', import.meta.url)

const fetchCalls = []
globalThis.fetch = async (url) => { fetchCalls.push(String(url)); throw new Error(`unexpected network access: ${url}`) }
for (const k of ['WITHDRAWAL_PAYOUTS_ENABLED', 'BANK_DEPOSIT_PULLS_ENABLED', 'BLOCKCHAIN_NETWORK', 'PLATFORM_ETH_PRIVATE_KEY',
  'PLATFORM_BTC_PRIVATE_KEY', 'INFURA_API_KEY', 'STRIPE_SECRET_KEY', 'SEPOLIA_USDT_CONTRACT']) delete process.env[k]

const controls = await import('@/lib/financial-controls')
const network = await import('@/lib/blockchain-network')
const price = await import('@/lib/crypto-price')
const wallet = await import('@/lib/wallet')
const stripe = await import('@/lib/stripe')

const BAD_TRUE = [undefined, '', ' ', 'TRUE', 'True', '1', 'yes', 'on', 'true ', ' true', 'false']

test('switches: withdrawal payouts and bank pulls are OFF unless exactly "true"', () => {
  for (const v of BAD_TRUE) {
    assert.equal(controls.withdrawalPayoutsEnabled({ WITHDRAWAL_PAYOUTS_ENABLED: v }), false, JSON.stringify(v))
    assert.equal(controls.bankDepositPullsEnabled({ BANK_DEPOSIT_PULLS_ENABLED: v }), false, JSON.stringify(v))
  }
  assert.equal(controls.withdrawalPayoutsEnabled({ WITHDRAWAL_PAYOUTS_ENABLED: 'true' }), true)
  assert.equal(controls.bankDepositPullsEnabled({ BANK_DEPOSIT_PULLS_ENABLED: 'true' }), true)
  assert.equal(controls.withdrawalPayoutsEnabled({ BANK_DEPOSIT_PULLS_ENABLED: 'true' }), false, 'switches are independent')
  assert.throws(() => controls.assertWithdrawalPayoutsEnabled({}), (e) => e instanceof controls.PaymentDisabledError && e.code === 'WITHDRAWAL_PAYOUTS_DISABLED')
  assert.throws(() => controls.assertBankDepositPullsEnabled({}), (e) => e instanceof controls.PaymentDisabledError && e.code === 'BANK_DEPOSIT_PULLS_DISABLED')
})

test('network: BLOCKCHAIN_NETWORK must be exactly mainnet or testnet; never a silent default', () => {
  for (const v of [undefined, '', 'Mainnet', 'MAINNET', 'prod', 'sepolia', 'mainnet ', 'test']) {
    assert.throws(() => network.getBlockchainNetwork({ BLOCKCHAIN_NETWORK: v }), network.BlockchainNetworkError, JSON.stringify(v))
  }
  const main = network.networkConfig({ BLOCKCHAIN_NETWORK: 'mainnet' })
  assert.deepEqual([main.network, main.ethChainId, main.infuraSubdomain, main.etherscanApi, main.blockstreamApi],
    ['mainnet', 1, 'mainnet', 'https://api.etherscan.io/api', 'https://blockstream.info/api'])
  const testnet = network.networkConfig({ BLOCKCHAIN_NETWORK: 'testnet', SEPOLIA_USDT_CONTRACT: '0xabc' })
  assert.deepEqual([testnet.network, testnet.ethChainId, testnet.infuraSubdomain, testnet.etherscanApi, testnet.blockstreamApi, testnet.usdtContract],
    ['testnet', 11155111, 'sepolia', 'https://api-sepolia.etherscan.io/api', 'https://blockstream.info/testnet/api', '0xabc'])
})

test('USDT: the verified official contract, EIP-55 valid, used by both payouts and deposit checks', () => {
  assert.equal(network.USDT_MAINNET_CONTRACT, '0xdAC17F958D2ee523a2206206994597C13D831ec7')
  assert.equal(getAddress(network.USDT_MAINNET_CONTRACT), network.USDT_MAINNET_CONTRACT, 'checksum valid')
  assert.equal(network.USDT_DECIMALS, 6)
  assert.equal(network.networkConfig({ BLOCKCHAIN_NETWORK: 'mainnet' }).usdtContract, network.USDT_MAINNET_CONTRACT)
  for (const f of ['lib/wallet.js', 'lib/blockchain.js']) {
    const src = readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8')
    assert.doesNotMatch(src, /0x[0-9a-fA-F]{39}(?![0-9a-fA-F])/, `${f}: no truncated address`)
    assert.doesNotMatch(src, /process\.env\.BLOCKCHAIN_NETWORK\s*===/, `${f}: no module-level network default`)
  }
})

// ---------------------------------------------------------------- pricing
function priceFetch({ coinbase, kraken, krakenError, coinbaseStatus = 200 } = {}) {
  const calls = []
  const f = async (url) => {
    calls.push(String(url))
    if (String(url).includes('coinbase')) {
      if (coinbase instanceof Error) throw coinbase
      return { ok: coinbaseStatus === 200, status: coinbaseStatus, json: async () => ({ data: { amount: String(coinbase) } }) }
    }
    if (kraken instanceof Error) throw kraken
    return { ok: true, status: 200, json: async () => ({ error: krakenError ? [krakenError] : [], result: krakenError ? {} : { PAIR: { c: [String(kraken), '1'] } } }) }
  }
  f.calls = calls
  return f
}

test('pricing: two sources must agree within 1%; amount is USD / average price, rounded DOWN', async () => {
  const f = priceFetch({ coinbase: 50000, kraken: 50100 })
  const q = await price.getPayoutQuote('BTC', 1000, { fetchImpl: f, now: () => new Date('2026-11-23T00:00:00Z') })
  assert.equal(q.priceUsd, 50050)
  assert.equal(q.cryptoAmount, '0.01998001') // 1000 / 50050 = 0.019980019... -> down to 8 decimals
  assert.deepEqual(q.sources.map((s) => s.name), ['coinbase', 'kraken'])
  assert.ok(f.calls.some((u) => u.includes('BTC-USD')) && f.calls.some((u) => u.includes('XBTUSD')))
  const usdt = await price.getPayoutQuote('USDT', 250.5, { fetchImpl: priceFetch({ coinbase: 1.0001, kraken: 0.9999 }) })
  assert.equal(usdt.cryptoAmount, '250.500000')
  const eth = await price.getPayoutQuote('ETH', 3000, { fetchImpl: priceFetch({ coinbase: 3000, kraken: 3000 }) })
  assert.equal(eth.cryptoAmount, '1.00000000')
})

test('pricing: never more than the held USD amount (rounding is always down)', () => {
  for (let i = 0; i < 2000; i++) {
    const usd = Math.round(Math.random() * 1e6) / 100 + 0.01
    const p = Math.round((Math.random() * 99999 + 0.5) * 1e6) / 1e6
    for (const c of ['BTC', 'ETH', 'USDT']) {
      const amount = Number(price.cryptoAmountFor(c, usd, p))
      assert.ok(amount * p <= usd + 1e-9, `${c} ${usd} @ ${p} -> ${amount}`)
    }
  }
})

test('pricing: fails closed when a source is down, errors, or the sources disagree', async () => {
  const cases = [
    [{ coinbase: new Error('down'), kraken: 50000 }, /unavailable/],
    [{ coinbase: 50000, kraken: new Error('down') }, /unavailable/],
    [{ coinbase: 50000, kraken: 50000, coinbaseStatus: 503 }, /unavailable/],
    [{ coinbase: 50000, krakenError: 'EQuery:Unknown asset pair' }, /unavailable/],
    [{ coinbase: 'NaN', kraken: 50000 }, /unavailable/],
    [{ coinbase: 0, kraken: 50000 }, /unavailable/],
    [{ coinbase: 50000, kraken: 50600 }, /disagree/],
  ]
  for (const [opts, re] of cases) {
    await assert.rejects(price.getPayoutQuote('BTC', 100, { fetchImpl: priceFetch(opts) }), (e) => e instanceof price.PriceUnavailableError && re.test(e.message), JSON.stringify(opts))
  }
  await assert.rejects(price.getPayoutQuote('DOGE', 100, { fetchImpl: priceFetch({ coinbase: 1, kraken: 1 }) }), price.PriceUnavailableError)
})

test('pricing: admin-confirmed amount must be within 1% of a fresh quote', () => {
  assert.equal(price.confirmedAmountAcceptable('0.01000000', '0.01000000'), true)
  assert.equal(price.confirmedAmountAcceptable('0.01009999', '0.01'), true)
  assert.equal(price.confirmedAmountAcceptable('0.0102', '0.01'), false)
  assert.equal(price.confirmedAmountAcceptable('0.0098', '0.01'), false)
  for (const bad of [null, '', 'abc', '-1', '0', undefined]) assert.equal(price.confirmedAmountAcceptable(bad, '0.01'), false)
})

// ---------------------------------------------------------------- wallet guard
test('wallet: sendCryptoPayout refuses BEFORE loading keys or contacting a network when payouts are off', async () => {
  fetchCalls.length = 0
  process.env.BLOCKCHAIN_NETWORK = 'mainnet'
  for (const v of BAD_TRUE) {
    if (v === undefined) delete process.env.WITHDRAWAL_PAYOUTS_ENABLED; else process.env.WITHDRAWAL_PAYOUTS_ENABLED = v
    for (const [c, a] of [['ETH', '0x0000000000000000000000000000000000000001'], ['USDT', '0x0000000000000000000000000000000000000001'], ['BTC', 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq']]) {
      let onBroadcastCalled = false
      await assert.rejects(wallet.sendCryptoPayout(c, a, '0.1', { onBroadcast: () => { onBroadcastCalled = true } }),
        (e) => e instanceof controls.PaymentDisabledError, `${c} with WITHDRAWAL_PAYOUTS_ENABLED=${JSON.stringify(v)}`)
      assert.equal(onBroadcastCalled, false)
    }
  }
  assert.deepEqual(fetchCalls, [], 'no network access')
  delete process.env.BLOCKCHAIN_NETWORK
})

test('wallet: with payouts on, a missing network or invalid address still refuses before any key is loaded', async () => {
  fetchCalls.length = 0
  process.env.WITHDRAWAL_PAYOUTS_ENABLED = 'true'
  try {
    delete process.env.BLOCKCHAIN_NETWORK
    await assert.rejects(wallet.sendCryptoPayout('ETH', '0x0000000000000000000000000000000000000001', '0.1'), network.BlockchainNetworkError)
    process.env.BLOCKCHAIN_NETWORK = 'mainnet'
    await assert.rejects(wallet.sendCryptoPayout('ETH', '0x123', '0.1'), /Invalid ETH destination/)
    await assert.rejects(wallet.sendCryptoPayout('BTC', 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx', '0.1'), /Invalid BTC destination/, 'testnet address on mainnet')
    await assert.rejects(wallet.sendCryptoPayout('DOGE', 'x', '1'), /Unsupported currency/)
    // Valid inputs reach key loading, which fails here because no key is set: proves the guards come first.
    await assert.rejects(wallet.sendCryptoPayout('ETH', '0x0000000000000000000000000000000000000001', '0.1'), /INFURA_API_KEY|PLATFORM_ETH_PRIVATE_KEY/)
    assert.deepEqual(fetchCalls, [], 'no network access')
    assert.equal(wallet.isValidPayoutAddress('BTC', 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'), true)
    process.env.BLOCKCHAIN_NETWORK = 'testnet'
    assert.equal(wallet.isValidPayoutAddress('BTC', 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'), false, 'mainnet address refused on testnet')
    assert.equal(wallet.isValidPayoutAddress('BTC', 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx'), true)
  } finally {
    delete process.env.WITHDRAWAL_PAYOUTS_ENABLED
    delete process.env.BLOCKCHAIN_NETWORK
  }
})

// ---------------------------------------------------------------- stripe guard
test('stripe: bank pull and withdrawal transfer refuse before any Stripe call while their switch is off', async () => {
  // No STRIPE_SECRET_KEY: reaching Stripe would throw "STRIPE_SECRET_KEY is not set" instead.
  await assert.rejects(stripe.createBankPullPaymentIntent({ amount: 100 }), (e) => e instanceof controls.PaymentDisabledError && e.code === 'BANK_DEPOSIT_PULLS_DISABLED')
  await assert.rejects(stripe.createWithdrawalTransfer({ amount: 100 }), (e) => e instanceof controls.PaymentDisabledError && e.code === 'WITHDRAWAL_PAYOUTS_DISABLED')
  process.env.BANK_DEPOSIT_PULLS_ENABLED = 'true'
  process.env.WITHDRAWAL_PAYOUTS_ENABLED = 'true'
  try {
    await assert.rejects(stripe.createBankPullPaymentIntent({ amount: 100 }), /STRIPE_SECRET_KEY is not set/, 'guard passed only when enabled')
    await assert.rejects(stripe.createWithdrawalTransfer({ amount: 100 }), /STRIPE_SECRET_KEY is not set/)
  } finally {
    delete process.env.BANK_DEPOSIT_PULLS_ENABLED
    delete process.env.WITHDRAWAL_PAYOUTS_ENABLED
  }
})
