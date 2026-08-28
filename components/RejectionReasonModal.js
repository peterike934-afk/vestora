"use client";

import { useState } from 'react'

const s = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300, padding: '20px' },
  modal: { width: '380px', maxWidth: '100%', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '24px' },
  title: { fontSize: '16px', fontWeight: '700', color: 'var(--text)', marginBottom: '4px' },
  sub: { fontSize: '13px', color: 'var(--text3)', marginBottom: '20px' },
  reasonBox: { background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '14px 16px', fontSize: '13.5px', color: 'var(--text)', lineHeight: 1.5, marginBottom: '20px' },
  reasonEmpty: { color: 'var(--text3)', fontStyle: 'italic' },
  closeBtn: { width: '100%', padding: '12px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text2)', fontSize: '14px', fontWeight: '500', cursor: 'pointer', transition: 'background 0.15s, border-color 0.15s, color 0.15s' },
  closeBtnHover: { background: 'var(--green-dim)', border: '1px solid var(--green)', color: 'var(--green)' },
}

function formatUsd(n) {
  return `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const TYPE_LABELS = {
  deposit: 'Deposit',
  withdrawal: 'Withdrawal',
  investment_withdrawal: 'Investment withdrawal',
  investment_interest_claim: 'Gains claim',
  admin_credit: 'Admin credit',
  admin_debit: 'Admin debit',
}

// Shared across Wallet and Dashboard — shows why a rejected transaction
// was rejected. Falls back to a plain "no reason provided" message for
// transactions rejected before the reason feature existed, or any
// rejection that genuinely went out without one.
export default function RejectionReasonModal({ txn, onClose }) {
  const [closeBtnHovered, setCloseBtnHovered] = useState(false)

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} onClick={e => e.stopPropagation()}>
        <div style={s.title}>Why was this rejected?</div>
        <div style={s.sub}>
          {TYPE_LABELS[txn.type] || txn.type} · {formatUsd(txn.amount_usd)} · {new Date(txn.created_at).toLocaleDateString()}
        </div>
        <div style={s.reasonBox}>
          {txn.admin_note
            ? txn.admin_note
            : <span style={s.reasonEmpty}>No reason was provided for this rejection.</span>}
        </div>
        <button
          style={{ ...s.closeBtn, ...(closeBtnHovered ? s.closeBtnHover : {}) }}
          onMouseEnter={() => setCloseBtnHovered(true)}
          onMouseLeave={() => setCloseBtnHovered(false)}
          onClick={onClose}
        >
          Close
        </button>
      </div>
    </div>
  )
}