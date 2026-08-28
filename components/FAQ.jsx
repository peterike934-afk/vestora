"use client";

import { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useReveal } from "@/hooks/useReveal";

const FAQS = [
  {
    q: "How do I start investing?",
    a: "Create an account, complete a short risk assessment, and fund your wallet. You can start investing in under five minutes with as little as $500.",
  },
  {
    q: "Can I withdraw anytime?",
    a: "Yes. Cash balances are available immediately. Asset liquidations settle within 1–3 business days depending on the asset class.",
  },
  {
    q: "What assets are supported?",
    a: "Vestora supports equities (US and international), major cryptocurrencies, physical gold, and income-producing real estate. AI-managed portfolios spread across all four automatically.",
  },
  {
    q: "How does Vestora make money?",
    a: "A flat 0.25% annual management fee, charged monthly. No commissions, no spreads, no hidden charges. If your portfolio grows, we earn more — so our incentives are aligned.",
  },
  {
    q: "Is my money safe?",
    a: "Assets are held in segregated custody accounts, separate from Vestora's operating funds. Cash balances are held at FDIC-insured partner banks up to applicable limits.",
  },
];

function FAQItem({ item, index }) {
  const [open, setOpen] = useState(false);

  return (
    <div className={`faq-item${open ? " faq-item--open" : ""}`}>
      <button className="faq-item__trigger" onClick={() => setOpen(o => !o)}>
        <span>{item.q}</span>
        <svg
          className={`faq-item__icon${open ? " faq-item__icon--open" : ""}`}
          width="18" height="18" viewBox="0 0 24 24" fill="none"
        >
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className="faq-item__body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          >
            <p>{item.a}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function FAQ() {
  const ref = useRef(null);
  const { fadeUp, staggerChild } = useReveal(ref);

  return (
   <section className="faq" id="faq" ref={ref}>
      <div className="faq__inner">
        <motion.p className="section-eyebrow" animate={fadeUp(0)}>
          FAQ
        </motion.p>

        <motion.h2 className="faq__headline" animate={fadeUp(1)}>
          Common questions,<br />straight answers.
        </motion.h2>

        <div className="faq__list">
          {FAQS.map((item, i) => (
            <motion.div key={item.q} animate={staggerChild(i)}>
              <FAQItem item={item} index={i} />
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
