"use client";

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { useUser } from '@/contexts/UserContext'
import { useMoneyFormatter } from '@/lib/formatting'
import { getWallet, getInvestmentPlans, getUserInvestments, createInvestment, requestInvestmentWithdrawal, claimInvestmentGains } from '@/lib/queries'

const s = {
  page: { padding: '32px 36px' },
  title: { fontSize: '26px', fontWeight: '700', color: 'var(--text)', marginBottom: '4px' },
  sub: { fontSize: '14px', color: 'var(--text2)', marginBottom: '28px' },
  card: { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '24px', marginBottom: '20px' },
  cardTitle: { fontSize: '15px', fontWeight: '600', color: 'var(--text)', marginBottom: '20px' },
  planGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '20px' },
  planCard: { background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '20px', cursor: 'pointer' },
  planCardActive: { borderColor: 'var(--green)', background: 'var(--green-dim)' },
  planName: { fontSize: '15px', fontWeight: '600', color: 'var(--text)', marginBottom: '4px' },
  planDesc: { fontSize: '12px', color: 'var(--text3)', marginBottom: '12px' },
  planApy: { fontSize: '22px', fontWeight: '700', color: 'var(--green)' },
  planMeta: { fontSize: '12px', color: 'var(--text2)', marginTop: '8px' },
  label: { display: 'block', fontSize: '13px', color: 'var(--text2)', marginBottom: '6px', fontWeight: '500' },
  input: { width: '100%', padding: '12px 16px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontSize: '14px', outline: 'none', marginBottom: '16px' },
  btnGreen: { padding: '13px 28px', background: 'var(--green)', border: 'none', borderRadius: 'var(--radius-sm)', color: '#000', fontSize: '14px', fontWeight: '600', cursor: 'pointer' },
  btnGhost: { padding: '13px 28px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text2)', fontSize: '14px', fontWeight: '500', cursor: 'pointer' },
  btnDisabled: { opacity: 0.5, cursor: 'not-allowed' },
  btnSmall: { fontSize: '12px', padding: '6px 14px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text2)', borderRadius: '6px', cursor: 'pointer', fontWeight: '600' },
  btnSmallGreen: { fontSize: '12px', padding: '6px 14px', border: '1px solid var(--green)', background: 'var(--green-dim)', color: 'var(--green)', borderRadius: '6px', cursor: 'pointer', fontWeight: '600' },
  btnSmallDisabled: { opacity: 0.35, cursor: 'not-allowed' },
  error: { fontSize: '13px', color: 'var(--red)', background: 'var(--red-dim)', padding: '10px 14px', borderRadius: 'var(--radius-sm)', marginBottom: '16px' },
  th: { fontSize: '11px', fontWeight: '500', color: 'var(--text3)', letterSpacing: '0.06em', textTransform: 'uppercase', padding: '0 0 14px 0', textAlign: 'left' },
  td: { padding: '13px 0', borderTop: '1px solid var(--border)', fontSize: '13px', color: 'var(--text)' },
  empty: { textAlign: 'center', padding: '40px', color: 'var(--text3)', fontSize: '14px' },
  statusBadge: { fontSize: '11px', fontWeight: '600', padding: '3px 9px', borderRadius: '999px' },
  modalOverlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300, padding: '20px' },
  modal: { width: '420px', maxWidth: '100%', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '24px' },
  modalTitle: { fontSize: '16px', fontWeight: '700', color: 'var(--text)', marginBottom: '4px' },
  modalSub: { fontSize: '13px', color: 'var(--text3)', marginBottom: '20px' },
  breakdown: { background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '16px', marginBottom: '16px' },
  breakdownRow: { display: 'flex', justifyContent: 'space-between', fontSize: '13px', padding: '4px 0' },
  breakdownLabel: { color: 'var(--text2)' },
  breakdownValueNeg: { color: 'var(--red)', fontWeight: '600' },
  breakdownValuePos: { color: 'var(--green)', fontWeight: '600' },
  breakdownTotal: { display: 'flex', justifyContent: 'space-between', fontSize: '15px', fontWeight: '700', color: 'var(--text)', marginTop: '10px', paddingTop: '10px', borderTop: '1px solid var(--border)' },
  penaltyNotice: { fontSize: '12px', color: 'var(--gold)', background: 'var(--gold-dim)', padding: '10px 12px', borderRadius: '8px', marginBottom: '16px' },
  maturedNotice: { fontSize: '12px', color: 'var(--green)', background: 'var(--green-dim)', padding: '10px 12px', borderRadius: '8px', marginBottom: '16px' },
  modalActions: { display: 'flex', gap: '10px', marginTop: '4px' },
}

