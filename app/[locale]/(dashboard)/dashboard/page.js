"use client";

import { createClient } from '@/lib/supabase/client'
import { useState, useEffect, useMemo } from 'react'
import { ResponsiveContainer, PieChart, Pie, Tooltip, Cell } from 'recharts'
import { ArrowDownLeft, ArrowUpRight, CircleDollarSign, ArrowRight, Inbox, ShieldCheck } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { useUser } from '@/contexts/UserContext'
import { useMoneyFormatter, useDateFormatter } from '@/lib/formatting'
import FinancialMetric from '@/components/dashboard/FinancialMetric'
import StatusBadge from '@/components/dashboard/StatusBadge'
import TransactionRow from '@/components/dashboard/TransactionRow'
import DashboardState from '@/components/dashboard/DashboardState'
import PortfolioPerformanceChart from '@/components/dashboard/PortfolioPerformanceChart'
import {
  getWallet, getTransactions, getUserInvestments,
  getServiceStatuses, getActiveIncidents, subscribeToStatusChanges,
  getPublicInvestmentActivity, getMonthlyInvestmentTotal, getSettings,
} from '@/lib/queries'

const s = {
  page: { maxWidth: '1380px', margin: '0 auto', padding: '34px 44px' },
  statusCard: { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '20px 24px', marginBottom: '20px', boxShadow: '0 4px 16px rgba(24, 49, 34, 0.035)' },
  statusHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' },
  statusStrip: { display: 'flex', gap: '10px', flexWrap: 'wrap' },
  statusPill: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12.5px', color: 'var(--text2)', background: 'var(--bg3)', padding: '6px 12px', borderRadius: '999px' },
  statusDot: { width: '7px', height: '7px', borderRadius: '50%', flexShrink: 0 },
  statusLink: { fontSize: '12px', color: 'var(--green)', fontWeight: '500', textDecoration: 'none' },
  alertBanner: { display: 'flex', alignItems: 'center', gap: '10px', background: 'var(--red-dim)', border: '1px solid var(--red)', borderRadius: 'var(--radius-sm)', padding: '12px 16px', marginTop: '14px', fontSize: '13px', color: 'var(--red)' },
  grid2: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(300px, 0.75fr)', gap: '20px', marginBottom: '20px' },
  card: { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '24px', boxShadow: '0 4px 16px rgba(24, 49, 34, 0.035)' },
  cardTitle: { fontSize: '15px', fontWeight: '600', color: 'var(--text)', marginBottom: '4px' },
  cardSub: { fontSize: '12px', color: 'var(--text3)', marginBottom: '20px' },
  txnItem: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid var(--border)' },
  empty: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '10px', padding: '40px 20px', color: 'var(--text3)', textAlign: 'center' },
  emptyTitle: { fontSize: '14px', fontWeight: '500', color: 'var(--text2)' },
  emptySub: { fontSize: '12px', color: 'var(--text3)', maxWidth: '220px' },
  legendRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', fontSize: '13px' },
  legendLeft: { display: 'flex', alignItems: 'center', gap: '8px' },
  legendDot: { width: '9px', height: '9px', borderRadius: '50%' },
  investmentItem: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '13px 0', borderBottom: '1px solid var(--border)' },
  investmentCopy: { minWidth: 0 },
  investmentName: { overflow: 'hidden', color: 'var(--text)', fontSize: '13px', fontWeight: '600', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  investmentMeta: { color: 'var(--text3)', fontSize: '11px', marginTop: '4px' },
}

const ALLOCATION_COLORS = ['var(--green)', 'var(--blue)', 'var(--gold)', 'var(--red)', 'var(--text3)'];
const TRANSACTION_ICONS = {
  deposit: ArrowDownLeft,
  withdrawal: ArrowUpRight,
  admin_credit: CircleDollarSign,
  admin_debit: CircleDollarSign,
}

const STATUS_DOT_COLOR = {
  up: 'var(--green)',
  degraded: 'var(--gold)',
  down: 'var(--red)',
  unknown: 'var(--text3)',
}

