"use client";

import { useState, useEffect } from 'react'
import { useUser } from '@/contexts/UserContext'
import { getMyReferralCode, getMyReferrals, getSettings } from '@/lib/queries'

const s = {
  page: { padding: '32px 36px' },
  title: { fontSize: '26px', fontWeight: '700', color: 'var(--text)', marginBottom: '4px' },
  sub: { fontSize: '14px', color: 'var(--text2)', marginBottom: '28px' },
  card: { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '24px', marginBottom: '20px' },
  cardTitle: { fontSize: '15px', fontWeight: '600', color: 'var(--text)', marginBottom: '8px' },
  cardDesc: { fontSize: '13px', color: 'var(--text3)', marginBottom: '20px' },
  codeBox: { display: 'flex', alignItems: 'center', gap: '10px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '14px 18px', marginBottom: '14px' },
  codeText: { fontFamily: 'monospace', fontSize: '18px', fontWeight: '700', color: 'var(--green)', letterSpacing: '0.05em', flex: 1 },
  copyBtn: { padding: '8px 16px', background: 'var(--green)', border: 'none', borderRadius: '8px', color: '#000', fontSize: '13px', fontWeight: '600', cursor: 'pointer' },
  linkBox: { display: 'flex', alignItems: 'center', gap: '10px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '12px 16px' },
  linkText: { fontSize: '13px', color: 'var(--text2)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  statsRow: { display: 'flex', gap: '16px', marginBottom: '20px' },
  stat: { flex: 1, background: 'var(--bg3)', borderRadius: 'var(--radius-sm)', padding: '18px 20px' },
  statLabel: { fontSize: '11px', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' },
  statValue: { fontSize: '22px', fontWeight: '700', color: 'var(--text)' },
  th: { fontSize: '11px', fontWeight: '500', color: 'var(--text3)', letterSpacing: '0.06em', textTransform: 'uppercase', padding: '0 0 12px 0', textAlign: 'left' },
  td: { padding: '12px 0', borderTop: '1px solid var(--border)', fontSize: '13px', color: 'var(--text)' },
  pill: { fontSize: '11px', fontWeight: '600', padding: '3px 9px', borderRadius: '999px' },
  empty: { textAlign: 'center', padding: '40px', color: 'var(--text3)', fontSize: '14px' },
}

function formatUsd(n) {
  return `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function ReferralsPage() {
  const { user } = useUser()
  const [code, setCode] = useState('')
  const [referrals, setReferrals] = useState([])
  const [settings, setSettings] = useState(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!user) return
    Promise.all([getMyReferralCode(user.id), getMyReferrals(), getSettings()])
      .then(([c, refs, set]) => {
        setCode(c)
        setReferrals(refs)
        setSettings(set)
      })
      .catch(err => console.error('Failed to load referral data:', err))
      .finally(() => setLoading(false))
  }, [user])

  const referralLink = typeof window !== 'undefined' && code
    ? `${window.location.origin}/signup?ref=${code}`
    : ''

  function handleCopy() {
    navigator.clipboard.writeText(referralLink)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const paidCount = referrals.filter(r => r.status === 'paid').length
  const pendingCount = referrals.filter(r => r.status === 'pending').length
  const totalEarned = referrals.filter(r => r.status === 'paid').reduce((sum, r) => sum + Number(r.referrer_bonus_usd), 0)

  if (!settings?.referral_program_enabled && !loading) {
    return (
      <div style={s.page}>
        <h1 style={s.title}>Referrals</h1>
        <div style={s.card}>
          <div style={s.empty}>The referral program isn't active right now.</div>
        </div>
      </div>
    )
  }

  return (
    <div style={s.page}>
      <h1 style={s.title}>Referrals</h1>
      <p style={s.sub}>
        Invite friends — you get {formatUsd(settings?.referral_referrer_bonus_usd)}, they get {formatUsd(settings?.referral_referred_bonus_usd)}
      </p>

      <div style={s.card}>
        <div style={s.cardTitle}>Your referral code</div>
        <div style={s.codeBox}>
          <span style={s.codeText}>{loading ? '········' : code}</span>
          <button style={s.copyBtn} onClick={handleCopy} disabled={loading}>
            {copied ? 'Copied!' : 'Copy link'}
          </button>
        </div>
        <div style={s.linkBox}>
          <span style={s.linkText}>{referralLink || 'Loading…'}</span>
        </div>
      </div>

      <div style={s.statsRow}>
        <div style={s.stat}>
          <div style={s.statLabel}>Total referred</div>
          <div style={s.statValue}>{loading ? '—' : referrals.length}</div>
        </div>
        <div style={s.stat}>
          <div style={s.statLabel}>Pending</div>
          <div style={s.statValue}>{loading ? '—' : pendingCount}</div>
        </div>
        <div style={s.stat}>
          <div style={s.statLabel}>Earned so far</div>
          <div style={{ ...s.statValue, color: 'var(--green)' }}>{loading ? '—' : formatUsd(totalEarned)}</div>
        </div>
      </div>

      <div style={s.card}>
        <div style={s.cardTitle}>Your referrals</div>
        {loading ? (
          <div style={s.empty}>Loading…</div>
        ) : referrals.length === 0 ? (
          <div style={s.empty}>No referrals yet — share your link to get started.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>{['Name', 'Bonus', 'Status', 'Date'].map(h => <th key={h} style={s.th}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {referrals.map(r => (
                <tr key={r.id}>
                  <td style={s.td}>{r.referred_name || 'New investor'}</td>
                  <td style={s.td}>{formatUsd(r.referrer_bonus_usd)}</td>
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
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}