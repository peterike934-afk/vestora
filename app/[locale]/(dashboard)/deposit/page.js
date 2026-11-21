"use client"

import { useState, useEffect } from 'react'
import { ArrowRight, Check, Coins, Globe2, Landmark, ShieldCheck } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useUser } from '@/contexts/UserContext'
import { useUsdFormatter } from '@/lib/formatting'
import { createTransaction, getSettings, getLinkedBankAccounts, disconnectBankAccount } from '@/lib/queries'
import ConnectBankButton from '@/components/ConnectBankButton'
import AuthTransitionOverlay from '@/components/AuthTransitionOverlay'

const s = {
  page: { padding: '0 0 32px' },
  title: { color: 'var(--text)', fontSize: '32px', fontWeight: '650', letterSpacing: '-0.035em', margin: 0 },
  sub: { color: 'var(--text2)', fontSize: '14px', lineHeight: 1.6, margin: '8px 0 0' },
  card: { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: '22px', padding: '26px', boxShadow: '0 12px 30px rgba(24,49,34,0.045)' },
  methodTabs: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '12px', marginBottom: '18px' },
  methodTab: { minWidth: 0, display: 'flex', alignItems: 'center', gap: '12px', padding: '16px', textAlign: 'left', borderRadius: '16px', fontSize: '14px', fontWeight: '650', cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)', boxShadow: '0 3px 12px rgba(24,49,34,0.025)', transition: 'border-color 160ms ease, background 160ms ease, box-shadow 160ms ease' },
  methodTabActive: { background: 'linear-gradient(145deg, rgba(31,111,74,0.10), rgba(31,111,74,0.035))', border: '1px solid var(--green)', color: 'var(--text)', boxShadow: '0 0 0 2px var(--green-dim)' },
  label: { display: 'block', fontSize: '13px', color: 'var(--text2)', marginBottom: '7px', fontWeight: '600' },
  input: { width: '100%', padding: '13px 15px', background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: '12px', color: 'var(--text)', fontSize: '14px', outline: 'none', marginBottom: '17px', transition: 'border-color 160ms ease, box-shadow 160ms ease' },
  select: { width: '100%', padding: '13px 15px', background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: '12px', color: 'var(--text)', fontSize: '14px', outline: 'none', marginBottom: '17px' },
  btnGreen: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '9px', padding: '14px 20px', background: 'linear-gradient(110deg, #155638, #20784D)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '13px', color: '#FFFFFF', fontSize: '14px', fontWeight: '650', cursor: 'pointer', width: '100%', boxShadow: '0 8px 18px rgba(21,86,56,0.17)', transition: 'transform 160ms ease, box-shadow 160ms ease' },
  btnDisabled: { opacity: 0.55, cursor: 'not-allowed' },
  error: { fontSize: '13px', color: 'var(--red)', background: 'var(--red-dim)', padding: '12px 15px', borderRadius: '12px', marginBottom: '16px', border: '1px solid rgba(201,65,77,0.18)' },
  mono: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', wordBreak: 'break-all', overflowWrap: 'anywhere' },
  grid2: { display: 'grid', gridTemplateColumns: 'minmax(0, 1.08fr) minmax(260px, 0.92fr)', gap: '18px', alignItems: 'start' },
  bankOption: { display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 14px', border: '1px solid var(--border)', borderRadius: '12px', marginBottom: '10px', cursor: 'pointer', background: 'var(--bg2)', transition: 'background 150ms ease, border-color 150ms ease' },
  bankOptionActive: { borderColor: 'var(--green)', background: 'var(--green-dim)' },
  disconnectBtn: { marginLeft: 'auto', flexShrink: 0, fontSize: '12px', color: 'var(--red)', background: 'transparent', border: '1px solid var(--red)', borderRadius: '8px', padding: '6px 10px', cursor: 'pointer' },
  wireRow: { display: 'flex', justifyContent: 'space-between', gap: '16px', padding: '12px 0', borderBottom: '1px solid var(--border)', fontSize: '13px' },
  wireRowLast: { borderBottom: 'none' },
  wireLabel: { color: 'var(--text2)' },
  wireValue: { color: 'var(--text)', fontWeight: '600', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', textAlign: 'right', overflowWrap: 'anywhere', userSelect: 'all' },
}

export default function DepositPage() {
  const t = useTranslations('Deposit')
  const formatUsd = useUsdFormatter()
  const { user } = useUser()
  const [settings, setSettings] = useState(null)
  const [method, setMethod] = useState('crypto')

  const [currency, setCurrency] = useState('BTC')
  const [cryptoAmount, setCryptoAmount] = useState('')
  const [amountUsd, setAmountUsd] = useState('')
  const [txHash, setTxHash] = useState('')

  const [linkedAccounts, setLinkedAccounts] = useState([])
  const [selectedAccountId, setSelectedAccountId] = useState(null)
  const [bankAmount, setBankAmount] = useState('')
  const [loadingBank, setLoadingBank] = useState(true)
  const [disconnectingId, setDisconnectingId] = useState(null)

  const [wireAmount, setWireAmount] = useState('')
  const [wireReference, setWireReference] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [showOverlay, setShowOverlay] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => {
    getSettings().then(setSettings).catch(err => console.error('Failed to load settings:', err))
  }, [])

  useEffect(() => {
    if (!user) return
    getLinkedBankAccounts(user.id)
      .then(accounts => {
        setLinkedAccounts(accounts)
        if (accounts.length > 0) setSelectedAccountId(accounts[0].id)
      })
      .catch(err => console.error('Failed to load linked bank accounts:', err))
      .finally(() => setLoadingBank(false))
  }, [user])

  const minDeposit = settings?.min_deposit_usd ?? 100
  const bankTransferEnabled = settings?.bank_transfer_enabled ?? false
  const bankWireEnabled = settings?.bank_wire_enabled ?? false

  const depositAddresses = {
    BTC: settings?.btc_deposit_address || t('notConfigured'),
    ETH: settings?.eth_deposit_address || t('notConfigured'),
    USDT: settings?.usdt_deposit_address || t('notConfigured'),
  }

  const wireDetails = {
    bankName: settings?.bank_name || t('notConfigured'),
    accountName: settings?.bank_account_name || t('notConfigured'),
    routingNumber: settings?.bank_routing_number || t('notConfigured'),
    accountNumber: settings?.bank_account_number || t('notConfigured'),
  }
  const methods = [
    { id: 'crypto', label: t('methods.crypto'), description: t('crypto.steps.1'), icon: Coins },
    ...(bankTransferEnabled
      ? [{ id: 'bank', label: t('methods.bank'), description: t('bank.steps.1'), icon: Landmark }]
      : []),
    ...(bankWireEnabled
      ? [{ id: 'wire', label: t('methods.wire'), description: t('wire.steps.1'), icon: Globe2 }]
      : []),
  ]

  function handleBankLinked(newAccount) {
    setLinkedAccounts(prev => [newAccount, ...prev])
    setSelectedAccountId(newAccount.id)
  }

  async function handleDisconnect(accountId, e) {
    e.stopPropagation()
    if (!window.confirm(t('confirmDisconnect'))) return

    setDisconnectingId(accountId)
    setError('')
    try {
      await disconnectBankAccount(accountId)
      setLinkedAccounts(prev => {
        const remaining = prev.filter(a => a.id !== accountId)
        if (selectedAccountId === accountId) {
          setSelectedAccountId(remaining.length > 0 ? remaining[0].id : null)
        }
        return remaining
      })
    } catch (err) {
      setError(err.message || t('errors.disconnectFailed'))
    } finally {
      setDisconnectingId(null)
    }
  }

  async function handleSubmitCrypto() {
    setError('')
    if (!cryptoAmount || !amountUsd || !txHash) {
      setError(t('errors.fillAmountAndHash'))
      return
    }
    if (Number(amountUsd) < minDeposit) {
      setError(t('errors.minDeposit', { amount: formatUsd(minDeposit) }))
      return
    }
    setSubmitting(true)
    setShowOverlay(true)
    try {
      await createTransaction({
        userId: user.id,
        type: 'deposit',
        amountUsd: Number(amountUsd),
        paymentMethod: 'crypto',
        cryptoCurrency: currency,
        cryptoAmount: Number(cryptoAmount),
        txHash: txHash.trim(),
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
    if (!selectedAccountId) {
      setError(t('errors.selectBank'))
      return
    }
    const amt = Number(bankAmount)
    if (!amt || amt <= 0) {
      setError(t('errors.validAmount'))
      return
    }
    if (amt < minDeposit) {
      setError(t('errors.minDeposit', { amount: formatUsd(minDeposit) }))
      return
    }
    setSubmitting(true)
    setShowOverlay(true)
    try {
      await createTransaction({
        userId: user.id,
        type: 'deposit',
        amountUsd: amt,
        paymentMethod: 'bank',
        linkedBankAccountId: selectedAccountId,
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
    const amt = Number(wireAmount)
    if (!amt || amt <= 0) {
      setError(t('errors.validAmount'))
      return
    }
    if (amt < minDeposit) {
      setError(t('errors.minDeposit', { amount: formatUsd(minDeposit) }))
      return
    }
    if (!wireReference.trim()) {
      setError(t('errors.wireReference'))
      return
    }
    setSubmitting(true)
    setShowOverlay(true)
    try {
      await createTransaction({
        userId: user.id,
        type: 'deposit',
        amountUsd: amt,
        paymentMethod: 'wire',
        note: `Sent from: ${wireReference.trim()}`,
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
      <div className="dashboard-money-page dashboard-money-page--deposit" style={s.page}>
        <h1 style={s.title}>{t('title')}</h1>
        <div className="dashboard-deposit-success" style={{ ...s.card, textAlign: 'center', padding: '48px' }} role="status" aria-live="polite">
          <div className="dashboard-deposit-success__icon"><Check size={24} aria-hidden="true" /></div>
          <div className="dashboard-deposit-success__title">{t('submitted.title')}</div>
          <div className="dashboard-deposit-success__description">
            {method === 'bank'
              ? t('submitted.bank')
              : method === 'wire'
              ? t('submitted.wire')
              : t('submitted.crypto')}
          </div>
          <button
            style={s.btnGreen}
            type="button"
            onClick={() => {
              setDone(false)
              setCryptoAmount(''); setAmountUsd(''); setTxHash('')
              setBankAmount('')
              setWireAmount(''); setWireReference('')
            }}
          >
            {t('submitted.makeAnother')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="dashboard-money-page dashboard-money-page--deposit" style={s.page}>
      <AuthTransitionOverlay show={showOverlay} />
      <div className="dashboard-money-page__header">
        <div>
          <h1 style={s.title}>{t('title')}</h1>
          <p style={s.sub}>{t('subtitle')}</p>
        </div>
        <div className="dashboard-money-page__currency">USD</div>
      </div>

      {error && <div style={s.error} role="alert">{error}</div>}

      <div style={s.card}>
        <div className="dashboard-deposit-methods" style={s.methodTabs} role="group" aria-label={t('title')}>
          {methods.map(({ id, label, description, icon: Icon }) => (
            <button
              key={id}
              type="button"
              className="dashboard-deposit-method"
              style={{ ...s.methodTab, ...(method === id ? s.methodTabActive : {}) }}
              aria-pressed={method === id}
              onClick={() => setMethod(id)}
            >
              <span className="dashboard-deposit-method__icon"><Icon size={20} aria-hidden="true" /></span>
              <span className="dashboard-deposit-method__copy">
                <span className="dashboard-deposit-method__title">{label}</span>
                <span className="dashboard-deposit-method__description">{description}</span>
              </span>
              <span className="dashboard-deposit-method__selected" aria-hidden="true">
                {method === id && <Check size={15} />}
              </span>
            </button>
          ))}
        </div>

        {method === 'crypto' && (
          <div className="responsive-grid-2" style={s.grid2}>
            <div>
              <label style={s.label} htmlFor="deposit-currency">{t('crypto.currency')}</label>
              <select id="deposit-currency" style={s.select} value={currency} onChange={e => setCurrency(e.target.value)}>
                <option value="BTC">Bitcoin (BTC)</option>
                <option value="ETH">Ethereum (ETH)</option>
                <option value="USDT">USDT (ERC-20)</option>
              </select>

              <label style={s.label} htmlFor="deposit-address">{t('crypto.sendTo')}</label>
              <input
                id="deposit-address"
                style={{ ...s.input, ...s.mono, cursor: 'text', userSelect: 'all' }}
                aria-label={`${t('crypto.sendTo')}: ${depositAddresses[currency]}`}
                readOnly
                value={depositAddresses[currency]}
              />

              <label style={s.label} htmlFor="deposit-crypto-amount">{t('crypto.amountSent', { currency })}</label>
              <input id="deposit-crypto-amount" style={s.input} type="number" step="any" placeholder="0.00" value={cryptoAmount} onChange={e => setCryptoAmount(e.target.value)} />

              <label style={s.label} htmlFor="deposit-usd-amount">{t('crypto.estimatedUsd')}</label>
              <input id="deposit-usd-amount" style={s.input} type="number" step="any" placeholder="0.00" value={amountUsd} onChange={e => setAmountUsd(e.target.value)} />

              <label style={s.label} htmlFor="deposit-transaction-hash">{t('crypto.txHash')}</label>
              <input id="deposit-transaction-hash" style={s.input} placeholder="0x..." value={txHash} onChange={e => setTxHash(e.target.value)} />

              <button
                style={{ ...s.btnGreen, ...(submitting ? s.btnDisabled : {}) }}
                disabled={submitting}
                onClick={handleSubmitCrypto}
              >
                {submitting ? t('submitting') : t('submitDeposit')} <ArrowRight size={17} aria-hidden="true" />
              </button>
            </div>

            <div className="dashboard-deposit-guidance" style={{ ...s.card, background: 'var(--bg3)', margin: 0 }}>
              <div className="dashboard-deposit-guidance__heading">
                <ShieldCheck size={19} aria-hidden="true" />
                <span>{t('howItWorks')}</span>
              </div>
              {[1, 2, 3, 4].map((step) => (
                <div className="dashboard-deposit-guidance__step" key={step}>
                  <span className="dashboard-deposit-guidance__number">{step}</span>
                  <span style={{ color: 'var(--text2)' }}>{t(`crypto.steps.${step}`)}</span>
                </div>
              ))}
              <div className="dashboard-deposit-guidance__minimum">
                <span style={{ color: 'var(--text2)' }}>{t('minimumDeposit')}</span>
                <span style={{ color: 'var(--text)', fontWeight: '600' }}>{formatUsd(minDeposit)}</span>
              </div>
            </div>
          </div>
        )}

        {method === 'bank' && (
          <div className="responsive-grid-2" style={s.grid2}>
            <div>
              {loadingBank ? (
                <div style={{ color: 'var(--text3)', fontSize: '14px', marginBottom: '16px' }}>{t('bank.loadingAccounts')}</div>
              ) : linkedAccounts.length === 0 ? (
                <ConnectBankButton linkedAccount={null} onLinked={handleBankLinked} />
              ) : (
                <>
                  <label style={s.label}>{t('bank.depositFrom')}</label>
                  {linkedAccounts.map(acct => (
                    <div
                      key={acct.id}
                      style={{ ...s.bankOption, ...(selectedAccountId === acct.id ? s.bankOptionActive : {}) }}
                      onClick={() => setSelectedAccountId(acct.id)}
                    >
                      <label className="dashboard-deposit-bank-option__label">
                        <input type="radio" name="deposit-bank-account" checked={selectedAccountId === acct.id} onChange={() => setSelectedAccountId(acct.id)} />
                        <span>{acct.bank_name} •••• {acct.last4}</span>
                      </label>
                      <button
                        type="button"
                        style={s.disconnectBtn}
                        disabled={disconnectingId === acct.id}
                        onClick={(e) => handleDisconnect(acct.id, e)}
                      >
                        {disconnectingId === acct.id ? t('bank.removing') : t('bank.disconnect')}
                      </button>
                    </div>
                  ))}
                  <div style={{ marginBottom: '16px' }}>
                    <ConnectBankButton linkedAccount={null} onLinked={handleBankLinked} />
                  </div>
                </>
              )}

              <label style={s.label} htmlFor="deposit-bank-amount">{t('bank.amountUsd')}</label>
              <input id="deposit-bank-amount" style={s.input} type="number" step="any" placeholder="0.00" value={bankAmount} onChange={e => setBankAmount(e.target.value)} />

              <button
                style={{ ...s.btnGreen, ...(submitting || !selectedAccountId ? s.btnDisabled : {}) }}
                disabled={submitting || !selectedAccountId}
                onClick={handleSubmitBank}
              >
                {submitting ? t('submitting') : t('submitDeposit')} <ArrowRight size={17} aria-hidden="true" />
              </button>
            </div>

            <div className="dashboard-deposit-guidance" style={{ ...s.card, background: 'var(--bg3)', margin: 0 }}>
              <div className="dashboard-deposit-guidance__heading">
                <ShieldCheck size={19} aria-hidden="true" />
                <span>{t('howItWorks')}</span>
              </div>
              {[1, 2, 3, 4].map((step) => (
                <div className="dashboard-deposit-guidance__step" key={step}>
                  <span className="dashboard-deposit-guidance__number">{step}</span>
                  <span style={{ color: 'var(--text2)' }}>{t(`bank.steps.${step}`)}</span>
                </div>
              ))}
              <div className="dashboard-deposit-guidance__minimum">
                <span style={{ color: 'var(--text2)' }}>{t('minimumDeposit')}</span>
                <span style={{ color: 'var(--text)', fontWeight: '600' }}>{formatUsd(minDeposit)}</span>
              </div>
            </div>
          </div>
        )}

        {method === 'wire' && (
          <div className="responsive-grid-2" style={s.grid2}>
            <div>
              <label style={s.label}>{t('wire.wireTo')}</label>
              <div style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '4px 16px', marginBottom: '16px' }}>
                <div style={s.wireRow}>
                  <span style={s.wireLabel}>{t('wire.bankName')}</span>
                  <span style={s.wireValue}>{wireDetails.bankName}</span>
                </div>
                <div style={s.wireRow}>
                  <span style={s.wireLabel}>{t('wire.accountName')}</span>
                  <span style={s.wireValue}>{wireDetails.accountName}</span>
                </div>
                <div style={s.wireRow}>
                  <span style={s.wireLabel}>{t('wire.routingNumber')}</span>
                  <span style={s.wireValue}>{wireDetails.routingNumber}</span>
                </div>
                <div style={{ ...s.wireRow, ...s.wireRowLast }}>
                  <span style={s.wireLabel}>{t('wire.accountNumber')}</span>
                  <span style={s.wireValue}>{wireDetails.accountNumber}</span>
                </div>
              </div>

              <label style={s.label} htmlFor="deposit-wire-amount">{t('wire.amountSent')}</label>
              <input id="deposit-wire-amount" style={s.input} type="number" step="any" placeholder="0.00" value={wireAmount} onChange={e => setWireAmount(e.target.value)} />

              <label style={s.label} htmlFor="deposit-wire-reference">{t('wire.sentFrom')}</label>
              <input id="deposit-wire-reference" style={s.input} placeholder={t('wire.sentFromPlaceholder')} value={wireReference} onChange={e => setWireReference(e.target.value)} />

              <button
                style={{ ...s.btnGreen, ...(submitting ? s.btnDisabled : {}) }}
                disabled={submitting}
                onClick={handleSubmitWire}
              >
                {submitting ? t('submitting') : t('submitDeposit')} <ArrowRight size={17} aria-hidden="true" />
              </button>
            </div>

            <div className="dashboard-deposit-guidance" style={{ ...s.card, background: 'var(--bg3)', margin: 0 }}>
              <div className="dashboard-deposit-guidance__heading">
                <ShieldCheck size={19} aria-hidden="true" />
                <span>{t('howItWorks')}</span>
              </div>
              {[1, 2, 3, 4].map((step) => (
                <div className="dashboard-deposit-guidance__step" key={step}>
                  <span className="dashboard-deposit-guidance__number">{step}</span>
                  <span style={{ color: 'var(--text2)' }}>{t(`wire.steps.${step}`)}</span>
                </div>
              ))}
              <div className="dashboard-deposit-guidance__minimum">
                <span style={{ color: 'var(--text2)' }}>{t('minimumDeposit')}</span>
                <span style={{ color: 'var(--text)', fontWeight: '600' }}>{formatUsd(minDeposit)}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}