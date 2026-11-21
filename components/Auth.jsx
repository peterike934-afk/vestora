"use client";

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import AuthExperienceShell from '@/components/auth/AuthExperienceShell'
import { useSearchParams } from 'next/navigation'
import { applyReferralCode } from '@/lib/queries'

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

export function Login() {
  const supabase = createClient()
  const [form, setForm] = useState({ email: '', password: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  async function handle(e) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const { error } = await supabase.auth.signInWithPassword({
      email: form.email,
      password: form.password,
    })

 if (error) {
  console.error('signup failed:', error.name, error.status, error.message)
  const unreachable = error.name === 'AuthRetryableFetchError' || error.message === '{}'
  setError(
    unreachable
      ? "Can't reach the server right now. Check your connection and try again."
      : error.message || 'Something went wrong. Please try again.'
  )
  return
}
    // Apply any referral code saved during signup but not yet processed
    // (happens when email confirmation was required before a session existed).
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

    setLoading(false)
    window.location.href = '/dashboard'
  }

  async function handleGoogle() {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    })
  }

  return (
    <AuthExperienceShell
      className="auth-experience--login"
      topAction={<>New to Vestora? <Link href="/signup">Create an account</Link></>}
    >
      <div className="auth-experience__form">
        <header className="auth-experience__form-heading">
          <span className="auth-experience__form-eyebrow">Secure account access</span>
          <h2 className="auth-experience__form-title">Welcome back</h2>
          <p className="auth-experience__form-description">Sign in to your Vestora account.</p>
        </header>

        {error && <div className="auth-experience__message" role="alert">{error}</div>}

        <form onSubmit={handle}>
          <div className="auth-experience__field">
            <label className="auth-experience__label" htmlFor="legacy-login-email">Email address</label>
            <input
              className="auth-experience__input"
              id="legacy-login-email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={form.email}
              onChange={e => setForm({...form, email: e.target.value})}
              required
            />
          </div>
          <div className="auth-experience__field">
            <label className="auth-experience__label" htmlFor="legacy-login-password">Password</label>
            <div className="auth-experience__password-wrap">
              <input
                className="auth-experience__input"
                id="legacy-login-password"
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
                <EyeIcon open={showPassword} />
              </button>
            </div>
          </div>
          <button
            className="auth-experience__submit"
            type="submit"
            disabled={loading}
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <div className="auth-experience__separator"><span>or</span></div>
        <button className="auth-experience__secondary" onClick={handleGoogle} type="button">
          <span className="auth-experience__google-mark" aria-hidden="true">G</span>
          Continue with Google
        </button>
        <p className="auth-experience__form-footer">
          Don’t have an account? <Link href="/signup">Create one</Link>
        </p>
      </div>
    </AuthExperienceShell>
  )
}