function EmptyState({ title, sub }) {
  return (
    <div style={s.empty}>
      <Inbox size={28} strokeWidth={1.5} />
      <p style={s.emptyTitle}>{title}</p>
      {sub && <p style={s.emptySub}>{sub}</p>}
    </div>
  );
}

function txnIconMeta(type, t) {
  switch (type) {
    case 'deposit':
      return { icon: TRANSACTION_ICONS.deposit, tone: 'positive', label: t('txnTypes.deposit') };
    case 'withdrawal':
      return { icon: TRANSACTION_ICONS.withdrawal, tone: 'negative', label: t('txnTypes.withdrawal') };
    case 'admin_credit':
      return { icon: TRANSACTION_ICONS.admin_credit, tone: 'positive', label: t('txnTypes.adminCredit') };
    case 'admin_debit':
      return { icon: TRANSACTION_ICONS.admin_debit, tone: 'negative', label: t('txnTypes.adminDebit') };
    default:
      return { icon: CircleDollarSign, tone: 'neutral', label: type };
  }
}

function DashboardArtwork() {
  return (
    <svg className="customer-dashboard-hero__illustration" viewBox="0 0 360 250" fill="none" aria-hidden="true">
      <circle cx="210" cy="122" r="112" fill="url(#hero-orb)" />
      <circle cx="210" cy="122" r="82" stroke="rgba(226,255,234,.25)" strokeWidth="1.2" />
      <circle cx="210" cy="122" r="58" stroke="rgba(226,255,234,.22)" strokeWidth="1.2" strokeDasharray="3 7" />
      <path d="M92 211c38-39 49-93 91-116 32-18 76-13 110 7" stroke="url(#hero-line)" strokeWidth="2" strokeLinecap="round" />
      <path d="M135 203c12-28 15-54 34-74m0 0c-25-2-42-17-48-39 28-2 48 10 54 39Zm19-36c14-25 34-39 59-42-2 29-19 48-47 55" fill="url(#hero-leaf)" stroke="rgba(221,255,230,.78)" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M169 129c-7 32-20 56-39 76m39-76 25 4m-25-4-17-28m46-1 20-21" stroke="rgba(232,255,238,.78)" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="293" cy="67" r="6" fill="#B7F5C8" />
      <circle cx="99" cy="112" r="4" fill="#B7F5C8" opacity=".8" />
      <circle cx="276" cy="192" r="4" fill="#B7F5C8" opacity=".72" />
      <defs>
        <radialGradient id="hero-orb" cx="0" cy="0" r="1" gradientTransform="matrix(121 78 -83 129 170 87)" gradientUnits="userSpaceOnUse">
          <stop stopColor="#54C988" stopOpacity=".36" />
          <stop offset="1" stopColor="#54C988" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="hero-line" x1="100" y1="180" x2="293" y2="100" gradientUnits="userSpaceOnUse">
          <stop stopColor="#A6EAC0" stopOpacity="0" />
          <stop offset=".55" stopColor="#A6EAC0" />
          <stop offset="1" stopColor="#A6EAC0" stopOpacity=".22" />
        </linearGradient>
        <linearGradient id="hero-leaf" x1="144" y1="74" x2="230" y2="145" gradientUnits="userSpaceOnUse">
          <stop stopColor="#8DE1AA" stopOpacity=".68" />
          <stop offset="1" stopColor="#2C8D5B" stopOpacity=".12" />
        </linearGradient>
      </defs>
    </svg>
  )
}

function buildAllocation(investments) {
  const active = investments.filter(i => i.status === 'active');
  const totalValue = active.reduce((sum, i) => sum + Number(i.current_value), 0);
  if (totalValue === 0) return [];
  const byPlan = {};
  for (const inv of active) {
    byPlan[inv.plan_name] = (byPlan[inv.plan_name] || 0) + Number(inv.current_value);
  }
  return Object.entries(byPlan)
    .map(([name, value]) => ({ name, value, pct: Math.round((value / totalValue) * 1000) / 10 }))
    .sort((a, b) => b.value - a.value);
}

