"use client";

import { useState, useEffect, useCallback } from 'react'
import { getAllReferralsAdmin, getReferralReviewDetails, getReferralAttentionItems } from '@/lib/queries'
import { REFERRAL_REJECTION_REASONS, referralReasonText } from '@/lib/referral-reasons'

const s = {
  page: { padding: '32px 36px', maxWidth: '100vw', boxSizing: 'border-box' },
  title: { fontSize: '26px', fontWeight: '700', color: 'var(--text)', marginBottom: '4px' },
  sub: { fontSize: '14px', color: 'var(--text2)', marginBottom: '20px' },
  card: { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '24px', maxWidth: '100%', boxSizing: 'border-box', marginBottom: '20px' },
  cardTitle: { fontSize: '15px', fontWeight: '600', color: 'var(--text)', marginBottom: '12px' },
  tableWrap: { overflowX: 'auto', WebkitOverflowScrolling: 'touch' },
  th: { fontSize: '11px', fontWeight: '500', color: 'var(--text3)', letterSpacing: '0.06em', textTransform: 'uppercase', padding: '0 8px 12px 0', textAlign: 'left', whiteSpace: 'nowrap' },
  td: { padding: '12px 8px 12px 0', borderTop: '1px solid var(--border)', fontSize: '13px', color: 'var(--text)', whiteSpace: 'nowrap', verticalAlign: 'top' },
  pill: { fontSize: '11px', fontWeight: '600', padding: '3px 9px', borderRadius: '999px' },
  btnGreen: { padding: '7px 14px', background: 'var(--green)', border: 'none', borderRadius: '8px', color: '#000', fontSize: '12px', fontWeight: '600', cursor: 'pointer' },
  btnRed: { padding: '7px 14px', background: 'var(--red)', border: 'none', borderRadius: '8px', color: '#fff', fontSize: '12px', fontWeight: '600', cursor: 'pointer' },
  btnGhost: { padding: '7px 14px', background: 'transparent', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text)', fontSize: '12px', fontWeight: '500', cursor: 'pointer' },
  btnDisabled: { opacity: 0.5, cursor: 'not-allowed' },
  empty: { textAlign: 'center', padding: '40px', color: 'var(--text3)', fontSize: '14px' },
  error: { fontSize: '13px', color: 'var(--red)', background: 'var(--red-dim)', padding: '10px 14px', borderRadius: '8px', marginBottom: '16px' },
  ok: { fontSize: '13px', color: 'var(--green)', background: 'var(--green-dim)', padding: '10px 14px', borderRadius: '8px', marginBottom: '16px' },
  filters: { display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' },
  detail: { background: 'var(--bg3)', borderRadius: '8px', padding: '14px 16px', fontSize: '12.5px', color: 'var(--text2)', whiteSpace: 'normal' },
  label: { display: 'block', fontSize: '12px', color: 'var(--text2)', marginBottom: '6px', fontWeight: '500' },
  input: { width: '100%', boxSizing: 'border-box', padding: '10px 12px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text)', fontSize: '13px', outline: 'none', marginBottom: '14px' },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300, padding: '16px' },
  modal: { width: '100%', maxWidth: '460px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '24px' },
  modalTitle: { fontSize: '16px', fontWeight: '700', color: 'var(--text)', marginBottom: '8px' },
  muted: { fontSize: '12px', color: 'var(--text3)' },
  kv: { display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '6px 16px', fontSize: '13px', marginBottom: '14px' },
}

const STATUS_STYLE = {
  pending: { background: 'var(--gold-dim)', color: 'var(--gold)' },
  paid: { background: 'var(--green-dim)', color: 'var(--green)' },
  rejected: { background: 'var(--red-dim)', color: 'var(--red)' },
  sent: { background: 'var(--green-dim)', color: 'var(--green)' },
  failed: { background: 'var(--red-dim)', color: 'var(--red)' },
  uncertain: { background: 'var(--gold-dim)', color: 'var(--gold)' },
}

const FILTERS = ['pending', 'paid', 'rejected', 'all']

function formatUsd(n) {
  return `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatDateTime(v) {
  return v ? new Date(v).toLocaleString() : '—'
}

async function postJson(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  let data = {}
  try { data = await res.json() } catch { /* non-JSON */ }
  if (!res.ok || data.error) {
    const err = new Error(data.error || `Request failed (${res.status})`)
    err.blockers = data.blockers
    throw err
  }
  return data
}

function Pill({ status }) {
  return <span style={{ ...s.pill, ...(STATUS_STYLE[status] || { background: 'var(--bg3)', color: 'var(--text2)' }) }}>{status}</span>
}

function Modal({ title, children, onClose }) {
  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}>
        <div style={s.modalTitle}>{title}</div>
        {children}
      </div>
    </div>
  )
}

function PayDialog({ referral, onClose, onDone }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function confirm() {
    setBusy(true)
    setError('')
    try {
      await postJson('/api/admin/pay-referral', { referralId: referral.id })
      onDone(`Referral #${referral.id} paid.`)
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }
  return (
    <Modal title={`Pay referral #${referral.id}?`} onClose={busy ? undefined : onClose}>
      <div style={s.kv}>
        <span style={s.muted}>Referrer</span><span>{referral.referrer?.full_name || referral.referrer?.email} — {formatUsd(referral.referrer_bonus_usd)}</span>
        <span style={s.muted}>Referred</span><span>{referral.referred?.full_name || referral.referred?.email} — {formatUsd(referral.referred_bonus_usd)}</span>
      </div>
      <p style={{ ...s.muted, marginBottom: '14px' }}>Both wallets are credited in one transaction. This cannot be undone.</p>
      {error && <div style={s.error}>{error}</div>}
      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
        <button style={s.btnGhost} onClick={onClose} disabled={busy}>Cancel</button>
        <button style={{ ...s.btnGreen, ...(busy ? s.btnDisabled : {}) }} onClick={confirm} disabled={busy}>{busy ? 'Paying…' : 'Confirm payment'}</button>
      </div>
    </Modal>
  )
}

