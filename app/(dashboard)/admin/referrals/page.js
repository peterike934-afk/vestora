"use client";

import { useState, useEffect } from 'react'
import { getAllReferralsAdmin } from '@/lib/queries'

const s = {
  page: { padding: '32px 36px' },
  title: { fontSize: '26px', fontWeight: '700', color: 'var(--text)', marginBottom: '4px' },
  sub: { fontSize: '14px', color: 'var(--text2)', marginBottom: '28px' },
  card: { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '24px' },
  th: { fontSize: '11px', fontWeight: '500', color: 'var(--text3)', letterSpacing: '0.06em', textTransform: 'uppercase', padding: '0 8px 12px 0', textAlign: 'left' },
  td: { padding: '12px 8px 12px 0', borderTop: '1px solid var(--border)', fontSize: '13px', color: 'var(--text)' },
  pill: { fontSize: '11px', fontWeight: '600', padding: '3px 9px', borderRadius: '999px' },
  btnGreen: { padding: '7px 16px', background: 'var(--green)', border: 'none', borderRadius: '8px', color: '#000', fontSize: '12px', fontWeight: '600', cursor: 'pointer' },
  btnDisabled: { opacity: 0.5, cursor: 'not-allowed' },
  empty: { textAlign: 'center', padding: '40px', color: 'var(--text3)', fontSize: '14px' },
  error: { fontSize: '13px', color: 'var(--red)', background: 'var(--red-dim)', padding: '10px 14px', borderRadius: '8px', marginBottom: '16px' },
}

function formatUsd(n) {
  return `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function AdminReferralsPage() {
  const [referrals, setReferrals] = useState([])
  const [loading, setLoading] = useState(true)
  const [payingId, setPayingId] = useState(null)
  const [error, setError] = useState('')

  async function load() {
    setLoading(true)
    try {
      setReferrals(await getAllReferralsAdmin())
    } catch (err) {
      setError(err.message || 'Failed to load referrals')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function handlePay(referralId) {
    setPayingId(referralId)
    setError('')
    try {
      const res = await fetch('/api/admin/pay-referral', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ referralId }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      await load()
    } catch (err) {
      setError(err.message || 'Failed to pay referral')
    } finally {
      setPayingId(null)
    }
  }

  const pending = referrals.filter(r => r.status === 'pending')

  return (
    <div style={s.page}>
      <h1 style={s.title}>Referrals</h1>
      <p style={s.sub}>{pending.length} pending payout{pending.length !== 1 ? 's' : ''}</p>

      {error && <div style={s.error}>{error}</div>}

      <div style={s.card}>
        {loading ? (
          <div style={s.empty}>Loading…</div>
        ) : referrals.length === 0 ? (
          <div style={s.empty}>No referrals yet.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>{['Referrer', 'Referred', 'Referrer bonus', 'Referred bonus', 'Status', 'Date', ''].map(h => <th key={h} style={s.th}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {referrals.map(r => (
                <tr key={r.id}>
                  <td style={s.td}>{r.referrer?.full_name || r.referrer?.email}</td>
                  <td style={s.td}>{r.referred?.full_name || r.referred?.email}</td>
                  <td style={s.td}>{formatUsd(r.referrer_bonus_usd)}</td>
                  <td style={s.td}>{formatUsd(r.referred_bonus_usd)}</td>
                  <td style={s.td}>
                    <span style={{
                      ...s.pill,
                      background: r.status === 'paid' ? 'var(--green-dim)' : 'var(--gold-dim)',
                      color: r.status === 'paid' ? 'var(--green)' : 'var(--gold)',
                    }}>
                      {r.status}
                    </span>
                  </td>
                  <td style={{ ...s.td, color: 'var(--text3)' }}>{new Date(r.created_at).toLocaleDateString()}</td>
                  <td style={s.td}>
                    {r.status === 'pending' && (
                      <button
                        style={{ ...s.btnGreen, ...(payingId === r.id ? s.btnDisabled : {}) }}
                        disabled={payingId === r.id}
                        onClick={() => handlePay(r.id)}
                      >
                        {payingId === r.id ? 'Paying…' : 'Pay'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}