function PlatformStatus() {
  const t = useTranslations('Dashboard');
  const [services, setServices] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      const [svc, inc] = await Promise.all([getServiceStatuses(), getActiveIncidents()]);
      setServices(svc);
      setIncidents(inc);
    } catch (err) {
      console.error('Failed to load platform status:', err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const unsubscribe = subscribeToStatusChanges(() => load());
    return unsubscribe;
  }, []);

  return (
    <div style={s.statusCard}>
      <div style={s.statusHead}>
        <div style={s.cardTitle}>{t('platformStatus.title')}</div>
        <a href="/status" style={s.statusLink}>{t('platformStatus.viewStatusPage')} →</a>
      </div>

      {loading ? (
        <div style={{ fontSize: '13px', color: 'var(--text3)' }}>{t('platformStatus.checkingSystems')}</div>
      ) : (
        <div style={s.statusStrip}>
          {services.map(svc => (
            <div key={svc.id} style={s.statusPill}>
              <span style={{ ...s.statusDot, background: STATUS_DOT_COLOR[svc.currentStatus] || STATUS_DOT_COLOR.unknown }} />
              {svc.name}
            </div>
          ))}
        </div>
      )}

      {incidents.length > 0 && (
        <div style={s.alertBanner}>
          ⚠ {incidents[0].title}
        </div>
      )}
    </div>
  );
}

