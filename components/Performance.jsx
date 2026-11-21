"use client";

import { useRef } from "react";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { useReveal } from "@/hooks/useReveal";

function PlatformPrinciple({ value }) {
  return (
    <span className="perf-stat__value">
      {value}
    </span>
  );
}

export default function Performance() {
  const ref = useRef(null);
  const { fadeUp, staggerChild, isInView } = useReveal(ref);
  const t = useTranslations("Performance");
  const stats = t.raw("stats");
  const principles = ["Fixed", "Review", "2FA"];

  return (
    <section className="perf" ref={ref}>
      <div className="perf__inner">
        <motion.p className="section-eyebrow" animate={fadeUp(0)}>
          {t("eyebrow")}
        </motion.p>

        <motion.h2 className="perf__headline" animate={fadeUp(1)}>
          {t("headlineLine1")}<br />{t("headlineLine2")}
        </motion.h2>

        <div className="perf__stats">
          {stats.map((stat, i) => (
            <motion.div
              key={stat.label}
              className="perf-stat"
              animate={staggerChild(i)}
            >
              <PlatformPrinciple value={principles[i]} />
              <p className="perf-stat__label">{stat.label}</p>
              <p className="perf-stat__note">{stat.note}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}