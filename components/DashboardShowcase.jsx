"use client";

import { useRef, useEffect } from "react";
import { gsap, ScrollTrigger } from "@/lib/gsap";
import { motion, useInView } from "framer-motion";
import { LineChart, Line, ResponsiveContainer, YAxis } from "recharts";
import { ArrowUpRight, ArrowDownRight, TrendingUp } from "lucide-react";

const CHART_DATA = [
  { v: 4200 }, { v: 4350 }, { v: 4180 }, { v: 4600 },
  { v: 4480 }, { v: 4900 }, { v: 5100 }, { v: 4950 },
  { v: 5400 }, { v: 5650 }, { v: 5500 }, { v: 5980 },
];

const ACTIVITY = [
  { label: "Deposit received", amount: "+$2,400", positive: true, time: "2m ago" },
  { label: "VOO purchase", amount: "−$850", positive: false, time: "1h ago" },
  { label: "Dividend payout", amount: "+$112.40", positive: true, time: "5h ago" },
  { label: "Rebalance executed", amount: "—", positive: true, time: "Yesterday" },
];

const ALLOCATION = [
  { label: "Equities", pct: 58, color: "var(--green)" },
  { label: "Bonds", pct: 27, color: "#9fc6b0" },
  { label: "Cash", pct: 15, color: "#d8e6dd" },
];

export default function DashboardShowcase() {
  const sectionRef = useRef(null);
  const glowRef = useRef(null);
  const inView = useInView(sectionRef, { once: true, margin: "-100px" });

  useEffect(() => {
    const glow = glowRef.current;
    if (!glow) return;

    const tween = gsap.to(glow, {
      y: 120,
      ease: "none",
      scrollTrigger: {
        trigger: sectionRef.current,
        start: "top bottom",
        end: "bottom top",
        scrub: true,
      },
    });

    return () => {
      tween.scrollTrigger?.kill();
      tween.kill();
    };
  }, []);

  return (
    <section className="showcase" ref={sectionRef}>
      <div className="showcase__glow" ref={glowRef} aria-hidden="true" />

      <div className="showcase__inner">
        <motion.p
          className="showcase__eyebrow"
          initial={{ opacity: 0, y: 10 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5 }}
        >
          Your portfolio, at a glance
        </motion.p>

        <motion.h2
          className="showcase__headline"
          initial={{ opacity: 0, y: 16 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, delay: 0.1 }}
        >
          Built for clarity,<br />not clutter.
        </motion.h2>

        <motion.div
          className="showcase__stage"
          initial={{ opacity: 0, y: 40 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.8, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
        >
          {/* ─── Main chart card ─────────────────── */}
          <div className="dash-card dash-card--main">
            <div className="dash-card__head">
              <div>
                <p className="dash-card__label">Total balance</p>
                <h3 className="dash-card__value">$59,842.10</h3>
              </div>
              <span className="dash-card__delta dash-card__delta--up">
                <ArrowUpRight size={14} /> 12.4%
              </span>
            </div>

            <div className="dash-card__chart">
              <ResponsiveContainer width="100%" height={120}>
                <LineChart data={CHART_DATA}>
                  <YAxis hide domain={["dataMin - 200", "dataMax + 200"]} />
                  <Line
                    type="monotone"
                    dataKey="v"
                    stroke="var(--green)"
                    strokeWidth={2.5}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="dash-card__foot">
              <span>1M</span>
              <span className="is-active">3M</span>
              <span>1Y</span>
              <span>All</span>
            </div>
          </div>

          {/* ─── Floating allocation widget ────────── */}
          <motion.div
            className="dash-card dash-card--float dash-card--allocation"
            animate={{ y: [0, -10, 0] }}
            transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
          >
            <p className="dash-card__label">Allocation</p>
            <div className="alloc-bar">
              {ALLOCATION.map((a) => (
                <div
                  key={a.label}
                  className="alloc-bar__seg"
                  style={{ width: `${a.pct}%`, background: a.color }}
                />
              ))}
            </div>
            <ul className="alloc-list">
              {ALLOCATION.map((a) => (
                <li key={a.label}>
                  <span className="alloc-dot" style={{ background: a.color }} />
                  {a.label}
                  <span className="alloc-pct">{a.pct}%</span>
                </li>
              ))}
            </ul>
          </motion.div>

          {/* ─── Floating activity widget ──────────── */}
          <motion.div
            className="dash-card dash-card--float dash-card--activity"
            animate={{ y: [0, 12, 0] }}
            transition={{ duration: 7, repeat: Infinity, ease: "easeInOut", delay: 0.5 }}
          >
            <p className="dash-card__label">Recent activity</p>
            <ul className="activity-list">
              {ACTIVITY.map((item) => (
                <li key={item.label}>
                  <span className={`activity-icon ${item.positive ? "is-up" : "is-down"}`}>
                    {item.positive ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
                  </span>
                  <div className="activity-text">
                    <span className="activity-label">{item.label}</span>
                    <span className="activity-time">{item.time}</span>
                  </div>
                  <span className={`activity-amount ${item.positive ? "is-up" : "is-down"}`}>
                    {item.amount}
                  </span>
                </li>
              ))}
            </ul>
          </motion.div>

          {/* ─── Floating mini stat badge ───────────── */}
          <motion.div
            className="dash-card dash-card--float dash-card--badge"
            animate={{ y: [0, -8, 0] }}
            transition={{ duration: 5, repeat: Infinity, ease: "easeInOut", delay: 1 }}
          >
            <TrendingUp size={16} />
            <span>Outperforming 91% of similar portfolios</span>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}
