"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useLocale } from "next-intl";
import { getInvestmentPlans } from "@/lib/queries";
import { useLandingMarketData } from "@/components/LandingMarketDataProvider";

const PHONE_VIEWS = [
  { id: "overview", label: "Overview", icon: "⌂" },
  { id: "investments", label: "Plans", icon: "▤" },
  { id: "transactions", label: "Activity", icon: "↕" },
  { id: "markets", label: "Markets", icon: "⌁" },
];

const DEMO_TRANSACTIONS = [
  { type: "Deposit", date: "Oct 24, 2026", amount: "+$1,250.00", status: "Verified", icon: "↓" },
  { type: "Withdrawal", date: "Oct 19, 2026", amount: "−$320.00", status: "Processing", icon: "↗" },
  { type: "Deposit", date: "Oct 12, 2026", amount: "+$800.00", status: "Completed", icon: "↓" },
];

const DEMO_INVESTMENT_AMOUNTS = [2400, 1200, 800];
const DEMO_PROGRESS = [68, 42, 24];

function formatPrice(value) {
  const price = Number(value);
  if (!Number.isFinite(price)) return "—";
  return price.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

function DemoLabel() {
  return <span className="phone-demo-label">Illustrative demo data</span>;
}

function OverviewView() {
  return (
    <div className="phone-demo-content">
      <div className="phone-app__greeting">
        <span>Portfolio overview</span>
        <small>Demo account</small>
      </div>
      <section className="phone-balance">
        <div>
          <span>Example portfolio value</span>
          <strong>$31,240.00</strong>
          <small>Available balance · $8,640.00</small>
        </div>
        <span className="phone-balance__status">DEMO</span>
      </section>
      <section className="phone-chart">
        <div className="phone-chart__head">
          <span>Portfolio overview</span>
          <span>Illustrative</span>
        </div>
        <svg viewBox="0 0 248 82" preserveAspectRatio="none" role="img" aria-label="Illustrative portfolio chart, not historical performance">
          <path className="phone-chart__line" pathLength="1" d="M0 70 C26 66 35 48 58 54 S88 68 112 46 S150 22 174 32 S215 48 248 16" fill="none" stroke="#70c39a" strokeWidth="3" strokeLinecap="round" />
          <path d="M0 70 C26 66 35 48 58 54 S88 68 112 46 S150 22 174 32 S215 48 248 16 L248 82 L0 82 Z" fill="rgba(112,195,154,.12)" />
        </svg>
      </section>
      <div className="phone-demo-summary">
        <div><span>Invested in example</span><strong>$22,600.00</strong></div>
        <div><span>Active plans</span><strong>03</strong></div>
      </div>
      <DemoLabel />
    </div>
  );
}

function InvestmentsView({ plans, plansLoading, plansError }) {
  return (
    <div className="phone-demo-content phone-demo-content--scroll">
      <div className="phone-app__greeting">
        <span>Investment plans</span>
        <small>Published terms</small>
      </div>
      {plansLoading ? (
        <p className="phone-demo-message">Loading published plans…</p>
      ) : plansError ? (
        <p className="phone-demo-message">Published plan details are temporarily unavailable.</p>
      ) : plans.length ? (
        <div className="phone-demo-plan-list">
          {plans.slice(0, 3).map((plan, index) => (
            <article className="phone-demo-plan" key={plan.id || plan.name}>
              <div className="phone-demo-plan__top">
                <span className="phone-plan__icon" aria-hidden="true">V</span>
                <span className="phone-demo-plan__details">
                  <strong>{plan.name}</strong>
                  <small>{plan.term_days} day term · {plan.apy_percent}% APY published</small>
                </span>
                <span className="phone-demo-plan__status">Demo</span>
              </div>
              <div className="phone-demo-plan__amount">
                <span>Example amount</span><strong>{formatPrice(DEMO_INVESTMENT_AMOUNTS[index])}</strong>
              </div>
              <div className="phone-demo-progress" aria-label={`Illustrative sample progress ${DEMO_PROGRESS[index]} percent`}>
                <span style={{ "--demo-progress": `${DEMO_PROGRESS[index]}%` }} />
              </div>
              <small className="phone-demo-plan__caption">Illustrative term progress</small>
            </article>
          ))}
        </div>
      ) : (
        <p className="phone-demo-message">No published plans are currently available.</p>
      )}
      <DemoLabel />
    </div>
  );
}

function TransactionsView() {
  return (
    <div className="phone-demo-content">
      <div className="phone-app__greeting">
        <span>Transactions</span>
        <small>Example history</small>
      </div>
      <div className="phone-demo-transactions">
        {DEMO_TRANSACTIONS.map((transaction) => (
          <article className="phone-demo-transaction" key={`${transaction.type}-${transaction.date}`}>
            <span className="phone-demo-transaction__icon" aria-hidden="true">{transaction.icon}</span>
            <span className="phone-demo-transaction__details">
              <strong>{transaction.type}</strong>
              <small>{transaction.date} · Demo</small>
              <b className={`phone-demo-status phone-demo-status--${transaction.status.toLowerCase()}`}>{transaction.status}</b>
            </span>
            <strong className="phone-demo-transaction__amount">{transaction.amount}</strong>
          </article>
        ))}
      </div>
      <DemoLabel />
    </div>
  );
}

function MarketsView({ stocks, loading, error }) {
  const quotes = stocks.slice(0, 4);

  return (
    <div className="phone-demo-content">
      <div className="phone-app__greeting">
        <span>Markets</span>
        <small>Public quotes</small>
      </div>
      {loading ? (
        <p className="phone-demo-message">Connecting to market data…</p>
      ) : quotes.length ? (
        <div className="phone-demo-markets">
          {quotes.map((stock) => {
            const change = Number(stock.changePercent);
            return (
              <article className="phone-demo-market" key={stock.symbol}>
                <span className="phone-demo-market__asset">
                  <i>{stock.symbol.slice(0, 1)}</i>
                  <span><strong>{stock.name}</strong><small>{stock.symbol}</small></span>
                </span>
                <span className="phone-demo-market__quote">
                  <strong>{formatPrice(stock.price)}</strong>
                  <b className={change >= 0 ? "is-up" : "is-down"}>
                    {Number.isFinite(change) ? `${change > 0 ? "+" : ""}${change.toFixed(2)}%` : "—"}
                  </b>
                </span>
                <svg className="phone-demo-market__spark" viewBox="0 0 64 18" aria-hidden="true">
                  <path d={change >= 0 ? "M3 12 L61 6" : "M3 6 L61 12"} />
                  <circle cx="61" cy={change >= 0 ? "6" : "12"} r="2" />
                </svg>
              </article>
            );
          })}
        </div>
      ) : (
        <p className="phone-demo-message">{error || "Public market quotes are temporarily unavailable."}</p>
      )}
      <p className="phone-demo-market-note">Live public market quotes · Not account performance</p>
    </div>
  );
}

export default function PortfolioCard() {
  const locale = useLocale();
  const reduceMotion = useReducedMotion();
  const { stocks, loading: marketsLoading, error: marketsError } = useLandingMarketData();
  const [activeView, setActiveView] = useState("overview");
  const [plans, setPlans] = useState([]);
  const [plansLoading, setPlansLoading] = useState(true);
  const [plansError, setPlansError] = useState(false);

  useEffect(() => {
    let active = true;
    setPlansLoading(true);
    setPlansError(false);
    getInvestmentPlans(locale)
      .then((availablePlans) => {
        if (active) setPlans(availablePlans);
      })
      .catch((error) => {
        console.error("Failed to load investment plans for phone preview:", error);
        if (active) setPlansError(true);
      })
      .finally(() => {
        if (active) setPlansLoading(false);
      });

    return () => {
      active = false;
    };
  }, [locale]);

  useEffect(() => {
    if (reduceMotion) return undefined;
    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      setActiveView((current) => {
        const index = PHONE_VIEWS.findIndex((view) => view.id === current);
        return PHONE_VIEWS[(index + 1) % PHONE_VIEWS.length].id;
      });
    }, 6000);
    return () => window.clearInterval(intervalId);
  }, [activeView, reduceMotion]);

  const renderView = () => {
    switch (activeView) {
      case "investments":
        return <InvestmentsView plans={plans} plansLoading={plansLoading} plansError={plansError} />;
      case "transactions":
        return <TransactionsView />;
      case "markets":
        return <MarketsView stocks={stocks} loading={marketsLoading} error={marketsError} />;
      default:
        return <OverviewView />;
    }
  };

  return (
    <div className="portfolio-grid hero-device-stage" aria-label="Interactive Vestora mobile application demonstration">
      <motion.div
        className="hero-plan-preview"
        animate={reduceMotion ? undefined : { y: [0, -7, 0] }}
        transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
      >
        <div className="hero-plan-preview__top">
          <span>Published plans</span>
          <span className="hero-plan-preview__badge">Interactive</span>
        </div>
        <strong>Explore Vestora</strong>
        <div className="hero-plan-preview__rule" />
        <div className="hero-plan-preview__meta">
          <span>Product demo</span>
          <span>Plan details</span>
        </div>
      </motion.div>

      <motion.div
        className="phone-shell"
        initial={{ opacity: 0, y: 28, rotate: 1.5 }}
        animate={{ opacity: 1, y: 0, rotate: 0 }}
        transition={{ duration: 0.8, delay: 0.35, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="phone-shell__buttons phone-shell__buttons--left" aria-hidden="true" />
        <div className="phone-shell__buttons phone-shell__buttons--right" aria-hidden="true" />
        <div className="phone-screen">
          <div className="phone-statusbar">
            <span>9:41</span>
            <div className="phone-statusbar__icons" aria-hidden="true"><i /><i /><i /></div>
          </div>
          <div className="phone-app">
            <header className="phone-app__header">
              <div className="phone-app__brand">
                <span className="phone-app__mark" aria-hidden="true">V</span>
                <strong>Vestora</strong>
              </div>
              <span className="phone-app__demo-tag">DEMO</span>
            </header>

            <div className="phone-demo-view" aria-live="polite">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={activeView}
                  className="phone-demo-view__screen"
                  initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduceMotion ? undefined : { opacity: 0, y: -6 }}
                  transition={{ duration: reduceMotion ? 0 : 0.22 }}
                >
                  {renderView()}
                </motion.div>
              </AnimatePresence>
            </div>

            <nav className="phone-app__nav" aria-label="Product demonstration navigation">
              {PHONE_VIEWS.map((view) => (
                <button
                  type="button"
                  key={view.id}
                  className={activeView === view.id ? "is-active" : ""}
                  aria-label={view.label}
                  aria-pressed={activeView === view.id}
                  onClick={() => setActiveView(view.id)}
                >
                  <i aria-hidden="true">{view.icon}</i><span>{view.label}</span>
                </button>
              ))}
            </nav>
          </div>
        </div>
      </motion.div>

      <motion.div
        className="hero-transaction-preview"
        animate={reduceMotion ? undefined : { y: [0, 8, 0] }}
        transition={{ duration: 7, repeat: Infinity, ease: "easeInOut", delay: 0.4 }}
      >
        <span className="hero-transaction-preview__icon" aria-hidden="true">↗</span>
        <div>
          <span>Interactive walkthrough</span>
          <strong>Switch app screens</strong>
        </div>
        <b>Demo</b>
      </motion.div>
    </div>
  );
}
