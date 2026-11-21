// lib/assistant.js
//
// The Investment Chat's answer engine. Pure functions: given the signed-in
// user's own overview (from /api/assistant/overview) and a question or
// quick action, return a structured reply. Every figure comes from that
// data; nothing is estimated. Replies use message keys from the
// "InvestmentAssistant" namespace so the UI can translate them.

export const QUICK_ACTIONS = ['balance', 'investments', 'earnings', 'performance', 'deposits', 'withdrawals', 'pending', 'support']

const RULES = [
  ['support', /\b(support|human|agent|person|someone|contact|complain|speak|talk to)\b/],
  ['performance', /\b(chart|graph|performance|perform|trend|growth|grow)\b/],
  ['rejected', /\b(reject\w*|declin\w*|denied|refus\w*|failed)\b/],
  ['pending', /\b(pending|processing|waiting|status|approved?|when will)\b/],
  ['deposits', /\b(deposit\w*|top ?up|fund(ing)?|add money)\b/],
  ['withdrawals', /\b(withdraw\w*|payout|cash ?out|send money)\b/],
  ['earnings', /\b(earn\w*|profit\w*|interest|return\w*|gain\w*|yield|roi)\b/],
  ['balance', /\b(balance|available|how much|wallet|money|funds?)\b/],
  ['investments', /\b(invest\w*|portfolio|plans?|holdings?|positions?)\b/],
  ['transactions', /\b(transactions?|history|activity|recent|statement)\b/],
  ['greeting', /^(hi|hello|hey|good (morning|afternoon|evening))\b/],
]

export function detectIntent(input) {
  const text = String(input ?? '').toLowerCase().trim()
  if (!text) return 'help'
  if (QUICK_ACTIONS.includes(text) || text === 'rejected' || text === 'transactions') return text
  for (const [intent, pattern] of RULES) {
    if (pattern.test(text)) {
      // "pending deposits" / "rejected withdrawal" narrow to one type.
      if (intent === 'pending' || intent === 'rejected') {
        if (/deposit/.test(text)) return intent === 'pending' ? 'deposits' : 'rejected'
        if (/withdraw/.test(text)) return intent === 'pending' ? 'withdrawals' : 'rejected'
      }
      return intent
    }
  }
  return 'help'
}

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
function round2(n) {
  return Math.round(n * 100) / 100
}
function sum(list, f) {
  return round2(list.reduce((acc, x) => acc + num(f(x)), 0))
}
function byNewest(a, b) {
  return Date.parse(b.created_at) - Date.parse(a.created_at)
}

export function summarize(data) {
  const investments = data?.investments || []
  const transactions = [...(data?.transactions || [])].sort(byNewest)
  const active = investments.filter((i) => i.status === 'active')
  const investedPrincipal = sum(active, (i) => num(i.amount_usd) - num(i.withdrawn_principal))
  const currentValue = sum(active, (i) => i.current_value)
  const ofType = (type, status) => transactions.filter((t) => t.type === type && (!status || t.status === status))
  return {
    balance: round2(num(data?.balance)),
    heldWithdrawals: data?.heldWithdrawals ?? null,
    active,
    investedPrincipal,
    currentValue,
    valueAbovePrincipal: round2(currentValue - investedPrincipal),
    claimable: sum(active, (i) => i.available_to_claim),
    claimed: sum(investments, (i) => i.claimed_interest),
    transactions,
    deposits: ofType('deposit'),
    withdrawals: ofType('withdrawal'),
    pending: transactions.filter((t) => t.status === 'pending'),
    rejected: transactions.filter((t) => t.status === 'rejected'),
    pendingDepositsUsd: sum(ofType('deposit', 'pending'), (t) => t.amount_usd),
    pendingWithdrawalsUsd: sum(ofType('withdrawal', 'pending'), (t) => t.amount_usd),
  }
}

const SUGGEST = {
  balance: ['pending', 'investments', 'withdrawals'],
  investments: ['performance', 'earnings', 'balance'],
  earnings: ['performance', 'investments', 'transactions'],
  performance: ['earnings', 'investments'],
  deposits: ['pending', 'rejected', 'balance'],
  withdrawals: ['pending', 'rejected', 'balance'],
  pending: ['deposits', 'withdrawals', 'support'],
  rejected: ['support', 'deposits', 'withdrawals'],
  transactions: ['pending', 'rejected', 'balance'],
}

