"use client";

import { useState, useEffect } from 'react'
import { getAllInvestmentsAdmin } from '@/lib/queries'

const s = {
  page: { padding: '32px 36px' },
  title: { fontSize: '26px', fontWeight: '700', color: 'var(--text)', marginBottom: '4px' },
  sub: { fontSize: '14px', color: 'var(--text2)', marginBottom: '28px' },
  row: { display: 'flex', gap: '16px', marginBottom: '20px' },
  stat: { flex: 1, background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '20px 24px' },
  statLabel: { fontSize: '11px', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' },
  statValue: { fontSize: '24px', fontWeight: '700', color: 'var(--text)' },
  card: { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '24px' },
  th: { fontSize: '11px', fontWeight: '500', color: 'var(--text3)', letterSpacing: '0.06em', textTransform: 'uppercase', padding: '0 8px 14px 0', textAlign: 'left' },
  td: { padding: '13px 8px 13px 0', borderTop: '1px solid var(--border)', fontSize: '13px', color: 'var(--text)' },
  badge: { fontSize: '11px', fontWeight: '600', padding: '3px 9px', borderRadius: '999px' },
  btnSmall: { fontSize: '12px', padding: '6px 14px', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '600', background: 'var(--red-dim)', color: 'var(--red)' },
  btnDisabled: { opacity: 0.5, cursor: 'not-allowed' },
  empty: { textAlign: 'center', padding: '40px', color: 'var(--text3)', fontSize: '14px' },
  error: { fontSize: '13px', color: 'var(--red)', background: 'var(--red-dim)', padding: '10px 14px', borderRadius: 'var(--radius-sm)', marginBottom: '16px' },
  modalOverlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300, padding: '20px' },
  modal: { width: '400px', maxWidth: '100%', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '24px' },
  modalTitle: { fontSize: '16px', fontWeight: '700', color: 'var(--text)', marginBottom: '4px' },
  modalSub: { fontSize: '13px', color: 'var(--text3)', marginBottom: '20px' },
  label: { display: 'block', fontSize: '13px', color: 'var(--text2)', marginBottom: '6px', fontWeight: '500' },
  textarea: { width: '100%', padding: '11px 14px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontSize: '14px', outline: 'none', marginBottom: '16px', minHeight: '80px', resize: 'vertical', fontFamily: 'inherit' },
  modalActions: { display: 'flex', gap: '10px' },
  btnGhost: { flex: 1, padding: '12px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text2)', fontSize: '14px', fontWeight: '500', cursor: 'pointer' },
  btnRed: { flex: 1, padding: '12px', background: 'var(--red)', border: 'none', borderRadius: 'var(--radius-sm)', color: '#fff', fontSize: '14px', fontWeight: '600', cursor: 'pointer' },
  modalError: { fontSize: '13px', color: 'var(--red)', background: 'var(--red-dim)', padding: '10px 14px', borderRadius: 'var(--radius-sm)', marginBottom: '16px' },
}

function formatUsd(n) {
  return `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// Requires a reason before cancelling — this becomes the admin_note on
// the investment_cancelled transaction the user sees in their own
// transaction history, so they know why their balance changed.
function CancelModal({ investment, onClose, onConfirm, submitting, error }) {
  const [reason, setReason] = useState('')

  return (
    <div style={s.modalOverlay} onClick={onClose}>
      <div style={s.modal} onClick={e => e.stopPropagation()}>
        <div style={s.modalTitle}>Cancel investment</div>
        <div style={s.modalSub}>
          Refund {formatUsd(investment.amount_usd)} principal to {investment.full_name || investment.email}'s wallet. Any unclaimed interest is forfeited.
        </div>

        {error && <div style={s.modalError}>{error}</div>}

        <label style={s.label}>Reason (shown to the user)</label>
        <textarea
          style={s.textarea}
          placeholder="e.g. Investment cancelled due to a compliance review"
          value={reason}
          onChange={e => setReason(e.target.value)}
          autoFocus
        />

        <div style={s.modalActions}>
          <button style={s.btnGhost} onClick={onClose}>Back</button>
          <button
            style={{ ...s.btnRed, ...(submitting ? s.btnDisabled : {}) }}
            disabled={submitting}
            onClick={() => onConfirm(reason)}
          >
            {submitting ? 'Cancelling…' : 'Cancel investment'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function AdminInvestmentsPage() {
  const [investments, setInvestments] = useState([])
  const [loading, setLoading] = useState(true)
  const [cancellingTxn, setCancellingTxn] = useState(null) // the investment being cancelled (modal target)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [modalError, setModalError] = useState('')

  async function loadData() {
    setLoading(true)
    setError('')
    try {
      const data = await getAllInvestmentsAdmin()
      setInvestments(data)
    } catch (err) {
      setError(err.message || 'Failed to load investments')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [])

  async function handleConfirmCancel(reason) {
    if (!reason.trim()) {
      setModalError('A reason is required.')
      return
    }
    setSubmitting(true)
    setModalError('')
    try {
      const res = await fetch('/api/admin/cancel-investment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ investmentId: cancellingTxn.id, reason: reason.trim() }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setCancellingTxn(null)
      await loadData()
    } catch (err) {
      setModalError(err.message || 'Failed to cancel investment')
    } finally {
      setSubmitting(false)
    }
  }

  const active = investments.filter(i => i.status === 'active')
  const totalInvested = active.reduce((sum, i) => sum + Number(i.amount_usd), 0)
  const totalCurrentValue = active.reduce((sum, i) => sum + Number(i.current_value), 0)

  return (
    <div style={s.page}>
      <h1 style={s.title}>Investments</h1>
      <p style={s.sub}>Every user's active and past investments</p>

      {error && <div style={s.error}>{error}</div>}

      <div className="responsive-stats" style={s.row}>
        <div style={s.stat}><div style={s.statLabel}>Active investments</div><div style={s.statValue}>{loading ? '—' : active.length}</div></div>
        <div style={s.stat}><div style={s.statLabel}>Total principal (active)</div><div style={s.statValue}>{loading ? '—' : formatUsd(totalInvested)}</div></div>
        <div style={s.stat}><div style={s.statLabel}>Total current value (active)</div><div style={s.statValue}>{loading ? '—' : formatUsd(totalCurrentValue)}</div></div>
      </div>

      <div style={s.card}>
        {loading ? (
          <div style={s.empty}>Loading…</div>
        ) : investments.length === 0 ? (
          <div style={s.empty}>No investments have been made yet.</div>
        ) : (
          <div className="responsive-table-wrap">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['User', 'Plan', 'Invested', 'Current value', 'APY', 'Days left', 'Status', 'Action'].map(h => (
                  <th key={h} style={s.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {investments.map(inv => (
                <tr key={inv.id}>
                  <td style={s.td}>
                    <div style={{ fontWeight: '500' }}>{inv.full_name || '—'}</div>
                    <div style={{ fontSize: '11px', color: 'var(--text3)' }}>{inv.email}</div>
                  </td>
                  <td style={s.td}>{inv.plan_name}</td>
                  <td style={s.td}>{formatUsd(inv.amount_usd)}</td>
                  <td style={{ ...s.td, color: 'var(--green)', fontWeight: '600' }}>{formatUsd(inv.current_value)}</td>
                  <td style={s.td}>{inv.apy_percent}%</td>
                  <td style={s.td}>{inv.status === 'active' ? Math.ceil(inv.days_remaining) : '—'}</td>
                  <td style={s.td}>
                    <span style={{
                      ...s.badge,
                      background: inv.status === 'active' ? 'var(--green-dim)' : inv.status === 'cancelled' ? 'var(--gold-dim)' : 'var(--bg4)',
                      color: inv.status === 'active' ? 'var(--green)' : inv.status === 'cancelled' ? 'var(--gold)' : 'var(--text3)',
                    }}>
                      {inv.status}
                    </span>
                  </td>
                  <td style={s.td}>
                    {inv.status === 'active' ? (
                      <button
                        style={s.btnSmall}
                        onClick={() => { setModalError(''); setCancellingTxn(inv) }}
                      >
                        Cancel
                      </button>
                    ) : (
                      <span style={{ color: 'var(--text3)', fontSize: '12px' }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>

      {cancellingTxn && (
        <CancelModal
          investment={cancellingTxn}
          onClose={() => setCancellingTxn(null)}
          onConfirm={handleConfirmCancel}
          submitting={submitting}
          error={modalError}
        />
      )}
    </div>
  )
}