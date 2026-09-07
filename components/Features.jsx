"use client";

import { useRef } from "react";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { useReveal } from "@/hooks/useReveal";

export default function Features() {
  const ref = useRef(null);
  const { fadeUp, staggerChild } = useReveal(ref);
  const t = useTranslations("Features");
  const items = t.raw("items");

  return (
    <section className="features" id="product" ref={ref}>
      <div className="features__inner">
        <motion.p className="section-eyebrow" animate={fadeUp(0)}>
          {t("eyebrow")}
        </motion.p>

        <motion.h2 className="features__headline" animate={fadeUp(1)}>
          {t("headlineLine1")}<br />{t("headlineLine2")}
        </motion.h2>

        <div className="features__grid">
          {items.map((f, i) => (
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