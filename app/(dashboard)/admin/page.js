"use client";

import { useState, useEffect, Fragment } from 'react'
import { useUser } from '@/contexts/UserContext'
import { createTransaction, getSettings, getLinkedBankAccounts } from '@/lib/queries'

const s = {
  page: { padding: '32px 36px' },
  title: { fontSize: '26px', fontWeight: '700', color: 'var(--text)', marginBottom: '4px' },
  sub: { fontSize: '14px', color: 'var(--text2)', marginBottom: '28px' },
  row: { display: 'flex', gap: '16px', marginBottom: '20px' },
  stat: { flex: 1, background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '20px 24px' },
  statLabel: { fontSize: '11px', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' },
  statValue: { fontSize: '24px', fontWeight: '700', color: 'var(--text)' },
  card: { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '24px', marginBottom: '20px' },
  cardTitle: { fontSize: '15px', fontWeight: '600', color: 'var(--text)', marginBottom: '20px' },
  tabs: { display: 'flex', gap: '8px', marginBottom: '20px' },
  tab: { padding: '8px 16px', borderRadius: '999px', fontSize: '13px', fontWeight: '500', cursor: 'pointer', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text2)' },
  tabActive: { background: 'var(--green)', color: '#000', borderColor: 'var(--green)' },
  th: { fontSize: '11px', fontWeight: '500', color: 'var(--text3)', letterSpacing: '0.06em', textTransform: 'uppercase', padding: '0 0 14px 0', textAlign: 'left' },
  td: { padding: '13px 0', borderTop: '1px solid var(--border)', fontSize: '13px', color: 'var(--text)' },
  btnSmall: { fontSize: '12px', padding: '6px 14px', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '600' },
  empty: { textAlign: 'center', padding: '40px', color: 'var(--text3)', fontSize: '14px' },
  modalOverlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300 },
  modal: { width: '380px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '24px' },
  modalTitle: { fontSize: '16px', fontWeight: '700', color: 'var(--text)', marginBottom: '4px' },
  modalSub: { fontSize: '13px', color: 'var(--text3)', marginBottom: '20px' },
  toggleGroup: { display: 'flex', gap: '8px', marginBottom: '16px' },
  toggleBtn: { flex: 1, padding: '10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text2)', fontSize: '13px', fontWeight: '600', cursor: 'pointer' },
  toggleBtnActiveCredit: { background: 'var(--green-dim)', borderColor: 'var(--green)', color: 'var(--green)' },
  toggleBtnActiveDebit: { background: 'var(--red-dim)', borderColor: 'var(--red)', color: 'var(--red)' },
  label: { display: 'block', fontSize: '13px', color: 'var(--text2)', marginBottom: '6px', fontWeight: '500' },
  input: { width: '100%', padding: '11px 14px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontSize: '14px', outline: 'none', marginBottom: '16px' },
  textarea: { width: '100%', padding: '11px 14px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontSize: '14px', outline: 'none', marginBottom: '16px', minHeight: '70px', resize: 'vertical', fontFamily: 'inherit' },
  modalActions: { display: 'flex', gap: '10px', marginTop: '4px' },
  btnGreen: { flex: 1, padding: '12px', background: 'var(--green)', border: 'none', borderRadius: 'var(--radius-sm)', color: '#000', fontSize: '14px', fontWeight: '600', cursor: 'pointer' },
  btnRed: { flex: 1, padding: '12px', background: 'var(--red)', border: 'none', borderRadius: 'var(--radius-sm)', color: '#fff', fontSize: '14px', fontWeight: '600', cursor: 'pointer' },
  btnGhost: { flex: 1, padding: '12px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text2)', fontSize: '14px', fontWeight: '500', cursor: 'pointer' },
  btnDisabled: { opacity: 0.5, cursor: 'not-allowed' },
  modalError: { fontSize: '13px', color: 'var(--red)', background: 'var(--red-dim)', padding: '10px 14px', borderRadius: 'var(--radius-sm)', marginBottom: '16px' },
  // New: verification panel shown inline under a pending row
  verifyBox: { marginTop: '10px', marginBottom: '4px', padding: '14px 16px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: '10px' },
  verifyGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 20px', marginBottom: '10px' },
  verifyLabel: { fontSize: '11px', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '2px' },
  verifyValue: { fontSize: '13px', color: 'var(--text)', fontFamily: 'monospace' },
  pill: { display: 'inline-block', fontSize: '11px', fontWeight: '600', padding: '3px 10px', borderRadius: '999px', marginTop: '8px' },
  pillGood: { background: 'var(--green-dim)', color: 'var(--green)' },
  pillBad: { background: 'var(--red-dim)', color: 'var(--red)' },
  checkBtn: { fontSize: '12px', padding: '6px 14px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text2)', borderRadius: '6px', cursor: 'pointer', marginRight: '8px' },
  checkBtnPrimary: { fontSize: '12px', padding: '6px 14px', border: '1px solid var(--blue)', background: 'var(--blue-dim)', color: 'var(--blue)', borderRadius: '6px', cursor: 'pointer', marginRight: '8px', fontWeight: '600' },
  reasonPreview: { fontSize: '11px', color: 'var(--text3)', marginTop: '2px', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
}

function formatUsd(n) {
  return `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// Renders the real blockchain result next to the user's claim, so the admin
// is confirming something already checked — not just trusting the form input.
function VerificationPanel({ txn, onCheck, checking }) {
  const result = txn.onchain_verification

  if (!txn.crypto_currency || !txn.tx_hash) {
    return null // nothing on-chain to check (e.g. admin_credit, withdrawal)
  }

  if (!result) {
    return (
      <div style={s.verifyBox}>
        <div style={{ fontSize: '13px', color: 'var(--text3)', marginBottom: '10px' }}>
          Not yet checked against the blockchain.
        </div>
        <button style={s.checkBtnPrimary} disabled={checking} onClick={onCheck}>
          {checking ? 'Checking…' : 'Check blockchain'}
        </button>
      </div>
    )
  }

  if (!result.found) {
    return (
      <div style={s.verifyBox}>
        <div style={{ ...s.pill, ...s.pillBad }}>Not found on-chain</div>
        <div style={{ fontSize: '13px', color: 'var(--text2)', marginTop: '8px' }}>
          {result.reason || 'Could not locate this transaction hash.'}
        </div>
        <div style={{ marginTop: '10px' }}>
          <button style={s.checkBtn} disabled={checking} onClick={onCheck}>
            {checking ? 'Checking…' : 'Recheck blockchain'}
          </button>
        </div>
      </div>
    )
  }

  const isClean = result.succeeded && result.matchesAddress && result.amountMatches && result.confirmed

  return (
    <div style={s.verifyBox}>
      <div style={s.verifyGrid}>
        <div>
          <div style={s.verifyLabel}>User claimed</div>
          <div style={s.verifyValue}>{txn.crypto_amount} {txn.crypto_currency}</div>
        </div>
        <div>
          <div style={s.verifyLabel}>On-chain amount</div>
          <div style={s.verifyValue}>{result.amount ?? '—'} {txn.crypto_currency}</div>
        </div>
        <div>
          <div style={s.verifyLabel}>Address match</div>
          <div style={s.verifyValue}>{result.matchesAddress ? 'Yes' : 'No — mismatch'}</div>
        </div>
        <div>
          <div style={s.verifyLabel}>Confirmations</div>
          <div style={s.verifyValue}>{result.confirmations ?? 0}</div>
        </div>
      </div>
      <div style={{ ...s.pill, ...(isClean ? s.pillGood : s.pillBad) }}>
        {isClean ? 'Verified on-chain — matches claim' : 'Does not match — review before approving'}
      </div>
      <div style={{ marginTop: '10px' }}>
        <button style={s.checkBtn} disabled={checking} onClick={onCheck}>
          {checking ? 'Checking…' : 'Recheck blockchain'}
        </button>
      </div>
    </div>
  )
}

// Asks for a reason before rejecting — required, same philosophy as
// the "Adjust wallet" modal: a rejection with no explanation isn't
// useful to the user OR to your own audit trail.
function RejectModal({ txn, onClose, onConfirm, submitting, error }) {
  const [reason, setReason] = useState('')

  return (
    <div style={s.modalOverlay} onClick={onClose}>
      <div style={s.modal} onClick={e => e.stopPropagation()}>
        <div style={s.modalTitle}>Reject transaction</div>
        <div style={s.modalSub}>
          {formatUsd(txn.amount_usd)} {txn.type} from {txn.profiles?.full_name || txn.profiles?.email || 'this user'}
        </div>

        {error && <div style={s.modalError}>{error}</div>}

        <label style={s.label}>Reason (shown to the user)</label>
        <textarea
          style={s.textarea}
          placeholder="e.g. Transaction hash could not be verified on-chain"
          value={reason}
          onChange={e => setReason(e.target.value)}
          autoFocus
        />

        <div style={s.modalActions}>
          <button style={s.btnGhost} onClick={onClose}>Cancel</button>
          <button
            style={{ ...s.btnRed, ...(submitting ? s.btnDisabled : {}) }}
            disabled={submitting}
            onClick={() => onConfirm(reason)}
          >
            {submitting ? 'Rejecting…' : 'Reject with reason'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Lets an admin go back and add/edit the reason on a transaction
// that's already rejected — e.g. it was rejected quickly and now
// needs a clearer explanation for the user.
function EditReasonModal({ txn, onClose, onConfirm, submitting, error }) {
  const [reason, setReason] = useState(txn.admin_note || '')

  return (
    <div style={s.modalOverlay} onClick={onClose}>
      <div style={s.modal} onClick={e => e.stopPropagation()}>
        <div style={s.modalTitle}>Edit rejection reason</div>
        <div style={s.modalSub}>
          {formatUsd(txn.amount_usd)} {txn.type} from {txn.profiles?.full_name || txn.profiles?.email || 'this user'}
        </div>

        {error && <div style={s.modalError}>{error}</div>}

        <label style={s.label}>Reason (shown to the user)</label>
        <textarea
          style={s.textarea}
          value={reason}
          onChange={e => setReason(e.target.value)}
          autoFocus
        />

        <div style={s.modalActions}>
          <button style={s.btnGhost} onClick={onClose}>Cancel</button>
          <button
            style={{ ...s.btnGreen, ...(submitting ? s.btnDisabled : {}) }}
            disabled={submitting}
            onClick={() => onConfirm(reason)}
          >
            {submitting ? 'Saving…' : 'Save reason'}
          </button>
        </div>
      </div>
    </div>
  )
}

function AdjustWalletModal({ user, onClose, onSuccess }) {
  const [type, setType] = useState('credit')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit() {
    setError('')
    if (!amount || Number(amount) <= 0) {
      setError('Enter a valid amount.')
      return
    }
    if (!reason.trim()) {
      setError('A reason is required.')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/admin/adjust-wallet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, type, amount: Number(amount), reason: reason.trim() }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      onSuccess()
    } catch (err) {
      setError(err.message || 'Failed to adjust wallet')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={s.modalOverlay} onClick={onClose}>
      <div style={s.modal} onClick={e => e.stopPropagation()}>
        <div style={s.modalTitle}>Adjust wallet</div>
        <div style={s.modalSub}>{user.full_name || user.email} · Current balance: {formatUsd(user.balance_usd)}</div>

        {error && <div style={s.modalError}>{error}</div>}

        <div style={s.toggleGroup}>
          <button
            style={{ ...s.toggleBtn, ...(type === 'credit' ? s.toggleBtnActiveCredit : {}) }}
            onClick={() => setType('credit')}
          >
            + Credit
          </button>
          <button
            style={{ ...s.toggleBtn, ...(type === 'debit' ? s.toggleBtnActiveDebit : {}) }}
            onClick={() => setType('debit')}
          >
            − Debit
          </button>
        </div>

        <label style={s.label}>Amount (USD)</label>
        <input style={s.input} type="number" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)} />

        <label style={s.label}>Reason (required)</label>
        <textarea
          style={s.textarea}
          placeholder="e.g. Promotional bonus, fee correction, chargeback…"
          value={reason}
          onChange={e => setReason(e.target.value)}
        />

        <div style={s.modalActions}>
          <button style={s.btnGhost} onClick={onClose}>Cancel</button>
          <button
            style={{ ...s.btnGreen, ...(submitting ? s.btnDisabled : {}) }}
            disabled={submitting}
            onClick={handleSubmit}
          >
            {submitting ? 'Saving…' : `${type === 'credit' ? 'Credit' : 'Debit'} account`}
          </button>
        </div>
      </div>
    </div>
  )
}

function TopInvestorsCard() {
  const [investors, setInvestors] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/admin/top-investors')
      .then(r => r.json())
      .then(data => setInvestors(data.investors || []))
      .catch(err => console.error('Failed to load top investors:', err))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div style={s.card}>
      <div style={s.cardTitle}>Top investors this month</div>
      {loading ? (
        <div style={s.empty}>Loading…</div>
      ) : investors.length === 0 ? (
        <div style={s.empty}>No verified deposits this month yet.</div>
      ) : (
        <div className="responsive-table-wrap">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Rank', 'Name', 'Email', 'Invested this month'].map(h => (
                  <th key={h} style={s.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {investors.map((inv, i) => (
                <tr key={inv.userId}>
                  <td style={s.td}>#{i + 1}</td>
                  <td style={{ ...s.td, fontWeight: '500' }}>{inv.fullName || '—'}</td>
                  <td style={{ ...s.td, color: 'var(--text2)' }}>{inv.email}</td>
                  <td style={{ ...s.td, fontWeight: '600' }}>{formatUsd(inv.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function AdminPanel() {
  const [tab, setTab] = useState('pending')
  const [users, setUsers] = useState([])
  const [transactions, setTransactions] = useState([])
  const [loading, setLoading] = useState(true)
  const [actingOn, setActingOn] = useState(null)
  const [checkingOn, setCheckingOn] = useState(null)
  const [error, setError] = useState('')
  const [adjustingUser, setAdjustingUser] = useState(null)
  const [rejectingTxn, setRejectingTxn] = useState(null)
  const [editingReasonTxn, setEditingReasonTxn] = useState(null)
  const [modalSubmitting, setModalSubmitting] = useState(false)
  const [modalError, setModalError] = useState('')

  async function loadData() {
    setLoading(true)
    setError('')
    try {
      const [usersRes, txnsRes] = await Promise.all([
        fetch('/api/admin/users').then(r => r.json()),
        fetch('/api/admin/transactions').then(r => r.json()),
      ])
      if (usersRes.error) throw new Error(usersRes.error)
      if (txnsRes.error) throw new Error(txnsRes.error)
      setUsers(usersRes.users || [])
      setTransactions(txnsRes.transactions || [])
    } catch (err) {
      setError(err.message || 'Failed to load admin data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [])

  async function handleAction(transactionId, action, options = {}) {
    setActingOn(transactionId)
    setError('')
    try {
      const res = await fetch('/api/admin/verify-transaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionId, action, ...options }),
      })
      const data = await res.json()

      // 409 means blockchain verification failed and wasn't overridden —
      // reload so the admin sees the on-chain comparison, instead of
      // just a generic error toast.
      if (res.status === 409) {
        setError(data.error || 'Blockchain verification did not pass.')
        await loadData()
        return
      }

      if (data.error) throw new Error(data.error)
      await loadData()
    } catch (err) {
      setError(err.message || 'Action failed')
    } finally {
      setActingOn(null)
    }
  }

  async function handleCheck(transactionId) {
    setCheckingOn(transactionId)
    setError('')
    try {
      const res = await fetch('/api/admin/verify-transaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionId, action: 'check' }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      await loadData()
    } catch (err) {
      setError(err.message || 'Blockchain check failed')
    } finally {
      setCheckingOn(null)
    }
  }

  async function handleConfirmReject(reason) {
    if (!reason.trim()) {
      setModalError('A reason is required.')
      return
    }
    setModalSubmitting(true)
    setModalError('')
    try {
      const res = await fetch('/api/admin/verify-transaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionId: rejectingTxn.id, action: 'reject', adminNote: reason.trim() }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setRejectingTxn(null)
      await loadData()
    } catch (err) {
      setModalError(err.message || 'Failed to reject transaction')
    } finally {
      setModalSubmitting(false)
    }
  }

  async function handleConfirmEditReason(reason) {
    if (!reason.trim()) {
      setModalError('A reason is required.')
      return
    }
    setModalSubmitting(true)
    setModalError('')
    try {
      const res = await fetch('/api/admin/update-transaction-note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionId: editingReasonTxn.id, note: reason.trim() }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setEditingReasonTxn(null)
      await loadData()
    } catch (err) {
      setModalError(err.message || 'Failed to update reason')
    } finally {
      setModalSubmitting(false)
    }
  }

  const pending = transactions.filter(t => t.status === 'pending')
  const totalAum = users.reduce((sum, u) => sum + Number(u.balance_usd), 0)
  const displayedTxns = tab === 'pending' ? pending : transactions

  return (
    <div style={s.page}>
      <h1 style={s.title}>Admin panel</h1>
      <p style={s.sub}>Real users, real balances, real verification</p>

      {error && (
        <div style={{ fontSize: '13px', color: 'var(--red)', background: 'var(--red-dim)', padding: '10px 14px', borderRadius: '8px', marginBottom: '16px' }}>
          {error}
        </div>
      )}

      <div className="responsive-stats" style={s.row}>
        <div style={s.stat}><div style={s.statLabel}>Total users</div><div style={s.statValue}>{loading ? '—' : users.length}</div></div>
        <div style={s.stat}><div style={s.statLabel}>Total AUM</div><div style={s.statValue}>{loading ? '—' : formatUsd(totalAum)}</div></div>
        <div style={s.stat}><div style={s.statLabel}>Pending review</div><div style={s.statValue}>{loading ? '—' : pending.length}</div></div>
      </div>

      <div style={s.card}>
        <div style={s.cardTitle}>Transactions</div>
        <div style={s.tabs}>
          <button style={{ ...s.tab, ...(tab === 'pending' ? s.tabActive : {}) }} onClick={() => setTab('pending')}>
            Pending ({pending.length})
          </button>
          <button style={{ ...s.tab, ...(tab === 'all' ? s.tabActive : {}) }} onClick={() => setTab('all')}>
            All ({transactions.length})
          </button>
        </div>

        {loading ? (
          <div style={s.empty}>Loading…</div>
        ) : displayedTxns.length === 0 ? (
          <div style={s.empty}>{tab === 'pending' ? 'Nothing pending — all caught up.' : 'No transactions yet.'}</div>
        ) : (
          <div className="responsive-table-wrap">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['User', 'Type', 'Amount', 'Crypto', 'Tx Hash', 'Status', 'Date', 'Action'].map(h => (
                  <th key={h} style={s.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayedTxns.map(tx => (
                <Fragment key={tx.id}>
                  <tr>
                    <td style={s.td}>
                      <div style={{ fontWeight: '500' }}>{tx.profiles?.full_name || '—'}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text3)' }}>{tx.profiles?.email}</div>
                    </td>
                    <td style={s.td}>{tx.type}</td>
                    <td style={{ ...s.td, fontWeight: '600' }}>{formatUsd(tx.amount_usd)}</td>
                    <td style={s.td}>{tx.crypto_amount ? `${tx.crypto_amount} ${tx.crypto_currency}` : '—'}</td>
                    <td style={{ ...s.td, fontFamily: 'monospace', fontSize: '11px', maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {tx.tx_hash || '—'}
                    </td>
                    <td style={s.td}>
                      <span style={{
                        fontSize: '11px', fontWeight: '600', padding: '3px 9px', borderRadius: '999px',
                        background: tx.status === 'verified' ? 'var(--green-dim)' : tx.status === 'rejected' ? 'var(--red-dim)' : 'var(--gold-dim)',
                        color: tx.status === 'verified' ? 'var(--green)' : tx.status === 'rejected' ? 'var(--red)' : 'var(--gold)',
                      }}>
                        {tx.status}
                      </span>
                      {tx.status === 'rejected' && tx.admin_note && (
                        <div style={s.reasonPreview} title={tx.admin_note}>{tx.admin_note}</div>
                      )}
                    </td>
                    <td style={{ ...s.td, color: 'var(--text3)' }}>{new Date(tx.created_at).toLocaleDateString()}</td>
                    <td style={s.td}>
                      {tx.status === 'pending' ? (
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button
                            style={{
                              ...s.btnSmall,
                              background: 'var(--green)',
                              color: '#000',
                              ...((tx.crypto_currency && tx.tx_hash && !tx.onchain_verification) ? { opacity: 0.4, cursor: 'not-allowed' } : {}),
                            }}
                            disabled={actingOn === tx.id || (tx.crypto_currency && tx.tx_hash && !tx.onchain_verification)}
                            title={(tx.crypto_currency && tx.tx_hash && !tx.onchain_verification) ? 'Check the blockchain before approving' : undefined}
                            onClick={() => handleAction(tx.id, 'verify')}
                          >
                            {actingOn === tx.id ? '…' : 'Verify'}
                          </button>
                          <button
                            style={{ ...s.btnSmall, background: 'var(--red)', color: '#fff' }}
                            disabled={actingOn === tx.id}
                            onClick={() => { setModalError(''); setRejectingTxn(tx) }}
                          >
                            Reject
                          </button>
                        </div>
                      ) : tx.status === 'rejected' ? (
                        <button
                          style={{ ...s.btnSmall, background: 'var(--bg4)', color: 'var(--text2)' }}
                          onClick={() => { setModalError(''); setEditingReasonTxn(tx) }}
                        >
                          {tx.admin_note ? 'Edit reason' : 'Add reason'}
                        </button>
                      ) : (
                        <span style={{ color: 'var(--text3)', fontSize: '12px' }}>—</span>
                      )}
                    </td>
                  </tr>

                  {tx.status === 'pending' && tx.crypto_currency && tx.tx_hash && (
                    <tr>
                      <td colSpan={8} style={{ padding: '0 0 4px 0', borderTop: 'none' }}>
                        <VerificationPanel
                          txn={tx}
                          onCheck={() => handleCheck(tx.id)}
                          checking={checkingOn === tx.id}
                        />
                        {tx.onchain_verification && !(
                          tx.onchain_verification.succeeded &&
                          tx.onchain_verification.matchesAddress &&
                          tx.onchain_verification.amountMatches &&
                          tx.onchain_verification.confirmed
                        ) && (
                          <button
                            style={s.checkBtn}
                            disabled={actingOn === tx.id}
                            onClick={() => handleAction(tx.id, 'verify', { skipBlockchainCheck: true })}
                          >
                            Override & approve anyway
                          </button>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>

      <div style={s.card}>
        <div style={s.cardTitle}>All users</div>
        {loading ? (
          <div style={s.empty}>Loading…</div>
        ) : (
          <div className="responsive-table-wrap">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Name', 'Email', 'Balance', 'Role', 'Status', 'Joined', 'Action'].map(h => (
                  <th key={h} style={s.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id}>
                  <td style={{ ...s.td, fontWeight: '500' }}>{u.full_name || '—'}</td>
                  <td style={{ ...s.td, color: 'var(--text2)' }}>{u.email}</td>
                  <td style={{ ...s.td, fontWeight: '600' }}>{formatUsd(u.balance_usd)}</td>
                  <td style={s.td}>{u.role}</td>
                  <td style={s.td}>{u.status}</td>
                  <td style={{ ...s.td, color: 'var(--text3)' }}>{new Date(u.created_at).toLocaleDateString()}</td>
                  <td style={s.td}>
                    {u.role !== 'admin' && (
                      <button
                        style={{ ...s.btnSmall, background: 'var(--blue-dim)', color: 'var(--blue)' }}
                        onClick={() => setAdjustingUser(u)}
                      >
                        Adjust
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>

      <TopInvestorsCard />

      {adjustingUser && (
        <AdjustWalletModal
          user={adjustingUser}
          onClose={() => setAdjustingUser(null)}
          onSuccess={() => { setAdjustingUser(null); loadData(); }}
        />
      )}

      {rejectingTxn && (
        <RejectModal
          txn={rejectingTxn}
          onClose={() => setRejectingTxn(null)}
          onConfirm={handleConfirmReject}
          submitting={modalSubmitting}
          error={modalError}
        />
      )}

      {editingReasonTxn && (
        <EditReasonModal
          txn={editingReasonTxn}
          onClose={() => setEditingReasonTxn(null)}
          onConfirm={handleConfirmEditReason}
          submitting={modalSubmitting}
          error={modalError}
        />
      )}
    </div>
  )
}