import { createClient } from '@/lib/supabase/client'

// Starts enrollment: returns a QR code (SVG string) to scan and a
// factorId to reference in the next step. The factor exists but is
// NOT active yet — it only becomes active after verifyEnrollment()
// succeeds with a real code from the authenticator app.
export async function startMfaEnrollment() {
  const supabase = createClient()
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp' })
  if (error) throw error
  return {
    factorId: data.id,
    qrCode: data.totp.qr_code, // SVG markup, render directly
    secret: data.totp.secret,  // manual-entry fallback if they can't scan
  }
}

// Confirms enrollment with the 6-digit code from the user's
// authenticator app. Only after this succeeds is the factor active.
export async function verifyMfaEnrollment(factorId, code) {
  const supabase = createClient()
  const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId })
  if (challengeError) throw challengeError

  const { error: verifyError } = await supabase.auth.mfa.verify({
    factorId,
    challengeId: challenge.id,
    code,
  })
  if (verifyError) throw verifyError
}

export async function listMfaFactors() {
  const supabase = createClient()
  const { data, error } = await supabase.auth.mfa.listFactors()
  if (error) throw error
  return data.totp // array of enrolled TOTP factors (verified + unverified)
}

export async function unenrollMfaFactor(factorId) {
  const supabase = createClient()
  const { error } = await supabase.auth.mfa.unenroll({ factorId })
  if (error) throw error
}

// Checks whether the CURRENT session still needs a second factor.
// currentLevel 'aal1' + nextLevel 'aal2' means: password was correct,
// but MFA hasn't been completed for this session yet.
export async function getAuthLevel() {
  const supabase = createClient()
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  if (error) throw error
  return data // { currentLevel, nextLevel }
}

// Used at login: challenges + verifies a code in one step for an
// already-enrolled factor.
export async function verifyMfaLogin(factorId, code) {
  const supabase = createClient()
  const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId })
  if (challengeError) throw challengeError

  const { error: verifyError } = await supabase.auth.mfa.verify({
    factorId,
    challengeId: challenge.id,
    code,
  })
  if (verifyError) throw verifyError
}