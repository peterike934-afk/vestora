"use client";

import { useState, useEffect, useCallback } from 'react'
import { TrendingUp, TrendingDown, RefreshCw } from 'lucide-react'
import { getInvestmentPlans } from '@/lib/queries'

const s = {
  page: { padding: '32px 36px' },
  title: { fontSize: '26px', fontWeight: '700', color: 'var(--text)', marginBottom: '4px' },
  sub: { fontSize: '14px', color: 'var(--text2)', marginBottom: '28px' },
  tabs: { display: 'flex', gap: '8px', marginBottom: '20px', flexWrap: 'wrap' },
  tab: { padding: '10px 18px', borderRadius: '999px', fontSize: '13px', fontWeight: '600', cursor: 'pointer', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text2)' },
  tabActive: { background: 'var(--green)', color: '#000', border: '1px solid var(--green)' },
  tabDisabled: { opacity: 0.4, cursor: 'not-allowed' },
  card: { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '24px' },
  cardHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' },
  cardTitle: { fontSize: '15px', fontWeight: '600', color: 'var(--text)' },
  refreshRow: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--text3)' },
  refreshBtn: { background: 'transparent', border: 'none', color: 'var(--text2)', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '4px' },
  th: { fontSize: '11px', fontWeight: '500', color: 'var(--text3)', letterSpacing: '0.06em', textTransform: 'uppercase', padding: '0 10px 14px 0', textAlign: 'left' },
  td: { padding: '13px 10px 13px 0', borderTop: '1px solid var(--border)', fontSize: '13px', color: 'var(--text)' },
  coinCell: { display: 'flex', alignItems: 'center', gap: '10px' },
  coinImg: { width: '26px', height: '26px', borderRadius: '50%', flexShrink: 0 },
  coinName: { fontWeight: '500', color: 'var(--text)' },
  coinSymbol: { fontSize: '11px', color: 'var(--text3)', textTransform: 'uppercase' },
  changeUp: { color: 'var(--green)', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '4px' },
  changeDown: { color: 'var(--red)', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '4px' },
  empty: { textAlign: 'center', padding: '40px', color: 'var(--text3)', fontSize: '14px' },
  error: { fontSize: '13px', color: 'var(--red)', background: 'var(--red-dim)', padding: '10px 14px', borderRadius: 'var(--radius-sm)', marginBottom: '16px' },
  comingSoon: { textAlign: 'center', padding: '60px 20px', color: 'var(--text3)' },
  comingSoonTitle: { fontSize: '15px', fontWeight: '600', color: 'var(--text)', marginBottom: '6px' },
  heroRow: { display: 'flex', flexWrap: 'wrap', gap: '32px', alignItems: 'flex-end', marginBottom: '24px' },
  heroPrice: { fontSize: '42px', fontWeight: '700', color: 'var(--text)', letterSpacing: '-0.01em' },
  heroLabel: { fontSize: '12px', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' },
  statGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '16px' },
  statBox: { background: 'var(--bg3)', borderRadius: 'var(--radius-sm)', padding: '14px 16px' },
  statBoxLabel: { fontSize: '11px', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' },
  statBoxValue: { fontSize: '15px', fontWeight: '600', color: 'var(--text)' },
  asOfNote: { fontSize: '12px', color: 'var(--text3)', marginBottom: '20px' },
  planGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px' },
  planCard: { background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '20px' },
  planName: { fontSize: '15px', fontWeight: '600', color: 'var(--text)', marginBottom: '4px' },
  planDesc: { fontSize: '12px', color: 'var(--text3)', marginBottom: '14px', lineHeight: 1.5 },
  planApy: { fontSize: '24px', fontWeight: '700', color: 'var(--green)' },
  planMeta: { fontSize: '12px', color: 'var(--text2)', marginTop: '8px' },
}

const ASSET_TABS = [
  { key: 'crypto', label: 'Crypto', live: true },
  { key: 'stocks', label: 'Stocks', live: true },
  { key: 'gold', label: 'Gold', live: true },
  { key: 'bonds', label: 'Bonds', live: true },
  { key: 'ai', label: 'AI Portfolios', live: true },
]

const REFRESH_MS = 45000 // CoinGecko's free public API is rate-limited — 45s keeps us well under it
const REFRESH_MS_STOCKS = 60000 // Finnhub free tier — a longer interval keeps shared rate-limit usage safe

