"use client";

import { useState, useEffect } from 'react'
import { Inbox } from 'lucide-react'
import { useUser } from '@/contexts/UserContext'
import { getWallet, getTransactions } from '@/lib/queries'
import RejectionReasonModal from '@/components/RejectionReasonModal'

const s = {
  page: { padding: '32px 36px' },
  title: { fontSize: '26px', fontWeight: '700', color: 'var(--text)', marginBottom: '4px' },
  sub: { fontSize: '14px', color: 'var(--text2)', marginBottom: '28px' },
  card: { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '24px', marginBottom: '20px' },
  row: { display: 'flex', gap: '16px', marginBottom: '20px' },
  stat: { flex: 1, background: 'var(--bg3)', borderRadius: 'var(--radius-sm)', padding: '20px 24px' },
  statLabel: { fontSize: '11px', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' },
  statValue: { fontSize: '24px', fontWeight: '700', color: 'var(--text)' },
  txItem: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid var(--border)' },
  txItemClickable: { cursor: 'pointer' },
  txLeft: { display: 'flex', alignItems: 'center', gap: '12px' },
  txIcon: { width: '34px', height: '34px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', flexShrink: 0 },
  empty: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '10px', padding: '40px 20px', textAlign: 'center' },
  emptyTitle: { fontSize: '14px', fontWeight: '500', color: 'var(--text2)' },
  emptySub: { fontSize: '12px', color: 'var(--text3)', maxWidth: '260px' },
  rejectedHint: { fontSize: '11px', color: 'var(--red)', marginTop: '2px' },
}

function formatUsd(n) {
  return `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function txnMeta(type) {
  switch (type) {
    case 'deposit': return { icon: '↓', color: 'var(--green)', bg: 'var(--green-dim)', label: 'Deposit' };
    case 'withdrawal': return { icon: '↑', color: 'var(--red)', bg: 'var(--red-dim)', label: 'Withdrawal' };
    case 'investment_withdrawal': return { icon: '↑', color: 'var(--red)', bg: 'var(--red-dim)', label: 'Investment withdrawal' };
    case 'investment_interest_claim': return { icon: '+', color: 'var(--green)', bg: 'var(--green-dim)', label: 'Gains claim' };
    case 'admin_credit': return { icon: '+', color: 'var(--green)', bg: 'var(--green-dim)', label: 'Admin credit' };
    case 'admin_debit': return { icon: '−', color: 'var(--red)', bg: 'var(--red-dim)', label: 'Admin debit' };
    default: return { icon: '•', color: 'var(--text2)', bg: 'var(--bg3)', label: type };
  }
}

export default function Wallet() {
  const { user } = useUser();
  const [wallet, setWallet] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewingReasonTxn, setViewingReasonTxn] = useState(null);

  useEffect(() => {
    if (!user) return;
    Promise.all([getWallet(user.id), getTransactions(user.id)])
      .then(([w, t]) => {
        setWallet(w);
        setTransactions(t || []);
      })
      .catch((err) => console.error('Failed to load wallet:', err))
      .finally(() => setLoading(false));
  }, [user]);

  const balance = wallet?.balance_usd ?? 0;
  const verified = transactions.filter(t => t.status === 'verified');
  const totalDeposited = verified
    .filter(t => t.type === 'deposit' || t.type === 'admin_credit')
    .reduce((sum, t) => sum + Number(t.amount_usd), 0);
  const totalWithdrawn = verified
    .filter(t => t.type === 'withdrawal' || t.type === 'admin_debit')
    .reduce((sum, t) => sum + Number(t.amount_usd), 0);

  return (
    <div style={s.page}>
      <h1 style={s.title}>Wallet</h1>
      <p style={s.sub}>Your cash balance and transaction history</p>

      <div className="responsive-stats" style={s.row}>
        <div style={s.stat}>
          <div style={s.statLabel}>Available balance</div>
          <div style={{ ...s.statValue, color: 'var(--green)' }}>{loading ? '—' : formatUsd(balance)}</div>
        </div>
        <div style={s.stat}>
          <div style={s.statLabel}>Total deposited</div>
          <div style={s.statValue}>{loading ? '—' : formatUsd(totalDeposited)}</div>
        </div>
        <div style={s.stat}>
          <div style={s.statLabel}>Total withdrawn</div>
          <div style={s.statValue}>{loading ? '—' : formatUsd(totalWithdrawn)}</div>
        </div>
      </div>

      <div style={s.card}>
        <div style={{ fontSize: '15px', fontWeight: '600', color: 'var(--text)', marginBottom: '20px' }}>Transaction history</div>

        {loading ? (
          <div style={s.empty}><p style={s.emptyTitle}>Loading…</p></div>
        ) : transactions.length === 0 ? (
          <div style={s.empty}>
            <Inbox size={26} strokeWidth={1.5} color="var(--text3)" />
            <p style={s.emptyTitle}>No transactions yet</p>
            <p style={s.emptySub}>Make a deposit to get started — it'll appear here once submitted, and update once verified.</p>
          </div>
        ) : (
          transactions.map((tx, i) => {
            const meta = txnMeta(tx.type);
            const isNegative = tx.type === 'withdrawal' || tx.type === 'admin_debit' || tx.type === 'investment_withdrawal';
            const isRejected = tx.status === 'rejected';
            return (
              <div
                key={tx.id}
                style={{
                  ...s.txItem,
                  ...(isRejected ? s.txItemClickable : {}),
                  ...(i === transactions.length - 1 ? { borderBottom: 'none' } : {}),
                }}
                onClick={isRejected ? () => setViewingReasonTxn(tx) : undefined}
              >
                <div style={s.txLeft}>
                  <div style={{ ...s.txIcon, background: meta.bg, color: meta.color }}>{meta.icon}</div>
                  <div>
                    <div style={{ fontSize: '14px', fontWeight: '500', color: 'var(--text)' }}>
                      {meta.label}{tx.status === 'pending' ? ' — pending verification' : ''}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>
                      {new Date(tx.created_at).toLocaleDateString()}
                    </div>
                    {isRejected && (
                      <div style={s.rejectedHint}>Rejected — tap to see why</div>
                    )}
                  </div>
                </div>
                <div style={{ fontSize: '14px', fontWeight: '600', color: isRejected ? 'var(--text3)' : meta.color }}>
                  {isNegative ? '−' : '+'}{formatUsd(tx.amount_usd)}
                </div>
              </div>
            );
          })
        )}
      </div>

      {viewingReasonTxn && (
        <RejectionReasonModal
          txn={viewingReasonTxn}
          onClose={() => setViewingReasonTxn(null)}
        />
      )}
    </div>
  )
}