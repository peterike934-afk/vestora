"use client";

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

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
  btn: { width: '100%', padding: '14px', background: 'var(--green)', border: 'none', borderRadius: 'var(--radius-sm)', color: '#000', fontSize: '15px', fontWeight: '600', marginTop: '8px', transition: 'opacity 0.2s', cursor: 'pointer' },
  btnDisabled: { opacity: 0.6, cursor: 'not-allowed' },
  link: { textAlign: 'center', marginTop: '24px', fontSize: '14px', color: 'var(--text2)' },
  linkA: { color: 'var(--green)', fontWeight: '500' },
  error: { fontSize: '13px', color: 'var(--red)', background: 'var(--red-dim)', padding: '10px 14px', borderRadius: 'var(--radius-sm)', marginBottom: '20px' },
  success: { fontSize: '14px', color: 'var(--text)', background: 'var(--bg3)', border: '1px solid var(--border)', padding: '16px', borderRadius: 'var(--radius-sm)', textAlign: 'center' },
}

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
    <div style={s.page}>
      <div style={s.card}>
        <div style={s.logo}>
          <div style={s.logoIcon}>$</div>
          <span style={s.logoText}>Vestoral</span>
        </div>

        {sent ? (
          <>
            <p style={s.title}>Check your email</p>
            <p style={s.sub}>If an account exists for {email}, a reset link is on its way.</p>
            <div style={s.success}>
              Didn't get it? Check your spam folder, or{' '}
              <span
                style={{ ...s.linkA, cursor: 'pointer' }}
                onClick={() => setSent(false)}
              >
                try again
              </span>.
            </div>
            <p style={s.link}>
              <Link href="/login" style={s.linkA}>Back to sign in</Link>
            </p>
          </>
        ) : (
          <>
            <p style={s.title}>Reset your password</p>
            <p style={s.sub}>Enter the email on your account and we'll send a reset link</p>

            {error && <div style={s.error}>{error}</div>}

            <form onSubmit={handle}>
              <div style={s.field}>
                <label style={s.label}>Email address</label>
                <input
                  style={s.input}
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <button
                style={{ ...s.btn, ...(loading ? s.btnDisabled : {}) }}
                type="submit"
                disabled={loading}
              >
                {loading ? 'Sending…' : 'Send reset link'}
              </button>
            </form>
            <p style={s.link}>
              <Link href="/login" style={s.linkA}>Back to sign in</Link>
            </p>
          </>
        )}
      </div>
    </div>
  )
}