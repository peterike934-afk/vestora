"use client";

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useUser } from '@/contexts/UserContext'
import { getWallet, createTransaction } from '@/lib/queries'
import { createClient } from '@/lib/supabase/client'
import { startMfaEnrollment, verifyMfaEnrollment, listMfaFactors, unenrollMfaFactor } from '@/lib/mfa'
import { updateEmailNotificationPref } from '@/lib/queries'

const s = {
  page: { padding: '32px 36px' },
  title: { fontSize: '26px', fontWeight: '700', color: 'var(--text)', marginBottom: '4px' },
  sub: { fontSize: '14px', color: 'var(--text2)', marginBottom: '28px' },
  card: { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '24px', marginBottom: '20px' },
  row: { display: 'flex', gap: '16px', marginBottom: '20px' },
  stat: { flex: 1, background: 'var(--bg3)', borderRadius: 'var(--radius-sm)', padding: '20px 24px' },
  statLabel: { fontSize: '11px', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' },
  statValue: { fontSize: '24px', fontWeight: '700', color: 'var(--text)' },
  label: { display: 'block', fontSize: '13px', color: 'var(--text2)', marginBottom: '6px', fontWeight: '500' },
  input: { width: '100%', padding: '12px 16px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontSize: '14px', outline: 'none', marginBottom: '16px' },
  select: { width: '100%', padding: '12px 16px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontSize: '14px', outline: 'none', marginBottom: '16px' },
  btnGreen: { padding: '13px 28px', background: 'var(--green)', border: 'none', borderRadius: 'var(--radius-sm)', color: '#000', fontSize: '14px', fontWeight: '600', cursor: 'pointer' },
  btnRed: { padding: '13px 28px', background: 'var(--red)', border: 'none', borderRadius: 'var(--radius-sm)', color: '#fff', fontSize: '14px', fontWeight: '600', cursor: 'pointer' },
  btnDisabled: { opacity: 0.5, cursor: 'not-allowed' },
  txItem: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid var(--border)' },
  txLeft: { display: 'flex', alignItems: 'center', gap: '12px' },
  txIcon: { width: '34px', height: '34px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', flexShrink: 0 },
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' },
  error: { fontSize: '13px', color: 'var(--red)', background: 'var(--red-dim)', padding: '10px 14px', borderRadius: 'var(--radius-sm)', marginBottom: '16px' },
  mono: { fontFamily: 'monospace', fontSize: '13px', color: 'var(--text)', wordBreak: 'break-all' },
  modalOverlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300 },
  modal: { width: '360px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '24px', textAlign: 'center' },
  modalTitle: { fontSize: '16px', fontWeight: '700', color: 'var(--text)', marginBottom: '8px' },
  modalSub: { fontSize: '13px', color: 'var(--text3)', marginBottom: '20px' },
  qrWrap: { background: '#fff', borderRadius: '8px', padding: '12px', display: 'inline-block', marginBottom: '16px' },
  secretText: { fontFamily: 'monospace', fontSize: '11px', color: 'var(--text3)', wordBreak: 'break-all', marginBottom: '20px' },
  codeInput: { width: '100%', padding: '12px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontSize: '18px', textAlign: 'center', letterSpacing: '4px', outline: 'none', marginBottom: '16px' },
  toggle: { width: '44px', height: '24px', borderRadius: '12px', cursor: 'pointer', position: 'relative', transition: 'background 0.2s' },
  toggleKnob: { width: '18px', height: '18px', borderRadius: '50%', background: '#fff', position: 'absolute', top: '3px', transition: 'left 0.2s' },
}

// ⚠️ PLACEHOLDER addresses — replace with your real deposit wallet
// addresses before going live. These are NOT real Vestora wallets.
const DEPOSIT_ADDRESSES = {
  BTC: 'bc1q_REPLACE_WITH_REAL_BTC_ADDRESS',
  ETH: '0xREPLACE_WITH_REAL_ETH_ADDRESS',
  USDT: '0xREPLACE_WITH_REAL_USDT_ERC20_ADDRESS',
}

export function Deposit() {
  const { user } = useUser()
  const [currency, setCurrency] = useState('BTC')
  const [cryptoAmount, setCryptoAmount] = useState('')
  const [amountUsd, setAmountUsd] = useState('')
  const [txHash, setTxHash] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  async function handleSubmit() {
    setError('')
    if (!cryptoAmount || !amountUsd || !txHash) {
      setError('Please fill in the amount and transaction hash.')
      return
    }
    setSubmitting(true)
    try {
      await createTransaction({
        userId: user.id,
        type: 'deposit',
        amountUsd: Number(amountUsd),
        cryptoCurrency: currency,
        cryptoAmount: Number(cryptoAmount),
        txHash: txHash.trim(),
      })
      setDone(true)
    } catch (err) {
      setError(err.message || 'Something went wrong submitting your deposit.')
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <div style={s.page}>
        <h1 style={s.title}>TESTVERIFY123</h1>
        <div style={{ ...s.card, textAlign: 'center', padding: '48px' }}>
          <div style={{ fontSize: '20px', fontWeight: '700', color: 'var(--text)', marginBottom: '8px' }}>Deposit submitted</div>
          <div style={{ fontSize: '14px', color: 'var(--text2)', marginBottom: '24px' }}>
            Your deposit claim is pending verification. Once we confirm the
            transaction on-chain, your balance will be updated.
          </div>
          <button style={s.btnGreen} onClick={() => { setDone(false); setCryptoAmount(''); setAmountUsd(''); setTxHash(''); }}>
            Make another deposit
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={s.page}>
      <h1 style={s.title}>Deposit funds</h1>
      <p style={s.sub}>Add crypto to your investment wallet</p>

      {error && <div style={s.error}>{error}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={s.card}>
          <label style={s.label}>Currency</label>
          <select style={s.select} value={currency} onChange={e => setCurrency(e.target.value)}>
            <option value="BTC">Bitcoin (BTC)</option>
            <option value="ETH">Ethereum (ETH)</option>
            <option value="USDT">USDT (ERC-20)</option>
          </select>

          <label style={s.label}>Send to this address</label>
          <div style={{ ...s.input, ...s.mono, cursor: 'text', userSelect: 'all' }}>
            {DEPOSIT_ADDRESSES[currency]}
          </div>

          <label style={s.label}>Amount sent ({currency})</label>
          <input style={s.input} type="number" step="any" placeholder="0.00" value={cryptoAmount} onChange={e => setCryptoAmount(e.target.value)} />

          <label style={s.label}>Estimated USD value</label>
          <input style={s.input} type="number" step="any" placeholder="0.00" value={amountUsd} onChange={e => setAmountUsd(e.target.value)} />

          <label style={s.label}>Transaction hash (tx ID)</label>
          <input style={s.input} placeholder="0x..." value={txHash} onChange={e => setTxHash(e.target.value)} />

          <button
            style={{ ...s.btnGreen, ...(submitting ? s.btnDisabled : {}) }}
            disabled={submitting}
            onClick={handleSubmit}
          >
            {submitting ? 'Submitting…' : 'Submit deposit'}
          </button>
        </div>

        <div style={{ ...s.card, background: 'var(--bg3)' }}>
          <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text)', marginBottom: '16px' }}>How it works</div>
          {[
            ['1', 'Send crypto to the address shown'],
            ['2', 'Copy your transaction hash from your wallet app'],
            ['3', 'Submit it here — your deposit sits pending'],
            ['4', 'We verify it on-chain and credit your balance'],
          ].map(([step, text]) => (
            <div key={step} style={{ display: 'flex', gap: '12px', marginBottom: '12px', fontSize: '13px' }}>
              <span style={{ color: 'var(--green)', fontWeight: '600' }}>{step}</span>
              <span style={{ color: 'var(--text2)' }}>{text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function Withdraw() {
  const { user } = useUser()
  const [balance, setBalance] = useState(0)
  const [loadingBalance, setLoadingBalance] = useState(true)
  const [amount, setAmount] = useState('')
  const [bank, setBank] = useState('')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (!user) return
    getWallet(user.id)
      .then(w => setBalance(w?.balance_usd ?? 0))
      .catch(err => console.error('Failed to load balance:', err))
      .finally(() => setLoadingBalance(false))
  }, [user])

  async function handleSubmit() {
    setError('')
    const amt = Number(amount)

    if (!amt || amt <= 0) {
      setError('Enter a valid amount.')
      return
    }
    if (!bank) {
      setError('Select a destination.')
      return
    }
    if (amt > balance) {
      setError(`You can't withdraw more than your available balance (${formatUsd(balance)}).`)
      return
    }

    setSubmitting(true)
    try {
      await createTransaction({
        userId: user.id,
        type: 'withdrawal',
        amountUsd: amt,
        note: `To: ${bank}${note ? ` — ${note}` : ''}`,
      })
      setDone(true)
    } catch (err) {
      setError(err.message || 'Something went wrong submitting your withdrawal.')
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <div style={s.page}>
        <h1 style={s.title}>Withdraw funds</h1>
        <div style={{ ...s.card, textAlign: 'center', padding: '48px' }}>
          <div style={{ fontSize: '20px', fontWeight: '700', color: 'var(--text)', marginBottom: '8px' }}>Withdrawal requested</div>
          <div style={{ fontSize: '14px', color: 'var(--text2)', marginBottom: '24px' }}>
            Your withdrawal request is pending review.
          </div>
          <button style={s.btnRed} onClick={() => { setDone(false); setAmount(''); setBank(''); setNote(''); }}>
            Make another withdrawal
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={s.page}>
      <h1 style={s.title}>Withdraw funds</h1>
      <p style={s.sub}>Move money from your wallet</p>

      {error && <div style={s.error}>{error}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={s.card}>
          <div style={{ ...s.stat, marginBottom: '20px' }}>
            <div style={s.statLabel}>Available to withdraw</div>
            <div style={{ ...s.statValue, color: 'var(--green)', fontSize: '20px' }}>
              {loadingBalance ? '—' : formatUsd(balance)}
            </div>
          </div>
          <label style={s.label}>Amount (USD)</label>
          <input style={s.input} type="number" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)} />
          <label style={s.label}>Destination bank</label>
          <select style={s.select} value={bank} onChange={e => setBank(e.target.value)}>
            <option value="">Select bank account</option>
            <option value="Chase — ****4821">Chase — ****4821</option>
            <option value="Bank of America — ****2930">Bank of America — ****2930</option>
            <option value="Wells Fargo — ****7104">Wells Fargo — ****7104</option>
          </select>
          <label style={s.label}>Note (optional)</label>
          <input style={s.input} placeholder="What's this for?" value={note} onChange={e => setNote(e.target.value)} />
          <button
            style={{ ...s.btnRed, ...(submitting ? s.btnDisabled : {}) }}
            disabled={submitting}
            onClick={handleSubmit}
          >
            {submitting ? 'Submitting…' : 'Request withdrawal'}
          </button>
        </div>
        <div style={{ ...s.card, background: 'var(--bg3)' }}>
          <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text)', marginBottom: '16px' }}>Withdrawal info</div>
          {[['Minimum', '$50'], ['Daily limit', '$50,000'], ['Fee', '0.5%'], ['Processing', 'Reviewed by our team']].map(([k, v]) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px', fontSize: '13px' }}>
              <span style={{ color: 'var(--text2)' }}>{k}</span>
              <span style={{ color: 'var(--text)', fontWeight: '500' }}>{v}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function formatUsd(n) {
  return `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
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

export function Settings() {
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
  const [mfaError, setMfaError] = useState('')

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
    setMfaError('')
    try {
      await unenrollMfaFactor(mfaFactor.id)
      setMfaFactor(null)
    } catch (err) {
      setMfaError(err.message || 'Failed to disable 2FA')
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

      {mfaError && <div style={s.error}>{mfaError}</div>}

      <div className="responsive-grid-2" style={s.grid2}>
        <div>
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