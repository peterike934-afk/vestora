"use client";

import { useRef, useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { getInvestmentPlans } from "@/lib/queries";
import { useReveal } from "@/hooks/useReveal";
import { useLocale } from "next-intl";

function formatAmount(n) {
  return `$${Number(n).toLocaleString()}`;
}

function formatRange(min, max) {
  if (max) return `${formatAmount(min)} – ${formatAmount(max)}`;
  return `${formatAmount(min)}+`;
}

function PricingCard({ plan, index, staggerChild, highlighted, ctaHref, ctaLabel }) {
  const t = useTranslations("Pricing");
  const assetClasses = t.raw("assetClasses");

  return (
    <motion.div
      className={`pricing-card ${highlighted ? "pricing-card--highlighted" : ""}`}
      animate={staggerChild(index)}
    >
      {highlighted && <span className="pricing-card__badge">{t("mostPopular")}</span>}

      <h3 className="pricing-card__name">{plan.name}</h3>
      <p className="pricing-card__desc">{plan.description}</p>

      <div className="pricing-card__price">
        <span className="pricing-card__amount">{plan.apy_percent}%</span>
        <span className="pricing-card__period">{t("apy")}</span>
      </div>
      <p style={{ fontSize: "13px", opacity: 0.7, marginTop: "-8px", marginBottom: "20px" }}>
        {t("investRange", { range: formatRange(plan.min_amount, plan.max_amount), days: plan.term_days })}
      </p>

      
       <a href={ctaHref}
        className={`btn ${highlighted ? "btn--primary" : "btn--ghost"} pricing-card__cta`}
      >
        {ctaLabel}
      </a>

      <ul className="pricing-card__features">
        {assetClasses.map((asset) => (
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
  const { fadeUp, staggerChild } = useReveal(sectionRef);
  const t = useTranslations("Pricing");
  const locale = useLocale();

  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isLoggedIn, setIsLoggedIn] = useState(null);

  useEffect(() => {
    getInvestmentPlans(locale)
      .then(setPlans)
      .catch(err => console.error("Failed to load plans:", err))
      .finally(() => setLoading(false));

    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => setIsLoggedIn(!!data.user));
  }, [locale]);
  

  const ctaHref = isLoggedIn ? "/portfolio" : "/signup";
  const ctaLabel = isLoggedIn ? t("ctaInvestNow") : t("ctaCreateAccount");
  const bandCtaLabel = isLoggedIn ? t("ctaGoToPortfolio") : t("ctaGetStarted");

  const highlightedIndex = Math.floor(plans.length / 2);

  return (
    <section className="pricing" id="pricing" ref={sectionRef}>
      <div className="pricing__inner">
        <motion.p className="pricing__eyebrow" animate={fadeUp(0)}>
          {t("eyebrow")}
        </motion.p>

        <motion.h2 className="pricing__headline" animate={fadeUp(1)}>
          {t("headlineLine1")}<br />{t("headlineLine2")}
        </motion.h2>

        {!loading && (
          <div className="pricing__grid">
            {plans.map((plan, i) => (
              <PricingCard
                key={plan.id}
                plan={plan}
                index={i}
                staggerChild={staggerChild}
                highlighted={i === highlightedIndex}
                ctaHref={ctaHref}
                ctaLabel={ctaLabel}
              />
            ))}
          </div>
        )}

        <motion.div className="pricing__cta-band" animate={fadeUp(2)}>
          <div>
            <h3 className="pricing__cta-title">{t("stillNotSure")}</h3>
            <p className="pricing__cta-text">
              {isLoggedIn ? t("bandTextLoggedIn") : t("bandTextLoggedOut")}
            </p>
          </div>
          <a href={ctaHref} className="btn btn--primary">
            {bandCtaLabel}
          </a>
        </motion.div>
      </div>
    </section>
  );
}