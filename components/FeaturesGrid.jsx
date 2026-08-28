"use client";

import { useRef } from "react";
import { motion } from "framer-motion";
import { useReveal } from "@/hooks/useReveal";

const CARDS = [
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <rect x="4" y="3" width="16" height="18" rx="2" stroke="currentColor" strokeWidth="2"/>
        <path d="M8 8h8M8 12h8M8 16h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
      </svg>
    ),
    title: "Transparent investment plans",
    desc: "Fixed-term plans with a clear rate, minimum, and maturity date — know exactly what you're earning and when.",
  },
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <path d="M3 17l5-6 4 4 9-11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M16 4h5v5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
    title: "Real portfolio growth",
    desc: "Watch your investment value grow day by day, calculated transparently from your actual start date and rate.",
  },
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
    title: "Verified deposits & withdrawals",
    desc: "Every deposit and withdrawal is reviewed and confirmed by our team before it touches your balance, with a full record kept.",
  },
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="2"/>
        <path d="M8 11V7a4 4 0 0 1 8 0v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
      </svg>
    ),
    title: "Two-factor authentication",
    desc: "Secure your account with an authenticator app — once enabled, a code is required at every login.",
  },
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
    title: "Live support chat",
    desc: "Message our team directly from your dashboard and get replies in real time — no ticket numbers, no waiting on email.",
  },
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <rect x="5" y="4" width="14" height="17" rx="2" stroke="currentColor" strokeWidth="2"/>
        <path d="M9 4V2.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1V4" stroke="currentColor" strokeWidth="2"/>
        <path d="M9 11l2 2 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M8 16h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
      </svg>
    ),
    title: "Full accountability",
    desc: "Every action on your account — deposits, withdrawals, adjustments — is permanently logged. Nothing happens without a record.",
  },
];

export default function FeaturesGrid() {
  const ref = useRef(null);
  const { fadeUp, staggerChild } = useReveal(ref);

  return (
    <section className="fg" id="product" ref={ref}>
      <div className="fg__inner">
        <motion.p className="section-eyebrow" animate={fadeUp(0)}>
          Everything you need
        </motion.p>

        <motion.h2 className="fg__headline" animate={fadeUp(1)}>
          Built for serious investors.<br />Simple enough for first-timers.
        </motion.h2>

        <div className="fg__grid">
          {CARDS.map((card, i) => (
            <motion.div
              key={card.title}
              className="fg-card"
              animate={staggerChild(i)}
              whileHover={{ y: -4, transition: { duration: 0.2, ease: "easeOut" } }}
            >
              <div className="fg-card__icon">{card.icon}</div>
              <h3 className="fg-card__title">{card.title}</h3>
              <p className="fg-card__desc">{card.desc}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}