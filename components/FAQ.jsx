"use client";

import { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslations } from "next-intl";
import { useReveal } from "@/hooks/useReveal";

function FAQItem({ item }) {
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
  const t = useTranslations("FAQ");
  const items = t.raw("items");

  return (
   <section className="faq" id="faq" ref={ref}>
      <div className="faq__inner">
        <motion.p className="section-eyebrow" animate={fadeUp(0)}>
          {t("eyebrow")}
        </motion.p>

        <motion.h2 className="faq__headline" animate={fadeUp(1)}>
          {t("headlineLine1")}<br />{t("headlineLine2")}
        </motion.h2>

        <div className="faq__list">
          {items.map((item, i) => (
            <motion.div key={item.q} animate={staggerChild(i)}>
              <FAQItem item={item} />
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}