function InvestorActivity() {
  const t = useTranslations('Dashboard');
  const formatMoney = useMoneyFormatter();
  const formatDate = useDateFormatter();
  const [activity, setActivity] = useState([]);
  const [monthlyTotal, setMonthlyTotal] = useState(0);
  const [visible, setVisible] = useState(true);
  const [loading, setLoading] = useState(true);
  const [pulse, setPulse] = useState(false);

  async function load(isRefresh = false) {
    try {
      const [feed, total, settings] = await Promise.all([
        getPublicInvestmentActivity(),
        getMonthlyInvestmentTotal(),
        getSettings(),
      ]);
      setActivity(feed);
      setMonthlyTotal(total);
      setVisible(settings.show_investor_activity !== false);
      if (isRefresh) {
        setPulse(true);
        setTimeout(() => setPulse(false), 1200);
      }
    } catch (err) {
      console.error('Failed to load investor activity:', err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const supabase = createClient();
    const channel = supabase
      .channel('investor-activity-feed')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions' }, () => load(true))
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, []);

  if (loading || !visible) return null;

  return (
    <div style={s.card}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
        <div style={s.cardTitle}>{t('investorActivity.title')}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span
            style={{
              width: '7px', height: '7px', borderRadius: '50%', background: 'var(--green)',
              boxShadow: pulse ? '0 0 0 5px var(--green-dim)' : '0 0 0 0 transparent',
              transition: 'box-shadow 0.6s ease',
            }}
          />
          <span style={{ fontSize: '11px', color: 'var(--text3)', fontWeight: '500', letterSpacing: '0.03em' }}>{t('investorActivity.live')}</span>
        </div>
      </div>
      <div style={s.cardSub}>{t('investorActivity.investedThisMonth', { amount: formatMoney(monthlyTotal) })}</div>
      {activity.length === 0 ? (
        <EmptyState title={t('investorActivity.noActivityYet')} />
      ) : (
        activity.slice(0, 6).map(a => (
          <div key={a.id} style={{ ...s.txnItem, borderBottom: '1px solid var(--border)' }}>
            <div style={{ fontSize: '13.5px', color: 'var(--text)' }}>
              {t('investorActivity.investedLine', { name: a.display_name, amount: formatMoney(a.amount_rounded) })}
            </div>
            <div style={{ fontSize: '11.5px', color: 'var(--text3)' }}>
              {formatDate(a.created_at)}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

export default function Dashboard() {
  const t = useTranslations('Dashboard');
  const tPortfolio = useTranslations('Portfolio');
  const tShell = useTranslations('DashboardShell');
  const tChart = useTranslations('PerformanceChart');
  const formatMoney = useMoneyFormatter();
  const formatDate = useDateFormatter();
  const { user, userName } = useUser();
  const firstName = userName?.split(' ')[0] || '';

  const [wallet, setWallet] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [investments, setInvestments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    Promise.all([getWallet(user.id), getTransactions(user.id), getUserInvestments(user.id)])
      .then(([walletData, txnData, investmentData]) => {
        if (cancelled) return;
        setWallet(walletData);
        setTransactions(txnData || []);
        setInvestments(investmentData || []);
      })
      .catch((err) => {
        console.error('Failed to load dashboard data:', err);
        if (!cancelled) setLoadError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [user?.id, retryCount]);

  const balance = wallet?.balance_usd ?? 0;
  const verifiedTxns = transactions.filter((t) => t.status === 'verified');
  const activeInvestments = investments.filter(i => i.status === 'active');
  const currentValue = activeInvestments.reduce((sum, i) => sum + Number(i.current_value), 0);
  const allocationData = useMemo(() => buildAllocation(investments), [investments]);
  const stats = [
    { label: tPortfolio('currentValue'), value: formatMoney(currentValue), detail: tPortfolio('yourInvestments') },
    {
      label: t('stats.pendingDeposits'),
      value: String(transactions.filter(t => t.type === 'deposit' && t.status === 'pending').length),
      detail: t('stats.awaitingVerification'),
    },
    {
      label: t('stats.totalDeposited'),
      value: formatMoney(verifiedTxns.filter(t => t.type === 'deposit').reduce((sum, t) => sum + Number(t.amount_usd), 0)),
      detail: t('stats.allTime'),
    },
  ];

  return (
    <div className="customer-dashboard-page" style={s.page}>
      <header className="customer-dashboard-hero">
        <div className="customer-dashboard-hero__copy">
          <div className="customer-dashboard-hero__eyebrow">
            <ShieldCheck size={14} strokeWidth={2} aria-hidden="true" />
            <span>{t('accountOverview')}</span>
          </div>
          <h1 className="customer-dashboard-hero__title">
            {firstName ? t('greetingWithName', { name: firstName }) : t('greeting')}
          </h1>
          <p className="customer-dashboard-hero__description">{t('subtitle')}</p>
          <Link className="customer-dashboard-hero__link" href="/portfolio">
            {tShell('nav.portfolio')}
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </div>
        <div className="customer-dashboard-hero__art">
          <DashboardArtwork />
        </div>
      </header>

      <section className="customer-dashboard-balance" aria-labelledby="customer-dashboard-balance-title">
        <div className="customer-dashboard-balance__content">
          <div className="customer-dashboard-balance__label">
            <span className="customer-dashboard-balance__icon"><CircleDollarSign size={17} aria-hidden="true" /></span>
            <h2 id="customer-dashboard-balance-title">{t('availableBalance')}</h2>
          </div>
          <div className="customer-dashboard-balance__amount">
            {loading || loadError ? '—' : formatMoney(balance)}
          </div>
          <div className="customer-dashboard-balance__currency">
            <span>USD</span>
            <span>{t('accountCurrency')}</span>
          </div>
          <div className="customer-dashboard-balance__actions">
            <Link href="/deposit" className="customer-dashboard-balance__action customer-dashboard-balance__action--primary">
              <ArrowDownLeft size={17} aria-hidden="true" />
              {tShell('nav.deposit')}
            </Link>
            <Link href="/withdraw" className="customer-dashboard-balance__action customer-dashboard-balance__action--secondary">
              <ArrowUpRight size={17} aria-hidden="true" />
              {tShell('nav.withdraw')}
            </Link>
          </div>
        </div>
        <div className="customer-dashboard-balance__art" aria-hidden="true">
          <svg viewBox="0 0 360 260" fill="none">
            <circle cx="228" cy="130" r="115" stroke="rgba(231,255,238,.13)" />
            <circle cx="228" cy="130" r="84" stroke="rgba(231,255,238,.14)" strokeDasharray="2 7" />
            <path d="M75 199c34-32 58-62 89-62 30 0 40 29 70 29 30 0 39-41 80-78" stroke="url(#balance-path)" strokeWidth="2" strokeLinecap="round" />
            <path d="M106 181c13-23 27-40 44-50m0 0c-21-1-35-13-40-32 22-1 39 8 44 32Zm31 2c10-20 27-32 47-34-2 23-15 38-37 43" fill="url(#balance-leaf)" stroke="rgba(231,255,238,.68)" strokeWidth="1.1" />
            <circle cx="311" cy="61" r="4" fill="#C5F8D1" />
            <circle cx="88" cy="116" r="3" fill="#C5F8D1" opacity=".8" />
            <defs>
              <linearGradient id="balance-path" x1="83" y1="173" x2="312" y2="100" gradientUnits="userSpaceOnUse">
                <stop stopColor="#B7F5C8" stopOpacity="0" />
                <stop offset=".58" stopColor="#B7F5C8" stopOpacity=".75" />
                <stop offset="1" stopColor="#B7F5C8" stopOpacity=".08" />
              </linearGradient>
              <linearGradient id="balance-leaf" x1="115" y1="105" x2="230" y2="159" gradientUnits="userSpaceOnUse">
                <stop stopColor="#A0E9B5" stopOpacity=".58" />
                <stop offset="1" stopColor="#3B9B68" stopOpacity=".1" />
              </linearGradient>
            </defs>
          </svg>
        </div>
      </section>

      <section className="customer-dashboard-metrics" aria-label={tPortfolio('yourInvestments')}>
        {stats.map(st => (
          <FinancialMetric
            key={st.label}
            label={st.label}
            value={loading || loadError ? '—' : st.value}
            detail={st.detail}
            tone={st.label === tPortfolio('currentValue') ? 'positive' : 'default'}
          />
        ))}
      </section>

      {loadError ? (
        <section className="customer-dashboard-card" style={s.card}>
          <DashboardState
            variant="error"
            title={t('dataLoadFailed')}
            action={(
              <button
                type="button"
                className="customer-dashboard-link"
                onClick={() => setRetryCount(count => count + 1)}
              >
                {t('retry')}
              </button>
            )}
          />
        </section>
      ) : (
      <>
      <section className="customer-dashboard-card customer-dashboard-performance" style={s.card} aria-labelledby="customer-dashboard-performance-title">
        <h2 id="customer-dashboard-performance-title" style={s.cardTitle}>{tChart('title')}</h2>
        {loading ? (
          <DashboardState variant="loading" title={tChart('loading')} />
        ) : (
          <PortfolioPerformanceChart investments={investments} transactions={transactions} />
        )}
      </section>

      <div className="customer-dashboard-grid" style={s.grid2}>
        <section className="customer-dashboard-card" style={s.card}>
          <div className="customer-dashboard-card__heading">
            <div>
              <h2 style={s.cardTitle}>{tPortfolio('yourInvestments')}</h2>
            </div>
            <Link className="customer-dashboard-link" href="/portfolio">{tShell('nav.portfolio')}</Link>
          </div>
          {loading ? (
            <DashboardState title={t('common.loading')} />
          ) : activeInvestments.length === 0 ? (
            <DashboardState
              title={tPortfolio('noInvestments')}
              action={<Link className="customer-dashboard-link" href="/portfolio">{tShell('nav.portfolio')}</Link>}
            />
          ) : (
            activeInvestments.slice(0, 4).map((investment, index) => (
              <div
                key={investment.id}
                style={{ ...s.investmentItem, ...(index === Math.min(activeInvestments.length, 4) - 1 ? { borderBottom: 'none' } : {}) }}
              >
                <span className="customer-dashboard-investment-mark" aria-hidden="true">
                  <CircleDollarSign size={17} strokeWidth={1.8} />
                </span>
                <div style={s.investmentCopy}>
                  <div style={s.investmentName}>{investment.plan_name}</div>
                  <div style={s.investmentMeta}>{tPortfolio('currentValue')}</div>
                </div>
                <div className="customer-dashboard-investment-value">
                  <strong>{formatMoney(investment.current_value)}</strong>
                  <StatusBadge status={investment.status}>{tPortfolio(`status.${investment.status}`, { default: investment.status })}</StatusBadge>
                </div>
              </div>
            ))
          )}
        </section>

        <section className="customer-dashboard-card" style={s.card}>
          <h2 style={s.cardTitle}>{t('assetAllocation.title')}</h2>
          <p style={s.cardSub}>{t('assetAllocation.byPlan')}</p>
          {loading ? (
            <DashboardState title={t('common.loading')} />
          ) : allocationData.length === 0 ? (
            <DashboardState title={t('assetAllocation.nothingAllocated')} />
          ) : (
            <>
              <div
                className="customer-dashboard-allocation-chart"
                role="img"
                aria-label={`${t('assetAllocation.byPlan')}: ${allocationData.map(item => `${item.name} ${item.pct}%`).join(', ')}`}
              >
                <ResponsiveContainer width="100%" height={190}>
                  <PieChart>
                    <Pie data={allocationData} dataKey="value" nameKey="name" innerRadius={54} outerRadius={82} paddingAngle={3}>
                      {allocationData.map((entry, i) => (
                        <Cell key={entry.name} fill={ALLOCATION_COLORS[i % ALLOCATION_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={value => formatMoney(value)} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="customer-dashboard-allocation-chart__center" aria-hidden="true">
                  <span>{tPortfolio('currentValue')}</span>
                  <strong>{formatMoney(currentValue)}</strong>
                </div>
              </div>
              <div>
                {allocationData.map((item, index) => (
                  <div key={item.name} style={s.legendRow}>
                    <div style={s.legendLeft}>
                      <span style={{ ...s.legendDot, background: ALLOCATION_COLORS[index % ALLOCATION_COLORS.length] }} />
                      <span style={{ color: 'var(--text2)' }}>{item.name}</span>
                    </div>
                    <span style={{ color: 'var(--text)', fontWeight: '600' }}>{item.pct}%</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      </div>

      <div className="customer-dashboard-grid customer-dashboard-grid--activity" style={s.grid2}>
        <section className="customer-dashboard-card" style={s.card}>
          <div className="customer-dashboard-card__heading">
            <div>
              <h2 style={s.cardTitle}>{t('recentTransactions.title')}</h2>
              <p style={s.cardSub}>{t('recentTransactions.subtitle')}</p>
            </div>
            <Link className="customer-dashboard-link" href="/wallet">{tShell('nav.wallet')}</Link>
          </div>
          {loading ? (
            <DashboardState title={t('common.loading')} />
          ) : transactions.length === 0 ? (
            <DashboardState title={t('recentTransactions.noTransactions')} description={t('recentTransactions.noTransactionsSub')} />
          ) : (
            transactions.slice(0, 5).map(tx => {
              const meta = txnIconMeta(tx.type, t);
              const negative = tx.type === 'withdrawal' || tx.type === 'admin_debit';
              const resolved = tx.status === 'verified';
              const statusLabel = tx.status === 'pending'
                ? t('recentTransactions.pending')
                : tx.status === 'rejected'
                  ? t('recentTransactions.rejected')
                  : tx.status === 'verified' ? t('recentTransactions.verified') : tx.status;
              return (
                <TransactionRow
                  key={tx.id}
                  icon={meta.icon}
                  title={meta.label}
                  description={formatDate(tx.created_at)}
                  amount={`${negative ? '−' : '+'}${formatMoney(tx.amount_usd)}`}
                  positive={!negative && resolved}
                  negative={negative && resolved}
                  iconTone={meta.tone}
                  status={tx.status}
                  statusLabel={statusLabel}
                />
              );
            })
          )}
        </section>
        <InvestorActivity />
      </div>
      </>
      )}

      <PlatformStatus />
    </div>
  )
}