export function Signup() {
  const supabase = createClient()
  const searchParams = useSearchParams()
  const [form, setForm] = useState({ first: '', last: '', email: '', password: '', confirm: '', referralCode: '' })
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  // If they arrived via a referral link (?ref=CODE), prefill the field —
  // but they can still edit or clear it, and can also just type a code
  // manually if someone shared it with them any other way.
  useEffect(() => {
    const ref = searchParams.get('ref')
    if (ref) setForm(f => ({ ...f, referralCode: ref }))
  }, [searchParams])

  async function handle(e) {
    e.preventDefault()
    setError('')
    setSuccess('')

    if (form.password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (form.password !== form.confirm) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)

    // After the link verifies the email, /callback has a session and sends
    // the user straight to the dashboard. If no session can be created on
    // the device that opens the link, /callback asks them to sign in.
    const emailRedirect = new URL('/callback', window.location.origin)
    emailRedirect.searchParams.set('next', '/dashboard')

    const { data, error } = await supabase.auth.signUp({
      email: form.email.trim(),
      password: form.password,
      options: {
        data: { full_name: `${form.first} ${form.last}`.trim() },
        emailRedirectTo: emailRedirect.toString(),
      },
    })

    setLoading(false)
if (error) {
  console.error('signup failed:', error.name, error.status, error.message)
  const unreachable = error.name === 'AuthRetryableFetchError' || error.message === '{}'
  setError(
    unreachable
      ? "Can't reach the server right now. Check your connection and try again."
      : error.message || 'Something went wrong. Please try again.'
  )
  return
}

    const typedCode = form.referralCode.trim()

    // Save it either way, so it survives to the next login if email
    // confirmation is required before a session exists yet.
    if (typedCode) {
      localStorage.setItem('vestora_referral_code', typedCode)
    }

    // If email confirmation is required (default Supabase setting),
    // there's no session yet — the user needs to click the link in their inbox.
    // Supabase deliberately returns this same response when the email is
    // already registered, without sending a new email and without changing
    // that account's password. Say so (without revealing whether the
    // account exists), so a returning user doesn't expect the new password
    // to work.
    if (data.user && !data.session) {
      setSuccess('Check your email for a confirmation link to activate your account. If you already have a Vestora account with this email, no new link is sent and your existing password is unchanged: sign in, or use "Forgot password" instead.')
      return
    }

    // Session exists immediately — apply the code right now.
    if (typedCode) {
      try {
        await applyReferralCode(typedCode)
      } catch (err) {
        console.error('Failed to apply referral code:', err)
      } finally {
        localStorage.removeItem('vestora_referral_code')
      }
    }

    window.location.href = '/dashboard'
  }

  return (
    <AuthExperienceShell
      className="auth-experience--signup"
      topAction={<>Already have an account? <Link href="/login">Sign in</Link></>}
    >
      <div className="auth-experience__form">
        <header className="auth-experience__form-heading">
          <span className="auth-experience__form-eyebrow">A thoughtful start</span>
          <h2 className="auth-experience__form-title">Create your account</h2>
          <p className="auth-experience__form-description">Your Vestora account begins here.</p>
        </header>

        {error && <div className="auth-experience__message" role="alert">{error}</div>}
        {success && <div className="auth-experience__message auth-experience__message--success" role="status">{success}</div>}

        {!success && (
          <form onSubmit={handle}>
            <div className="auth-experience__field-row">
              <div className="auth-experience__field">
                <label className="auth-experience__label" htmlFor="signup-first-name">First name</label>
                <input
                  className="auth-experience__input"
                  id="signup-first-name"
                  autoComplete="given-name"
                  placeholder="First name"
                  value={form.first}
                  onChange={e=>setForm({...form,first:e.target.value})}
                  required
                />
              </div>
              <div className="auth-experience__field">
                <label className="auth-experience__label" htmlFor="signup-last-name">Last name</label>
                <input
                  className="auth-experience__input"
                  id="signup-last-name"
                  autoComplete="family-name"
                  placeholder="Last name"
                  value={form.last}
                  onChange={e=>setForm({...form,last:e.target.value})}
                  required
                />
              </div>
            </div>
            <div className="auth-experience__field">
              <label className="auth-experience__label" htmlFor="signup-email">Email address</label>
              <input
                className="auth-experience__input"
                id="signup-email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={form.email}
                onChange={e=>setForm({...form,email:e.target.value})}
                required
              />
            </div>
            <div className="auth-experience__field">
              <label className="auth-experience__label" htmlFor="signup-password">Password</label>
              <div className="auth-experience__password-wrap">
                <input
                  className="auth-experience__input"
                  id="signup-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  placeholder="Min. 8 characters"
                  value={form.password}
                  onChange={e=>setForm({...form,password:e.target.value})}
                  required
                  minLength={8}
                />
                <button
                  type="button"
                  className="auth-experience__password-toggle"
                  onClick={() => setShowPassword(v => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  <EyeIcon open={showPassword} />
                </button>
              </div>
            </div>
            <div className="auth-experience__field">
              <label className="auth-experience__label" htmlFor="signup-confirm-password">Confirm password</label>
              <div className="auth-experience__password-wrap">
                <input
                  className="auth-experience__input"
                  id="signup-confirm-password"
                  type={showConfirm ? 'text' : 'password'}
                  autoComplete="new-password"
                  placeholder="Re-enter your password"
                  value={form.confirm}
                  onChange={e=>setForm({...form,confirm:e.target.value})}
                  required
                  minLength={8}
                />
                <button
                  type="button"
                  className="auth-experience__password-toggle"
                  onClick={() => setShowConfirm(v => !v)}
                  aria-label={showConfirm ? 'Hide password' : 'Show password'}
                >
                  <EyeIcon open={showConfirm} />
                </button>
              </div>
            </div>
            <div className="auth-experience__field">
              <label className="auth-experience__label" htmlFor="signup-referral">Referral code (optional)</label>
              <input
                className="auth-experience__input"
                id="signup-referral"
                placeholder="e.g. X7K2M9QP"
                value={form.referralCode}
                onChange={e => setForm({ ...form, referralCode: e.target.value.toUpperCase() })}
              />
            </div>
            <label className="auth-experience__checkbox">
              <input
                type="checkbox"
                checked={acceptedTerms}
                onChange={e => setAcceptedTerms(e.target.checked)}
                required
              />
              <span>
                I agree to the <a href="/legal/terms-of-service.pdf" target="_blank" rel="noreferrer">Terms of Service</a> and <a href="/legal/privacy-policy.pdf" target="_blank" rel="noreferrer">Privacy Policy</a>.
              </span>
            </label>
            <button
              className="auth-experience__submit"
              type="submit"
              disabled={loading}
            >
              {loading ? 'Creating account…' : 'Create account'}
            </button>
          </form>
        )}

        <p className="auth-experience__form-footer">
          Already have an account? <Link href="/login">Sign in</Link>
        </p>
      </div>
    </AuthExperienceShell>
  )
}