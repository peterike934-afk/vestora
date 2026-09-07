"use client";

import { useRef } from "react";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { useReveal } from "@/hooks/useReveal";

export default function WhyVestora() {
  const ref = useRef(null);
  const { fadeUp, staggerChild } = useReveal(ref);
  const t = useTranslations("WhyVestora");
  const reasons = t.raw("reasons");

  return (
    <section className="why" id="about" ref={ref}>
      <div className="why__inner">
        <motion.p className="section-eyebrow" animate={fadeUp(0)}>
          {t("eyebrow")}
        </motion.p>

        <motion.h2 className="why__headline" animate={fadeUp(1)}>
          {t("headlineLine1")}<br />{t("headlineLine2")}
        </motion.h2>

        <div className="why__grid">
          {reasons.map((r, i) => (
            <motion.div
              key={r.title}
              className="why-card"
              animate={staggerChild(i)}
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