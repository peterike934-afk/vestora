// Application-level switches for operations that move real money.
//
// Each is OFF unless its environment variable is exactly the string 'true'.
// Missing, empty, 'TRUE', '1' or 'true ' all mean OFF, so a missing setting
// always fails closed. Read on every call, never cached.
//
// These sit in front of the database switches (financial_operation_controls,
// 20261127000000), which only an operator connected as postgres can change
// with an audit entry. BOTH must be on for a payout or a bank pull, and the
// payment libraries (lib/wallet.js, lib/stripe.js) check the application
// switch again immediately before contacting a provider.

export const WITHDRAWAL_PAYOUTS_DISABLED_CODE = 'WITHDRAWAL_PAYOUTS_DISABLED'
export const WITHDRAWAL_PAYOUTS_DISABLED_MESSAGE =
  'Withdrawal payouts are currently disabled. Nothing was sent and the withdrawal is still pending.'
export const BANK_PULLS_DISABLED_CODE = 'BANK_DEPOSIT_PULLS_DISABLED'
export const BANK_PULLS_DISABLED_MESSAGE =
  'Bank pulls are currently disabled. No bank account was charged and the deposit is still pending.'

export function withdrawalPayoutsEnabled(env = process.env) {
  return env?.WITHDRAWAL_PAYOUTS_ENABLED === 'true'
}

export function bankDepositPullsEnabled(env = process.env) {
  return env?.BANK_DEPOSIT_PULLS_ENABLED === 'true'
}

export class PaymentDisabledError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

// Called by the payment libraries right before any provider call.
export function assertWithdrawalPayoutsEnabled(env = process.env) {
  if (!withdrawalPayoutsEnabled(env)) {
    throw new PaymentDisabledError(WITHDRAWAL_PAYOUTS_DISABLED_CODE, WITHDRAWAL_PAYOUTS_DISABLED_MESSAGE)
  }
}

export function assertBankDepositPullsEnabled(env = process.env) {
  if (!bankDepositPullsEnabled(env)) {
    throw new PaymentDisabledError(BANK_PULLS_DISABLED_CODE, BANK_PULLS_DISABLED_MESSAGE)
  }
}
