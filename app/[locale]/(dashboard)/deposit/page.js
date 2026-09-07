"use client"

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { useUser } from '@/contexts/UserContext'
import { useMoneyFormatter } from '@/lib/formatting'
import { createTransaction, getSettings, getLinkedBankAccounts, disconnectBankAccount } from '@/lib/queries'
import ConnectBankButton from '@/components/ConnectBankButton'
import AuthTransitionOverlay from '@/components/AuthTransitionOverlay'

const s = {
  page: { padding: '32px 36px' },
  title: { fontSize: '26px', fontWeight: '700', color: 'var(--text)', marginBottom: '4px' },
  sub: { fontSize: '14px', color: 'var(--text2)', marginBottom: '28px' },
  card: { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '24px', marginBottom: '20px' },
  methodTabs: { display: 'flex', gap: '8px', marginBottom: '24px' },
  methodTab: { flex: 1, padding: '12px', textAlign: 'center', borderRadius: 'var(--radius-sm)', fontSize: '14px', fontWeight: '600', cursor: 'pointer', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text2)' },
  methodTabActive: { background: 'var(--green-dim)', border: '1px solid var(--green)', color: 'var(--green)' },
  label: { display: 'block', fontSize: '13px', color: 'var(--text2)', marginBottom: '6px', fontWeight: '500' },
  input: { width: '100%', padding: '12px 16px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontSize: '14px', outline: 'none', marginBottom: '16px' },
  select: { width: '100%', padding: '12px 16px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontSize: '14px', outline: 'none', marginBottom: '16px' },
  btnGreen: { padding: '13px 28px', background: 'var(--green)', border: 'none', borderRadius: 'var(--radius-sm)', color: '#000', fontSize: '14px', fontWeight: '600', cursor: 'pointer', width: '100%' },
  btnDisabled: { opacity: 0.5, cursor: 'not-allowed' },
  error: { fontSize: '13px', color: 'var(--red)', background: 'var(--red-dim)', padding: '10px 14px', borderRadius: 'var(--radius-sm)', marginBottom: '16px' },
  mono: { fontFamily: 'monospace', wordBreak: 'break-all', overflowWrap: 'anywhere' },
  grid2: { display: 'grid', gap: '20px' },
  bankOption: { display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 14px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', marginBottom: '10px', cursor: 'pointer' },
  bankOptionActive: { borderColor: 'var(--green)', background: 'var(--green-dim)' },
  disconnectBtn: { marginLeft: 'auto', fontSize: '12px', color: 'var(--red)', background: 'transparent', border: '1px solid var(--red)', borderRadius: '6px', padding: '4px 10px', cursor: 'pointer' },
  wireRow: { display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border)', fontSize: '13.5px' },
  wireRowLast: { borderBottom: 'none' },
  wireLabel: { color: 'var(--text2)' },
  wireValue: { color: 'var(--text)', fontWeight: '600', fontFamily: 'monospace', userSelect: 'all' },
}

export default function DepositPage() {
  const t = useTranslations('Deposit')
  const formatMoney = useMoneyFormatter()
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
      setError(t('errors.minDeposit', { amount: formatMoney(minDeposit) }))
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
      setError(t('errors.minDeposit', { amount: formatMoney(minDeposit) }))
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
      setError(t('errors.minDeposit', { amount: formatMoney(minDeposit) }))
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
      <div style={s.page}>
        <h1 style={s.title}>{t('title')}</h1>
        <div style={{ ...s.card, textAlign: 'center', padding: '48px' }}>
          <div style={{ fontSize: '20px', fontWeight: '700', color: 'var(--text)', marginBottom: '8px' }}>{t('submitted.title')}</div>
          <div style={{ fontSize: '14px', color: 'var(--text2)', marginBottom: '24px' }}>
            {method === 'bank'
              ? t('submitted.bank')
              : method === 'wire'
              ? t('submitted.wire')
              : t('submitted.crypto')}
          </div>
          <button
            style={s.btnGreen}
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
    <div style={s.page}>
      <AuthTransitionOverlay show={showOverlay} />
      <h1 style={s.title}>{t('title')}</h1>
      <p style={s.sub}>{t('subtitle')}</p>

      {error && <div style={s.error}>{error}</div>}

      <div style={s.card}>
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

        {method === 'crypto' && (
          <div className="responsive-grid-2" style={s.grid2}>
            <div>
              <label style={s.label}>{t('crypto.currency')}</label>
              <select style={s.select} value={currency} onChange={e => setCurrency(e.target.value)}>
                <option value="BTC">Bitcoin (BTC)</option>
                <option value="ETH">Ethereum (ETH)</option>
                <option value="USDT">USDT (ERC-20)</option>
              </select>

              <label style={s.label}>{t('crypto.sendTo')}</label>
              <div style={{ ...s.input, ...s.mono, cursor: 'text', userSelect: 'all' }}>
                {depositAddresses[currency]}
              </div>

              <label style={s.label}>{t('crypto.amountSent', { currency })}</label>
              <input style={s.input} type="number" step="any" placeholder="0.00" value={cryptoAmount} onChange={e => setCryptoAmount(e.target.value)} />

              <label style={s.label}>{t('crypto.estimatedUsd')}</label>
              <input style={s.input} type="number" step="any" placeholder="0.00" value={amountUsd} onChange={e => setAmountUsd(e.target.value)} />

              <label style={s.label}>{t('crypto.txHash')}</label>
              <input style={s.input} placeholder="0x..." value={txHash} onChange={e => setTxHash(e.target.value)} />

              <button
                style={{ ...s.btnGreen, ...(submitting ? s.btnDisabled : {}) }}
                disabled={submitting}
                onClick={handleSubmitCrypto}
              >
                {submitting ? t('submitting') : t('submitDeposit')}
              </button>
            </div>

            <div style={{ ...s.card, background: 'var(--bg3)', margin: 0 }}>
              <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text)', marginBottom: '16px' }}>{t('howItWorks')}</div>
              {[1, 2, 3, 4].map((step) => (
                <div key={step} style={{ display: 'flex', gap: '12px', marginBottom: '12px', fontSize: '13px' }}>
                  <span style={{ color: 'var(--green)', fontWeight: '600' }}>{step}</span>
                  <span style={{ color: 'var(--text2)' }}>{t(`crypto.steps.${step}`)}</span>
                </div>
              ))}
              <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--border)', fontSize: '13px', display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text2)' }}>{t('minimumDeposit')}</span>
                <span style={{ color: 'var(--text)', fontWeight: '600' }}>{formatMoney(minDeposit)}</span>
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
                      <input type="radio" checked={selectedAccountId === acct.id} onChange={() => setSelectedAccountId(acct.id)} />
                      <span>{acct.bank_name} •••• {acct.last4}</span>
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

              <label style={s.label}>{t('bank.amountUsd')}</label>
              <input style={s.input} type="number" step="any" placeholder="0.00" value={bankAmount} onChange={e => setBankAmount(e.target.value)} />

              <button
                style={{ ...s.btnGreen, ...(submitting || !selectedAccountId ? s.btnDisabled : {}) }}
                disabled={submitting || !selectedAccountId}
                onClick={handleSubmitBank}
              >
                {submitting ? t('submitting') : t('submitDeposit')}
              </button>
            </div>

            <div style={{ ...s.card, background: 'var(--bg3)', margin: 0 }}>
              <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text)', marginBottom: '16px' }}>{t('howItWorks')}</div>
              {[1, 2, 3, 4].map((step) => (
                <div key={step} style={{ display: 'flex', gap: '12px', marginBottom: '12px', fontSize: '13px' }}>
                  <span style={{ color: 'var(--green)', fontWeight: '600' }}>{step}</span>
                  <span style={{ color: 'var(--text2)' }}>{t(`bank.steps.${step}`)}</span>
                </div>
              ))}
              <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--border)', fontSize: '13px', display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text2)' }}>{t('minimumDeposit')}</span>
                <span style={{ color: 'var(--text)', fontWeight: '600' }}>{formatMoney(minDeposit)}</span>
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

              <label style={s.label}>{t('wire.amountSent')}</label>
              <input style={s.input} type="number" step="any" placeholder="0.00" value={wireAmount} onChange={e => setWireAmount(e.target.value)} />

              <label style={s.label}>{t('wire.sentFrom')}</label>
              <input style={s.input} placeholder={t('wire.sentFromPlaceholder')} value={wireReference} onChange={e => setWireReference(e.target.value)} />

              <button
                style={{ ...s.btnGreen, ...(submitting ? s.btnDisabled : {}) }}
                disabled={submitting}
                onClick={handleSubmitWire}
              >
                {submitting ? t('submitting') : t('submitDeposit')}
              </button>
            </div>

            <div style={{ ...s.card, background: 'var(--bg3)', margin: 0 }}>
              <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text)', marginBottom: '16px' }}>{t('howItWorks')}</div>
              {[1, 2, 3, 4].map((step) => (
                <div key={step} style={{ display: 'flex', gap: '12px', marginBottom: '12px', fontSize: '13px' }}>
                  <span style={{ color: 'var(--green)', fontWeight: '600' }}>{step}</span>
                  <span style={{ color: 'var(--text2)' }}>{t(`wire.steps.${step}`)}</span>
                </div>
              ))}
              <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--border)', fontSize: '13px', display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text2)' }}>{t('minimumDeposit')}</span>
                <span style={{ color: 'var(--text)', fontWeight: '600' }}>{formatMoney(minDeposit)}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}