// Crypto prices span wildly different magnitudes ($60,000 BTC vs
// $0.00002 SHIB), so a fixed 2-decimal format breaks down — this picks
// a sensible decimal count based on the price itself.
function formatCryptoPrice(n) {
  const num = Number(n) || 0
  if (num >= 1) return `$${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  if (num >= 0.01) return `$${num.toFixed(4)}`
  return `$${num.toFixed(8)}`
}

function formatMarketCap(n) {
  const num = Number(n) || 0
  if (num >= 1e12) return `$${(num / 1e12).toFixed(2)}T`
  if (num >= 1e9) return `$${(num / 1e9).toFixed(2)}B`
  if (num >= 1e6) return `$${(num / 1e6).toFixed(2)}M`
  return `$${num.toLocaleString()}`
}

// Small inline sparkline — no chart library needed for a single trend line.
function Sparkline({ prices, up }) {
  if (!prices || prices.length < 2) return null
  const width = 100
  const height = 32
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  const range = max - min || 1
  const points = prices
    .map((p, i) => {
      const x = (i / (prices.length - 1)) * width
      const y = height - ((p - min) / range) * height
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block' }}>
      <polyline
        points={points}
        fill="none"
        stroke={up ? 'var(--green)' : 'var(--red)'}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function CryptoTab() {
  const [coins, setCoins] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [lastUpdated, setLastUpdated] = useState(null)

  const load = useCallback(async () => {
    setError('')
    try {
      const res = await fetch(
        'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=20&page=1&sparkline=true&price_change_percentage=24h'
      )
      if (!res.ok) throw new Error('Market data request failed.')
      const data = await res.json()
      setCoins(data)
      setLastUpdated(new Date())
    } catch (err) {
      setError('Could not load live market data — will retry shortly.')
      console.error('Failed to load crypto markets:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const interval = setInterval(load, REFRESH_MS)
    return () => clearInterval(interval)
  }, [load])

  return (
    <div style={s.card}>
      <div style={s.cardHead}>
        <div style={s.cardTitle}>Top coins by market cap</div>
        <div style={s.refreshRow}>
          {lastUpdated && <span>Updated {lastUpdated.toLocaleTimeString()}</span>}
          <button style={s.refreshBtn} onClick={load} aria-label="Refresh now" title="Refresh now">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {error && <div style={s.error}>{error}</div>}

      {loading ? (
        <div style={s.empty}>Loading live prices…</div>
      ) : coins.length === 0 ? (
        <div style={s.empty}>No data available right now.</div>
      ) : (
        <div className="responsive-table-wrap">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['#', 'Coin', 'Price', '24h', '7d trend', 'Market cap'].map(h => (
                  <th key={h} style={s.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {coins.map(coin => {
                const up = coin.price_change_percentage_24h >= 0
                return (
                  <tr key={coin.id}>
                    <td style={{ ...s.td, color: 'var(--text3)' }}>{coin.market_cap_rank}</td>
                    <td style={s.td}>
                      <div style={s.coinCell}>
                        <img src={coin.image} alt="" style={s.coinImg} />
                        <div>
                          <div style={s.coinName}>{coin.name}</div>
                          <div style={s.coinSymbol}>{coin.symbol}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ ...s.td, fontWeight: '600' }}>{formatCryptoPrice(coin.current_price)}</td>
                    <td style={s.td}>
                      <span style={up ? s.changeUp : s.changeDown}>
                        {up ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                        {Math.abs(coin.price_change_percentage_24h || 0).toFixed(2)}%
                      </span>
                    </td>
                    <td style={s.td}>
                      <Sparkline prices={coin.sparkline_in_7d?.price} up={up} />
                    </td>
                    <td style={{ ...s.td, color: 'var(--text2)' }}>{formatMarketCap(coin.market_cap)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// Tries a favicon for the stock's domain via Google's public favicon
// service (no key, no signup, very reliable — unlike Clearbit's free
// Logo API, which has become inconsistent). Falls back to the same
// initials-circle style used elsewhere in the app if even that fails.
function StockLogo({ domain, symbol }) {
  const [failed, setFailed] = useState(false)

  if (!domain || failed) {
    return (
      <div style={{ ...s.coinImg, background: 'var(--bg4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: '700', color: 'var(--text2)' }}>
        {symbol.slice(0, 2)}
      </div>
    )
  }

  return (
    <img
      src={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`}
      alt=""
      style={{ ...s.coinImg, background: '#fff', objectFit: 'contain', padding: '4px' }}
      onError={() => setFailed(true)}
    />
  )
}

