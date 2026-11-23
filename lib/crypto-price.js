import 'server-only'

// Server-side crypto pricing for withdrawal payouts. The crypto amount a
// customer receives is ALWAYS calculated here from the USD amount held for
// the withdrawal; a customer-typed crypto amount is never used.
//
// Two independent public price sources (Coinbase and Kraken spot prices)
// must both answer and agree within MAX_SOURCE_SPREAD; otherwise no quote is
// produced (fail closed). The amount is rounded DOWN to the coin's payout
// precision, so Vestora never pays more than the held USD amount.

export const MAX_SOURCE_SPREAD = 0.01     // sources must agree within 1%
export const CONFIRMATION_TOLERANCE = 0.01 // admin-confirmed amount vs fresh quote
const TIMEOUT_MS = 5000

export const PAYOUT_DECIMALS = { BTC: 8, ETH: 8, USDT: 6 }
const COINBASE_PAIR = { BTC: 'BTC-USD', ETH: 'ETH-USD', USDT: 'USDT-USD' }
const KRAKEN_PAIR = { BTC: 'XBTUSD', ETH: 'ETHUSD', USDT: 'USDTZUSD' }

export class PriceUnavailableError extends Error {}

function positiveNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : null
}

async function getJson(fetchImpl, url) {
  const res = await fetchImpl(url, { cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

async function coinbasePrice(currency, fetchImpl) {
  const body = await getJson(fetchImpl, `https://api.coinbase.com/v2/prices/${COINBASE_PAIR[currency]}/spot`)
  return positiveNumber(body?.data?.amount)
}

async function krakenPrice(currency, fetchImpl) {
  const body = await getJson(fetchImpl, `https://api.kraken.com/0/public/Ticker?pair=${KRAKEN_PAIR[currency]}`)
  if (Array.isArray(body?.error) && body.error.length) throw new Error(body.error.join('; '))
  const ticker = body?.result ? Object.values(body.result)[0] : null
  return positiveNumber(ticker?.c?.[0]) // last trade price
}

/** Formats `usd / price` rounded DOWN to the payout precision, as a decimal string. */
export function cryptoAmountFor(currency, amountUsd, priceUsd) {
  const decimals = PAYOUT_DECIMALS[currency]
  if (decimals === undefined) throw new PriceUnavailableError(`Unsupported currency: ${currency}`)
  const usd = positiveNumber(amountUsd)
  const price = positiveNumber(priceUsd)
  if (!usd || !price) throw new PriceUnavailableError('Invalid amount or price')
  // Integer arithmetic in the smallest unit avoids floating-point rounding up.
  const scale = 10n ** BigInt(decimals)
  const usdCents = BigInt(Math.round(usd * 100))
  const priceMicro = BigInt(Math.round(price * 1e6))
  const units = (usdCents * 10_000n * scale) / priceMicro // floor
  if (units <= 0n) throw new PriceUnavailableError('Amount too small to pay out')
  const whole = units / scale
  const frac = (units % scale).toString().padStart(decimals, '0')
  return `${whole}.${frac}`
}

/**
 * Quote for paying `amountUsd` in `currency`. Throws PriceUnavailableError
 * if either source fails or they disagree by more than MAX_SOURCE_SPREAD.
 */
export async function getPayoutQuote(currency, amountUsd, { fetchImpl = fetch, now = () => new Date() } = {}) {
  if (!COINBASE_PAIR[currency]) throw new PriceUnavailableError(`Unsupported currency: ${currency}`)
  const results = await Promise.allSettled([coinbasePrice(currency, fetchImpl), krakenPrice(currency, fetchImpl)])
  const [coinbase, kraken] = results.map((r) => (r.status === 'fulfilled' ? r.value : null))
  if (!coinbase || !kraken) {
    throw new PriceUnavailableError('A trusted price source is unavailable; no payout amount can be calculated right now.')
  }
  const spread = Math.abs(coinbase - kraken) / Math.min(coinbase, kraken)
  if (spread > MAX_SOURCE_SPREAD) {
    throw new PriceUnavailableError(`Price sources disagree by ${(spread * 100).toFixed(2)}%; no payout amount can be calculated right now.`)
  }
  const priceUsd = (coinbase + kraken) / 2
  return {
    currency,
    amountUsd: Number(amountUsd),
    priceUsd: Number(priceUsd.toFixed(6)),
    cryptoAmount: cryptoAmountFor(currency, amountUsd, priceUsd),
    sources: [{ name: 'coinbase', priceUsd: coinbase }, { name: 'kraken', priceUsd: kraken }],
    quotedAt: now().toISOString(),
  }
}

/** True if the admin-confirmed amount is within tolerance of the fresh server quote. */
export function confirmedAmountAcceptable(confirmed, fresh) {
  const c = positiveNumber(confirmed)
  const f = positiveNumber(fresh)
  if (!c || !f) return false
  return Math.abs(c - f) / f <= CONFIRMATION_TOLERANCE
}
