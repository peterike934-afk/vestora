"use client";

import { useRef, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useReveal } from "@/hooks/useReveal";

const STATS = [
  { value: 18.4, suffix: "%", label: "Average annual return", note: "3-year average across all plans" },
  { value: 2.1,  suffix: "B", prefix: "$", label: "Assets under management", note: "Across 40,000+ portfolios" },
  { value: 42,   suffix: "K+", label: "Active investors", note: "In 28 countries" },
];

function CountUp({ value, prefix = "", suffix = "", decimals = 0, active }) {
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (!active) return;
    let start = null;
    const duration = 1400;
    const step = (ts) => {
      if (!start) start = ts;
      const progress = Math.min((ts - start) / duration, 1);
      const ease = 1 - Math.pow(1 - progress, 3);
      setDisplay(value * ease);
      if (progress < 1) requestAnimationFrame(step);
    };
    const id = requestAnimationFrame(step);
    return () => cancelAnimationFrame(id);
  }, [active, value]);

  return (
    <span className="perf-stat__value">
      {prefix}{display.toFixed(decimals)}{suffix}
    </span>
  );
}

export default function Performance() {
  const ref = useRef(null);
  const { fadeUp, staggerChild, isInView } = useReveal(ref);

  return (
    <section className="perf" ref={ref}>
      <div className="perf__inner">
        <motion.p className="section-eyebrow" animate={fadeUp(0)}>
          Performance
        </motion.p>

        <motion.h2 className="perf__headline" animate={fadeUp(1)}>
          Numbers that speak<br />for themselves.
        </motion.h2>

        <div className="perf__stats">
          {STATS.map((s, i) => (
            <motion.div
              key={s.label}
              className="perf-stat"
              animate={staggerChild(i)}
            >
              <CountUp
                value={s.value}
                prefix={s.prefix}
                suffix={s.suffix}
                decimals={s.suffix === "%" ? 1 : s.suffix === "B" ? 1 : 0}
                active={isInView}
              />
              <p className="perf-stat__label">{s.label}</p>
              <p className="perf-stat__note">{s.note}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