function RejectDialog({ referral, onClose, onDone }) {
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit() {
    if (!reason) { setError('Choose a reason.'); return }
    setBusy(true)
    setError('')
    try {
      await postJson('/api/admin/referrals/reject', { referralId: referral.id, reason, privateNote: note })
      onDone(`Referral #${referral.id} rejected.`)
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }
  return (
    <Modal title={`Reject referral #${referral.id}`} onClose={busy ? undefined : onClose}>
      <label style={s.label} htmlFor="reject-reason">Reason shown to both customers</label>
      <select id="reject-reason" style={s.input} value={reason} onChange={e => setReason(e.target.value)}>
        <option value="">Select…</option>
        {REFERRAL_REJECTION_REASONS.map(r => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
      </select>
      {reason && <div style={{ ...s.detail, marginBottom: '14px' }}>Customers will see: “{referralReasonText(reason)}”</div>}
      <label style={s.label} htmlFor="reject-note">Private note (admins only — never shown to customers)</label>
      <textarea id="reject-note" style={{ ...s.input, minHeight: '80px', resize: 'vertical' }} maxLength={2000} value={note} onChange={e => setNote(e.target.value)} />
      {error && <div style={s.error}>{error}</div>}
      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
        <button style={s.btnGhost} onClick={onClose} disabled={busy}>Cancel</button>
        <button style={{ ...s.btnRed, ...(busy ? s.btnDisabled : {}) }} onClick={submit} disabled={busy}>{busy ? 'Rejecting…' : 'Reject referral'}</button>
      </div>
    </Modal>
  )
}

function RetryDialog({ delivery, onClose, onDone }) {
  const [note, setNote] = useState('')
  const [evidence, setEvidence] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const needsEvidence = delivery.status === 'uncertain'
  async function submit() {
    if (!note.trim()) { setError('A note is required.'); return }
    if (needsEvidence && !evidence.trim()) { setError('Provider evidence that the email was not delivered is required.'); return }
    setBusy(true)
    setError('')
    try {
      await postJson('/api/admin/referrals/notifications/retry', { deliveryId: delivery.id, note, providerEvidence: evidence })
      onDone('Email queued for retry.')
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }
  return (
    <Modal title={`Retry “${delivery.event_type}” email`} onClose={busy ? undefined : onClose}>
      <p style={{ ...s.muted, marginBottom: '14px' }}>
        Status: {delivery.status}{delivery.failure_code ? ` (${delivery.failure_code})` : ''}, {delivery.attempt_count} attempt(s).
        {needsEvidence && ' The provider may already have delivered this email. Check the provider dashboard first and record what you found.'}
      </p>
      <label style={s.label} htmlFor="retry-note">Reason for retry</label>
      <input id="retry-note" style={s.input} maxLength={500} value={note} onChange={e => setNote(e.target.value)} />
      {needsEvidence && (
        <>
          <label style={s.label} htmlFor="retry-evidence">Provider evidence (not delivered)</label>
          <textarea id="retry-evidence" style={{ ...s.input, minHeight: '70px', resize: 'vertical' }} maxLength={1000} value={evidence} onChange={e => setEvidence(e.target.value)} />
        </>
      )}
      {error && <div style={s.error}>{error}</div>}
      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
        <button style={s.btnGhost} onClick={onClose} disabled={busy}>Cancel</button>
        <button style={{ ...s.btnGreen, ...(busy ? s.btnDisabled : {}) }} onClick={submit} disabled={busy}>{busy ? 'Saving…' : 'Retry email'}</button>
      </div>
    </Modal>
  )
}

function ReviewDetail({ referral, notes, deliveries, onRetry }) {
  return (
    <div style={s.detail}>
      {referral.status === 'rejected' && (
        <div style={{ marginBottom: '10px' }}>
          <strong>Public reason:</strong> {referralReasonText(referral.rejection_reason)}
          <span style={s.muted}> · reviewed {formatDateTime(referral.reviewed_at)}</span>
        </div>
      )}
      {referral.status === 'paid' && (
        <div style={{ marginBottom: '10px' }}><strong>Paid:</strong> {formatDateTime(referral.paid_at)}</div>
      )}
      <div style={{ marginBottom: '10px' }}>
        <strong>Private notes</strong> <span style={s.muted}>(admins only)</span>
        {notes.length === 0 ? <div style={s.muted}>None.</div> : notes.map((n, i) => (
          <div key={i} style={{ marginTop: '4px' }}>{n.note} <span style={s.muted}>— {formatDateTime(n.created_at)}</span></div>
        ))}
      </div>
      <div>
        <strong>Emails</strong>
        {deliveries.length === 0 ? <div style={s.muted}>None queued.</div> : (
          <table style={{ borderCollapse: 'collapse', marginTop: '6px' }}>
            <tbody>
              {deliveries.map(d => (
                <tr key={d.id}>
                  <td style={{ padding: '3px 12px 3px 0' }}>{d.event_type}</td>
                  <td style={{ padding: '3px 12px 3px 0' }}><Pill status={d.status} /></td>
                  <td style={{ padding: '3px 12px 3px 0', ...s.muted }}>{d.failure_code || ''} {d.attempt_count ? `· ${d.attempt_count} attempt(s)` : ''}</td>
                  <td style={{ padding: '3px 0' }}>
                    {(d.status === 'failed' || d.status === 'uncertain') && <button style={s.btnGhost} onClick={() => onRetry(d)}>Retry…</button>}
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

function CampaignPanel() {
  const [preview, setPreview] = useState(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [confirmText, setConfirmText] = useState('')
  const [batchSize, setBatchSize] = useState(10)

  async function loadPreview() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/admin/referrals/campaign', { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Preview failed')
      setPreview(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function act(body, message) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const data = await postJson('/api/admin/referrals/campaign', body)
      const r = data.result
      setNotice(r ? `${message}: ${r.status}, sent ${r.sent ?? 0}, failed ${r.failed ?? 0}, uncertain ${r.uncertain ?? 0}, not claimed (paused, no consent or already taken) ${r.notClaimed ?? 0}.` : message)
      setConfirmText('')
      await loadPreview()
    } catch (err) {
      setError(err.blockers?.length ? `${err.message}: ${err.blockers.join('; ')}` : err.message)
    } finally {
      setBusy(false)
    }
  }

  const blocked = preview && !preview.gate.allowed
  const queued = preview?.campaign.queued
  const paused = preview?.campaign.paused

  return (
    <div style={s.card}>
      <div style={s.cardTitle}>Referral launch campaign (promotional email)</div>
      <p style={{ ...s.muted, marginBottom: '14px' }}>
        Sent only to verified customers who explicitly opted in to promotional emails. Consent and the pause switch are re-checked for every email at send time.
      </p>
      {error && <div style={s.error}>{error}</div>}
      {notice && <div style={s.ok}>{notice}</div>}
      <button style={{ ...s.btnGhost, marginBottom: '14px' }} onClick={loadPreview} disabled={loading}>{loading ? 'Loading…' : preview ? 'Refresh dry run' : 'Dry run preview'}</button>

      {preview && (
        <>
          <div style={s.kv}>
            <span style={s.muted}>Gate</span>
            <span style={{ color: blocked ? 'var(--red)' : 'var(--green)' }}>{blocked ? 'Blocked' : 'Open'}</span>
            {blocked && (<><span style={s.muted}>Blockers</span><span>{preview.gate.blockers.join('; ')}</span></>)}
            <span style={s.muted}>Programme</span>
            <span>{preview.programme ? `${preview.programme.enabled ? 'enabled' : 'disabled'} · referrer ${formatUsd(preview.programme.referrerBonusUsd)} · referred ${formatUsd(preview.programme.referredBonusUsd)}` : 'settings unavailable'}</span>
            <span style={s.muted}>Eligible now</span>
            <span>{preview.eligibleRecipients} customer(s){preview.sampleRecipients.length ? ` — e.g. ${preview.sampleRecipients.join(', ')}` : ''}</span>
            <span style={s.muted}>Campaign</span>
            <span>{queued ? (paused ? 'queued · paused' : 'queued · running') : 'not queued'}</span>
            <span style={s.muted}>Emails</span>
            <span>{Object.entries(preview.deliveries).map(([k, v]) => `${k} ${v}`).join(' · ')}</span>
          </div>

          {!queued && (
            <div style={{ marginBottom: '10px' }}>
              <label style={s.label} htmlFor="campaign-confirm">Type <code>{preview.enqueueConfirmation}</code> to queue (it starts paused)</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input id="campaign-confirm" style={{ ...s.input, marginBottom: 0 }} value={confirmText} onChange={e => setConfirmText(e.target.value)} disabled={blocked} />
                <button
                  style={{ ...s.btnGreen, ...(blocked || busy || confirmText !== preview.enqueueConfirmation ? s.btnDisabled : {}) }}
                  disabled={blocked || busy || confirmText !== preview.enqueueConfirmation}
                  onClick={() => act({ action: 'enqueue', confirm: confirmText }, 'Campaign queued (paused)')}
                >Queue</button>
              </div>
            </div>
          )}

          {queued && (
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
              {paused
                ? <button style={{ ...s.btnGhost, ...(blocked || busy ? s.btnDisabled : {}) }} disabled={blocked || busy} onClick={() => act({ action: 'resume' }, 'Campaign resumed')}>Resume</button>
                : <button style={{ ...s.btnRed, ...(busy ? s.btnDisabled : {}) }} disabled={busy} onClick={() => act({ action: 'pause' }, 'Campaign paused')}>Pause</button>}
              <label style={{ ...s.muted, display: 'flex', alignItems: 'center', gap: '6px' }}>
                Batch size
                <input type="number" min={1} max={preview.maxBatchSize} value={batchSize} onChange={e => setBatchSize(e.target.value)} style={{ ...s.input, width: '80px', marginBottom: 0 }} />
              </label>
              <button
                style={{ ...s.btnGreen, ...(blocked || busy || paused ? s.btnDisabled : {}) }}
                disabled={blocked || busy || paused}
                onClick={() => act({ action: 'send-batch', batchSize: Number(batchSize) }, 'Batch finished')}
              >Send one batch</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// Payouts need BOTH switches on: REFERRAL_PAYOUTS_ENABLED in this
// deployment and the database switch (only an operator can change it, with
// an audit entry). The server refuses payments either way; this only
// explains why the Pay button is unavailable.
function PayoutStatus({ status }) {
  if (!status) return null
  if (status.enabled) return <div style={{ ...s.ok, marginBottom: '16px' }}>Referral payouts are enabled.</div>
  const why = []
  if (!status.application) why.push('this deployment has REFERRAL_PAYOUTS_ENABLED turned off')
  if (status.database === false) why.push('the database payout switch is off')
  if (status.database === null) why.push('the database payout switch could not be read')
  return (
    <div style={{ ...s.error, marginBottom: '16px' }}>
      Referral payouts are frozen{why.length ? ` (${why.join('; ')})` : ''}. You can still review and reject referrals; nothing can be paid.
    </div>
  )
}

function AttentionPanel({ items, onRetry }) {
  if (!items || (items.attributionErrors.length === 0 && items.deliveries.length === 0)) return null
  return (
    <div style={s.card}>
      <div style={s.cardTitle}>Needs attention</div>
      {items.attributionErrors.length > 0 && (
        <>
          <p style={s.muted}>Signups whose referral code could not be processed (no referral was created). Investigate before attributing anything manually.</p>
          <div style={s.tableWrap}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>{['Account', 'Error code', 'Signed up', 'Processed'].map(h => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
              <tbody>
                {items.attributionErrors.map(i => (
                  <tr key={i.user_id}>
                    <td style={{ ...s.td, fontFamily: 'monospace' }}>{i.user_id}</td>
                    <td style={s.td}>{i.error_sqlstate || '—'}</td>
                    <td style={s.td}>{formatDateTime(i.captured_at)}</td>
                    <td style={s.td}>{formatDateTime(i.processed_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {items.deliveries.length > 0 && (
        <>
          <p style={{ ...s.muted, marginTop: '12px' }}>Admin alert emails that failed or may not have been delivered.</p>
          <div style={s.tableWrap}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>{['Email', 'Status', 'Code', 'Attempts', 'Updated', ''].map(h => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
              <tbody>
                {items.deliveries.map(d => (
                  <tr key={d.id}>
                    <td style={s.td}>{d.event_type}</td>
                    <td style={s.td}><Pill status={d.status} /></td>
                    <td style={s.td}>{d.failure_code || '—'}</td>
                    <td style={s.td}>{d.attempt_count}</td>
                    <td style={s.td}>{formatDateTime(d.updated_at)}</td>
                    <td style={s.td}><button style={s.btnGhost} onClick={() => onRetry(d)}>Retry…</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

export default function AdminReferralsPage() {
  const [referrals, setReferrals] = useState([])
  const [details, setDetails] = useState({ notes: [], deliveries: [] })
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('pending')
  const [expanded, setExpanded] = useState(null)
  const [dialog, setDialog] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [payout, setPayout] = useState(null)
  const [attentionItems, setAttentionItems] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    fetch('/api/admin/pay-referral', { cache: 'no-store' })
      .then(res => (res.ok ? res.json() : null))
      .then(setPayout)
      .catch(() => setPayout({ enabled: false, application: false, database: null }))
    getReferralAttentionItems().then(setAttentionItems).catch(() => setAttentionItems(null))
    try {
      const rows = await getAllReferralsAdmin()
      setReferrals(rows)
      setDetails(await getReferralReviewDetails(rows.map(r => r.id)))
    } catch (err) {
      setError(err.message || 'Failed to load referrals')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  function done(message) {
    setDialog(null)
    setNotice(message)
    setError('')
    load()
  }

  const counts = Object.fromEntries(FILTERS.map(f => [f, f === 'all' ? referrals.length : referrals.filter(r => r.status === f).length]))
  const visible = filter === 'all' ? referrals : referrals.filter(r => r.status === filter)
  const attention = details.deliveries.filter(d => d.status === 'failed' || d.status === 'uncertain').length

  return (
    <div style={s.page}>
      <h1 style={s.title}>Referrals</h1>
      <p style={s.sub}>
        {counts.pending} awaiting review{attention ? ` · ${attention} email(s) need attention` : ''}
      </p>

      <PayoutStatus status={payout} />
      {error && <div style={s.error}>{error}</div>}
      {notice && <div style={s.ok}>{notice}</div>}

      <div style={s.card}>
        <div style={s.filters}>
          {FILTERS.map(f => (
            <button key={f} style={filter === f ? s.btnGreen : s.btnGhost} onClick={() => setFilter(f)}>
              {f} ({counts[f]})
            </button>
          ))}
        </div>
        {loading ? (
          <div style={s.empty}>Loading…</div>
        ) : visible.length === 0 ? (
          <div style={s.empty}>No {filter === 'all' ? '' : filter} referrals.</div>
        ) : (
          <div style={s.tableWrap}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '760px' }}>
              <thead>
                <tr>{['#', 'Referrer', 'Referred', 'Referrer bonus', 'Referred bonus', 'Status', 'Created', ''].map(h => <th key={h} style={s.th}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {visible.map(r => {
                  const rowDeliveries = details.deliveries.filter(d => d.referral_id === r.id)
                  const rowNotes = details.notes.filter(n => n.referral_id === r.id)
                  const flagged = rowDeliveries.some(d => d.status === 'failed' || d.status === 'uncertain')
                  return [
                    <tr key={r.id}>
                      <td style={{ ...s.td, color: 'var(--text3)' }}>{r.id}</td>
                      <td style={s.td}>{r.referrer?.full_name || r.referrer?.email}</td>
                      <td style={s.td}>{r.referred?.full_name || r.referred?.email}</td>
                      <td style={s.td}>{formatUsd(r.referrer_bonus_usd)}</td>
                      <td style={s.td}>{formatUsd(r.referred_bonus_usd)}</td>
                      <td style={s.td}><Pill status={r.status} />{flagged && <span title="Email needs attention" style={{ marginLeft: '6px', color: 'var(--red)' }}>●</span>}</td>
                      <td style={{ ...s.td, color: 'var(--text3)' }}>{new Date(r.created_at).toLocaleDateString()}</td>
                      <td style={{ ...s.td, display: 'flex', gap: '6px' }}>
                        {r.status === 'pending' && (
                          <>
                            <button style={{ ...s.btnGreen, ...(payout?.enabled ? {} : s.btnDisabled) }} disabled={!payout?.enabled}
                              title={payout?.enabled ? undefined : 'Referral payouts are frozen'}
                              onClick={() => setDialog({ type: 'pay', referral: r })}>Pay…</button>
                            <button style={s.btnRed} onClick={() => setDialog({ type: 'reject', referral: r })}>Reject…</button>
                          </>
                        )}
                        <button style={s.btnGhost} onClick={() => setExpanded(expanded === r.id ? null : r.id)} aria-expanded={expanded === r.id}>
                          {expanded === r.id ? 'Hide' : 'Details'}
                        </button>
                      </td>
                    </tr>,
                    expanded === r.id && (
                      <tr key={`${r.id}-detail`}>
                        <td colSpan={8} style={{ padding: '0 0 12px 0' }}>
                          <ReviewDetail referral={r} notes={rowNotes} deliveries={rowDeliveries} onRetry={d => setDialog({ type: 'retry', delivery: d })} />
                        </td>
                      </tr>
                    ),
                  ]
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <AttentionPanel items={attentionItems} onRetry={d => setDialog({ type: 'retry', delivery: d })} />

      <CampaignPanel />

      {dialog?.type === 'pay' && <PayDialog referral={dialog.referral} onClose={() => setDialog(null)} onDone={done} />}
      {dialog?.type === 'reject' && <RejectDialog referral={dialog.referral} onClose={() => setDialog(null)} onDone={done} />}
      {dialog?.type === 'retry' && <RetryDialog delivery={dialog.delivery} onClose={() => setDialog(null)} onDone={done} />}
    </div>
  )
}
