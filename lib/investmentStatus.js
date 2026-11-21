// lib/investmentStatus.js
//
// Display-only helper: maps a stored investment status to the status
// shown in the UI. It never changes stored data.
//
// Under the V2 atomic cancellation (cancel_investment_atomically), a
// cancelled investment is stored as status = 'withdrawn' with its
// withdrawn_principal left unchanged. The only other path that sets
// 'withdrawn' is an approved investment_withdrawal, and that happens
// only once withdrawn_principal >= amount_usd - 0.005 (see
// _finalize_claimed_transaction). So a 'withdrawn' investment whose
// principal was NOT fully withdrawn was cancelled by an admin.
//
// Legacy rows stored as 'cancelled' keep showing as cancelled. If
// withdrawn_principal is not present on the row, the stored status is
// shown unchanged.

const FULLY_WITHDRAWN_TOLERANCE = 0.005

export function getDisplayInvestmentStatus(inv) {
  if (!inv) return undefined
  if (inv.status !== 'withdrawn') return inv.status

  const withdrawn = inv.withdrawn_principal
  const amount = inv.amount_usd
  if (withdrawn === null || withdrawn === undefined || amount === null || amount === undefined) {
    return inv.status
  }

  const withdrawnNum = Number(withdrawn)
  const amountNum = Number(amount)
  if (!Number.isFinite(withdrawnNum) || !Number.isFinite(amountNum)) return inv.status

  return withdrawnNum < amountNum - FULLY_WITHDRAWN_TOLERANCE ? 'cancelled' : 'withdrawn'
}