function StocksTab() {
  const [stocks, setStocks] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [lastUpdated, setLastUpdated] = useState(null)

  const load = useCallback(async () => {
    setError('')
    try {
      const res = await fetch('/api/markets/stocks')
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setStocks(data.stocks || [])
      setLastUpdated(new Date())
    } catch (err) {
      setError(err.message || 'Could not load live stock data — will retry shortly.')
      console.error('Failed to load stock markets:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const interval = setInterval(load, REFRESH_MS_STOCKS)
    return () => clearInterval(interval)
  }, [load])

  return (
    <div style={s.card}>
      <div style={s.cardHead}>
        <div style={s.cardTitle}>Large-cap stocks</div>
        <div style={s.refreshRow}>
          {lastUpdated && <span>Updated {lastUpdated.toLocaleTimeString()}</span>}
          <button style={s.refreshBtn} onClick={load} aria-label="Refresh now" title="Refresh now">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {error && <div style={s.error}>{error}</div>}

      {loading ? (
        <div style={s.empty}>Loading live prices…</div>
      ) : stocks.length === 0 ? (
        <div style={s.empty}>No data available right now.</div>
      ) : (
        <div className="responsive-table-wrap">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Symbol', 'Price', 'Change', "Day's range", 'Prev close'].map(h => (
                  <th key={h} style={s.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stocks.map(stock => {
                const up = (stock.change || 0) >= 0
                return (
                  <tr key={stock.symbol}>
                    <td style={s.td}>
                      <div style={s.coinCell}>
                        <StockLogo domain={stock.domain} symbol={stock.symbol} />
                        <div>
                          <div style={s.coinName}>{stock.symbol}</div>
                          <div style={s.coinSymbol}>{stock.name}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ ...s.td, fontWeight: '600' }}>
                      {stock.price != null ? `$${stock.price.toFixed(2)}` : '—'}
                    </td>
                    <td style={s.td}>
                      <span style={up ? s.changeUp : s.changeDown}>
                        {up ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                        {stock.change != null ? `${Math.abs(stock.change).toFixed(2)} (${Math.abs(stock.changePercent || 0).toFixed(2)}%)` : '—'}
                      </span>
                    </td>
                    <td style={{ ...s.td, color: 'var(--text2)' }}>
                      {stock.low != null && stock.high != null ? `$${stock.low.toFixed(2)} – $${stock.high.toFixed(2)}` : '—'}
                    </td>
                    <td style={{ ...s.td, color: 'var(--text2)' }}>
                      {stock.previousClose != null ? `$${stock.previousClose.toFixed(2)}` : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function GoldTab() {
  const [gold, setGold] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [lastUpdated, setLastUpdated] = useState(null)

  const load = useCallback(async () => {
    setError('')
    try {
      const res = await fetch('/api/markets/gold')
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setGold(data)
      setLastUpdated(new Date())
    } catch (err) {
      setError(err.message || 'Could not load live gold price — will retry shortly.')
      console.error('Failed to load gold price:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const interval = setInterval(load, 120000) // matches the server's 2-minute cache window
    return () => clearInterval(interval)
  }, [load])

  const up = gold && (gold.change || 0) >= 0

  return (
    <div style={s.card}>
      <div style={s.cardHead}>
        <div style={s.cardTitle}>Gold (XAU/USD) — per troy ounce</div>
        <div style={s.refreshRow}>
          {lastUpdated && <span>Updated {lastUpdated.toLocaleTimeString()}</span>}
          <button style={s.refreshBtn} onClick={load} aria-label="Refresh now" title="Refresh now">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {error && <div style={s.error}>{error}</div>}

      {loading ? (
        <div style={s.empty}>Loading live price…</div>
      ) : !gold ? (
        <div style={s.empty}>No data available right now.</div>
      ) : (
        <>
          <div style={s.heroRow}>
            <div>
              <div style={s.heroLabel}>Current price</div>
              <div style={s.heroPrice}>${gold.price?.toFixed(2)}</div>
            </div>
            <div>
              <div style={s.heroLabel}>Today's change</div>
              <span style={{ ...(up ? s.changeUp : s.changeDown), fontSize: '18px' }}>
                {up ? <TrendingUp size={18} /> : <TrendingDown size={18} />}
                ${Math.abs(gold.change || 0).toFixed(2)} ({Math.abs(gold.changePercent || 0).toFixed(2)}%)
              </span>
            </div>
          </div>

          <div style={s.statGrid}>
            <div style={s.statBox}>
              <div style={s.statBoxLabel}>Open</div>
              <div style={s.statBoxValue}>${gold.open?.toFixed(2) ?? '—'}</div>
            </div>
            <div style={s.statBox}>
              <div style={s.statBoxLabel}>Day's high</div>
              <div style={s.statBoxValue}>${gold.high?.toFixed(2) ?? '—'}</div>
            </div>
            <div style={s.statBox}>
              <div style={s.statBoxLabel}>Day's low</div>
              <div style={s.statBoxValue}>${gold.low?.toFixed(2) ?? '—'}</div>
            </div>
            <div style={s.statBox}>
              <div style={s.statBoxLabel}>Previous close</div>
              <div style={s.statBoxValue}>${gold.previousClose?.toFixed(2) ?? '—'}</div>
            </div>
            {gold.fiftyTwoWeekLow != null && (
              <div style={s.statBox}>
                <div style={s.statBoxLabel}>52-week low</div>
                <div style={s.statBoxValue}>${gold.fiftyTwoWeekLow.toFixed(2)}</div>
              </div>
            )}
            {gold.fiftyTwoWeekHigh != null && (
              <div style={s.statBox}>
                <div style={s.statBoxLabel}>52-week high</div>
                <div style={s.statBoxValue}>${gold.fiftyTwoWeekHigh.toFixed(2)}</div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function BondsTab() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setError('')
    try {
      const res = await fetch('/api/markets/bonds')
      const json = await res.json()
      if (json.error) throw new Error(json.error)
      setData(json)
    } catch (err) {
      setError(err.message || 'Could not load live bond yield data — will retry shortly.')
      console.error('Failed to load bond yields:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const interval = setInterval(load, 3600000) // matches server's hourly cache — this updates once per business day anyway
    return () => clearInterval(interval)
  }, [load])

  return (
    <div style={s.card}>
      <div style={s.cardHead}>
        <div style={s.cardTitle}>US Treasury yield curve</div>
        <button style={s.refreshBtn} onClick={load} aria-label="Refresh now" title="Refresh now">
          <RefreshCw size={14} />
        </button>
      </div>

      {error && <div style={s.error}>{error}</div>}

      {loading ? (
        <div style={s.empty}>Loading live yields…</div>
      ) : !data ? (
        <div style={s.empty}>No data available right now.</div>
      ) : (
        <>
          {data.asOf && <div style={s.asOfNote}>As of {data.asOf}</div>}
          <div style={s.statGrid}>
            {data.yields.map(y => (
              <div key={y.label} style={s.statBox}>
                <div style={s.statBoxLabel}>{y.label}</div>
                <div style={s.statBoxValue}>{y.yield.toFixed(2)}%</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function AiPortfoliosTab() {
  const [plans, setPlans] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    getInvestmentPlans()
      .then(setPlans)
      .catch(err => {
        setError(err.message || 'Could not load plans.')
        console.error('Failed to load investment plans:', err)
      })
      .finally(() => setLoading(false))
  }, [])

  return (
    <div style={s.card}>
      <div style={s.cardHead}>
        <div style={s.cardTitle}>Vestora managed portfolios</div>
      </div>
      <p style={{ fontSize: '13px', color: 'var(--text3)', marginTop: '-12px', marginBottom: '20px' }}>
        These aren't priced by an external market — they're your platform's own plans, shown live from your catalog.
      </p>

      {error && <div style={s.error}>{error}</div>}

      {loading ? (
        <div style={s.empty}>Loading…</div>
      ) : plans.length === 0 ? (
        <div style={s.empty}>No active plans yet — add one in Platform Settings.</div>
      ) : (
        <div style={s.planGrid}>
          {plans.map(plan => (
            <div key={plan.id} style={s.planCard}>
              <div style={s.planName}>{plan.name}</div>
              {plan.description && <div style={s.planDesc}>{plan.description}</div>}
              <div style={s.planApy}>{plan.apy_percent}% APY</div>
              <div style={s.planMeta}>{plan.term_days}-day term · min ${Number(plan.min_amount).toLocaleString()}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ComingSoonTab({ label }) {
  return (
    <div style={s.card}>
      <div style={s.comingSoon}>
        <div style={s.comingSoonTitle}>{label} data coming soon</div>
        <p style={{ fontSize: '13px' }}>Live {label.toLowerCase()} pricing will appear here once it's connected.</p>
      </div>
    </div>
  )
}

export default function MarketsPage() {
  const [tab, setTab] = useState('crypto')

  return (
    <div style={s.page}>
      <h1 style={s.title}>Markets</h1>
      <p style={s.sub}>Live pricing across every asset class Vestora supports</p>

      <div style={s.tabs}>
        {ASSET_TABS.map(t => (
          <button
            key={t.key}
            style={{
              ...s.tab,
              ...(tab === t.key ? s.tabActive : {}),
              ...(!t.live && tab !== t.key ? s.tabDisabled : {}),
            }}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'crypto' && <CryptoTab />}
      {tab === 'stocks' && <StocksTab />}
      {tab === 'gold' && <GoldTab />}
      {tab === 'bonds' && <BondsTab />}
      {tab === 'ai' && <AiPortfoliosTab />}
    </div>
  )
}