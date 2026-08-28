"use client";

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useUser } from '@/contexts/UserContext'
import { createClient } from '@/lib/supabase/client'
import { startMfaEnrollment, verifyMfaEnrollment, listMfaFactors, unenrollMfaFactor } from '@/lib/mfa'
import { updateEmailNotificationPref } from '@/lib/queries'

const s = {
  page: { padding: '32px 36px' },
  title: { fontSize: '26px', fontWeight: '700', color: 'var(--text)', marginBottom: '4px' },
  sub: { fontSize: '14px', color: 'var(--text2)', marginBottom: '28px' },
  card: { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '24px', marginBottom: '20px' },
  label: { display: 'block', fontSize: '13px', color: 'var(--text2)', marginBottom: '6px', fontWeight: '500' },
  input: { width: '100%', padding: '12px 16px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontSize: '14px', outline: 'none', marginBottom: '16px' },
  btnGreen: { padding: '13px 28px', background: 'var(--green)', border: 'none', borderRadius: 'var(--radius-sm)', color: '#000', fontSize: '14px', fontWeight: '600', cursor: 'pointer' },
  btnRed: { padding: '13px 28px', background: 'var(--red)', border: 'none', borderRadius: 'var(--radius-sm)', color: '#fff', fontSize: '14px', fontWeight: '600', cursor: 'pointer' },
  btnDisabled: { opacity: 0.5, cursor: 'not-allowed' },
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' },
  toggle: { width: '44px', height: '24px', borderRadius: '12px', cursor: 'pointer', position: 'relative', transition: 'background 0.2s' },
  toggleKnob: { width: '18px', height: '18px', borderRadius: '50%', background: '#fff', position: 'absolute', top: '3px', transition: 'left 0.2s' },
  error: { fontSize: '13px', color: 'var(--red)', background: 'var(--red-dim)', padding: '10px 14px', borderRadius: 'var(--radius-sm)', marginBottom: '16px' },
  modalOverlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300 },
  modal: { width: '360px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '24px', textAlign: 'center' },
  modalTitle: { fontSize: '16px', fontWeight: '700', color: 'var(--text)', marginBottom: '8px' },
  modalSub: { fontSize: '13px', color: 'var(--text3)', marginBottom: '20px' },
  qrWrap: { background: '#fff', borderRadius: '8px', padding: '12px', display: 'inline-block', marginBottom: '16px' },
  secretText: { fontFamily: 'monospace', fontSize: '11px', color: 'var(--text3)', wordBreak: 'break-all', marginBottom: '20px' },
  codeInput: { width: '100%', padding: '12px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontSize: '18px', textAlign: 'center', letterSpacing: '4px', outline: 'none', marginBottom: '16px' },
}

function EnrollMfaModal({ onClose, onEnrolled }) {
  const [step, setStep] = useState('loading') // loading | scan | error
  const [factorId, setFactorId] = useState(null)
  const [qrCode, setQrCode] = useState('')
  const [secret, setSecret] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [verifying, setVerifying] = useState(false)

  useEffect(() => {
    startMfaEnrollment()
      .then(({ factorId, qrCode, secret }) => {
        setFactorId(factorId)
        setQrCode(qrCode)
        setSecret(secret)
        setStep('scan')
      })
      .catch(err => {
        setError(err.message || 'Failed to start enrollment')
        setStep('error')
      })
  }, [])

  async function handleVerify() {
    if (!code || code.length !== 6) {
      setError('Enter the 6-digit code from your authenticator app.')
      return
    }
    setVerifying(true)
    setError('')
    try {
      await verifyMfaEnrollment(factorId, code)
      onEnrolled()
    } catch (err) {
      setError(err.message || 'Invalid code — try again.')
    } finally {
      setVerifying(false)
    }
  }

  return (
    <div style={s.modalOverlay} onClick={onClose}>
      <div style={s.modal} onClick={e => e.stopPropagation()}>
        <div style={s.modalTitle}>Enable two-factor auth</div>

        {step === 'loading' && <div style={s.modalSub}>Setting up…</div>}

        {step === 'error' && <div style={s.error}>{error}</div>}

        {step === 'scan' && (
          <>
            <div style={s.modalSub}>Scan with Google Authenticator, Authy, or any TOTP app</div>
            <div style={s.qrWrap} dangerouslySetInnerHTML={{ __html: qrCode }} />
            <div style={s.secretText}>Can't scan? Enter manually: {secret}</div>

            {error && <div style={s.error}>{error}</div>}

            <input
              style={s.codeInput}
              placeholder="000000"
              maxLength={6}
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
            />
            <button
              style={{ ...s.btnGreen, width: '100%', ...(verifying ? s.btnDisabled : {}) }}
              disabled={verifying}
              onClick={handleVerify}
            >
              {verifying ? 'Verifying…' : 'Confirm & enable'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

export default function Settings() {
  const router = useRouter()
  const { user, userName } = useUser()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [notify, setNotify] = useState(true)
  const [mfaFactor, setMfaFactor] = useState(null)
  const [loadingMfa, setLoadingMfa] = useState(true)
  const [showEnrollModal, setShowEnrollModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!user) return
    setName(userName || '')
    setEmail(user.email || '')

    const supabase = createClient()
    supabase.from('profiles').select('email_notifications').eq('id', user.id).single()
      .then(({ data }) => { if (data) setNotify(data.email_notifications) })
      .catch(err => console.error('Failed to load notification preference:', err))
  }, [user, userName])

  async function handleToggleNotify() {
    const next = !notify
    setNotify(next) // optimistic — flips immediately, reverts below if the save fails
    try {
      await updateEmailNotificationPref(user.id, next)
    } catch (err) {
      console.error('Failed to save notification preference:', err)
      setNotify(!next)
    }
  }

  async function loadMfaStatus() {
    setLoadingMfa(true)
    try {
      const factors = await listMfaFactors()
      const verified = factors.find(f => f.status === 'verified')
      setMfaFactor(verified || null)
    } catch (err) {
      console.error('Failed to load MFA status:', err)
    } finally {
      setLoadingMfa(false)
    }
  }

  useEffect(() => { loadMfaStatus() }, [])

  async function handleDisableMfa() {
    if (!mfaFactor) return
    if (!confirm('Disable two-factor authentication?')) return
    setError('')
    try {
      await unenrollMfaFactor(mfaFactor.id)
      setMfaFactor(null)
    } catch (err) {
      setError(err.message || 'Failed to disable 2FA')
    }
  }

  async function handleSave() {
    setSaving(true)
    setSaved(false)
    const supabase = createClient()
    const { error } = await supabase
      .from('profiles')
      .update({ full_name: name })
      .eq('id', user.id)
    setSaving(false)
    if (!error) setSaved(true)
  }

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <div style={s.page}>
      <h1 style={s.title}>Settings</h1>
      <p style={s.sub}>Manage your account preferences</p>

      {error && <div style={s.error}>{error}</div>}

      <div className="responsive-grid-2" style={s.grid2}>
        <div style={s.card}>
          <div style={{ fontSize: '15px', fontWeight: '600', color: 'var(--text)', marginBottom: '20px' }}>Profile</div>
          <label style={s.label}>Full name</label>
          <input style={s.input} value={name} onChange={e => setName(e.target.value)} />
          <label style={s.label}>Email address</label>
          <input style={s.input} type="email" value={email} disabled />
          <button style={s.btnGreen} onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save changes'}
          </button>
        </div>

        <div>
          <div style={s.card}>
            <div style={{ fontSize: '15px', fontWeight: '600', color: 'var(--text)', marginBottom: '20px' }}>Security</div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
              <div>
                <div style={{ fontSize: '14px', fontWeight: '500', color: 'var(--text)' }}>Email notifications</div>
                <div style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>Get alerts for deposits and withdrawals</div>
              </div>
              <div onClick={handleToggleNotify} style={{ ...s.toggle, background: notify ? 'var(--green)' : 'var(--bg4)' }}>
                <div style={{ ...s.toggleKnob, left: notify ? '23px' : '3px' }} />
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
              <div>
                <div style={{ fontSize: '14px', fontWeight: '500', color: 'var(--text)' }}>Two-factor auth</div>
                <div style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>
                  {loadingMfa ? 'Checking status…' : mfaFactor ? 'Enabled — code required on every login' : 'Require a code from your authenticator app on login'}
                </div>
              </div>
            </div>

            {!loadingMfa && (
              mfaFactor ? (
                <button style={{ ...s.btnRed, width: '100%' }} onClick={handleDisableMfa}>
                  Disable 2FA
                </button>
              ) : (
                <button style={{ ...s.btnGreen, width: '100%' }} onClick={() => setShowEnrollModal(true)}>
                  Enable 2FA
                </button>
              )
            )}
          </div>
          <button style={{ ...s.btnRed, width: '100%', marginTop: '4px' }} onClick={handleSignOut}>Sign out</button>
        </div>
      </div>

      {showEnrollModal && (
        <EnrollMfaModal
          onClose={() => setShowEnrollModal(false)}
          onEnrolled={() => { setShowEnrollModal(false); loadMfaStatus(); }}
        />
      )}
    </div>
  )
}