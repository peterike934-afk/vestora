"use client";

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, ArrowRight, Check, Mail } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import AuthExperienceShell from '@/components/auth/AuthExperienceShell'

export default function ForgotPassword() {
  const supabase = createClient()
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  async function handle(e) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })

    setLoading(false)

    // Deliberately show success even on error to avoid leaking whether
    // an email exists in the system. Real errors are still logged.
    if (error) {
      console.error('Password reset request error:', error.message)
    }
    setSent(true)
  }

  return (
    <AuthExperienceShell
      className="auth-experience--recovery"
      topAction={<>Remembered your password? <Link href="/login">Sign in</Link></>}
    >
      <div className="auth-experience__form">
        {sent ? (
          <>
            <header className="auth-experience__form-heading">
              <span className="auth-experience__form-eyebrow">Check your inbox</span>
              <h2 className="auth-experience__form-title">Check your email</h2>
              <p className="auth-experience__form-description">
                If an account exists for <strong>{email}</strong>, a reset link is on its way.
              </p>
            </header>
            <div className="auth-experience__message auth-experience__message--success" role="status">
              <Mail size={17} aria-hidden="true" />
              <span>Didn’t get it? Check your spam folder, or <button type="button" className="auth-experience__inline-button" onClick={() => setSent(false)}>try again</button>.</span>
            </div>
            <p className="auth-experience__form-footer">
              <Link href="/login"><ArrowLeft size={14} aria-hidden="true" /> Back to sign in</Link>
            </p>
          </>
        ) : (
          <>
            <header className="auth-experience__form-heading">
              <span className="auth-experience__form-eyebrow">Account recovery</span>
              <h2 className="auth-experience__form-title">Reset your password</h2>
              <p className="auth-experience__form-description">
                Enter the email address linked to your account and we’ll send a reset link.
              </p>
            </header>

            {error && <div className="auth-experience__message" role="alert">{error}</div>}

            <form onSubmit={handle}>
              <div className="auth-experience__field">
                <label className="auth-experience__label" htmlFor="recovery-email">Email address</label>
                <input
                  className="auth-experience__input"
                  id="recovery-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <button
                className="auth-experience__submit"
                type="submit"
                disabled={loading}
              >
                {loading ? 'Sending…' : <>Send reset link <ArrowRight size={16} aria-hidden="true" /></>}
              </button>
            </form>
            <p className="auth-experience__form-footer">
              <Link href="/login"><ArrowLeft size={14} aria-hidden="true" /> Back to sign in</Link>
            </p>
          </>
        )}
      </div>
    </AuthExperienceShell>
  )
}