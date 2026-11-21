"use client";

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowRight, Eye, EyeOff } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { getAuthLevel, listMfaFactors, verifyMfaLogin } from '@/lib/mfa'
import AuthTransitionOverlay from '@/components/AuthTransitionOverlay'
import AuthExperienceShell from '@/components/auth/AuthExperienceShell'
import { applyReferralCode } from '@/lib/queries'
import { getSignInErrorMessage, VERIFICATION_MESSAGES, SUCCESS_VERIFICATION_STATUSES } from '@/lib/authMessages'

// Minimum time the full-screen overlay stays visible after a successful
// sign-in, so it doesn't flash by on a fast connection — the request
// itself might resolve in 200ms, but the overlay still holds for this
// long (minus whatever the request already took) before handing off.
const MIN_OVERLAY_MS = 1200

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export default function Login() {
  const router = useRouter()
  const supabase = createClient()
  const [form, setForm] = useState({ email: '', password: '' })
  const [error, setError] = useState('')
  const [verificationMessage, setVerificationMessage] = useState('')
  const [verificationStatus, setVerificationStatus] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  // Full-screen blur overlay — shown the instant Sign in / Verify is
  // clicked, hidden again on error. Not tied to `loading` directly so
  // it can keep covering the screen through the MFA check too.
  const [showOverlay, setShowOverlay] = useState(false)

  // MFA challenge step — only shown if the account has 2FA enabled
  const [needsMfa, setNeedsMfa] = useState(false)
  const [mfaFactorId, setMfaFactorId] = useState(null)
  const [mfaCode, setMfaCode] = useState('')
  const [verifyingMfa, setVerifyingMfa] = useState(false)

  useEffect(() => {
    const verification = new URLSearchParams(window.location.search).get('verification')

    if (verification && Object.hasOwn(VERIFICATION_MESSAGES, verification)) {
      setVerificationMessage(VERIFICATION_MESSAGES[verification])
      setVerificationStatus(verification)
    }
  }, [])

  async function handle(e) {
  e.preventDefault()
  setError('')
  setLoading(true)
  setShowOverlay(true)
  const overlayStartedAt = Date.now()

  const { error } = await supabase.auth.signInWithPassword({
    email: form.email.trim(),
    password: form.password,
  })

  setLoading(false)

  if (error) {
    setShowOverlay(false)
    setError(getSignInErrorMessage(error))
    return
  }

  // Apply any referral code saved during signup but not yet processed —
  // happens whenever email confirmation was required before a real
  // session existed, so this is the first real chance to attach it.
  const savedCode = localStorage.getItem('vestora_referral_code')
  if (savedCode) {
    try {
      await applyReferralCode(savedCode)
    } catch (err) {
      console.error('Failed to apply referral code:', err)
    } finally {
      localStorage.removeItem('vestora_referral_code')
    }
  }

  // Password was correct — now check if this account requires a
  // second factor before the session is actually fully trusted.
  try {
    const { currentLevel, nextLevel } = await getAuthLevel()
      if (currentLevel === 'aal1' && nextLevel === 'aal2') {
        const factors = await listMfaFactors()
        const verified = factors.find(f => f.status === 'verified')
        if (verified) {
          setShowOverlay(false)
          setMfaFactorId(verified.id)
          setNeedsMfa(true)
          return // don't redirect yet — wait for the code
        }
      }
    } catch (err) {
      console.error('MFA check failed:', err)
      // Fail open here would be a security hole; fail closed instead —
      // if we can't determine MFA status, don't grant access silently.
      // In practice this only triggers on a network/API issue, so show
      // a clear error rather than silently redirecting.
      setShowOverlay(false)
      setError('Could not verify account security status. Please try again.')
      return
    }

    const elapsed = Date.now() - overlayStartedAt
    if (elapsed < MIN_OVERLAY_MS) await wait(MIN_OVERLAY_MS - elapsed)
   router.push('/en/dashboard')
  }

  async function handleVerifyMfa(e) {
    e.preventDefault()
    setError('')
    if (!mfaCode || mfaCode.length !== 6) {
      setError('Enter the 6-digit code from your authenticator app.')
      return
    }
    setVerifyingMfa(true)
    setShowOverlay(true)
    const overlayStartedAt = Date.now()
    try {
      await verifyMfaLogin(mfaFactorId, mfaCode)
      const elapsed = Date.now() - overlayStartedAt
      if (elapsed < MIN_OVERLAY_MS) await wait(MIN_OVERLAY_MS - elapsed)
     router.push('/en/dashboard')
    } catch (err) {
      setShowOverlay(false)
      setError(err.message || 'Invalid code — try again.')
      setVerifyingMfa(false)
    }
  }

  async function handleGoogle() {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    })
  }

  if (needsMfa) {
    return (
      <AuthExperienceShell
        className="auth-experience--login"
        topAction={<>Back to <Link href="/login">sign in</Link></>}
      >
        <AuthTransitionOverlay show={showOverlay} />
        <div className="auth-experience__form">
          <header className="auth-experience__form-heading">
            <span className="auth-experience__form-eyebrow">Additional security</span>
            <h2 className="auth-experience__form-title">Two-factor authentication</h2>
            <p className="auth-experience__form-description">
              Enter the 6-digit code from your authenticator app.
            </p>
          </header>

          {error && <div className="auth-experience__message" role="alert">{error}</div>}

          <form onSubmit={handleVerifyMfa}>
            <input
              className="auth-experience__input auth-experience__code-input"
              aria-label="Authenticator code"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              maxLength={6}
              autoFocus
              value={mfaCode}
              onChange={e => setMfaCode(e.target.value.replace(/\D/g, ''))}
            />
            <button
              className="auth-experience__submit"
              type="submit"
              disabled={verifyingMfa}
            >
              {verifyingMfa ? 'Verifying…' : <>Verify &amp; sign in <ArrowRight size={16} aria-hidden="true" /></>}
            </button>
          </form>
        </div>
      </AuthExperienceShell>
    )
  }

  return (
    <AuthExperienceShell
      className="auth-experience--login"
      topAction={<>New to Vestora? <Link href="/signup">Create an account</Link></>}
    >
      <AuthTransitionOverlay show={showOverlay} />
      <div className="auth-experience__form">
        <header className="auth-experience__form-heading">
          <span className="auth-experience__form-eyebrow">Secure account access</span>
          <h2 className="auth-experience__form-title">Welcome back</h2>
          <p className="auth-experience__form-description">Sign in to your Vestora account.</p>
        </header>

        {error && <div className="auth-experience__message" role="alert">{error}</div>}
        {verificationMessage && (
          <div
            className={`auth-experience__message${SUCCESS_VERIFICATION_STATUSES.has(verificationStatus) ? ' auth-experience__message--success' : ''}`}
            role="status"
          >
            {verificationMessage}
          </div>
        )}

        <form onSubmit={handle}>
          <div className="auth-experience__field">
            <label className="auth-experience__label" htmlFor="login-email">Email address</label>
            <input
              className="auth-experience__input"
              id="login-email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={form.email}
              onChange={e => setForm({...form, email: e.target.value})}
              required
            />
          </div>
          <div className="auth-experience__field">
            <label className="auth-experience__label" htmlFor="login-password">Password</label>
            <div className="auth-experience__password-wrap">
              <input
                className="auth-experience__input"
                id="login-password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="••••••••"
                value={form.password}
                onChange={e => setForm({...form, password: e.target.value})}
                required
              />
              <button
                type="button"
                className="auth-experience__password-toggle"
                onClick={() => setShowPassword(v => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword
                  ? <EyeOff size={17} aria-hidden="true" />
                  : <Eye size={17} aria-hidden="true" />}
              </button>
            </div>
            <div className="auth-experience__options">
              <Link className="auth-experience__text-link" href="/forgot-password">
                Forgot password?
              </Link>
            </div>
          </div>
          <button
            className="auth-experience__submit"
            type="submit"
            disabled={loading}
          >
            {loading ? 'Signing in…' : <>Sign in <ArrowRight size={16} aria-hidden="true" /></>}
          </button>
        </form>
        <p className="auth-experience__form-footer">
          Don’t have an account? <Link href="/signup">Create one</Link>
        </p>
      </div>
    </AuthExperienceShell>
  )
}