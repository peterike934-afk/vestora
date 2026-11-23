"use client";

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { useUser } from '@/contexts/UserContext'
import { useMoneyFormatter, useDateFormatter } from '@/lib/formatting'
import { getMyReferralCode, getMyReferralHistory, getSettings } from '@/lib/queries'

const s = {
  page: { padding: '32px 36px' },
  title: { fontSize: '26px', fontWeight: '700', color: 'var(--text)', marginBottom: '4px' },
  sub: { fontSize: '14px', color: 'var(--text2)', marginBottom: '8px' },
  note: { fontSize: '12px', color: 'var(--text3)', marginBottom: '28px' },
  card: { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '24px', marginBottom: '20px' },
  cardTitle: { fontSize: '15px', fontWeight: '600', color: 'var(--text)', marginBottom: '8px' },
  help: { fontSize: '13px', color: 'var(--text2)', marginBottom: '14px', lineHeight: '20px' },
  codeBox: { display: 'flex', alignItems: 'center', gap: '10px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '14px 18px', marginBottom: '14px' },
  codeText: { fontFamily: 'monospace', fontSize: '18px', fontWeight: '700', color: 'var(--green)', letterSpacing: '0.05em', flex: 1 },
  copyBtn: { padding: '8px 16px', background: 'var(--green)', border: 'none', borderRadius: '8px', color: '#000', fontSize: '13px', fontWeight: '600', cursor: 'pointer' },
  linkBox: { display: 'flex', alignItems: 'center', gap: '10px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '12px 16px' },
  linkText: { fontSize: '13px', color: 'var(--text2)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  statsRow: { display: 'flex', gap: '16px', marginBottom: '20px', flexWrap: 'wrap' },
  stat: { flex: '1 1 160px', background: 'var(--bg3)', borderRadius: 'var(--radius-sm)', padding: '18px 20px' },
  statLabel: { fontSize: '11px', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' },
  statValue: { fontSize: '22px', fontWeight: '700', color: 'var(--text)' },
  tableWrap: { overflowX: 'auto' },
  th: { fontSize: '11px', fontWeight: '500', color: 'var(--text3)', letterSpacing: '0.06em', textTransform: 'uppercase', padding: '0 12px 12px 0', textAlign: 'left', whiteSpace: 'nowrap' },
  td: { padding: '12px 12px 12px 0', borderTop: '1px solid var(--border)', fontSize: '13px', color: 'var(--text)', verticalAlign: 'top' },
  pill: { fontSize: '11px', fontWeight: '600', padding: '3px 9px', borderRadius: '999px', whiteSpace: 'nowrap' },
  reason: { fontSize: '12px', color: 'var(--text3)', marginTop: '6px' },
  empty: { textAlign: 'center', padding: '40px', color: 'var(--text3)', fontSize: '14px' },
}

const STATUS_STYLE = {
  pending: { background: 'var(--gold-dim)', color: 'var(--gold)' },
  paid: { background: 'var(--green-dim)', color: 'var(--green)' },
  rejected: { background: 'var(--red-dim)', color: 'var(--red)' },
}

function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || ''
}

export default function ReferralsPage() {
  const t = useTranslations('Referrals')
  const formatMoney = useMoneyFormatter()
  const formatDate = useDateFormatter()
  const { user } = useUser()
  const [code, setCode] = useState('')
  const [history, setHistory] = useState([])
  const [settings, setSettings] = useState(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!user) return
    Promise.all([getMyReferralCode(user.id), getMyReferralHistory(), getSettings()])
      .then(([c, rows, set]) => {
        setCode(c)
        setHistory(rows)
        setSettings(set)
      })
      .catch(err => console.error('Failed to load referral data:', err))
      .finally(() => setLoading(false))
  }, [user])

  const referralLink = typeof window !== 'undefined' && code
    ? `${window.location.origin}/signup?ref=${encodeURIComponent(code)}`
    : ''

  function handleCopy() {
    navigator.clipboard.writeText(referralLink)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const asReferrer = history.filter(r => r.my_role === 'referrer')
  const pendingCount = history.filter(r => r.status === 'pending').length
  const totalPaid = history.filter(r => r.status === 'paid').reduce((sum, r) => sum + Number(r.my_bonus_usd || 0), 0)

  if (!settings?.referral_program_enabled && !loading) {
    return (
      <div style={s.page}>
        <h1 style={s.title}>{t('title')}</h1>
        <div style={s.card}>
          <div style={s.empty}>{t('programInactive')}</div>
        </div>
        {history.length > 0 && <HistoryCard t={t} history={history} formatMoney={formatMoney} formatDate={formatDate} />}
      </div>
    )
  }

  return (
    <div style={s.page}>
      <h1 style={s.title}>{t('title')}</h1>
      <p style={s.sub}>
        {t('subtitle', { referrerBonus: formatMoney(settings?.referral_referrer_bonus_usd), referredBonus: formatMoney(settings?.referral_referred_bonus_usd) })}
      </p>
      <p style={s.note}>{t('rewardConditions')}</p>

      <div style={s.card}>
        <div style={s.cardTitle}>{t('yourCode')}</div>
        <div style={s.help}>{t('shareInstructions')}</div>
        <div style={s.codeBox}>
          <span style={s.codeText}>{loading ? '········' : code}</span>
          <button style={s.copyBtn} onClick={handleCopy} disabled={loading || !referralLink}>
            {copied ? t('copied') : t('copyLink')}
          </button>
        </div>
        <div style={s.linkBox}>
          <span style={s.linkText}>{referralLink || t('loading')}</span>
        </div>
      </div>

      <div style={s.statsRow}>
        <div style={s.stat}>
          <div style={s.statLabel}>{t('totalReferred')}</div>
          <div style={s.statValue}>{loading ? '—' : asReferrer.length}</div>
        </div>
        <div style={s.stat}>
          <div style={s.statLabel}>{t('pending')}</div>
          <div style={s.statValue}>{loading ? '—' : pendingCount}</div>
        </div>
        <div style={s.stat}>
          <div style={s.statLabel}>{t('earnedSoFar')}</div>
          <div style={{ ...s.statValue, color: 'var(--green)' }}>{loading ? '—' : formatMoney(totalPaid)}</div>
        </div>
      </div>

      {loading
        ? <div style={s.card}><div style={s.empty}>{t('loading')}</div></div>
        : <HistoryCard t={t} history={history} formatMoney={formatMoney} formatDate={formatDate} />}
    </div>
  )
}

function HistoryCard({ t, history, formatMoney, formatDate }) {
  return (
    <div style={s.card}>
      <div style={s.cardTitle}>{t('yourReferrals')}</div>
      {history.length === 0 ? (
        <div style={s.empty}>{t('noReferralsYet')}</div>
      ) : (
        <div style={s.tableWrap}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>{['name', 'role', 'bonus', 'status', 'date'].map(h => <th key={h} style={s.th}>{t(`table.${h}`)}</th>)}</tr>
            </thead>
            <tbody>
              {history.map(r => (
                <tr key={`${r.id}-${r.my_role}`}>
                  <td style={s.td}>{firstName(r.other_party_name) || t('newInvestor')}</td>
                  <td style={s.td}>{t(`role.${r.my_role}`)}</td>
                  <td style={s.td}>{r.status === 'rejected' ? '—' : formatMoney(r.my_bonus_usd)}</td>
                  <td style={s.td}>
                    <span style={{ ...s.pill, ...(STATUS_STYLE[r.status] || STATUS_STYLE.pending) }}>
                      {t(`status.${r.status}`)}
                    </span>
                    {r.status === 'rejected' && <div style={s.reason}>{t(`reason.${r.rejection_reason || 'other'}`)}</div>}
                  </td>
                  <td style={{ ...s.td, color: 'var(--text3)' }}>{formatDate(r.paid_at || r.reviewed_at || r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
