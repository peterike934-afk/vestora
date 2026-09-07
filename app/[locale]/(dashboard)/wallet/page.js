"use client";

import { useState, useEffect } from 'react'
import { Inbox } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useUser } from '@/contexts/UserContext'
import { useMoneyFormatter, useDateFormatter } from '@/lib/formatting'
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

function txnMeta(type, t) {
  switch (type) {
    case 'deposit': return { icon: '↓', color: 'var(--green)', bg: 'var(--green-dim)', label: t('txnTypes.deposit') };
    case 'withdrawal': return { icon: '↑', color: 'var(--red)', bg: 'var(--red-dim)', label: t('txnTypes.withdrawal') };
    case 'investment_withdrawal': return { icon: '↑', color: 'var(--red)', bg: 'var(--red-dim)', label: t('txnTypes.investmentWithdrawal') };
    case 'investment_interest_claim': return { icon: '+', color: 'var(--green)', bg: 'var(--green-dim)', label: t('txnTypes.gainsClaim') };
    case 'admin_credit': return { icon: '+', color: 'var(--green)', bg: 'var(--green-dim)', label: t('txnTypes.adminCredit') };
    case 'admin_debit': return { icon: '−', color: 'var(--red)', bg: 'var(--red-dim)', label: t('txnTypes.adminDebit') };
    default: return { icon: '•', color: 'var(--text2)', bg: 'var(--bg3)', label: type };
  }
}

export default function Wallet() {
  const t = useTranslations('Wallet')
  const formatMoney = useMoneyFormatter()
  const formatDate = useDateFormatter()
  const { user } = useUser();
  const [wallet, setWallet] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewingReasonTxn, setViewingReasonTxn] = useState(null);

  useEffect(() => {
    if (!user) return;
    Promise.all([getWallet(user.id), getTransactions(user.id)])
      .then(([w, tx]) => {
        setWallet(w);
        setTransactions(tx || []);
      })
      .catch((err) => console.error('Failed to load wallet:', err))
      .finally(() => setLoading(false));
  }, [user]);

  const balance = wallet?.balance_usd ?? 0;
  const verified = transactions.filter(tx => tx.status === 'verified');
  const totalDeposited = verified
    .filter(tx => tx.type === 'deposit' || tx.type === 'admin_credit')
    .reduce((sum, tx) => sum + Number(tx.amount_usd), 0);
  const totalWithdrawn = verified
    .filter(tx => tx.type === 'withdrawal' || tx.type === 'admin_debit')
    .reduce((sum, tx) => sum + Number(tx.amount_usd), 0);

  return (
    <div style={s.page}>
      <h1 style={s.title}>{t('title')}</h1>
      <p style={s.sub}>{t('subtitle')}</p>

      <div className="responsive-stats" style={s.row}>
        <div style={s.stat}>
          <div style={s.statLabel}>{t('availableBalance')}</div>
          <div style={{ ...s.statValue, color: 'var(--green)' }}>{loading ? '—' : formatMoney(balance)}</div>
        </div>
        <div style={s.stat}>
          <div style={s.statLabel}>{t('totalDeposited')}</div>
          <div style={s.statValue}>{loading ? '—' : formatMoney(totalDeposited)}</div>
        </div>
        <div style={s.stat}>
          <div style={s.statLabel}>{t('totalWithdrawn')}</div>
          <div style={s.statValue}>{loading ? '—' : formatMoney(totalWithdrawn)}</div>
        </div>
      </div>

      <div style={s.card}>
        <div style={{ fontSize: '15px', fontWeight: '600', color: 'var(--text)', marginBottom: '20px' }}>{t('history')}</div>

        {loading ? (
          <div style={s.empty}><p style={s.emptyTitle}>{t('loading')}</p></div>
        ) : transactions.length === 0 ? (
          <div style={s.empty}>
            <Inbox size={26} strokeWidth={1.5} color="var(--text3)" />
            <p style={s.emptyTitle}>{t('noTransactions')}</p>
            <p style={s.emptySub}>{t('noTransactionsSub')}</p>
          </div>
        ) : (
          transactions.map((tx, i) => {
            const meta = txnMeta(tx.type, t);
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
                      {meta.label}{tx.status === 'pending' ? ` — ${t('pendingVerification')}` : ''}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>
                      {formatDate(tx.created_at)}
                    </div>
                    {isRejected && (
                      <div style={s.rejectedHint}>{t('rejectedHint')}</div>
                    )}
                  </div>
                </div>
                <div style={{ fontSize: '14px', fontWeight: '600', color: isRejected ? 'var(--text3)' : meta.color }}>
                  {isNegative ? '−' : '+'}{formatMoney(tx.amount_usd)}
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