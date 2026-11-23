"use client";

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { useMoneyFormatter } from '@/lib/formatting'
import { getSettings, getMyMarketingConsent, setMyMarketingConsent } from '@/lib/queries'

// In-app referral announcement. Amounts come from live settings, never
// hardcoded. The marketing opt-in is an explicit button press recorded
// with source 'announcement_prompt'; nothing is inferred. Dismissal is a
// per-user, per-device convenience only.
const DISMISS_KEY_PREFIX = 'vestora_referral_announcement_dismissed:'
const TERMS_PATH = '/legal/referral-terms'

const s = {
  card: { background: 'var(--bg2)', border: '1px solid var(--green)', borderRadius: 'var(--radius)', padding: '20px 24px', marginBottom: '20px', position: 'relative' },
  title: { fontSize: '15px', fontWeight: '700', color: 'var(--text)', marginBottom: '6px', paddingRight: '28px' },
  body: { fontSize: '13px', color: 'var(--text2)', lineHeight: '20px', marginBottom: '14px' },
  row: { display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' },
  primary: { padding: '9px 16px', background: 'var(--green)', border: 'none', borderRadius: '8px', color: '#000', fontSize: '13px', fontWeight: '600', cursor: 'pointer', textDecoration: 'none' },
  secondary: { padding: '9px 16px', background: 'transparent', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text)', fontSize: '13px', fontWeight: '500', cursor: 'pointer' },
  close: { position: 'absolute', top: '12px', right: '14px', background: 'transparent', border: 'none', color: 'var(--text3)', fontSize: '18px', cursor: 'pointer', lineHeight: 1 },
  small: { fontSize: '12px', color: 'var(--text3)' },
  ok: { fontSize: '12px', color: 'var(--green)' },
  err: { fontSize: '12px', color: 'var(--red)' },
}

function readDismissed(userId) {
  try { return window.localStorage.getItem(DISMISS_KEY_PREFIX + userId) === '1' } catch { return false }
}

function writeDismissed(userId) {
  try { window.localStorage.setItem(DISMISS_KEY_PREFIX + userId, '1') } catch { /* storage unavailable */ }
}

export default function ReferralAnnouncement({ userId }) {
  const t = useTranslations('ReferralAnnouncement')
  const formatMoney = useMoneyFormatter()
  const [settings, setSettings] = useState(null)
  const [consent, setConsent] = useState(null)
  const [hidden, setHidden] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)

  useEffect(() => {
    if (!userId) return
    if (readDismissed(userId)) return
    let cancelled = false
    // Promotion is only shown once the referral terms are published.
    const termsPublished = fetch(TERMS_PATH, { method: 'HEAD', cache: 'no-store' })
      .then(res => res.ok)
      .catch(() => false)
    Promise.all([getSettings(), getMyMarketingConsent(userId), termsPublished])
      .then(([set, granted, terms]) => {
        if (cancelled) return
        setSettings(set)
        setConsent(granted)
        setHidden(!set?.referral_program_enabled || !terms)
      })
      .catch(err => console.error('Failed to load referral announcement:', err))
    return () => { cancelled = true }
  }, [userId])

  if (hidden || !settings) return null

  function dismiss() {
    writeDismissed(userId)
    setHidden(true)
  }

  async function optIn() {
    setSaving(true)
    setMessage(null)
    try {
      await setMyMarketingConsent(true, 'announcement_prompt')
      setConsent(true)
      setMessage({ type: 'ok', text: t('optInDone') })
    } catch (err) {
      console.error('Failed to save marketing preference:', err)
      setMessage({ type: 'err', text: t('optInFailed') })
    } finally {
      setSaving(false)
    }
  }

  return (
    <section style={s.card} aria-label={t('title')}>
      <button style={s.close} onClick={dismiss} aria-label={t('dismiss')}>×</button>
      <div style={s.title}>{t('title')}</div>
      <div style={s.body}>
        {t('body', {
          referrerBonus: formatMoney(settings.referral_referrer_bonus_usd),
          referredBonus: formatMoney(settings.referral_referred_bonus_usd),
        })}
      </div>
      <div style={s.row}>
        <Link href="/referrals" style={s.primary}>{t('viewReferrals')}</Link>
        <a href={TERMS_PATH} target="_blank" rel="noopener noreferrer" style={{ ...s.small, textDecoration: 'underline' }}>{t('termsLink')}</a>
        {consent === false && (
          <button style={{ ...s.secondary, ...(saving ? { opacity: 0.5, cursor: 'not-allowed' } : {}) }} onClick={optIn} disabled={saving}>
            {saving ? t('saving') : t('optIn')}
          </button>
        )}
        {message && <span style={message.type === 'ok' ? s.ok : s.err}>{message.text}</span>}
      </div>
      {consent === false && <div style={{ ...s.small, marginTop: '10px' }}>{t('optInExplainer')}</div>}
    </section>
  )
}
