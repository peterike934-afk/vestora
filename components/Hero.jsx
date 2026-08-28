"use client";

import { motion } from "framer-motion";
import PortfolioCard from "./PortfolioCard";

export default function Hero() {
  return (
    <section className="hero">
      <div className="hero__glow" aria-hidden="true" />

      <div className="hero__inner">
        <motion.p
          className="hero__eyebrow"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          Investing, simplified
        </motion.p>

        <motion.h1
          className="hero__headline"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1 }}
        >
          Grow your money<br />with quiet confidence.
        </motion.h1>

        <motion.p
          className="hero__subhead"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
        >
          One portfolio. Real-time growth. No noise.
        </motion.p>

        <motion.div
          className="hero__ctas"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3 }}
        >
          <a href="/signup" className="btn btn--primary">Start investing</a>
          <a href="/#product" className="btn btn--ghost">See how it works</a>
        </motion.div>

        <motion.div
          className="hero__card-wrap"
          initial={{ opacity: 0, y: 28 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.4, ease: [0.16, 1, 0.3, 1] }}
        >
          <PortfolioCard />
        </motion.div>
      </div>
    </section>
  );
}