function calculatePreview(inv, principalAmount) {
  const amt = Number(principalAmount) || 0
  if (amt <= 0) return null
  const isMatured = inv.is_matured
  const daysElapsed = (Date.now() - new Date(inv.started_at).getTime()) / 86400000
  const daysCounted = Math.min(daysElapsed, inv.term_days)
  let interestEarned = 0
  let fee = 0
  if (isMatured) {
    interestEarned = amt * ((inv.apy_percent / 100) * inv.term_days / 365)
  } else {
    fee = Number(inv.early_withdrawal_fee_usd) || 0
  }
  const payout = Math.max(amt + interestEarned - fee, 0)
  return { principal: amt, interestEarned, fee, payout, isMatured }
}

function WithdrawModal({ investment, onClose, onSuccess }) {
  const t = useTranslations('Portfolio')
  const formatMoney = useMoneyFormatter()
  const [amount, setAmount] = useState(investment.available_to_withdraw?.toFixed(2) || '')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const preview = calculatePreview(investment, amount)
  const available = Number(investment.available_to_withdraw) || 0

  async function handleSubmit() {
    setError('')
    const amt = Number(amount)
    if (!amt || amt <= 0) {
      setError(t('errors.validAmount'))
      return
    }
    if (amt > available) {
      setError(t('errors.exceedsAvailable', { amount: formatMoney(available) }))
      return
    }
    setSubmitting(true)
    try {
      await requestInvestmentWithdrawal({ investmentId: investment.id, principalAmount: amt })
      onSuccess()
    } catch (err) {
      setError(err.message || t('errors.withdrawFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={s.modalOverlay} onClick={onClose}>
      <div style={s.modal} onClick={e => e.stopPropagation()}>
        <div style={s.modalTitle}>{t('withdrawModal.title', { plan: investment.plan_name })}</div>
        <div style={s.modalSub}>{t('withdrawModal.available', { amount: formatMoney(available) })}</div>

        {error && <div style={s.error}>{error}</div>}

        {preview?.isMatured ? (
          <div style={s.maturedNotice}>{t('withdrawModal.maturedNotice')}</div>
        ) : (
          <div style={s.penaltyNotice}>{t('withdrawModal.penaltyNotice', { fee: formatMoney(investment.early_withdrawal_fee_usd) })}</div>
        )}

        <label style={s.label}>{t('withdrawModal.amountLabel')}</label>
        <input
          style={s.input}
          type="number"
          step="any"
          placeholder="0.00"
          value={amount}
          onChange={e => setAmount(e.target.value)}
        />

        {preview && (
          <div style={s.breakdown}>
            <div style={s.breakdownRow}>
              <span style={s.breakdownLabel}>{t('withdrawModal.principalWithdrawn')}</span>
              <span>{formatMoney(preview.principal)}</span>
            </div>
            <div style={s.breakdownRow}>
              <span style={s.breakdownLabel}>{preview.isMatured ? t('withdrawModal.interestEarned') : t('withdrawModal.interestForfeited')}</span>
              <span style={preview.isMatured ? s.breakdownValuePos : s.breakdownValueNeg}>
                {preview.isMatured ? `+${formatMoney(preview.interestEarned)}` : formatMoney(0)}
              </span>
            </div>
            {preview.fee > 0 && (
              <div style={s.breakdownRow}>
                <span style={s.breakdownLabel}>{t('withdrawModal.earlyFee')}</span>
                <span style={s.breakdownValueNeg}>−{formatMoney(preview.fee)}</span>
              </div>
            )}
            <div style={s.breakdownTotal}>
              <span>{t('withdrawModal.youllReceive')}</span>
              <span>{formatMoney(preview.payout)}</span>
            </div>
          </div>
        )}

        <div style={s.modalActions}>
          <button style={s.btnGhost} onClick={onClose}>{t('cancel')}</button>
          <button
            style={{ ...s.btnGreen, flex: 1, ...(submitting ? s.btnDisabled : {}) }}
            disabled={submitting}
            onClick={handleSubmit}
          >
            {submitting ? t('withdrawModal.requesting') : t('withdrawModal.requestWithdrawal')}
          </button>
        </div>
      </div>
    </div>
  )
}

function ClaimGainsModal({ investment, onClose, onSuccess }) {
  const t = useTranslations('Portfolio')
  const formatMoney = useMoneyFormatter()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const claimable = Number(investment.available_to_claim) || 0

  async function handleSubmit() {
    setError('')
    setSubmitting(true)
    try {
      await claimInvestmentGains(investment.id)
      onSuccess()
    } catch (err) {
      setError(err.message || t('errors.claimFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={s.modalOverlay} onClick={onClose}>
      <div style={s.modal} onClick={e => e.stopPropagation()}>
        <div style={s.modalTitle}>{t('claimModal.title', { plan: investment.plan_name })}</div>
        <div style={s.modalSub}>{t('claimModal.subtitle')}</div>

        {error && <div style={s.error}>{error}</div>}

        <div style={s.breakdown}>
          <div style={s.breakdownTotal}>
            <span>{t('claimModal.availableToClaim')}</span>
            <span style={s.breakdownValuePos}>{formatMoney(claimable)}</span>
          </div>
        </div>

        <div style={s.modalActions}>
          <button style={s.btnGhost} onClick={onClose}>{t('cancel')}</button>
          <button
            style={{ ...s.btnGreen, flex: 1, ...((submitting || claimable <= 0) ? s.btnDisabled : {}) }}
            disabled={submitting || claimable <= 0}
            onClick={handleSubmit}
          >
            {submitting ? t('claimModal.claiming') : t('claimModal.claimGains')}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function PortfolioPage() {
  const t = useTranslations('Portfolio')
  const formatMoney = useMoneyFormatter()
  const { user } = useUser()
  const [balance, setBalance] = useState(0)
  const [plans, setPlans] = useState([])
  const [investments, setInvestments] = useState([])
  const [selectedPlan, setSelectedPlan] = useState(null)
  const [amount, setAmount] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [withdrawingInv, setWithdrawingInv] = useState(null)
  const [claimingInv, setClaimingInv] = useState(null)

  async function loadData() {
    if (!user) return
    setLoading(true)
    setError('')
    try {
      const [wallet, planList, investmentList] = await Promise.all([
        getWallet(user.id),
        getInvestmentPlans(),
        getUserInvestments(user.id),
      ])
      setBalance(wallet?.balance_usd ?? 0)
      setPlans(planList)
      setInvestments(investmentList)
    } catch (err) {
      setError(err.message || t('errors.loadFailed'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [user])

  async function handleInvest() {
    setError('')
    setSuccess('')
    const amt = Number(amount)

    if (!selectedPlan) {
      setError(t('errors.selectPlan'))
      return
    }
    if (!amt || amt < selectedPlan.min_amount) {
      setError(t('errors.minForPlan', { plan: selectedPlan.name, amount: formatMoney(selectedPlan.min_amount) }))
      return
    }
    if (amt > balance) {
      setError(t('errors.exceedsBalance', { amount: formatMoney(balance) }))
      return
    }

    setSubmitting(true)
    try {
      await createInvestment({ planId: selectedPlan.id, amountUsd: amt })
      setSuccess(t('investSuccess', { amount: formatMoney(amt), plan: selectedPlan.name }))
      setAmount('')
      setSelectedPlan(null)
      await loadData()
    } catch (err) {
      setError(err.message || t('errors.investFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  const totalInvested = investments.reduce((sum, i) => sum + Number(i.amount_usd), 0)
  const totalCurrentValue = investments.reduce((sum, i) => sum + Number(i.current_value), 0)

  return (
    <div style={s.page}>
      <h1 style={s.title}>{t('title')}</h1>
      <p style={s.sub}>{t('subtitle')}</p>

      {error && <div style={s.error}>{error}</div>}
      {success && <div style={{ ...s.error, color: 'var(--green)', background: 'var(--green-dim)' }}>{success}</div>}

      <div style={s.card}>
        <div style={s.cardTitle}>{t('choosePlan')}</div>
        <div className="responsive-plan-grid" style={s.planGrid}>
          {plans.map(plan => (
            <div
              key={plan.id}
              style={{ ...s.planCard, ...(selectedPlan?.id === plan.id ? s.planCardActive : {}) }}
              onClick={() => setSelectedPlan(plan)}
            >
              <div style={s.planName}>{plan.name}</div>
              <div style={s.planDesc}>{plan.description}</div>
              <div style={s.planApy}>{t('apyValue', { apy: plan.apy_percent })}</div>
              <div style={s.planMeta}>{t('termMin', { days: plan.term_days, min: formatMoney(plan.min_amount) })}</div>
            </div>
          ))}
        </div>

        <label style={s.label}>{t('amountToInvest', { available: formatMoney(balance) })}</label>
        <input
          style={s.input}
          type="number"
          placeholder="0.00"
          value={amount}
          onChange={e => setAmount(e.target.value)}
        />
        <button
          style={{ ...s.btnGreen, ...(submitting ? s.btnDisabled : {}) }}
          disabled={submitting}
          onClick={handleInvest}
        >
          {submitting ? t('investing') : t('investNow')}
        </button>
      </div>

      <div style={s.card}>
        <div style={s.cardTitle}>{t('yourInvestments')}</div>
        {loading ? (
          <div style={s.empty}>{t('loading')}</div>
        ) : investments.length === 0 ? (
          <div style={s.empty}>{t('noInvestments')}</div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: '32px', marginBottom: '20px' }}>
              <div>
                <div style={{ fontSize: '11px', color: 'var(--text3)', textTransform: 'uppercase', marginBottom: '4px' }}>{t('totalInvested')}</div>
                <div style={{ fontSize: '20px', fontWeight: '700', color: 'var(--text)' }}>{formatMoney(totalInvested)}</div>
              </div>
              <div>
                <div style={{ fontSize: '11px', color: 'var(--text3)', textTransform: 'uppercase', marginBottom: '4px' }}>{t('currentValue')}</div>
                <div style={{ fontSize: '20px', fontWeight: '700', color: 'var(--green)' }}>{formatMoney(totalCurrentValue)}</div>
              </div>
            </div>
            <div className="responsive-table-wrap">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['plan', 'invested', 'currentValue', 'apy', 'daysLeft', 'status', 'blank'].map(h => (
                    <th key={h} style={s.th}>{h === 'blank' ? '' : t(`table.${h}`)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {investments.map(inv => {
                  const available = Number(inv.available_to_withdraw) || 0
                  const canWithdraw = inv.status === 'active' && available > 0.01
                  const claimable = inv.status === 'active' ? (Number(inv.available_to_claim) || 0) : 0
                  const canClaim = claimable > 0.01
                  return (
                    <tr key={inv.id}>
                      <td style={{ ...s.td, fontWeight: '500' }}>{inv.plan_name}</td>
                      <td style={s.td}>{formatMoney(inv.amount_usd)}</td>
                      <td style={{ ...s.td, color: 'var(--green)', fontWeight: '600' }}>{formatMoney(inv.current_value)}</td>
                      <td style={s.td}>{inv.apy_percent}%</td>
                      <td style={s.td}>{Math.ceil(inv.days_remaining)}</td>
                      <td style={s.td}>
                        <span style={{
                          ...s.statusBadge,
                          background: inv.status === 'active' ? 'var(--green-dim)' : inv.status === 'cancelled' ? 'var(--gold-dim)' : 'var(--bg4)',
                          color: inv.status === 'active' ? 'var(--green)' : inv.status === 'cancelled' ? 'var(--gold)' : 'var(--text3)',
                        }}>
                          {t(`status.${inv.status}`, { default: inv.status })}
                        </span>
                      </td>
                      <td style={s.td}>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button
                            style={{ ...s.btnSmallGreen, ...(canClaim ? {} : s.btnSmallDisabled) }}
                            disabled={!canClaim}
                            title={!canClaim ? t('noGainsYet') : undefined}
                            onClick={() => setClaimingInv(inv)}
                          >
                            {t('claimGains')}
                          </button>
                          <button
                            style={{ ...s.btnSmall, ...(canWithdraw ? {} : s.btnSmallDisabled) }}
                            disabled={!canWithdraw}
                            title={!canWithdraw ? t('nothingToWithdraw') : undefined}
                            onClick={() => setWithdrawingInv(inv)}
                          >
                            {t('withdraw')}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            </div>
          </>
        )}
      </div>

      {withdrawingInv && (
        <WithdrawModal
          investment={withdrawingInv}
          onClose={() => setWithdrawingInv(null)}
          onSuccess={() => {
            setWithdrawingInv(null)
            setSuccess(t('withdrawRequestedMsg'))
            loadData()
          }}
        />
      )}

      {claimingInv && (
        <ClaimGainsModal
          investment={claimingInv}
          onClose={() => setClaimingInv(null)}
          onSuccess={() => {
            setClaimingInv(null)
            setSuccess(t('claimRequestedMsg'))
            loadData()
          }}
        />
      )}
    </div>
  )
}