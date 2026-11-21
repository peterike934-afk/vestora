"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "framer-motion";
import { useLocale, useTranslations } from "next-intl";
import { gsap } from "@/lib/gsap";
import { getInvestmentPlans } from "@/lib/queries";
import { useLandingMarketData } from "@/components/LandingMarketDataProvider";

const DASHBOARD_VIEWS = [
  { id: "overview", label: "Overview" },
  { id: "investments", label: "Investments" },
  { id: "markets", label: "Markets" },
  { id: "transactions", label: "Transactions" },
];

const DEMO_TRANSACTIONS = [
  { type: "Deposit", date: "October 24, 2026", amount: "+$1,250.00", status: "Verified", icon: "↓" },
  { type: "Withdrawal", date: "October 19, 2026", amount: "−$320.00", status: "Processing", icon: "↗" },
  { type: "Deposit", date: "October 12, 2026", amount: "+$800.00", status: "Completed", icon: "↓" },
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

function ShowcaseGlobe() {
  return (
    <div className="showcase__environment" aria-hidden="true">
      <div className="showcase__globe">
        <svg viewBox="0 0 640 640" focusable="false">
          <defs>
            <radialGradient id="vestora-globe-fill" cx="38%" cy="34%" r="70%">
              <stop offset="0%" stopColor="#28583f" stopOpacity=".4" />
              <stop offset="68%" stopColor="#102d20" stopOpacity=".2" />
              <stop offset="100%" stopColor="#071710" stopOpacity=".04" />
            </radialGradient>
            <clipPath id="vestora-globe-clip"><circle cx="320" cy="320" r="285" /></clipPath>
          </defs>
          <circle cx="320" cy="320" r="285" fill="url(#vestora-globe-fill)" stroke="#9ac4a5" strokeOpacity=".22" />
          <g className="showcase__globe-grid" clipPath="url(#vestora-globe-clip)" fill="none" stroke="#a9ccb2" strokeOpacity=".2">
            <ellipse cx="320" cy="320" rx="112" ry="285" />
            <ellipse cx="320" cy="320" rx="218" ry="285" />
            <ellipse cx="320" cy="320" rx="285" ry="92" />
            <ellipse cx="320" cy="320" rx="285" ry="188" />
            <path d="M35 320h570M57 208h526M57 432h526" strokeOpacity=".12" />
            <path d="M110 520C208 407 315 337 542 260M70 357C228 263 369 207 574 178M148 114C258 235 390 362 530 522" stroke="#a9ccb2" strokeOpacity=".18" />
          </g>
          <g className="showcase__globe-signals" fill="#b4d7bd">
            <circle cx="157" cy="272" r="3" />
            <circle cx="278" cy="168" r="2.5" />
            <circle cx="430" cy="253" r="3" />
            <circle cx="375" cy="405" r="2.5" />
            <circle cx="206" cy="438" r="2" />
          </g>
          <g fill="none" stroke="#9fc6a9" strokeOpacity=".3">
            <path d="M157 272C218 188 343 192 430 253" />
            <path d="M206 438C269 393 329 397 375 405" />
            <path d="M278 168C294 260 334 334 375 405" strokeOpacity=".2" />
          </g>
        </svg>
      </div>
      <div className="showcase__network" />
    </div>
  );
}

function DemoDisclosure() {
  return (
    <p className="showcase-demo-disclosure">
      <span aria-hidden="true">i</span>
      Interactive product demonstration · Account balances, activity and investment progress are illustrative examples.
    </p>
  );
}

function DemoPortfolioChart() {
  return (
    <section className="showcase-demo-chart">
      <div className="showcase-demo-chart__head">
        <div><small>Portfolio overview</small><strong>Illustrative sample chart</strong></div>
        <span>Not historical performance</span>
      </div>
      <div className="showcase-demo-chart__plot">
        <div className="showcase-demo-chart__lines" aria-hidden="true"><i /><i /><i /></div>
        <svg viewBox="0 0 680 180" preserveAspectRatio="none" role="img" aria-label="Illustrative portfolio chart, not historical investment performance">
          <path className="showcase-demo-chart__area" d="M0 148 C52 142 58 110 112 122 S182 145 236 103 S310 82 360 94 S442 52 488 68 S572 76 620 44 S660 39 680 23 L680 180 L0 180Z" />
          <path className="showcase-demo-chart__line" pathLength="1" d="M0 148 C52 142 58 110 112 122 S182 145 236 103 S310 82 360 94 S442 52 488 68 S572 76 620 44 S660 39 680 23" />
        </svg>
      </div>
      <div className="showcase-demo-chart__axis"><span>Illustrative period start</span><span>Illustrative period end</span></div>
    </section>
  );
}

function DemoActivity({ compact = false }) {
  return (
    <section className={`showcase-demo-activity${compact ? " showcase-demo-activity--compact" : ""}`}>
      <div className="showcase-demo-section-head">
        <div><small>Example account activity</small><strong>Recent transactions</strong></div>
        <span>DEMO</span>
      </div>
      {DEMO_TRANSACTIONS.slice(0, compact ? 2 : 3).map((transaction) => (
        <div className="showcase-demo-transaction" key={`${transaction.type}-${transaction.date}`}>
          <span className="showcase-demo-transaction__icon" aria-hidden="true">{transaction.icon}</span>
          <span className="showcase-demo-transaction__details">
            <strong>{transaction.type}</strong>
            <small>{transaction.date} · Demonstration data</small>
          </span>
          <span className="showcase-demo-transaction__end">
            <strong>{transaction.amount}</strong>
            <small className={`showcase-demo-status showcase-demo-status--${transaction.status.toLowerCase()}`}>{transaction.status}</small>
          </span>
        </div>
      ))}
    </section>
  );
}

function OverviewView({ balanceVisible, onToggleBalance, featuredPlan }) {
  return (
    <div className="showcase-view showcase-view--overview">
      <section className="showcase-demo-balance">
        <div className="showcase-demo-balance__top">
          <span>Example total portfolio</span>
          <span className="showcase-demo-balance__tag">ILLUSTRATIVE</span>
        </div>
        <div className="showcase-demo-balance__value">
          <strong>{balanceVisible ? "$31,240.00" : "••••••••"}</strong>
          <button type="button" onClick={onToggleBalance} aria-label={balanceVisible ? "Hide demonstration balance" : "Show demonstration balance"} aria-pressed={!balanceVisible}>
            {balanceVisible ? "Hide" : "Show"}
          </button>
        </div>
        <div className="showcase-demo-balance__foot">
          <span>Example available balance <b>{balanceVisible ? "$8,640.00" : "••••••"}</b></span>
          <span>Demo account · Not customer data</span>
        </div>
      </section>

      <section className="showcase-demo-plan-summary">
        <small>Investment summary</small>
        <strong>{featuredPlan?.name || "Published investment plans"}</strong>
        <span>{featuredPlan ? `${featuredPlan.term_days} day term · ${featuredPlan.apy_percent}% APY published` : "Published terms shown when available"}</span>
        <div><span>Example invested amount</span><b>$22,600.00</b></div>
        <em>Illustrative demo amount</em>
      </section>

      <DemoPortfolioChart />
      <DemoActivity compact />
    </div>
  );
}

function InvestmentsView({ plans, plansLoading, plansError }) {
  return (
    <div className="showcase-view showcase-view--investments">
      <div className="showcase-view-intro">
        <div><small>Investment workspace</small><h4>Plans &amp; progress</h4></div>
        <span>Sample amounts and progress · DEMO</span>
      </div>
      {plansLoading ? (
        <p className="showcase-view-message">Loading published investment plans…</p>
      ) : plansError ? (
        <p className="showcase-view-message">Published plan details are temporarily unavailable.</p>
      ) : plans.length ? (
        <div className="showcase-investment-list">
          {plans.slice(0, 3).map((plan, index) => (
            <article className="showcase-investment-card" key={plan.id || plan.name}>
              <div className="showcase-investment-card__top">
                <span className="showcase-investment-card__mark">V</span>
                <span className="showcase-investment-card__title"><strong>{plan.name}</strong><small>Published terms · {plan.term_days} days</small></span>
                <span className="showcase-demo-pill">Demo</span>
              </div>
              <p>{plan.description}</p>
              <div className="showcase-investment-card__metrics">
                <span><small>Example amount</small><strong>{formatPrice(DEMO_INVESTMENT_AMOUNTS[index])}</strong></span>
                <span><small>Published rate</small><strong>{plan.apy_percent}% APY</strong></span>
                <span><small>Example status</small><strong className="showcase-investment-card__status">Illustrative</strong></span>
              </div>
              <div className="showcase-demo-progress" aria-label={`Illustrative sample term progress ${DEMO_PROGRESS[index]} percent`}>
                <span style={{ "--demo-progress": `${DEMO_PROGRESS[index]}%` }} />
              </div>
              <div className="showcase-investment-card__foot"><span>Illustrative term progress</span><b>{DEMO_PROGRESS[index]}%</b></div>
            </article>
          ))}
        </div>
      ) : (
        <p className="showcase-view-message">No published investment plans are currently available.</p>
      )}
      <p className="showcase-view-footnote">Plan names, durations and APY are from published plan data. Example amounts and progress are illustrative only.</p>
    </div>
  );
}

function MarketsView({ stocks, loading, error }) {
  const marketStocks = stocks.slice(0, 5);

  return (
    <div className="showcase-view showcase-view--markets">
      <div className="showcase-view-intro">
        <div><small>Market intelligence</small><h4>Public market snapshot</h4></div>
        <span>Live quote data · Not portfolio performance</span>
      </div>
      <div className="showcase-market-table">
        <div className="showcase-market-table__head"><span>Asset</span><span>Price</span><span>Day move</span><span>Movement</span></div>
        {loading ? (
          <p className="showcase-view-message">Connecting to live market data…</p>
        ) : marketStocks.length ? (
          marketStocks.map((stock) => {
            const change = Number(stock.changePercent);
            const direction = Number.isFinite(change) && change < 0 ? "down" : "up";
            const offset = Number.isFinite(change) ? Math.min(Math.abs(change) * 4, 44) : 0;
            return (
              <div className="showcase-market-row" key={stock.symbol}>
                <span className="showcase-market-row__asset">
                  <i>{stock.symbol.slice(0, 1)}</i><span><strong>{stock.name}</strong><small>{stock.symbol}</small></span>
                </span>
                <strong className="showcase-market-row__price">{formatPrice(stock.price)}</strong>
                <b className={`showcase-market-row__change is-${direction}`}>
                  {Number.isFinite(change) ? `${change > 0 ? "+" : ""}${change.toFixed(2)}%` : "—"}
                </b>
                <span className={`showcase-market-row__range is-${direction}`} aria-label="Today's movement from previous close">
                  <i style={{ "--market-change-offset": `${offset}%` }} />
                </span>
              </div>
            );
          })
        ) : (
          <p className="showcase-view-message">{error || "Public market quotes are temporarily unavailable."}</p>
        )}
      </div>
      <div className="showcase-market-foot"><span>Public market data from Vestora market feeds</span><span>Refreshes every minute while this page is visible</span></div>
    </div>
  );
}

function TransactionsView() {
  return (
    <div className="showcase-view showcase-view--transactions">
      <div className="showcase-view-intro">
        <div><small>Account activity</small><h4>Transaction history</h4></div>
        <span>Illustrative records · DEMO</span>
      </div>
      <DemoActivity />
      <p className="showcase-view-footnote">These example deposits and withdrawals are fictional product-demo content, not customer records.</p>
    </div>
  );
}

export default function DashboardShowcase() {
  const t = useTranslations("DashboardShowcase");
  const locale = useLocale();
  const reduceMotion = useReducedMotion();
  const sectionRef = useRef(null);
  const glowRef = useRef(null);
  const inView = useInView(sectionRef, { once: true, margin: "-100px" });
  const { stocks, loading: marketsLoading, error: marketsError, updatedAt } = useLandingMarketData();
  const [plans, setPlans] = useState([]);
  const [plansLoading, setPlansLoading] = useState(true);
  const [plansError, setPlansError] = useState(false);
  const [activeView, setActiveView] = useState("overview");
  const [balanceVisible, setBalanceVisible] = useState(true);

  useEffect(() => {
    let active = true;
    setPlansLoading(true);
    setPlansError(false);
    getInvestmentPlans(locale)
      .then((availablePlans) => {
        if (active) setPlans(availablePlans);
      })
      .catch((error) => {
        console.error("Failed to load investment plans for dashboard preview:", error);
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
    const glow = glowRef.current;
    if (!glow || reduceMotion) return undefined;

    const tween = gsap.to(glow, {
      y: 120,
      ease: "none",
      scrollTrigger: {
        trigger: sectionRef.current,
        start: "top bottom",
        end: "bottom top",
        scrub: true,
      },
    });

    return () => {
      tween.scrollTrigger?.kill();
      tween.kill();
    };
  }, [reduceMotion]);

  const featuredPlan = plans[0];
  const updatedTime = updatedAt
    ? new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(updatedAt)
    : null;
  const activeLabel = DASHBOARD_VIEWS.find((view) => view.id === activeView)?.label || "Overview";

  const renderActiveView = () => {
    switch (activeView) {
      case "investments":
        return <InvestmentsView plans={plans} plansLoading={plansLoading} plansError={plansError} />;
      case "markets":
        return <MarketsView stocks={stocks} loading={marketsLoading} error={marketsError} />;
      case "transactions":
        return <TransactionsView />;
      default:
        return (
          <OverviewView
            balanceVisible={balanceVisible}
            onToggleBalance={() => setBalanceVisible((visible) => !visible)}
            featuredPlan={featuredPlan}
          />
        );
    }
  };

  return (
    <section className="showcase" ref={sectionRef}>
      <ShowcaseGlobe />
      <div className="showcase__glow" ref={glowRef} aria-hidden="true" />

      <div className="showcase__inner">
        <motion.p
          className="showcase__eyebrow"
          initial={{ opacity: 0, y: 10 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5 }}
        >
          {t("eyebrow")}
        </motion.p>

        <motion.h2
          className="showcase__headline"
          initial={{ opacity: 0, y: 16 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, delay: 0.1 }}
        >
          {t("headlineLine1")}<br />{t("headlineLine2")}
        </motion.h2>

        <DemoDisclosure />

        <motion.div
          className="showcase__stage"
          initial={{ opacity: 0, y: 40 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.8, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="showcase-window">
            <aside className="showcase-sidebar" aria-label="Interactive dashboard demonstration navigation">
              <div className="showcase-sidebar__brand"><span>V</span><strong>Vestora</strong></div>
              <div className="showcase-sidebar__nav">
                {DASHBOARD_VIEWS.map((view) => (
                  <button
                    type="button"
                    className={activeView === view.id ? "is-active" : ""}
                    key={view.id}
                    aria-current={activeView === view.id ? "page" : undefined}
                    onClick={() => setActiveView(view.id)}
                  >
                    {view.label}
                  </button>
                ))}
              </div>
              <div className="showcase-sidebar__profile"><span>V</span><div><strong>Demo workspace</strong><small>Interactive preview</small></div></div>
            </aside>

            <div className="showcase-dashboard">
              <header className="showcase-dashboard__header">
                <div><small>Investment workspace · Interactive demo</small><h3>{activeLabel}</h3></div>
                <span className="showcase-dashboard__live">
                  <i aria-hidden="true" />
                  {marketsLoading ? "Connecting" : marketsError ? "Feed unavailable" : "Live market feed"}
                </span>
              </header>
              <nav className="showcase-dashboard__tabs" aria-label="Dashboard demonstration views">
                {DASHBOARD_VIEWS.map((view) => (
                  <button
                    type="button"
                    className={activeView === view.id ? "is-active" : ""}
                    key={view.id}
                    aria-current={activeView === view.id ? "page" : undefined}
                    onClick={() => setActiveView(view.id)}
                  >
                    {view.label}
                  </button>
                ))}
              </nav>
              <div className="showcase-dashboard__content" aria-live="polite">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={activeView}
                    className="showcase-dashboard__view"
                    initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={reduceMotion ? undefined : { opacity: 0, y: -6 }}
                    transition={{ duration: reduceMotion ? 0 : 0.2 }}
                  >
                    {renderActiveView()}
                  </motion.div>
                </AnimatePresence>
              </div>
              <div className="showcase-dashboard__footer">
                <span>Interactive product demonstration</span>
                <span>{updatedTime ? `Market data updated ${updatedTime}` : "Market data refreshes every minute"}</span>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
