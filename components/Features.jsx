"use client";

import { useRef } from "react";
import { motion } from "framer-motion";
import { useReveal } from "@/hooks/useReveal";

const FEATURES = [
  {
    label: "Stocks",
    title: "Equities, without the spreadsheet",
    desc: "Buy fractional shares in thousands of public companies, with automatic dividend reinvestment built in.",
  },
  {
    label: "Crypto",
    title: "Digital assets, properly custodied",
    desc: "Bitcoin, Ethereum, and a curated set of major tokens — held in cold storage, not a hot wallet.",
  },
  {
    label: "Gold",
    title: "A hedge that actually settles",
    desc: "Allocate into fully-backed physical gold, priced in real time and redeemable on request.",
  },
  {
    label: "Real estate",
    title: "Property, in any amount",
    desc: "Fractional ownership in vetted income-producing properties, starting at $50.",
  },
  {
    label: "AI portfolios",
    title: "Managed, not guessed",
    desc: "A model portfolio that rebalances on a schedule based on your risk profile, not market noise.",
  },
];

export default function Features() {
  const ref = useRef(null);
  const { fadeUp, staggerChild } = useReveal(ref);

  return (
    <section className="features" id="product" ref={ref}>
      <div className="features__inner">
        <motion.p className="section-eyebrow" animate={fadeUp(0)}>
          What you can hold
        </motion.p>

        <motion.h2 className="features__headline" animate={fadeUp(1)}>
          Five asset classes.<br />One account.
        </motion.h2>

        <div className="features__grid">
          {FEATURES.map((f, i) => (
            <motion.div
              key={f.label}
              className="feature-card"
              animate={staggerChild(i)}
            >
              <span className="feature-card__label">{f.label}</span>
              <h3 className="feature-card__title">{f.title}</h3>
              <p className="feature-card__desc">{f.desc}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
