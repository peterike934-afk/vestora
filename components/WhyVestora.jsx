"use client";

import { motion } from "framer-motion";

const REASONS = [
  {
    title: "Secure by default",
    desc: "Assets held in segregated, insured custody accounts — never commingled with operating funds.",
  },
  {
    title: "Real-time analytics",
    desc: "Your portfolio updates live, with performance broken down by asset class, not buried in a PDF.",
  },
  {
    title: "Low, visible fees",
    desc: "A flat 0.25% annual fee. No trading commissions, no withdrawal penalties, no fine print.",
  },
  {
    title: "Built-in diversification",
    desc: "Every plan spreads risk across asset classes automatically, rebalanced as markets shift.",
  },
];

export default function WhyVestora() {
  return (
    <section className="why" id="about">
      <div className="why__inner">
        <motion.p
          className="section-eyebrow"
          initial={{ opacity: 0, y: 10 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.5 }}
        >
          Why Vestora
        </motion.p>

        <motion.h2
          className="why__headline"
          initial={{ opacity: 0, y: 14 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.6, delay: 0.05 }}
        >
          Built for people who'd<br />rather not think about it.
        </motion.h2>

        <div className="why__grid">
          {REASONS.map((r, i) => (
            <motion.div
              key={r.title}
              className="why-card"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.5, delay: i * 0.08, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="why-card__mark" aria-hidden="true" />
              <h3 className="why-card__title">{r.title}</h3>
              <p className="why-card__desc">{r.desc}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
