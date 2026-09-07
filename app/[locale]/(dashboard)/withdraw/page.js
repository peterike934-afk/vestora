"use client";

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { useUser } from '@/contexts/UserContext'
import { useSearchParams } from 'next/navigation'
import { useMoneyFormatter } from '@/lib/formatting'
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
  connectBox: { textAlign: 'center', padding: '32px 20px' },
}

function isToday(dateStr) {
  const d = new Date(dateStr)
  const now = new Date()
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
}

function looksLikeValidAddress(currency, address) {
  if (!address) return false
  if (currency === 'BTC') {
    return /^(1|3|m|n|2|bc1|tb1)[a-zA-Z0-9]{25,60}$/.test(address.trim())
  }
  return /^0x[a-fA-F0-9]{40}$/.test(address.trim())
}

export default function WithdrawPage() {
  const t = useTranslations('Withdraw')
  const formatMoney = useMoneyFormatter()
  const { user } = useUser()
  const searchParams = useSearchParams()
  const [balance, setBalance] = useState(0)
  const [settings, setSettings] = useState(null)
  const [withdrawnToday, setWithdrawnToday] = useState(0)
  const [loadingBalance, setLoadingBalance] = useState(true)
  const [method, setMethod] = useState('crypto')

  const [currency, setCurrency] = useState('ETH')
  const [cryptoAmount, setCryptoAmount] = useState('')
  const [amount, setAmount] = useState('')
  const [address, setAddress] = useState('')

  const [connectOnboarded, setConnectOnboarded] = useState(false)
  const [checkingConnect, setCheckingConnect] = useState(true)
  const [connectingBank, setConnectingBank] = useState(false)
  const [bankAmount, setBankAmount] = useState('')

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
      setError(err.message || t('errors.connectFailed'))
      setConnectingBank(false)
    }
  }

  async function handleSubmitCrypto() {
    setError('')
    if (!cryptoAmount || Number(cryptoAmount) <= 0) {
      setError(t('errors.enterAmount'))
      return
    }
    if (!amt || amt <= 0) {
      setError(t('errors.enterUsdEquivalent'))
      return
    }
    if (!address || !looksLikeValidAddress(currency, address)) {
      setError(t('errors.invalidAddress', { currency }))
      return
    }
    if (amt < minWithdrawal) {
      setError(t('errors.minWithdrawal', { amount: formatMoney(minWithdrawal) }))
      return
    }
    if (amt > balance) {
      setError(t('errors.exceedsBalance', { amount: formatMoney(balance) }))
      return
    }
    if (amt > remainingToday) {
      setError(t('errors.exceedsDailyLimit', { amount: formatMoney(remainingToday) }))
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
      setError(err.message || t('errors.genericSubmit'))
    } finally {
      setSubmitting(false)
      setShowOverlay(false)
    }
  }

  async function handleSubmitBank() {
    setError('')
    if (!bankAmt || bankAmt <= 0) {
      setError(t('errors.validAmount'))
      return
    }
    if (bankAmt < minWithdrawal) {
      setError(t('errors.minWithdrawal', { amount: formatMoney(minWithdrawal) }))
      return
    }
    if (bankAmt > balance) {
      setError(t('errors.exceedsBalance', { amount: formatMoney(balance) }))
      return
    }
    if (bankAmt > remainingToday) {
      setError(t('errors.exceedsDailyLimit', { amount: formatMoney(remainingToday) }))
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
      setError(err.message || t('errors.genericSubmit'))
    } finally {
      setSubmitting(false)
      setShowOverlay(false)
    }
  }

  async function handleSubmitWire() {
    setError('')
    if (!wireAmt || wireAmt <= 0) {
      setError(t('errors.validAmount'))
      return
    }
    if (!wireBankName.trim() || !wireAccountName.trim() || !wireRoutingNumber.trim() || !wireAccountNumber.trim()) {
      setError(t('errors.fillBankDetails'))
      return
    }
    if (wireAmt < minWithdrawal) {
      setError(t('errors.minWithdrawal', { amount: formatMoney(minWithdrawal) }))
      return
    }
    if (wireAmt > balance) {
      setError(t('errors.exceedsBalance', { amount: formatMoney(balance) }))
      return
    }
    if (wireAmt > remainingToday) {
      setError(t('errors.exceedsDailyLimit', { amount: formatMoney(remainingToday) }))
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
      setError(err.message || t('errors.genericSubmit'))
    } finally {
      setSubmitting(false)
      setShowOverlay(false)
    }
  }

  if (done) {
    return (
      <div style={s.page}>
        <h1 style={s.title}>{t('title')}</h1>
        <div style={{ ...s.card, textAlign: 'center', padding: '48px' }}>
          <div style={{ fontSize: '20px', fontWeight: '700', color: 'var(--text)', marginBottom: '8px' }}>{t('requested.title')}</div>
          <div style={{ fontSize: '14px', color: 'var(--text2)', marginBottom: '24px' }}>
            {method === 'bank'
              ? t('requested.bank')
              : method === 'wire'
              ? t('requested.wire')
              : t('requested.crypto', { amount: cryptoAmount, currency })}
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
            {t('requested.makeAnother')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={s.page}>
      <AuthTransitionOverlay show={showOverlay} />
      <h1 style={s.title}>{t('title')}</h1>
      <p style={s.sub}>{t('subtitle')}</p>

      {error && <div style={s.error}>{error}</div>}

      <div className="responsive-grid-2" style={s.grid2}>
        <div style={s.card}>
          <div style={{ ...s.stat, marginBottom: '20px' }}>
            <div style={s.statLabel}>{t('availableToWithdraw')}</div>
            <div style={{ ...s.statValue, color: 'var(--green)', fontSize: '20px' }}>
              {loadingBalance ? '—' : formatMoney(balance)}
            </div>
          </div>

          <div style={s.methodTabs}>
            <button
              style={{ ...s.methodTab, ...(method === 'crypto' ? s.methodTabActive : {}) }}
              onClick={() => setMethod('crypto')}
            >
              {t('methods.crypto')}
            </button>
            {bankTransferEnabled && (
              <button
                style={{ ...s.methodTab, ...(method === 'bank' ? s.methodTabActive : {}) }}
                onClick={() => setMethod('bank')}
              >
                {t('methods.bank')}
              </button>
            )}
            {bankWireEnabled && (
              <button
                style={{ ...s.methodTab, ...(method === 'wire' ? s.methodTabActive : {}) }}
                onClick={() => setMethod('wire')}
              >
                {t('methods.wire')}
              </button>
            )}
          </div>

          {method === 'crypto' ? (
            <>
              <label style={s.label}>{t('crypto.currency')}</label>
              <select style={s.select} value={currency} onChange={e => setCurrency(e.target.value)}>
                <option value="ETH">Ethereum (ETH)</option>
                <option value="USDT">USDT (ERC-20)</option>
                <option value="BTC">Bitcoin (BTC)</option>
              </select>

              <label style={s.label}>{t('crypto.amountToWithdraw', { currency })}</label>
              <input style={s.input} type="number" step="any" placeholder="0.00" value={cryptoAmount} onChange={e => setCryptoAmount(e.target.value)} />

              <label style={s.label}>{t('crypto.usdEquivalent')}</label>
              <input style={s.input} type="number" step="any" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)} />

              {amt > 0 && (
                <div style={s.feePreview}>
                  {t('feePreview', { feePercent, fee: formatMoney(fee), amount: formatMoney(amt) })}
                </div>
              )}

              <label style={s.label}>{t('crypto.destinationAddress', { currency })}</label>
              <input
                style={{ ...s.input, ...s.mono }}
                placeholder={isBtc ? 'bc1...' : '0x...'}
                value={address}
                onChange={e => setAddress(e.target.value)}
              />

              <label style={s.label}>{t('noteOptional')}</label>
              <input style={s.input} placeholder={t('notePlaceholder')} value={note} onChange={e => setNote(e.target.value)} />

              <button
                style={{ ...s.btnRed, ...(submitting ? s.btnDisabled : {}) }}
                disabled={submitting}
                onClick={handleSubmitCrypto}
              >
                {submitting ? t('submitting') : t('requestWithdrawal')}
              </button>
            </>
          ) : method === 'wire' ? (
            <>
              <label style={s.label}>{t('wire.bankName')}</label>
              <input style={s.input} value={wireBankName} onChange={e => setWireBankName(e.target.value)} placeholder={t('wire.bankNamePlaceholder')} />

              <label style={s.label}>{t('wire.accountHolder')}</label>
              <input style={s.input} value={wireAccountName} onChange={e => setWireAccountName(e.target.value)} />

              <label style={s.label}>{t('wire.routingNumber')}</label>
              <input style={s.input} value={wireRoutingNumber} onChange={e => setWireRoutingNumber(e.target.value)} />

              <label style={s.label}>{t('wire.accountNumber')}</label>
              <input style={s.input} value={wireAccountNumber} onChange={e => setWireAccountNumber(e.target.value)} />

              <label style={s.label}>{t('amountUsd')}</label>
              <input style={s.input} type="number" step="any" placeholder="0.00" value={wireBankAmount} onChange={e => setWireBankAmount(e.target.value)} />

              {wireAmt > 0 && (
                <div style={s.feePreview}>
                  {t('feePreview', { feePercent, fee: formatMoney(wireFee), amount: formatMoney(wireAmt) })}
                </div>
              )}

              <label style={s.label}>{t('noteOptional')}</label>
              <input style={s.input} placeholder={t('notePlaceholder')} value={note} onChange={e => setNote(e.target.value)} />

              <button
                style={{ ...s.btnRed, ...(submitting ? s.btnDisabled : {}) }}
                disabled={submitting}
                onClick={handleSubmitWire}
              >
                {submitting ? t('submitting') : t('requestWithdrawal')}
              </button>
            </>
          ) : checkingConnect ? (
            <div style={s.connectBox}>
              <div style={{ color: 'var(--text3)', fontSize: '14px' }}>{t('bank.checkingAccount')}</div>
            </div>
          ) : !connectOnboarded ? (
            <div style={s.connectBox}>
              <div style={{ fontSize: '14px', color: 'var(--text2)', marginBottom: '20px' }}>{t('bank.needsVerification')}</div>
              <button
                style={{ ...s.btnGreen, ...(connectingBank ? s.btnDisabled : {}) }}
                disabled={connectingBank}
                onClick={handleConnectBank}
              >
                {connectingBank ? t('bank.openingSetup') : t('bank.setUpPayouts')}
              </button>
            </div>
          ) : (
            <>
              <label style={s.label}>{t('amountUsd')}</label>
              <input style={s.input} type="number" step="any" placeholder="0.00" value={bankAmount} onChange={e => setBankAmount(e.target.value)} />

              {bankAmt > 0 && (
                <div style={s.feePreview}>
                  {t('feePreview', { feePercent, fee: formatMoney(bankFee), amount: formatMoney(bankAmt) })}
                </div>
              )}

              <label style={s.label}>{t('noteOptional')}</label>
              <input style={s.input} placeholder={t('notePlaceholder')} value={note} onChange={e => setNote(e.target.value)} />

              <button
                style={{ ...s.btnRed, ...(submitting ? s.btnDisabled : {}) }}
                disabled={submitting}
                onClick={handleSubmitBank}
              >
                {submitting ? t('submitting') : t('requestWithdrawal')}
              </button>
            </>
          )}
        </div>

        <div style={{ ...s.card, background: 'var(--bg3)' }}>
          <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text)', marginBottom: '16px' }}>{t('info.title')}</div>
          {[
            [t('info.minimum'), formatMoney(minWithdrawal)],
            [t('info.dailyLimit'), formatMoney(dailyLimit)],
            [t('info.remainingToday'), formatMoney(remainingToday)],
            [t('info.fee'), `${feePercent}%`],
            [t('info.processing'), t('info.processingValue')],
          ].map(([k, v]) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px', fontSize: '13px' }}>
              <span style={{ color: 'var(--text2)' }}>{k}</span>
              <span style={{ color: 'var(--text)', fontWeight: '500' }}>{v}</span>
            </div>
          ))}
          {method === 'crypto' && (
            <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--border)', fontSize: '12px', color: 'var(--text3)' }}>
              {t('info.cryptoWarning')}
            </div>
          )}
          {method === 'wire' && (
            <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--border)', fontSize: '12px', color: 'var(--text3)' }}>
              {t('info.wireWarning')}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}