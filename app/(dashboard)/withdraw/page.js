"use client";

import { useState, useEffect } from 'react'
import { useUser } from '@/contexts/UserContext'
import { useSearchParams } from 'next/navigation'
import { getWallet, getTransactions, createTransaction, getSettings, getConnectOnboardingStatus } from '@/lib/queries'
import AuthTransitionOverlay from '@/components/AuthTransitionOverlay'

const s = {
  page: { padding: '32px 36px' },
  title: { fontSize: '26px', fontWeight: '700', color: 'var(--text)', marginBottom: '4px' },
  sub: { fontSize: '14px', color: 'var(--text2)', marginBottom: '28px' },
  card: { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '24px', marginBottom: '20px' },
  stat: { flex: 1, background: 'var(--bg3)', borderRadius: 'var(--radius-sm)', padding: '20px 24px' },
  statLabel: { fontSize: '11px', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' },
  statValue: { fontSize: '24px', fontWeight: '700', color: 'var(--text)' },
  label: { display: 'block', fontSize: '13px', color: 'var(--text2)', marginBottom: '6px', fontWeight: '500' },
  input: { width: '100%', padding: '12px 16px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontSize: '14px', outline: 'none', marginBottom: '16px' },
  select: { width: '100%', padding: '12px 16px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontSize: '14px', outline: 'none', marginBottom: '16px' },
  mono: { fontFamily: 'monospace' },
  btnRed: { padding: '13px 28px', background: 'var(--red)', border: 'none', borderRadius: 'var(--radius-sm)', color: '#fff', fontSize: '14px', fontWeight: '600', cursor: 'pointer', width: '100%' },
  btnGreen: { padding: '13px 28px', background: 'var(--green)', border: 'none', borderRadius: 'var(--radius-sm)', color: '#000', fontSize: '14px', fontWeight: '600', cursor: 'pointer', width: '100%' },
  btnDisabled: { opacity: 0.5, cursor: 'not-allowed' },
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' },
  error: { fontSize: '13px', color: 'var(--red)', background: 'var(--red-dim)', padding: '10px 14px', borderRadius: 'var(--radius-sm)', marginBottom: '16px' },
  feePreview: { fontSize: '13px', color: 'var(--text2)', marginBottom: '16px', padding: '10px 14px', background: 'var(--bg3)', borderRadius: 'var(--radius-sm)' },
  methodTabs: { display: 'flex', gap: '8px', marginBottom: '24px' },
  methodTab: { flex: 1, padding: '12px', textAlign: 'center', borderRadius: 'var(--radius-sm)', fontSize: '14px', fontWeight: '600', cursor: 'pointer', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text2)' },
  methodTabActive: { background: 'var(--red-dim)', border: '1px solid var(--red)', color: 'var(--red)' },
  comingSoonNote: { fontSize: '12px', color: 'var(--text3)', marginTop: '-10px', marginBottom: '16px' },
  connectBox: { textAlign: 'center', padding: '32px 20px' },
  connectIcon: { fontSize: '32px', marginBottom: '12px' },
}

function formatUsd(n) {
  return `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function isToday(dateStr) {
  const d = new Date(dateStr)
  const now = new Date()
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
}

function looksLikeValidAddress(currency, address) {
  if (!address) return false
  if (currency === 'BTC') {
    // Mainnet: 1, 3, bc1 — Testnet: m, n, 2, tb1
    return /^(1|3|m|n|2|bc1|tb1)[a-zA-Z0-9]{25,60}$/.test(address.trim())
  }
  return /^0x[a-fA-F0-9]{40}$/.test(address.trim())
}

export default function WithdrawPage() {
  const { user } = useUser()
  const searchParams = useSearchParams()
  const [balance, setBalance] = useState(0)
  const [settings, setSettings] = useState(null)
  const [withdrawnToday, setWithdrawnToday] = useState(0)
  const [loadingBalance, setLoadingBalance] = useState(true)
  const [method, setMethod] = useState('crypto') // 'crypto' | 'bank' | 'wire'

  // Crypto state
  const [currency, setCurrency] = useState('ETH')
  const [cryptoAmount, setCryptoAmount] = useState('')
  const [amount, setAmount] = useState('')
  const [address, setAddress] = useState('')

  // Bank (Stripe Connect) state
  const [connectOnboarded, setConnectOnboarded] = useState(false)
  const [checkingConnect, setCheckingConnect] = useState(true)
  const [connectingBank, setConnectingBank] = useState(false)
  const [bankAmount, setBankAmount] = useState('')

  // Wire (manual) state
  const [wireBankAmount, setWireBankAmount] = useState('')
  const [wireBankName, setWireBankName] = useState('')
  const [wireAccountName, setWireAccountName] = useState('')
  const [wireRoutingNumber, setWireRoutingNumber] = useState('')
  const [wireAccountNumber, setWireAccountNumber] = useState('')

  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [showOverlay, setShowOverlay] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (!user) return
    Promise.all([getWallet(user.id), getTransactions(user.id), getSettings()])
      .then(([wallet, txns, settingsData]) => {
        setBalance(wallet?.balance_usd ?? 0)
        setSettings(settingsData)
        const todayTotal = txns
          .filter(t => t.type === 'withdrawal' && ['pending', 'verified'].includes(t.status) && isToday(t.created_at))
          .reduce((sum, t) => sum + Number(t.amount_usd), 0)
        setWithdrawnToday(todayTotal)
      })
      .catch(err => console.error('Failed to load withdraw data:', err))
      .finally(() => setLoadingBalance(false))
  }, [user])

  useEffect(() => {
    if (!user) return
    setCheckingConnect(true)

    const justReturned = searchParams.get('connect') === 'complete'

    const check = justReturned
      ? fetch('/api/stripe/check-connect-status', { method: 'POST' }).then(r => r.json()).then(d => d.onboarded)
      : getConnectOnboardingStatus(user.id)

    check
      .then(setConnectOnboarded)
      .catch(err => console.error('Failed to check Connect status:', err))
      .finally(() => setCheckingConnect(false))
  }, [user, searchParams])

  const minWithdrawal = settings?.min_withdrawal_usd ?? 50
  const dailyLimit = settings?.daily_withdrawal_limit_usd ?? 50000
  const feePercent = settings?.withdrawal_fee_percent ?? 0.5
  const remainingToday = Math.max(dailyLimit - withdrawnToday, 0)
  const bankTransferEnabled = settings?.bank_transfer_enabled ?? false
  const bankWireEnabled = settings?.bank_wire_enabled ?? false

  const amt = Number(amount) || 0
  const fee = amt * (feePercent / 100)
  const isBtc = currency === 'BTC'

  const bankAmt = Number(bankAmount) || 0
  const bankFee = bankAmt * (feePercent / 100)

  const wireAmt = Number(wireBankAmount) || 0
  const wireFee = wireAmt * (feePercent / 100)

  async function handleConnectBank() {
    setConnectingBank(true)
    setError('')
    try {
      const res = await fetch('/api/stripe/connect-onboarding', { method: 'POST' })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      window.location.href = data.url
    } catch (err) {
      setError(err.message || 'Failed to start bank onboarding.')
      setConnectingBank(false)
    }
  }

  async function handleSubmitCrypto() {
    setError('')
    if (!cryptoAmount || Number(cryptoAmount) <= 0) {
      setError('Enter the amount to withdraw.')
      return
    }
    if (!amt || amt <= 0) {
      setError('Enter the USD equivalent.')
      return
    }
    if (!address || !looksLikeValidAddress(currency, address)) {
      setError(`Enter a valid ${currency} address.`)
      return
    }
    if (amt < minWithdrawal) {
      setError(`Minimum withdrawal is ${formatUsd(minWithdrawal)}.`)
      return
    }
    if (amt > balance) {
      setError(`You can't withdraw more than your available balance (${formatUsd(balance)}).`)
      return
    }
    if (amt > remainingToday) {
      setError(`This would exceed your daily withdrawal limit. You have ${formatUsd(remainingToday)} left today.`)
      return
    }

    setSubmitting(true)
    setShowOverlay(true)
    try {
      await createTransaction({
        userId: user.id,
        type: 'withdrawal',
        amountUsd: amt,
        paymentMethod: 'crypto',
        cryptoCurrency: currency,
        cryptoAmount: Number(cryptoAmount),
        destinationAddress: address.trim(),
        note: note || null,
      })
      setDone(true)
    } catch (err) {
      setError(err.message || 'Something went wrong submitting your withdrawal.')
    } finally {
      setSubmitting(false)
      setShowOverlay(false)
    }
  }

  async function handleSubmitBank() {
    setError('')
    if (!bankAmt || bankAmt <= 0) {
      setError('Enter a valid amount.')
      return
    }
    if (bankAmt < minWithdrawal) {
      setError(`Minimum withdrawal is ${formatUsd(minWithdrawal)}.`)
      return
    }
    if (bankAmt > balance) {
      setError(`You can't withdraw more than your available balance (${formatUsd(balance)}).`)
      return
    }
    if (bankAmt > remainingToday) {
      setError(`This would exceed your daily withdrawal limit. You have ${formatUsd(remainingToday)} left today.`)
      return
    }

    setSubmitting(true)
    setShowOverlay(true)
    try {
      await createTransaction({
        userId: user.id,
        type: 'withdrawal',
        amountUsd: bankAmt,
        paymentMethod: 'bank',
        note: note || null,
      })
      setDone(true)
    } catch (err) {
      setError(err.message || 'Something went wrong submitting your withdrawal.')
    } finally {
      setSubmitting(false)
      setShowOverlay(false)
    }
  }

  async function handleSubmitWire() {
    setError('')
    if (!wireAmt || wireAmt <= 0) {
      setError('Enter a valid amount.')
      return
    }
    if (!wireBankName.trim() || !wireAccountName.trim() || !wireRoutingNumber.trim() || !wireAccountNumber.trim()) {
      setError('Fill in all your bank details so we can send the wire correctly.')
      return
    }
    if (wireAmt < minWithdrawal) {
      setError(`Minimum withdrawal is ${formatUsd(minWithdrawal)}.`)
      return
    }
    if (wireAmt > balance) {
      setError(`You can't withdraw more than your available balance (${formatUsd(balance)}).`)
      return
    }
    if (wireAmt > remainingToday) {
      setError(`This would exceed your daily withdrawal limit. You have ${formatUsd(remainingToday)} left today.`)
      return
    }

    setSubmitting(true)
    setShowOverlay(true)
    try {
      await createTransaction({
        userId: user.id,
        type: 'withdrawal',
        amountUsd: wireAmt,
        paymentMethod: 'wire',
        note: `Wire to: ${wireAccountName.trim()} — ${wireBankName.trim()}, routing ${wireRoutingNumber.trim()}, account ${wireAccountNumber.trim()}${note ? ` | ${note}` : ''}`,
      })
      setDone(true)
    } catch (err) {
      setError(err.message || 'Something went wrong submitting your withdrawal.')
    } finally {
      setSubmitting(false)
      setShowOverlay(false)
    }
  }

  if (done) {
    return (
      <div style={s.page}>
        <h1 style={s.title}>Withdraw funds</h1>
        <div style={{ ...s.card, textAlign: 'center', padding: '48px' }}>
          <div style={{ fontSize: '20px', fontWeight: '700', color: 'var(--text)', marginBottom: '8px' }}>Withdrawal requested</div>
          <div style={{ fontSize: '14px', color: 'var(--text2)', marginBottom: '24px' }}>
            {method === 'bank'
              ? 'Your withdrawal is pending review. Once approved, funds will be sent to your connected bank account.'
              : method === 'wire'
              ? 'Your wire withdrawal is pending review. Once approved, funds will be sent to the bank account you provided.'
              : `Your withdrawal is pending review. Once approved, ${cryptoAmount} ${currency} will be sent to the address you provided.`}
          </div>
          <button
            style={s.btnRed}
            onClick={() => {
              setDone(false)
              setAmount(''); setCryptoAmount(''); setAddress('')
              setBankAmount(''); setNote('')
              setWireBankAmount(''); setWireBankName(''); setWireAccountName(''); setWireRoutingNumber(''); setWireAccountNumber('')
            }}
          >
            Make another withdrawal
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={s.page}>
      <AuthTransitionOverlay show={showOverlay} />
      <h1 style={s.title}>Withdraw funds</h1>
      <p style={s.sub}>Move money out of your wallet</p>

      {error && <div style={s.error}>{error}</div>}

      <div className="responsive-grid-2" style={s.grid2}>
        <div style={s.card}>
          <div style={{ ...s.stat, marginBottom: '20px' }}>
            <div style={s.statLabel}>Available to withdraw</div>
            <div style={{ ...s.statValue, color: 'var(--green)', fontSize: '20px' }}>
              {loadingBalance ? '—' : formatUsd(balance)}
            </div>
          </div>

          <div style={s.methodTabs}>
            <button
              style={{ ...s.methodTab, ...(method === 'crypto' ? s.methodTabActive : {}) }}
              onClick={() => setMethod('crypto')}
            >
              Crypto
            </button>
            {bankTransferEnabled && (
              <button
                style={{ ...s.methodTab, ...(method === 'bank' ? s.methodTabActive : {}) }}
                onClick={() => setMethod('bank')}
              >
                Bank transfer
              </button>
            )}
            {bankWireEnabled && (
              <button
                style={{ ...s.methodTab, ...(method === 'wire' ? s.methodTabActive : {}) }}
                onClick={() => setMethod('wire')}
              >
                Wire transfer
              </button>
            )}
          </div>

          {method === 'crypto' ? (
            <>
              <label style={s.label}>Currency</label>
              <select style={s.select} value={currency} onChange={e => setCurrency(e.target.value)}>
                <option value="ETH">Ethereum (ETH)</option>
                <option value="USDT">USDT (ERC-20)</option>
                <option value="BTC">Bitcoin (BTC)</option>
              </select>

              <label style={s.label}>Amount to withdraw ({currency})</label>
              <input style={s.input} type="number" step="any" placeholder="0.00" value={cryptoAmount} onChange={e => setCryptoAmount(e.target.value)} />

              <label style={s.label}>USD equivalent</label>
              <input style={s.input} type="number" step="any" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)} />

              {amt > 0 && (
                <div style={s.feePreview}>
                  Fee ({feePercent}%): {formatUsd(fee)} · Deducted from balance: <strong>{formatUsd(amt)}</strong>
                </div>
              )}

              <label style={s.label}>Destination {currency} address</label>
              <input
                style={{ ...s.input, ...s.mono }}
                placeholder={isBtc ? 'bc1...' : '0x...'}
                value={address}
                onChange={e => setAddress(e.target.value)}
              />

              <label style={s.label}>Note (optional)</label>
              <input style={s.input} placeholder="What's this for?" value={note} onChange={e => setNote(e.target.value)} />

              <button
                style={{ ...s.btnRed, ...(submitting ? s.btnDisabled : {}) }}
                disabled={submitting}
                onClick={handleSubmitCrypto}
              >
                {submitting ? 'Submitting…' : 'Request withdrawal'}
              </button>
            </>
          ) : method === 'wire' ? (
            <>
              <label style={s.label}>Your bank name</label>
              <input style={s.input} value={wireBankName} onChange={e => setWireBankName(e.target.value)} placeholder="e.g. Chase" />

              <label style={s.label}>Account holder name</label>
              <input style={s.input} value={wireAccountName} onChange={e => setWireAccountName(e.target.value)} />

              <label style={s.label}>Routing number</label>
              <input style={s.input} value={wireRoutingNumber} onChange={e => setWireRoutingNumber(e.target.value)} />

              <label style={s.label}>Account number</label>
              <input style={s.input} value={wireAccountNumber} onChange={e => setWireAccountNumber(e.target.value)} />

              <label style={s.label}>Amount (USD)</label>
              <input style={s.input} type="number" step="any" placeholder="0.00" value={wireBankAmount} onChange={e => setWireBankAmount(e.target.value)} />

              {wireAmt > 0 && (
                <div style={s.feePreview}>
                  Fee ({feePercent}%): {formatUsd(wireFee)} · Deducted from balance: <strong>{formatUsd(wireAmt)}</strong>
                </div>
              )}

              <label style={s.label}>Note (optional)</label>
              <input style={s.input} placeholder="What's this for?" value={note} onChange={e => setNote(e.target.value)} />

              <button
                style={{ ...s.btnRed, ...(submitting ? s.btnDisabled : {}) }}
                disabled={submitting}
                onClick={handleSubmitWire}
              >
                {submitting ? 'Submitting…' : 'Request withdrawal'}
              </button>
            </>
          ) : checkingConnect ? (
            <div style={s.connectBox}>
              <div style={{ color: 'var(--text3)', fontSize: '14px' }}>Checking your payout account…</div>
            </div>
          ) : !connectOnboarded ? (
            <div style={s.connectBox}>
              <div style={{ fontSize: '14px', color: 'var(--text2)', marginBottom: '20px' }}>
                To withdraw to your bank, Stripe needs to verify a payout account first — a quick, secure step.
              </div>
              <button
                style={{ ...s.btnGreen, ...(connectingBank ? s.btnDisabled : {}) }}
                disabled={connectingBank}
                onClick={handleConnectBank}
              >
                {connectingBank ? 'Opening secure setup…' : 'Set up bank payouts'}
              </button>
            </div>
          ) : (
            <>
              <label style={s.label}>Amount (USD)</label>
              <input style={s.input} type="number" step="any" placeholder="0.00" value={bankAmount} onChange={e => setBankAmount(e.target.value)} />

              {bankAmt > 0 && (
                <div style={s.feePreview}>
                  Fee ({feePercent}%): {formatUsd(bankFee)} · Deducted from balance: <strong>{formatUsd(bankAmt)}</strong>
                </div>
              )}

              <label style={s.label}>Note (optional)</label>
              <input style={s.input} placeholder="What's this for?" value={note} onChange={e => setNote(e.target.value)} />

              <button
                style={{ ...s.btnRed, ...(submitting ? s.btnDisabled : {}) }}
                disabled={submitting}
                onClick={handleSubmitBank}
              >
                {submitting ? 'Submitting…' : 'Request withdrawal'}
              </button>
            </>
          )}
        </div>

        <div style={{ ...s.card, background: 'var(--bg3)' }}>
          <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text)', marginBottom: '16px' }}>Withdrawal info</div>
          {[
            ['Minimum', formatUsd(minWithdrawal)],
            ['Daily limit', formatUsd(dailyLimit)],
            ['Remaining today', formatUsd(remainingToday)],
            ['Fee', `${feePercent}%`],
            ['Processing', 'Reviewed, then sent for real'],
          ].map(([k, v]) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px', fontSize: '13px' }}>
              <span style={{ color: 'var(--text2)' }}>{k}</span>
              <span style={{ color: 'var(--text)', fontWeight: '500' }}>{v}</span>
            </div>
          ))}
          {method === 'crypto' && (
            <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--border)', fontSize: '12px', color: 'var(--text3)' }}>
              Double-check your address before submitting — crypto sent to the wrong address can't be recovered.
            </div>
          )}
          {method === 'wire' && (
            <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--border)', fontSize: '12px', color: 'var(--text3)' }}>
              Double-check your bank details before submitting — we'll wire funds exactly where you tell us to.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}