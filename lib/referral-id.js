// referrals.id is BIGINT. Accept a positive safe integer (JSON number) or a
// decimal string, and pass it on as a string so no precision is ever lost.
const MAX_BIGINT = 9223372036854775807n

export function parseReferralId(value) {
  let text
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) return null
    text = String(value)
  } else if (typeof value === 'string') {
    text = value.trim()
    if (!/^[1-9][0-9]{0,18}$/.test(text)) return null
  } else {
    return null
  }
  return BigInt(text) <= MAX_BIGINT ? text : null
}
