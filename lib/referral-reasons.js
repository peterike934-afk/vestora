// Neutral, customer-safe wording for referral rejection reasons. The only
// values the database accepts (referrals_rejection_reason_check); private
// admin notes are stored separately and never shown to customers.
export const REFERRAL_REJECTION_REASONS = ['not_eligible', 'duplicate_account', 'terms_not_met', 'other']

const REASON_TEXT = {
  not_eligible: 'The referral did not meet the programme’s eligibility requirements.',
  duplicate_account: 'The new account could not be accepted as a new customer for the referral programme.',
  terms_not_met: 'The referral programme terms were not met.',
  other: 'The referral could not be approved.',
}

export function referralReasonText(code) {
  return REASON_TEXT[code] || REASON_TEXT.other
}

export function isReferralRejectionReason(code) {
  return REFERRAL_REJECTION_REASONS.includes(code)
}
