"use client";

import { createClient } from '@/lib/supabase/client'
import { useState, useEffect, useMemo } from 'react'
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, PieChart, Pie, Cell } from 'recharts'
import { Inbox } from 'lucide-react'
import { useUser } from '@/contexts/UserContext'
import {
  getWallet, getTransactions, getUserInvestments,
  getServiceStatuses, getActiveIncidents, subscribeToStatusChanges,
  getPublicInvestmentActivity, getMonthlyInvestmentTotal, getSettings,
} from '@/lib/queries'

const s = {
  page: { padding: '32px 36px', maxWidth: '1200px' },
  header: { marginBottom: '32px' },
  title: { fontSize: '26px', fontWeight: '700', color: 'var(--text)', marginBottom: '4px' },
  sub: { fontSize: '14px', color: 'var(--text2)' },
  statsGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px', marginBottom: '20px' },
  stat: { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '20px 24px' },
  statLabel: { fontSize: '12px', color: 'var(--text3)', fontWeight: '500', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: '10px' },
  statValue: { fontSize: '26px', fontWeight: '700', color: 'var(--text)', marginBottom: '6px', letterSpacing: '-0.02em' },
  statChange: { fontSize: '12px', fontWeight: '500', padding: '3px 8px', borderRadius: '20px', display: 'inline-block' },

  statusCard: { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '20px 24px', marginBottom: '20px' },
  statusHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' },
  statusStrip: { display: 'flex', gap: '10px', flexWrap: 'wrap' },
  statusPill: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12.5px', color: 'var(--text2)', background: 'var(--bg3)', padding: '6px 12px', borderRadius: '999px' },
  statusDot: { width: '7px', height: '7px', borderRadius: '50%', flexShrink: 0 },
  statusLink: { fontSize: '12px', color: 'var(--green)', fontWeight: '500', textDecoration: 'none' },
  alertBanner: { display: 'flex', alignItems: 'center', gap: '10px', background: 'var(--red-dim)', border: '1px solid var(--red)', borderRadius: 'var(--radius-sm)', padding: '12px 16px', marginTop: '14px', fontSize: '13px', color: 'var(--red)' },

  grid2: { display: 'grid', gridTemplateColumns: '1fr 340px', gap: '20px', marginBottom: '20px' },
  card: { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '24px' },
  cardTitle: { fontSize: '15px', fontWeight: '600', color: 'var(--text)', marginBottom: '4px' },
  cardSub: { fontSize: '12px', color: 'var(--text3)', marginBottom: '20px' },

  txnItem: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid var(--border)' },
  txnLeft: { display: 'flex', alignItems: 'center', gap: '12px' },
  txnIcon: { width: '36px', height: '36px', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', flexShrink: 0 },
  txnName: { fontSize: '14px', fontWeight: '500', color: 'var(--text)' },
  txnDate: { fontSize: '12px', color: 'var(--text3)', marginTop: '2px' },
  txnAmount: { fontSize: '14px', fontWeight: '600' },

  empty: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '10px', padding: '40px 20px', color: 'var(--text3)', textAlign: 'center' },
  emptyTitle: { fontSize: '14px', fontWeight: '500', color: 'var(--text2)' },
  emptySub: { fontSize: '12px', color: 'var(--text3)', maxWidth: '220px' },

  legendRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', fontSize: '13px' },
  legendLeft: { display: 'flex', alignItems: 'center', gap: '8px' },
  legendDot: { width: '9px', height: '9px', borderRadius: '50%' },

  topItem: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid var(--border)' },
  topLeft: { display: 'flex', alignItems: 'center', gap: '12px' },
  topRank: { width: '26px', height: '26px', borderRadius: '8px', background: 'var(--bg3)', color: 'var(--text2)', fontSize: '12px', fontWeight: '700', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  topName: { fontSize: '13.5px', fontWeight: '500', color: 'var(--text)' },
  topMeta: { fontSize: '11.5px', color: 'var(--text3)', marginTop: '2px' },
  topGain: { fontSize: '13.5px', fontWeight: '600' },
}

// Matches the palette used elsewhere in the app (green/blue/gold/etc as CSS vars)
const ALLOCATION_COLORS = ['var(--green)', 'var(--blue)', 'var(--gold)', 'var(--red)', 'var(--text3)'];

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

function formatUsd(n) {
  return `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function txnIconMeta(type) {
  switch (type) {
    case 'deposit':
      return { icon: '↓', color: 'var(--green)', bg: 'var(--green-dim)', label: 'Deposit' };
    case 'withdrawal':
      return { icon: '↑', color: 'var(--red)', bg: 'var(--red-dim)', label: 'Withdrawal' };
    case 'admin_credit':
      return { icon: '+', color: 'var(--green)', bg: 'var(--green-dim)', label: 'Admin credit' };
    case 'admin_debit':
      return { icon: '−', color: 'var(--red)', bg: 'var(--red-dim)', label: 'Admin debit' };
    default:
      return { icon: '•', color: 'var(--text2)', bg: 'var(--bg3)', label: type };
  }
}

// The value of a single investment at any point in time, using the
// same simple-interest-prorated-and-capped formula as the
// investments_with_value SQL view — so the chart's "today" point
// matches the Portfolio page's live current_value exactly.
function valueAt(investment, atDate) {
  const started = new Date(investment.started_at);
  if (atDate < started) return 0;
  const daysElapsed = (atDate - started) / 86400000;
  const cappedDays = Math.min(daysElapsed, investment.term_days);
  return Number(investment.amount_usd) * (1 + (Number(investment.apy_percent) / 100) * (cappedDays / 365));
}

// Because accrual is deterministic (fixed APY, prorated by time), the
// whole growth curve can be reconstructed from investments' start
// dates alone — no need to have stored daily snapshots historically.
function buildGrowthSeries(investments) {
  if (!investments.length) return [];

  const starts = investments.map(i => new Date(i.started_at).getTime());
  const earliest = new Date(Math.min(...starts));
  const now = new Date();
  const totalDays = Math.max(1, Math.ceil((now - earliest) / 86400000));
  const pointCount = Math.min(30, totalDays + 1);

  const points = [];
  for (let i = 0; i < pointCount; i++) {
    const t = pointCount === 1 ? 0 : i / (pointCount - 1);
    const date = new Date(earliest.getTime() + t * (now.getTime() - earliest.getTime()));
    const total = investments.reduce((sum, inv) => sum + valueAt(inv, date), 0);
    points.push({
      date: date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      value: Math.round(total * 100) / 100,
    });
  }
  return points;
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

// Ranks each individual holding (not grouped by plan, unlike allocation)
// by its actual gain percentage — amount_usd vs current_value — so this
// reflects real performance per position, not just position size.
function buildTopPerformers(investments) {
  return investments
    .filter(i => i.status === 'active' || i.status === 'matured')
    .map(i => {
      const invested = Number(i.amount_usd);
      const current = Number(i.current_value);
      const gainUsd = current - invested;
      const gainPct = invested > 0 ? (gainUsd / invested) * 100 : 0;
      return { ...i, gainUsd, gainPct };
    })
    .sort((a, b) => b.gainPct - a.gainPct)
    .slice(0, 5);
}

function PlatformStatus() {
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
        <div style={s.cardTitle}>Platform status</div>
        <a href="/status" style={s.statusLink}>View status page →</a>
      </div>

      {loading ? (
        <div style={{ fontSize: '13px', color: 'var(--text3)' }}>Checking systems…</div>
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

function TopPerformers({ investments, loading }) {
  const top = useMemo(() => buildTopPerformers(investments), [investments]);

  return (
    <div style={s.card}>
      <div style={s.cardTitle}>Top performing investments</div>
      <div style={s.cardSub}>{top.length ? 'Ranked by return since start' : 'No holdings yet'}</div>

      {loading ? (
        <EmptyState title="Loading…" />
      ) : top.length === 0 ? (
        <EmptyState
          title="Nothing to rank yet"
          sub="Once your investments start accruing, the best performers show up here."
        />
      ) : (
        top.map((inv, i) => (
          <div key={inv.id} style={{ ...s.topItem, ...(i === top.length - 1 ? { borderBottom: 'none' } : {}) }}>
            <div style={s.topLeft}>
              <div style={s.topRank}>{i + 1}</div>
              <div>
                <div style={s.topName}>{inv.plan_name}</div>
                <div style={s.topMeta}>{formatUsd(inv.amount_usd)} invested · {inv.apy_percent}% APY</div>
              </div>
            </div>
            <div style={{ ...s.topGain, color: inv.gainPct >= 0 ? 'var(--green)' : 'var(--red)' }}>
              {inv.gainPct >= 0 ? '+' : ''}{inv.gainPct.toFixed(2)}%
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function InvestorActivity() {
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
        <div style={s.cardTitle}>Investor activity</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span
            style={{
              width: '7px', height: '7px', borderRadius: '50%', background: 'var(--green)',
              boxShadow: pulse ? '0 0 0 5px var(--green-dim)' : '0 0 0 0 transparent',
              transition: 'box-shadow 0.6s ease',
            }}
          />
          <span style={{ fontSize: '11px', color: 'var(--text3)', fontWeight: '500', letterSpacing: '0.03em' }}>LIVE</span>
        </div>
      </div>
      <div style={s.cardSub}>{formatUsd(monthlyTotal)} invested on Vestora this month</div>
      {activity.length === 0 ? (
        <EmptyState title="No activity yet this month" />
      ) : (
        activity.slice(0, 6).map(a => (
          <div key={a.id} style={{ ...s.txnItem, borderBottom: '1px solid var(--border)' }}>
            <div style={{ fontSize: '13.5px', color: 'var(--text)' }}>
              <b>{a.display_name}</b> invested {formatUsd(a.amount_rounded)}
            </div>
            <div style={{ fontSize: '11.5px', color: 'var(--text3)' }}>
              {new Date(a.created_at).toLocaleDateString()}
            </div>
          </div>
        ))
      )}
    </div>
  );
}


export default function Dashboard() {
  const { user, userName } = useUser();
  const firstName = userName?.split(' ')[0] || '';

  const [wallet, setWallet] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [investments, setInvestments] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.id) return;
    Promise.all([getWallet(user.id), getTransactions(user.id), getUserInvestments(user.id)])
      .then(([walletData, txnData, investmentData]) => {
        setWallet(walletData);
        setTransactions(txnData || []);
        setInvestments(investmentData || []);
      })
      .catch((err) => console.error('Failed to load dashboard data:', err))
      .finally(() => setLoading(false));
  }, [user?.id]);

  const balance = wallet?.balance_usd ?? 0;
  const verifiedTxns = transactions.filter((t) => t.status === 'verified');

  const growthData = useMemo(() => buildGrowthSeries(investments), [investments]);
  const allocationData = useMemo(() => buildAllocation(investments), [investments]);

  // "Gains" is two genuinely different things added together — real
  // investment returns (current_value minus what was put in) and any
  // manual admin credit/debit. Kept as separate sums internally, shown
  // as one honest total with a breakdown in the subtext, so it never
  // reads as "you earned this from investing" when part of it was a
  // manual adjustment.
  const investmentGains = investments
    .filter(i => i.status === 'active' || i.status === 'matured')
    .reduce((sum, i) => sum + (Number(i.current_value) - Number(i.amount_usd)), 0);
  const netAdminAdjustments = verifiedTxns
    .filter(t => t.type === 'admin_credit' || t.type === 'admin_debit')
    .reduce((sum, t) => sum + (t.type === 'admin_credit' ? Number(t.amount_usd) : -Number(t.amount_usd)), 0);
  const totalGains = investmentGains + netAdminAdjustments;

  const stats = [
    { label: 'Total Balance', value: formatUsd(balance), change: 'Verified deposits', up: null },
    {
      label: 'Total Gains',
      value: `${totalGains >= 0 ? '+' : ''}${formatUsd(totalGains)}`,
      change: netAdminAdjustments !== 0
        ? `${formatUsd(investmentGains)} from investing, ${formatUsd(netAdminAdjustments)} adjustments`
        : 'From active investments',
      up: totalGains >= 0,
    },
    { label: "Pending Deposits", value: String(transactions.filter(t => t.type === 'deposit' && t.status === 'pending').length), change: 'Awaiting verification', up: null },
    { label: 'Total Deposited', value: formatUsd(verifiedTxns.filter(t => t.type === 'deposit' || t.type === 'admin_credit').reduce((sum, t) => sum + Number(t.amount_usd), 0)), change: 'All time', up: null },
    { label: 'Transactions', value: String(transactions.length), change: 'Total activity', up: null },
  ];

  return (
    <div style={s.page}>
      <div style={s.header}>
        <h1 style={s.title}>Good morning{firstName ? `, ${firstName}` : ''}</h1>
        <p style={s.sub}>Here's what's happening with your account today</p>
      </div>

      <div style={s.statsGrid}>
        {stats.map(st => (
          <div key={st.label} style={s.stat}>
            <div style={s.statLabel}>{st.label}</div>
            <div style={{ ...s.statValue, ...(st.up === true ? { color: 'var(--green)' } : st.up === false ? { color: 'var(--red)' } : {}) }}>
              {loading ? '—' : st.value}
            </div>
            <span style={{
              ...s.statChange,
              background: st.up === true ? 'var(--green-dim)' : st.up === false ? 'var(--red-dim)' : 'var(--bg3)',
              color: st.up === true ? 'var(--green)' : st.up === false ? 'var(--red)' : 'var(--text2)',
            }}>
              {st.change}
            </span>
          </div>
        ))}
      </div>

      <PlatformStatus />

      <InvestorActivity />

          

      <div className="responsive-grid-2" style={s.grid2}>
        <div style={s.card}>
          <div style={s.cardTitle}>Portfolio growth</div>
          <div style={s.cardSub}>{growthData.length ? 'Since your first investment' : 'No holdings yet'}</div>
          {loading ? (
            <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <EmptyState title="Loading…" />
            </div>
          ) : growthData.length === 0 ? (
            <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <EmptyState
                title="No investment activity yet"
                sub="This account doesn't have any holdings to chart yet."
              />
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={growthData} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                <defs>
                  <linearGradient id="growthFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--green)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--green)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--text3)' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--text3)' }} axisLine={false} tickLine={false} tickFormatter={v => `$${Math.round(v / 1000)}k`} />
                <Tooltip
                  formatter={v => formatUsd(v)}
                  contentStyle={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '12px' }}
                />
                <Area type="monotone" dataKey="value" stroke="var(--green)" strokeWidth={2} fill="url(#growthFill)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        <div style={s.card}>
          <div style={s.cardTitle}>Asset allocation</div>
          <div style={s.cardSub}>{allocationData.length ? 'By plan' : 'No holdings yet'}</div>
          {loading ? (
            <EmptyState title="Loading…" />
          ) : allocationData.length === 0 ? (
            <EmptyState title="Nothing allocated yet" />
          ) : (
            <>
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie
                    data={allocationData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={45}
                    outerRadius={70}
                    paddingAngle={2}
                  >
                    {allocationData.map((entry, i) => (
                      <Cell key={entry.name} fill={ALLOCATION_COLORS[i % ALLOCATION_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={v => formatUsd(v)} contentStyle={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '12px' }} />
                </PieChart>
              </ResponsiveContainer>
          
              <div>
                {allocationData.map((a, i) => (
                  <div key={a.name} style={s.legendRow}>
                    <div style={s.legendLeft}>
                      <span style={{ ...s.legendDot, background: ALLOCATION_COLORS[i % ALLOCATION_COLORS.length] }} />
                      <span style={{ color: 'var(--text2)' }}>{a.name}</span>
                    </div>
                    <span style={{ color: 'var(--text)', fontWeight: '600' }}>{a.pct}%</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="responsive-grid-2" style={s.grid2}>
        <div style={s.card}>
          <div style={s.cardTitle}>Recent transactions</div>
          <div style={s.cardSub}>Deposits, withdrawals, and account activity</div>

          {loading ? (
            <EmptyState title="Loading…" />
          ) : transactions.length === 0 ? (
            <EmptyState
              title="No transactions yet"
              sub="Once you make a deposit, it'll show up here — pending until verified."
            />
          ) : (
          transactions.map((tx, i) => {
  const meta = txnIconMeta(tx.type);
  const isNegative = tx.type === 'withdrawal' || tx.type === 'admin_debit';
  const isResolved = tx.status === 'verified';
  const amountColor = isResolved ? meta.color : 'var(--text3)';
  return (
    <div key={tx.id} style={{ ...s.txnItem, ...(i === transactions.length - 1 ? { borderBottom: 'none' } : {}) }}>
      <div style={s.txnLeft}>
        <div style={{ ...s.txnIcon, background: isResolved ? meta.bg : 'var(--bg3)', color: amountColor }}>{meta.icon}</div>
        <div>
          <div style={s.txnName}>{meta.label}{tx.status === 'pending' ? ' (pending)' : tx.status === 'rejected' ? ' (rejected)' : ''}</div>
          <div style={s.txnDate}>{new Date(tx.created_at).toLocaleDateString()}</div>
        </div>
      </div>
      <div style={{ ...s.txnAmount, color: amountColor }}>
        {isNegative ? '−' : '+'}{formatUsd(tx.amount_usd)}
      </div>
    </div>
  );
})
          )}
        </div>
    

        <TopPerformers investments={investments} loading={loading} />
      </div>
    </div>
  )
}