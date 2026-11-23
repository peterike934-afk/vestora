"use client";

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import VestoraMark from '@/components/VestoraMark'
import { useSearchParams } from 'next/navigation'

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
  row: { display: 'flex', gap: '16px' },
  half: { flex: 1 },
  divider: { display: 'flex', alignItems: 'center', gap: '12px', margin: '24px 0' },
  divLine: { flex: 1, height: '1px', background: 'var(--border)' },
  divText: { fontSize: '12px', color: 'var(--text3)' },
  google: { width: '100%', padding: '12px', background: 'transparent', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontSize: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', cursor: 'pointer' },
  error: { fontSize: '13px', color: 'var(--red)', background: 'var(--red-dim)', padding: '10px 14px', borderRadius: 'var(--radius-sm)', marginBottom: '20px' },
  success: { fontSize: '13px', color: 'var(--green)', background: 'var(--green-dim)', padding: '10px 14px', borderRadius: 'var(--radius-sm)', marginBottom: '20px' },
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

export function Login() {
  const router = useRouter()
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
      setLoading(false)
      setError(error.message)
      return
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
    <div style={s.page}>
      <div style={s.card}>
        <div style={s.logo}>
          <VestoraMark size={32} />
          <span style={s.logoText}>Vestora</span>
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
                <EyeIcon open={showPassword} />
              </button>
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
        <button style={s.google} onClick={handleGoogle} type="button">🌐 Continue with Google</button>
        <p style={s.link}>Don't have an account? <Link href="/signup" style={s.linkA}>Create one</Link></p>
      </div>
    </div>
  )
}

export function Signup() {
  const router = useRouter()
  const supabase = createClient()
  const searchParams = useSearchParams()
  const [form, setForm] = useState({ first: '', last: '', email: '', password: '', confirm: '', referralCode: '' })
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

    // The referral code travels with the signup itself. The database captures
    // it once, when the account is created, and attributes it only after the
    // email is verified — on any device, with no further client call.
    const referralCode = form.referralCode.trim().toUpperCase()
    const { data, error } = await supabase.auth.signUp({
      email: form.email.trim(),
      password: form.password,
      options: {
        data: {
          full_name: `${form.first} ${form.last}`.trim(),
          ...(referralCode ? { referral_code: referralCode } : {}),
        },
        emailRedirectTo: emailRedirect.toString(),
      },
    })

    setLoading(false)

    if (error) {
      setError(error.message)
      return
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

    window.location.href = '/dashboard'
  }

  return (
    <div style={s.page}>
      <div style={s.card}>
        <div style={s.logo}>
          <VestoraMark size={32} />
          <span style={s.logoText}>Vestora</span>
        </div>
        <p style={s.title}>Start investing today</p>
        <p style={s.sub}>Create your free account in seconds</p>

        {error && <div style={s.error}>{error}</div>}
        {success && <div style={s.success}>{success}</div>}

        {!success && (
          <form onSubmit={handle}>
            <div style={{...s.row, marginBottom: '0'}}>
              <div style={{...s.field, ...s.half}}>
                <label style={s.label}>First name</label>
                <input style={s.input} placeholder="John" value={form.first} onChange={e=>setForm({...form,first:e.target.value})} required />
              </div>
              <div style={{...s.field, ...s.half}}>
                <label style={s.label}>Last name</label>
                <input style={s.input} placeholder="Doe" value={form.last} onChange={e=>setForm({...form,last:e.target.value})} required />
              </div>
            </div>
            <div style={s.field}>
              <label style={s.label}>Email address</label>
              <input style={s.input} type="email" placeholder="you@example.com" value={form.email} onChange={e=>setForm({...form,email:e.target.value})} required />
            </div>
            <div style={s.field}>
              <label style={s.label}>Password</label>
              <div style={s.passWrap}>
                <input
                  style={{ ...s.input, paddingRight: '44px' }}
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Min. 8 characters"
                  value={form.password}
                  onChange={e=>setForm({...form,password:e.target.value})}
                  required
                  minLength={8}
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
            </div>
            <div style={s.field}>
              <label style={s.label}>Confirm password</label>
              <div style={s.passWrap}>
                <input
                  style={{ ...s.input, paddingRight: '44px' }}
                  type={showConfirm ? 'text' : 'password'}
                  placeholder="Re-enter your password"
                  value={form.confirm}
                  onChange={e=>setForm({...form,confirm:e.target.value})}
                  required
                  minLength={8}
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
            <div style={s.field}>
              <label style={s.label}>Referral code (optional)</label>
              <input
                style={s.input}
                placeholder="e.g. X7K2M9QP"
                value={form.referralCode}
                onChange={e => setForm({ ...form, referralCode: e.target.value.toUpperCase() })}
              />
            </div>
            <button
              style={{ ...s.btn, ...(loading ? s.btnDisabled : {}) }}
              type="submit"
              disabled={loading}
            >
              {loading ? 'Creating account…' : 'Create account'}
            </button>
          </form>
        )}

        <div style={s.divider}><div style={s.divLine}/><span style={s.divText}>or</span><div style={s.divLine}/></div>
        <p style={s.link}>Already have an account? <Link href="/login" style={s.linkA}>Sign in</Link></p>
      </div>
    </div>
  )
}