"use client";

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { CircleDollarSign, TrendingUp, ShieldCheck } from 'lucide-react'
import { useUser } from '@/contexts/UserContext'
import { useMoneyFormatter } from '@/lib/formatting'
import { getWallet, getInvestmentPlans, getUserInvestments, createInvestment, requestInvestmentWithdrawal, claimInvestmentGains } from '@/lib/queries'
import DashboardPageHeader from '@/components/dashboard/DashboardPageHeader'
import FinancialMetric from '@/components/dashboard/FinancialMetric'
import DashboardState from '@/components/dashboard/DashboardState'
import FormField from '@/components/dashboard/FormField'

// Must match c_early_fee_rate in the request_investment_withdrawal SQL function.
const EARLY_FEE_RATE = 0.10
const PLAN_ICONS = [TrendingUp, ShieldCheck, CircleDollarSign]

const s = {
  page: { maxWidth: '1380px', margin: '0 auto', padding: '34px 44px' },
  card: { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '24px', marginBottom: '20px', boxShadow: '0 4px 16px rgba(24, 49, 34, 0.035)' },
  cardTitle: { fontSize: '15px', fontWeight: '600', color: 'var(--text)', marginBottom: '20px' },
  planGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '20px' },
  planCard: { width: '100%', background: 'var(--bg3)', borderWidth: '1px', borderStyle: 'solid', borderColor: 'var(--border)', borderRadius: 'var(--radius-sm)', padding: '22px', cursor: 'pointer', color: 'var(--text)', font: 'inherit', textAlign: 'left', transition: 'border-color 160ms ease, background 160ms ease, transform 160ms ease', boxShadow: '0 7px 22px rgba(20, 54, 35, .045)' },
  planCardActive: { borderColor: 'var(--green)', background: 'var(--green-dim)' },
  planName: { fontSize: '15px', fontWeight: '600', color: 'var(--text)', marginBottom: '4px' },
  planDesc: { fontSize: '12px', color: 'var(--text3)', marginBottom: '12px' },
  planApy: { fontSize: '22px', fontWeight: '700', color: 'var(--green)' },
  planMeta: { fontSize: '12px', color: 'var(--text2)', marginTop: '8px' },
  label: { display: 'block', fontSize: '13px', color: 'var(--text2)', marginBottom: '6px', fontWeight: '500' },
  input: { width: '100%', padding: '12px 16px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontSize: '14px', outline: 'none', marginBottom: '16px' },
  btnGreen: { padding: '13px 28px', background: 'var(--green)', border: 'none', borderRadius: 'var(--radius-sm)', color: '#fff', fontSize: '14px', fontWeight: '600', cursor: 'pointer' },
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
  modalTitle: { fontSize: '16px', fontWeight: '700', color: 'var(--text)', marginTop: 0, marginBottom: '4px' },
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

function calculatePreview(inv, principalAmount, walletBalance) {
  const amt = Number(principalAmount) || 0
  if (amt <= 0) return null
  const isMatured = inv.is_matured
  const daysElapsed = (Date.now() - new Date(inv.started_at).getTime()) / 86400000
  const daysCounted = Math.min(daysElapsed, inv.term_days)
  let interestEarned = 0
  let forfeited = 0
  let fee = 0
  if (isMatured) {
    interestEarned = amt * ((inv.apy_percent / 100) * inv.term_days / 365)
  } else {
    const remaining = Number(inv.remaining_principal) || 0
    const accrued = amt * (inv.apy_percent / 100) * daysCounted / 365
    const claimedShare = remaining > 0 ? Number(inv.claimed_interest || 0) * (amt / remaining) : 0
    forfeited = Math.max(accrued - claimedShare, 0)
    fee = Math.round(amt * EARLY_FEE_RATE * 100) / 100
  }
  // The fee is charged to the wallet first; only a shortfall comes out of the payout.
  const feeFromWallet = Math.min(fee, Math.max(Number(walletBalance) || 0, 0))
  const feeFromPayout = Math.round((fee - feeFromWallet) * 100) / 100
  const payout = Math.max(amt + interestEarned - feeFromPayout, 0)
  return { principal: amt, interestEarned, forfeited, fee, feeFromWallet, feeFromPayout, payout, isMatured }
}

function WithdrawModal({ investment, balance, onClose, onSuccess }) {
  const t = useTranslations('Portfolio')
  const formatMoney = useMoneyFormatter()
  const [amount, setAmount] = useState(investment.available_to_withdraw?.toFixed(2) || '')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const preview = calculatePreview(investment, amount, balance)
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
      <div style={s.modal} role="dialog" aria-modal="true" aria-labelledby="withdraw-modal-title" onClick={e => e.stopPropagation()}>
        <h2 id="withdraw-modal-title" style={s.modalTitle}>{t('withdrawModal.title', { plan: investment.plan_name })}</h2>
        <div style={s.modalSub}>{t('withdrawModal.available', { amount: formatMoney(available) })}</div>

        {error && <div style={s.error}>{error}</div>}

        {preview?.isMatured ? (
          <div style={s.maturedNotice}>{t('withdrawModal.maturedNotice')}</div>
        ) : (
          <div style={s.penaltyNotice}>{t('withdrawModal.penaltyNotice', { fee: formatMoney(preview?.fee ?? 0) })}</div>
        )}

        <label htmlFor="withdraw-amount" style={s.label}>{t('withdrawModal.amountLabel')}</label>
        <input
          id="withdraw-amount"
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
                {preview.isMatured ? `+${formatMoney(preview.interestEarned)}` : `−${formatMoney(preview.forfeited)}`}
              </span>
            </div>
            {preview.fee > 0 && (
              <>
                <div style={s.breakdownRow}>
                  <span style={s.breakdownLabel}>{t('withdrawModal.feeChargedToWallet')}</span>
                  <span style={s.breakdownValueNeg}>−{formatMoney(preview.feeFromWallet)}</span>
                </div>
                {preview.feeFromPayout > 0 && (
                  <div style={s.breakdownRow}>
                    <span style={s.breakdownLabel}>{t('withdrawModal.feeTakenFromPayout')}</span>
                    <span style={s.breakdownValueNeg}>−{formatMoney(preview.feeFromPayout)}</span>
                  </div>
                )}
              </>
            )}
            <div style={s.breakdownTotal}>
              <span>{t('withdrawModal.youllReceive')}</span>
              <span>{formatMoney(preview.payout)}</span>
            </div>
            {preview.fee > 0 && (
              <div style={{ ...s.breakdownRow, marginTop: '8px' }}>
                <span style={s.breakdownLabel}>{t('withdrawModal.totalWithFee')}</span>
                <span>{formatMoney(preview.principal + preview.fee)}</span>
              </div>
            )}
          </div>
        )}

        <div style={s.modalActions}>
          <button type="button" style={s.btnGhost} onClick={onClose}>{t('cancel')}</button>
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
      <div style={s.modal} role="dialog" aria-modal="true" aria-labelledby="claim-modal-title" onClick={e => e.stopPropagation()}>
        <h2 id="claim-modal-title" style={s.modalTitle}>{t('claimModal.title', { plan: investment.plan_name })}</h2>
        <div style={s.modalSub}>{t('claimModal.subtitle')}</div>

        {error && <div style={s.error}>{error}</div>}

        <div style={s.breakdown}>
          <div style={s.breakdownTotal}>
            <span>{t('claimModal.availableToClaim')}</span>
            <span style={s.breakdownValuePos}>{formatMoney(claimable)}</span>
          </div>
        </div>

        <div style={s.modalActions}>
          <button type="button" style={s.btnGhost} onClick={onClose}>{t('cancel')}</button>
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
  const tDashboard = useTranslations('Dashboard')
  const formatMoney = useMoneyFormatter()
  const { user } = useUser()
  const [balance, setBalance] = useState(0)
  const [plans, setPlans] = useState([])
  const [investments, setInvestments] = useState([])
  const [selectedPlan, setSelectedPlan] = useState(null)
  const [amount, setAmount] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [withdrawingInv, setWithdrawingInv] = useState(null)
  const [claimingInv, setClaimingInv] = useState(null)

  async function loadData() {
    if (!user) return
    setLoading(true)
    setLoadFailed(false)
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
      setLoadFailed(true)
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

  // Only open investments count towards the totals; closed ones move to the history list.
  const activeInvestments = investments.filter(i => i.status === 'active')
  const closedInvestments = investments.filter(i => i.status !== 'active')
  const totalInvested = activeInvestments.reduce((sum, i) => sum + Number(i.remaining_principal ?? i.amount_usd), 0)
  const totalCurrentValue = activeInvestments.reduce((sum, i) => sum + Number(i.current_value), 0)

  return (
    <div className="customer-portfolio-page" style={s.page}>
      <DashboardPageHeader eyebrow={tDashboard('accountOverview')} title={t('title')} description={t('subtitle')} />

      <section className="customer-portfolio-metrics" aria-label={t('yourInvestments')}>
        <FinancialMetric
          label={tDashboard('availableBalance')}
          value={loading || loadFailed ? '—' : formatMoney(balance)}
          detail="USD"
          tone="primary"
        />
        <FinancialMetric
          label={t('totalInvested')}
          value={loading || loadFailed ? '—' : formatMoney(totalInvested)}
          detail={t('yourInvestments')}
        />
        <FinancialMetric
          label={t('currentValue')}
          value={loading || loadFailed ? '—' : formatMoney(totalCurrentValue)}
          tone="positive"
          detail={t('yourInvestments')}
        />
      </section>

      {error && (
        <div style={s.error} role="alert">
          {error}
          {loadFailed && (
            <button type="button" className="customer-portfolio-retry" onClick={loadData}>
              {tDashboard('retry')}
            </button>
          )}
        </div>
      )}
      {success && <div style={{ ...s.error, color: 'var(--green)', background: 'var(--green-dim)' }} role="status">{success}</div>}

      <div className="customer-portfolio-card" style={s.card}>
        <div style={s.cardTitle}>{t('choosePlan')}</div>
        {loading ? (
          <DashboardState title={t('loading')} />
        ) : loadFailed ? (
          <DashboardState variant="error" title={t('errors.loadFailed')} />
        ) : (
        <>
        <div className="responsive-plan-grid customer-portfolio-plan-grid" style={s.planGrid}>
          {plans.map((plan, index) => {
            const Icon = PLAN_ICONS[index % PLAN_ICONS.length]
            return (
            <button
              type="button"
              key={plan.id}
              className="customer-portfolio-plan"
              aria-pressed={selectedPlan?.id === plan.id}
              style={{ ...s.planCard, ...(selectedPlan?.id === plan.id ? s.planCardActive : {}) }}
              onClick={() => setSelectedPlan(plan)}
            >
              <span className="customer-portfolio-plan__icon">
                <Icon size={20} strokeWidth={1.8} aria-hidden="true" />
              </span>
              <span className="customer-portfolio-plan__name" style={s.planName}>{plan.name}</span>
              <span className="customer-portfolio-plan__description" style={s.planDesc}>{plan.description}</span>
              <span className="customer-portfolio-plan__apy" style={s.planApy}>{t('apyValue', { apy: plan.apy_percent })}</span>
              <span className="customer-portfolio-plan__meta" style={s.planMeta}>
                {t('termMin', { days: plan.term_days, min: formatMoney(plan.min_amount) })}
              </span>
            </button>
            )
          })}
        </div>

        <FormField
          id="portfolio-investment-amount"
          label={t('amountToInvest', { available: formatMoney(balance) })}
          control={(
            <input
              style={{ ...s.input, marginBottom: 0 }}
              type="number"
              min="0"
              step="any"
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={e => setAmount(e.target.value)}
            />
          )}
        />
        <button
          type="button"
          style={{ ...s.btnGreen, ...(submitting ? s.btnDisabled : {}) }}
          disabled={submitting}
          onClick={handleInvest}
        >
          {submitting ? t('investing') : t('investNow')}
        </button>
        </>
        )}
      </div>

      <div className="customer-portfolio-card customer-portfolio-card--investments" style={s.card}>
        <div style={s.cardTitle}>{t('yourInvestments')}</div>
        {loading ? (
          <DashboardState title={t('loading')} />
        ) : loadFailed ? (
          <DashboardState variant="error" title={t('errors.loadFailed')} />
        ) : investments.length === 0 ? (
          <DashboardState title={t('noInvestments')} />
        ) : (
          <>
            <div className="responsive-table-wrap">
            <table aria-label={t('yourInvestments')} style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['plan', 'invested', 'currentValue', 'apy', 'daysLeft', 'status', 'blank'].map(h => (
                    <th key={h} style={s.th}>{h === 'blank' ? '' : t(`table.${h}`)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {activeInvestments.map(inv => {
                  const available = Number(inv.available_to_withdraw) || 0
                  const canWithdraw = inv.status === 'active' && available > 0.01
                  const claimable = inv.status === 'active' ? (Number(inv.available_to_claim) || 0) : 0
                  const canClaim = claimable > 0.01
                  return (
                    <tr key={inv.id}>
                      <td data-label={t('table.plan')} style={{ ...s.td, fontWeight: '500' }}>{inv.plan_name}</td>
                      <td data-label={t('table.invested')} style={s.td}>{formatMoney(inv.amount_usd)}</td>
                      <td data-label={t('table.currentValue')} style={{ ...s.td, color: 'var(--green)', fontWeight: '600' }}>{formatMoney(inv.current_value)}</td>
                      <td data-label={t('table.apy')} style={s.td}>{inv.apy_percent}%</td>
                      <td data-label={t('table.daysLeft')} style={s.td}>{Math.ceil(inv.days_remaining)}</td>
                      <td data-label={t('table.status')} style={s.td}>
                        <span style={{
                          ...s.statusBadge,
                          background: inv.status === 'active' ? 'var(--green-dim)' : inv.status === 'cancelled' ? 'var(--gold-dim)' : 'var(--bg4)',
                          color: inv.status === 'active' ? 'var(--green)' : inv.status === 'cancelled' ? 'var(--gold)' : 'var(--text3)',
                        }}>
                          {t(`status.${inv.status}`, { default: inv.status })}
                        </span>
                      </td>
                      <td data-label="" style={s.td}>
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

            {closedInvestments.length > 0 && (
              <div style={{ marginTop: '28px' }}>
                <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text3)', marginBottom: '8px' }}>{t('closedInvestments')}</div>
                {closedInvestments.map(inv => (
                  <div
                    key={inv.id}
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderTop: '1px solid var(--border)', fontSize: '13px', color: 'var(--text3)' }}
                  >
                    <span>{inv.plan_name} · {formatMoney(inv.amount_usd)}</span>
                    <span style={{
                      ...s.statusBadge,
                      background: inv.status === 'cancelled' ? 'var(--gold-dim)' : 'var(--bg4)',
                      color: inv.status === 'cancelled' ? 'var(--gold)' : 'var(--text3)',
                    }}>
                      {t(`status.${inv.status}`, { default: inv.status })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {withdrawingInv && (
        <WithdrawModal
          investment={withdrawingInv}
          balance={balance}
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