/**
 * @returns {{ key: string, params: object, blocks: object[], actions: string[] }}
 *   params ending in "Usd" are dollar amounts for the UI to format.
 */
export function buildReply(intent, data, { firstName } = {}) {
  const s = summarize(data)
  const actions = SUGGEST[intent] || QUICK_ACTIONS.slice(0, 6)

  switch (intent) {
    case 'greeting':
    case 'help':
      return { key: intent === 'greeting' ? 'reply.greeting' : 'reply.help', params: { name: firstName ? ` ${firstName}` : '' }, blocks: [], actions: QUICK_ACTIONS }

    case 'balance': {
      const items = [{ label: 'metric.available', usd: s.balance }]
      if (s.heldWithdrawals) items.push({ label: 'metric.heldForWithdrawals', usd: s.heldWithdrawals })
      if (s.pendingDepositsUsd) items.push({ label: 'metric.pendingDeposits', usd: s.pendingDepositsUsd })
      if (s.active.length) items.push({ label: 'metric.investedValue', usd: s.currentValue })
      return { key: 'reply.balance', params: { balanceUsd: s.balance }, blocks: [{ type: 'metrics', items }], actions }
    }

    case 'investments':
      if (!s.active.length) return { key: 'reply.noInvestments', params: {}, blocks: [], actions: ['balance', 'support'] }
      return {
        key: 'reply.investments',
        params: { count: s.active.length, valueUsd: s.currentValue, principalUsd: s.investedPrincipal },
        blocks: [{ type: 'investments', items: s.active.slice(0, 6) }],
        actions,
      }

    case 'earnings':
      if (!s.active.length && !s.claimed) return { key: 'reply.noEarnings', params: {}, blocks: [], actions: ['investments', 'support'] }
      return {
        key: 'reply.earnings',
        params: { claimableUsd: s.claimable },
        blocks: [{
          type: 'metrics',
          items: [
            { label: 'metric.claimableNow', usd: s.claimable },
            { label: 'metric.alreadyClaimed', usd: s.claimed },
            { label: 'metric.valueAbovePrincipal', usd: s.valueAbovePrincipal },
          ],
        }],
        actions,
      }

    case 'performance':
      return { key: 'reply.performance', params: {}, blocks: [{ type: 'chart' }], actions }

    case 'deposits':
    case 'withdrawals': {
      const list = intent === 'deposits' ? s.deposits : s.withdrawals
      if (!list.length) return { key: `reply.no${intent === 'deposits' ? 'Deposits' : 'Withdrawals'}`, params: {}, blocks: [], actions: ['balance', 'support'] }
      const counts = { pending: 0, verified: 0, rejected: 0 }
      for (const t of list) if (t.status in counts) counts[t.status] += 1
      return {
        key: `reply.${intent}`,
        params: { pending: counts.pending, approved: counts.verified, rejected: counts.rejected },
        blocks: [{ type: 'transactions', items: list.slice(0, 6) }],
        actions,
      }
    }

    case 'pending':
      if (!s.pending.length) return { key: 'reply.noPending', params: {}, blocks: [], actions: ['transactions', 'balance'] }
      return { key: 'reply.pending', params: { count: s.pending.length }, blocks: [{ type: 'transactions', items: s.pending.slice(0, 8) }], actions }

    case 'rejected':
      if (!s.rejected.length) return { key: 'reply.noRejected', params: {}, blocks: [], actions: ['transactions', 'pending'] }
      return { key: 'reply.rejected', params: { count: s.rejected.length }, blocks: [{ type: 'transactions', items: s.rejected.slice(0, 6), showReasons: true }], actions }

    case 'transactions':
      if (!s.transactions.length) return { key: 'reply.noTransactions', params: {}, blocks: [], actions: ['balance', 'support'] }
      return { key: 'reply.transactions', params: {}, blocks: [{ type: 'transactions', items: s.transactions.slice(0, 8), showReasons: true }], actions }

    case 'support':
      return { key: 'reply.support', params: {}, blocks: [{ type: 'support' }], actions: ['pending', 'rejected'] }

    default:
      return { key: 'reply.help', params: { name: '' }, blocks: [], actions: QUICK_ACTIONS }
  }
}
