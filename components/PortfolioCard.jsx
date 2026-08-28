"use client";

import { useEffect, useState, useRef } from "react";
import { motion, useInView, animate } from "framer-motion";

function TickingNumber({ value, prefix = "", suffix = "", decimals = 0 }) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-40px" });
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (!isInView) return;
    const controls = animate(0, value, {
      duration: 1.4,
      delay: 0.6,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setDisplay(v),
    });
    return () => controls.stop();
  }, [isInView, value]);

  return (
    <span ref={ref} className="ticking-number">
      {prefix}{display.toFixed(decimals)}{suffix}
    </span>
  );
}

// Smooth, organic-looking line path for the chart — not a literal data plot,
// but reads as "real" growth rather than a generic decorative squiggle.
const CHART_PATH = "M0,118 C30,112 48,100 70,96 C95,91 110,104 135,98 C162,91 178,60 205,52 C232,44 250,66 278,58 C306,50 322,18 350,8";

function GrowthChart() {
  const pathRef = useRef(null);
  const isInView = useInView(pathRef, { once: true, margin: "-40px" });

  return (
    <svg viewBox="0 0 350 130" className="growth-chart" preserveAspectRatio="none">
      <defs>
        <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1F6F4A" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#1F6F4A" stopOpacity="0" />
        </linearGradient>
      </defs>

      <motion.path
        d={`${CHART_PATH} L350,130 L0,130 Z`}
        fill="url(#chartFill)"
        initial={{ opacity: 0 }}
        animate={isInView ? { opacity: 1 } : {}}
        transition={{ duration: 0.6, delay: 1.2 }}
      />

      <motion.path
        ref={pathRef}
        d={CHART_PATH}
        fill="none"
        stroke="#1F6F4A"
        strokeWidth="2.5"
        strokeLinecap="round"
        initial={{ pathLength: 0 }}
        animate={isInView ? { pathLength: 1 } : {}}
        transition={{ duration: 1.3, delay: 0.5, ease: [0.16, 1, 0.3, 1] }}
      />
    </svg>
  );
}

export default function PortfolioCard() {
  return (
    <div className="portfolio-grid">
      <div className="bento-card bento-card--chart">
        <div className="bento-card__head">
          <span className="bento-card__label">Total portfolio</span>
          <span className="bento-card__change">+12.4%</span>
        </div>
        <div className="bento-card__value">
          <TickingNumber value={48219} prefix="$" decimals={0} />
        </div>
        <GrowthChart />
      </div>

      <div className="bento-card bento-card--stat">
        <span className="bento-card__label">This month</span>
        <div className="bento-card__value bento-card__value--sm">
          <TickingNumber value={12.4} prefix="+" suffix="%" decimals={1} />
        </div>
      </div>

      <div className="bento-card bento-card--stat">
        <span className="bento-card__label">Available cash</span>
        <div className="bento-card__value bento-card__value--sm">
          <TickingNumber value={3842} prefix="$" decimals={0} />
        </div>
      </div>
    </div>
  );
}
