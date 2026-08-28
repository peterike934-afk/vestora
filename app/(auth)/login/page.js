"use client";

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { getAuthLevel, listMfaFactors, verifyMfaLogin } from '@/lib/mfa'
import AuthTransitionOverlay from '@/components/AuthTransitionOverlay'
import VestoraMark from '@/components/VestoraMark'
import { applyReferralCode } from '@/lib/queries'

const s = {
  page: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: '24px' },
  card: { width: '100%', maxWidth: '440px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: '20px', padding: '48px 40px' },
  logo: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '40px', justifyContent: 'center' },
  logoText: { fontFamily: 'Playfair Display, serif', fontSize: '22px', fontWeight: '600', color: 'var(--text)' },
  title: { fontSize: '24px', fontWeight: '700', color: 'var(--text)', marginBottom: '8px', textAlign: 'center' },
  sub: { fontSize: '14px', color: 'var(--text2)', textAlign: 'center', marginBottom: '32px' },
  label: { display: 'block', fontSize: '13px', color: 'var(--text2)', marginBottom: '6px', fontWeight: '500' },
  input: { width: '100%', padding: '12px 16px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontSize: '14px', outline: 'none', transition: 'border-color 0.2s' },
  field: { marginBottom: '20px' },
  btn: { width: '100%', padding: '14px', background: 'var(--green)', border: 'none', borderRadius: 'var(--radius-sm)', color: '#000', fontSize: '15px', fontWeight: '600', marginTop: '8px', transition: 'opacity 0.2s', cursor: 'pointer' },
  btnDisabled: { opacity: 0.6, cursor: 'not-allowed' },
  link: { textAlign: 'center', marginTop: '24px', fontSize: '14px', color: 'var(--text2)' },
  linkA: { color: 'var(--green)', fontWeight: '500' },
  divider: { display: 'flex', alignItems: 'center', gap: '12px', margin: '24px 0' },
  divLine: { flex: 1, height: '1px', background: 'var(--border)' },
  divText: { fontSize: '12px', color: 'var(--text3)' },
  google: { width: '100%', padding: '12px', background: 'transparent', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontSize: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', cursor: 'pointer' },
  error: { fontSize: '13px', color: 'var(--red)', background: 'var(--red-dim)', padding: '10px 14px', borderRadius: 'var(--radius-sm)', marginBottom: '20px' },
  codeInput: { width: '100%', padding: '14px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontSize: '20px', textAlign: 'center', letterSpacing: '6px', outline: 'none', marginBottom: '20px' },
  passWrap: { position: 'relative' },
  eyeBtn: { position: 'absolute', right: '14px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', padding: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', color: 'var(--text3)' },
}

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

  async function handle(e) {
  e.preventDefault()
  setError('')
  setLoading(true)
  setShowOverlay(true)
  const overlayStartedAt = Date.now()

  const { error } = await supabase.auth.signInWithPassword({
    email: form.email,
    password: form.password,
  })

  setLoading(false)

  if (error) {
    setShowOverlay(false)
    setError(error.message)
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
    router.push('/dashboard')
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
      router.push('/dashboard')
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
      <div style={s.page}>
        <AuthTransitionOverlay show={showOverlay} />
        <div style={s.card}>
          <div style={s.logo}>
            <VestoraMark size={32} />
            <span style={s.logoText}>vestora</span>
          </div>
          <p style={s.title}>Two-factor authentication</p>
          <p style={s.sub}>Enter the 6-digit code from your authenticator app</p>

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
              {verifyingMfa ? 'Verifying…' : 'Verify & sign in'}
            </button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div style={s.page}>
      <AuthTransitionOverlay show={showOverlay} />
      <div style={s.card}>
        <div style={s.logo}>
          <VestoraMark size={32} />
          <span style={s.logoText}>vestora</span>
        </div>
        <p style={s.title}>Welcome back</p>
        <p style={s.sub}>Sign in to your investment account</p>

        {error && <div style={s.error}>{error}</div>}

        <form onSubmit={handle}>
          <div style={s.field}>
            <label style={s.label}>Email address</label>
            <input style={s.input} type="email" placeholder="you@example.com" value={form.email} onChange={e => setForm({...form, email: e.target.value})} required />
          </div>
          <div style={s.field}>
            <label style={s.label}>Password</label>
            <div style={s.passWrap}>
              <input
                style={{ ...s.input, paddingRight: '44px' }}
                type={showPassword ? 'text' : 'password'}
                placeholder="••••••••"
                value={form.password}
                onChange={e => setForm({...form, password: e.target.value})}
                required
              />
              <button
                type="button"
                style={s.eyeBtn}
                onClick={() => setShowPassword(v => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-10-8-10-8a18.5 18.5 0 0 1 4.22-5.94M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s3-8 11-8 11 8 11 8-3 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
            <div style={{ textAlign: 'right', marginTop: '8px' }}>
              <Link href="/forgot-password" style={{ fontSize: '13px', color: 'var(--text2)' }}>
                Forgot password?
              </Link>
            </div>
          </div>
          <button
            style={{ ...s.btn, ...(loading ? s.btnDisabled : {}) }}
            type="submit"
            disabled={loading}
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <div style={s.divider}><div style={s.divLine}/><span style={s.divText}>or</span><div style={s.divLine}/></div>
        <p style={s.link}>Don't have an account? <Link href="/signup" style={s.linkA}>Create one</Link></p>
      </div>
    </div>
  )
}