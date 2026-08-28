"use client";

import { useRef, useState, useEffect } from "react";
import { motion, useInView } from "framer-motion";
import { Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getInvestmentPlans } from "@/lib/queries";

// Shown once, applies across every plan — not plan-specific, since
// asset access isn't gated by tier in this product.
const ASSET_CLASSES = ["Crypto", "Stocks", "Real Estate", "Bonds"];

function formatAmount(n) {
  return `$${Number(n).toLocaleString()}`;
}

function formatRange(min, max) {
  if (max) return `${formatAmount(min)} – ${formatAmount(max)}`;
  return `${formatAmount(min)}+`;
}

function PricingCard({ plan, index, inView, highlighted, ctaHref, ctaLabel }) {
  return (
    <motion.div
      className={`pricing-card ${highlighted ? "pricing-card--highlighted" : ""}`}
      initial={{ opacity: 0, y: 24 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.5, delay: index * 0.1 }}
    >
      {highlighted && <span className="pricing-card__badge">Most popular</span>}

      <h3 className="pricing-card__name">{plan.name}</h3>
      <p className="pricing-card__desc">{plan.description}</p>

      <div className="pricing-card__price">
        <span className="pricing-card__amount">{plan.apy_percent}%</span>
        <span className="pricing-card__period">APY</span>
      </div>
      <p style={{ fontSize: "13px", opacity: 0.7, marginTop: "-8px", marginBottom: "20px" }}>
        Invest {formatRange(plan.min_amount, plan.max_amount)} · {plan.term_days}-day term
      </p>

      <a
        href={ctaHref}
        className={`btn ${highlighted ? "btn--primary" : "btn--ghost"} pricing-card__cta`}
      >
        {ctaLabel}
      </a>

      <ul className="pricing-card__features">
        {ASSET_CLASSES.map((asset) => (
          <li key={asset}>
            <Check size={15} strokeWidth={2.25} />
            <span>{asset}</span>
          </li>
        ))}
      </ul>
    </motion.div>
  );
}

export default function Pricing() {
  const sectionRef = useRef(null);
  const inView = useInView(sectionRef, { once: true, margin: "-80px" });

  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  // null while checking, true/false once known — avoids briefly
  // showing the wrong CTA before auth state resolves.
  const [isLoggedIn, setIsLoggedIn] = useState(null);

  useEffect(() => {
    getInvestmentPlans()
      .then(setPlans)
      .catch(err => console.error("Failed to load plans:", err))
      .finally(() => setLoading(false));

    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => setIsLoggedIn(!!data.user));
  }, []);

  const ctaHref = isLoggedIn ? "/portfolio" : "/signup";
  const ctaLabel = isLoggedIn ? "Invest now" : "Create account";

  // Middle plan (by sort order — min_amount ascending, same as
  // getInvestmentPlans()) is treated as "most popular", matching the
  // original static layout's middle-card emphasis.
  const highlightedIndex = Math.floor(plans.length / 2);

  return (
    <section className="pricing" id="pricing" ref={sectionRef}>
      <div className="pricing__inner">
        <motion.p
          className="pricing__eyebrow"
          initial={{ opacity: 0, y: 10 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5 }}
        >
          Investment plans
        </motion.p>

        <motion.h2
          className="pricing__headline"
          initial={{ opacity: 0, y: 16 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, delay: 0.1 }}
        >
          Real returns.<br />No hidden fees.
        </motion.h2>

        {!loading && (
          <div className="pricing__grid">
            {plans.map((plan, i) => (
              <PricingCard
                key={plan.id}
                plan={plan}
                index={i}
                inView={inView}
                highlighted={i === highlightedIndex}
                ctaHref={ctaHref}
                ctaLabel={ctaLabel}
              />
            ))}
          </div>
        )}

        <motion.div
          className="pricing__cta-band"
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5, delay: 0.4 }}
        >
          <div>
            <h3 className="pricing__cta-title">Still not sure?</h3>
            <p className="pricing__cta-text">
              {isLoggedIn ? "Head to your portfolio to explore plans." : "Create a free account — no card required to get started."}
            </p>
          </div>
          <a href={ctaHref} className="btn btn--primary">
            {isLoggedIn ? "Go to portfolio" : "Get started"}
          </a>
        </motion.div>
      </div>
    </section>
  );
}