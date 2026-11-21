// lib/portfolioHistory.js
//
// Builds the investment performance series from recorded data only:
//
// - Each investment adds its principal (amount_usd) at started_at.
// - Each verified investment_withdrawal removes its principal_portion at
//   verified_at.
// - Each verified investment_interest_claim adds to "earnings credited"
//   at verified_at.
// - The final point is today, valued at the sum of current_value reported
//   by the database for active investments.
//
// Nothing is projected or interpolated from APY. An investment that is
// closed but has no recorded event for when its principal left (for
// example an admin cancellation) cannot be placed on the timeline
// truthfully, so it is left out and reported in `excludedCount`.

const DAY_MS = 24 * 60 * 60 * 1000
const CENT = 0.005

export const PERFORMANCE_RANGES = [
  { key: '1W', days: 7 },
  { key: '1M', days: 30 },
  { key: '3M', days: 91 },
  { key: '6M', days: 182 },
  { key: '1Y', days: 365 },
]

function toMs(value) {
  const ms = Date.parse(value ?? '')
  return Number.isFinite(ms) ? ms : null
}

function num(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function round2(n) {
  return Math.round(n * 100) / 100
}

export function buildPortfolioHistory(investments = [], transactions = [], now = Date.now()) {
  const verified = transactions.filter((t) => t?.status === 'verified')
  const withdrawalsByInvestment = new Map()
  for (const t of verified) {
    if (t.type !== 'investment_withdrawal' || !t.investment_id) continue
    const list = withdrawalsByInvestment.get(t.investment_id) || []
    list.push(t)
    withdrawalsByInvestment.set(t.investment_id, list)
  }

  const events = []
  const plotted = new Set()
  let excludedCount = 0

  for (const inv of investments) {
    const start = toMs(inv?.started_at)
    if (start === null || start > now) continue

    const withdrawals = withdrawalsByInvestment.get(inv.id) || []
    const recordedOut = withdrawals.reduce((sum, t) => sum + num(t.principal_portion), 0)
    const remaining = num(inv.amount_usd) - recordedOut

    // Closed with principal unaccounted for by any recorded event: its exit
    // time is unknown, so it is not drawn rather than guessed.
    if (inv.status !== 'active' && remaining > CENT) {
      excludedCount += 1
      continue
    }

    plotted.add(inv.id)
    events.push({ t: start, principal: num(inv.amount_usd), earnings: 0 })
    for (const w of withdrawals) {
      const at = toMs(w.verified_at) ?? toMs(w.created_at)
      if (at !== null && at <= now) events.push({ t: at, principal: -num(w.principal_portion), earnings: 0 })
    }
  }

  for (const t of verified) {
    if (t.type !== 'investment_interest_claim' || !plotted.has(t.investment_id)) continue
    const at = toMs(t.verified_at) ?? toMs(t.created_at)
    if (at !== null && at <= now) events.push({ t: at, principal: 0, earnings: num(t.amount_usd) })
  }

  if (events.length === 0) {
    return { points: [], firstAt: null, excludedCount, currentValue: null }
  }

  events.sort((a, b) => a.t - b.t)

  const points = []
  let principal = 0
  let earnings = 0
  for (const e of events) {
    principal += e.principal
    earnings += e.earnings
    const point = { t: e.t, invested: round2(Math.max(principal, 0)), earnings: round2(earnings), value: null }
    if (points.length && points[points.length - 1].t === e.t) points[points.length - 1] = point
    else points.push(point)
  }

  const currentValue = round2(
    investments
      .filter((inv) => inv?.status === 'active' && plotted.has(inv.id))
      .reduce((sum, inv) => sum + num(inv.current_value), 0)
  )
  points.push({ t: now, invested: round2(Math.max(principal, 0)), earnings: round2(earnings), value: currentValue })

  return { points, firstAt: points[0].t, excludedCount, currentValue }
}

// Ranges are offered only where the history reaches past the next-shorter
// range, so a 1Y filter is not shown for three weeks of data.
export function availableRanges(firstAt, now = Date.now()) {
  if (firstAt === null) return []
  const spanDays = (now - firstAt) / DAY_MS
  return PERFORMANCE_RANGES.filter((r, i) => i === 0 || spanDays > PERFORMANCE_RANGES[i - 1].days)
}

// Points inside the range, starting with the state carried in from before
// the range so the line begins at the right level.
export function sliceHistory(points, days, now = Date.now()) {
  if (!points.length) return []
  const from = now - days * DAY_MS
  const inside = points.filter((p) => p.t >= from)
  const before = points.filter((p) => p.t < from)
  if (before.length) {
    const carried = before[before.length - 1]
    inside.unshift({ ...carried, t: from, value: null })
  }
  return inside
}
