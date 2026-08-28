"use client";

import { useState, useEffect, useRef } from 'react'
import { Send } from 'lucide-react'
import { getMessages, sendMessage, subscribeToMessages } from '@/lib/queries'

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
  tabActive: { background: 'var(--green)', color: '#000', border: '1px solid var(--green)' },
  th: { fontSize: '11px', fontWeight: '500', color: 'var(--text3)', letterSpacing: '0.06em', textTransform: 'uppercase', padding: '0 0 14px 0', textAlign: 'left' },
  td: { padding: '13px 0', borderTop: '1px solid var(--border)', fontSize: '13px', color: 'var(--text)' },
  btnSmall: { fontSize: '12px', padding: '6px 14px', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '600' },
  empty: { textAlign: 'center', padding: '40px', color: 'var(--text3)', fontSize: '14px' },
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
  withdrawBox: { marginTop: '10px', marginBottom: '4px', padding: '14px 16px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: '10px' },
withdrawGrid: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px 20px' },
withdrawLabel: { fontSize: '11px', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '2px' },
withdrawValue: { fontSize: '13px', color: 'var(--text)', fontWeight: '600' },
withdrawValuePos: { fontSize: '13px', color: 'var(--green)', fontWeight: '600' },
withdrawValueNeg: { fontSize: '13px', color: 'var(--red)', fontWeight: '600' },
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

// Shows the principal/interest/fee breakdown that was locked in when the
// user requested an investment withdrawal — so the admin can see exactly
// what they're approving, not just a lump total.
function WithdrawalBreakdownPanel({ txn }) {
  if (txn.type !== 'investment_withdrawal') return null

  const principal = Number(txn.principal_portion) || 0
  const forfeited = Number(txn.forfeited_interest) || 0
  const fee = Number(txn.fee_charged) || 0
  const payout = Number(txn.amount_usd) || 0
  const interestPaid = payout - principal + fee > 0 ? payout - principal + fee : 0

  return (
    <div style={s.withdrawBox}>
      <div style={s.withdrawGrid}>
        <div>
          <div style={s.withdrawLabel}>Principal</div>
          <div style={s.withdrawValue}>{formatUsd(principal)}</div>
        </div>
        <div>
          <div style={s.withdrawLabel}>{forfeited > 0 ? 'Interest forfeited' : 'Interest paid'}</div>
          {forfeited > 0 ? (
            <div style={s.withdrawValueNeg}>−{formatUsd(forfeited)}</div>
          ) : (
            <div style={s.withdrawValuePos}>+{formatUsd(interestPaid)}</div>
          )}
        </div>
        <div>
          <div style={s.withdrawLabel}>Early fee</div>
          <div style={fee > 0 ? s.withdrawValueNeg : s.withdrawValue}>
            {fee > 0 ? `−${formatUsd(fee)}` : '—'}
          </div>
        </div>
        <div>
          <div style={s.withdrawLabel}>Payout</div>
          <div style={s.withdrawValue}>{formatUsd(payout)}</div>
        </div>
      </div>
      <div style={{ ...s.pill, ...(fee > 0 || forfeited > 0 ? s.pillBad : s.pillGood), marginTop: '10px' }}>
        {fee > 0 || forfeited > 0 ? 'Early withdrawal — penalty applied' : 'Matured — no penalty'}
      </div>
    </div>
  )
}

export default function AdminPanel() {
  const [tab, setTab] = useState('pending')
  const [users, setUsers] = useState([])
  const [transactions, setTransactions] = useState([])
  const [loading, setLoading] = useState(true)
  const [actingOn, setActingOn] = useState(null)
  const [checkingOn, setCheckingOn] = useState(null)
  const [error, setError] = useState('')

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

      <div style={s.row}>
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
            <div style={{ ...s.empty, display: 'flex', justifyContent: 'center' }}>
     <LoadingLogo size={22} />
   </div>
        ) : displayedTxns.length === 0 ? (
          <div style={s.empty}>{tab === 'pending' ? 'Nothing pending — all caught up.' : 'No transactions yet.'}</div>
        ) : (
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
                <>
                  <tr key={tx.id}>
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
                            onClick={() => handleAction(tx.id, 'reject')}
                          >
                            Reject
                          </button>
                        </div>
                      ) : (
                        <span style={{ color: 'var(--text3)', fontSize: '12px' }}>—</span>
                      )}
                    </td>
                  </tr>

                  {tx.status === 'pending' && tx.crypto_currency && tx.tx_hash && (
                    <tr key={`${tx.id}-verify`}>
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
                  {tx.status === 'pending' && tx.type === 'investment_withdrawal' && (
  <tr key={`${tx.id}-breakdown`}>
    <td colSpan={8} style={{ padding: '0 0 4px 0', borderTop: 'none' }}>
      <WithdrawalBreakdownPanel txn={tx} />
    </td>
  </tr>
)}
                </>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div style={s.card}>
        <div style={s.cardTitle}>All users</div>
        {loading ? (
             <div style={{ ...s.empty, display: 'flex', justifyContent: 'center' }}>
     <LoadingLogo size={22} />
   </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Name', 'Email', 'Balance', 'Role', 'Status', 'Joined'].map(h => (
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
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
