"use client";

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { getAuthLevel, listMfaFactors, verifyMfaLogin } from '@/lib/mfa'

const s = {
  page: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: '24px' },
  card: { width: '100%', maxWidth: '440px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: '20px', padding: '48px 40px' },
  logo: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '40px', justifyContent: 'center' },
  logoIcon: { width: '36px', height: '36px', background: 'var(--green)', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px' },
  logoText: { fontFamily: 'Playfair Display, serif', fontSize: '22px', fontWeight: '600', color: 'var(--text)' },
  title: { fontSize: '24px', fontWeight: '700', color: 'var(--text)', marginBottom: '8px', textAlign: 'center' },
  sub: { fontSize: '14px', color: 'var(--text2)', textAlign: 'center', marginBottom: '32px' },
  label: { display: 'block', fontSize: '13px', color: 'var(--text2)', marginBottom: '6px', fontWeight: '500' },
  input: { width: '100%', padding: '12px 16px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontSize: '14px', outline: 'none', transition: 'border-color 0.2s' },
  field: { marginBottom: '20px' },
  hint: { fontSize: '12px', color: 'var(--text3)', marginTop: '6px' },
  btn: { width: '100%', padding: '14px', background: 'var(--green)', border: 'none', borderRadius: 'var(--radius-sm)', color: '#000', fontSize: '15px', fontWeight: '600', marginTop: '8px', transition: 'opacity 0.2s', cursor: 'pointer' },
  btnDisabled: { opacity: 0.6, cursor: 'not-allowed' },
  link: { textAlign: 'center', marginTop: '24px', fontSize: '14px', color: 'var(--text2)' },
  linkA: { color: 'var(--green)', fontWeight: '500' },
  error: { fontSize: '13px', color: 'var(--red)', background: 'var(--red-dim)', padding: '10px 14px', borderRadius: 'var(--radius-sm)', marginBottom: '20px' },
  success: { fontSize: '14px', color: 'var(--text)', textAlign: 'center' },
  codeInput: { width: '100%', padding: '14px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontSize: '20px', textAlign: 'center', letterSpacing: '6px', outline: 'none', marginBottom: '20px' },
  passWrap: { position: 'relative' },
  eyeBtn: { position: 'absolute', right: '14px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', padding: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', color: 'var(--text3)' },
}

function EyeIcon({ open }) {
  return open ? (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-10-8-10-8a18.5 18.5 0 0 1 4.22-5.94M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19M14.12 14.12a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  ) : (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s3-8 11-8 11 8 11 8-3 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

export default function ResetPassword() {
  const router = useRouter()
  const supabase = createClient()

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  // Supabase sends the user here with a recovery token in the URL. It fires
  // a PASSWORD_RECOVERY auth event once it's parsed the token into a session.
  // Until that fires, this is not a page the user can meaningfully act on —
  // no verified state means the link was invalid, expired, or already used.
  const [verified, setVerified] = useState(false)
  const [checking, setChecking] = useState(true)

  // Recovery links establish a session on their own — Supabase does not
  // require the MFA step to do this. That means without an extra check here,
  // anyone with access to the account's email can reset the password without
  // ever entering a 6-digit code, which quietly bypasses 2FA. So once the
  // recovery session is confirmed, we check whether this account has MFA
  // enabled and, if so, gate the password form behind the same code check
  // the login page uses before letting updateUser() run.
  const [needsMfa, setNeedsMfa] = useState(false)
  const [mfaFactorId, setMfaFactorId] = useState(null)
  const [mfaCode, setMfaCode] = useState('')
  const [mfaVerified, setMfaVerified] = useState(false)
  const [verifyingMfa, setVerifyingMfa] = useState(false)

  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange(async (event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setVerified(true)

        try {
          const { currentLevel, nextLevel } = await getAuthLevel()
          if (currentLevel === 'aal1' && nextLevel === 'aal2') {
            const factors = await listMfaFactors()
            const verifiedFactor = factors.find(f => f.status === 'verified')
            if (verifiedFactor) {
              setMfaFactorId(verifiedFactor.id)
              setNeedsMfa(true)
            }
          }
        } catch (err) {
          console.error('MFA check failed during password reset:', err)
          // Fail closed: if we can't confirm MFA status, don't let the
          // password form through silently.
          setError('Could not verify account security status. Please try again.')
        }

        setChecking(false)
      }
    })

    // If no PASSWORD_RECOVERY event fires shortly after mount, the link
    // was invalid/expired — stop the loading state and show that instead
    // of leaving the form hanging indefinitely.
    const timeout = setTimeout(() => setChecking(false), 2500)

    return () => {
      listener.subscription.unsubscribe()
      clearTimeout(timeout)
    }
  }, [supabase])

  async function handleVerifyMfa(e) {
    e.preventDefault()
    setError('')
    if (!mfaCode || mfaCode.length !== 6) {
      setError('Enter the 6-digit code from your authenticator app.')
      return
    }
    setVerifyingMfa(true)
    try {
      await verifyMfaLogin(mfaFactorId, mfaCode)
      setMfaVerified(true)
      setNeedsMfa(false)
    } catch (err) {
      setError(err.message || 'Invalid code — try again.')
    } finally {
      setVerifyingMfa(false)
    }
  }

  async function handle(e) {
    e.preventDefault()
    setError('')

    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password })
    setLoading(false)

    if (error) {
      setError(error.message)
      return
    }

    setSuccess(true)
    setTimeout(() => router.push('/login'), 1800)
  }

  if (checking) {
    return (
      <div style={s.page}>
        <div style={s.card}>
          <div style={s.logo}>
            <div style={s.logoIcon}>$</div>
            <span style={s.logoText}>Vestoral</span>
          </div>
          <p style={s.sub}>Verifying your reset link…</p>
        </div>
      </div>
    )
  }

  if (!verified) {
    return (
      <div style={s.page}>
        <div style={s.card}>
          <div style={s.logo}>
            <div style={s.logoIcon}>$</div>
            <span style={s.logoText}>Vestoral</span>
          </div>
          <p style={s.title}>Link expired</p>
          <p style={s.sub}>This reset link is invalid or has already been used.</p>
          <Link href="/forgot-password" style={{ ...s.btn, display: 'block', textAlign: 'center', textDecoration: 'none' }}>
            Request a new link
          </Link>
        </div>
      </div>
    )
  }

  if (needsMfa && !mfaVerified) {
    return (
      <div style={s.page}>
        <div style={s.card}>
          <div style={s.logo}>
            <div style={s.logoIcon}>$</div>
            <span style={s.logoText}>Vestoral</span>
          </div>
          <p style={s.title}>Two-factor authentication</p>
          <p style={s.sub}>This account has 2FA enabled. Enter the 6-digit code from your authenticator app to continue.</p>

          {error && <div style={s.error}>{error}</div>}

          <form onSubmit={handleVerifyMfa}>
            <input
              style={s.codeInput}
              placeholder="000000"
              maxLength={6}
              autoFocus
              value={mfaCode}
              onChange={e => setMfaCode(e.target.value.replace(/\D/g, ''))}
            />
            <button
              style={{ ...s.btn, ...(verifyingMfa ? s.btnDisabled : {}) }}
              type="submit"
              disabled={verifyingMfa}
            >
              {verifyingMfa ? 'Verifying…' : 'Verify & continue'}
            </button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div style={s.page}>
      <div style={s.card}>
        <div style={s.logo}>
          <div style={s.logoIcon}>$</div>
          <span style={s.logoText}>Vestoral</span>
        </div>

        {success ? (
          <>
            <p style={s.title}>Password updated</p>
            <p style={s.success}>Redirecting you to sign in…</p>
          </>
        ) : (
          <>
            <p style={s.title}>Set a new password</p>
            <p style={s.sub}>Choose a strong password for your account</p>

            {error && <div style={s.error}>{error}</div>}

            <form onSubmit={handle}>
              <div style={s.field}>
                <label style={s.label}>New password</label>
                <div style={s.passWrap}>
                  <input
                    style={{ ...s.input, paddingRight: '44px' }}
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                    autoFocus
                  />
                  <button
                    type="button"
                    style={s.eyeBtn}
                    onClick={() => setShowPassword(v => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    <EyeIcon open={showPassword} />
                  </button>
                </div>
                <div style={s.hint}>At least 8 characters</div>
              </div>
              <div style={s.field}>
                <label style={s.label}>Confirm password</label>
                <div style={s.passWrap}>
                  <input
                    style={{ ...s.input, paddingRight: '44px' }}
                    type={showConfirm ? 'text' : 'password'}
                    placeholder="••••••••"
                    value={confirm}
                    onChange={e => setConfirm(e.target.value)}
                    required
                  />
                  <button
                    type="button"
                    style={s.eyeBtn}
                    onClick={() => setShowConfirm(v => !v)}
                    aria-label={showConfirm ? 'Hide password' : 'Show password'}
                  >
                    <EyeIcon open={showConfirm} />
                  </button>
                </div>
              </div>
              <button
                style={{ ...s.btn, ...(loading ? s.btnDisabled : {}) }}
                type="submit"
                disabled={loading}
              >
                {loading ? 'Updating…' : 'Update password'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}