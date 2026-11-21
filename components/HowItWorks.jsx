"use client";

import { motion } from "framer-motion";
import { useRef } from "react";
import { useReveal } from "@/hooks/useReveal";

const STEPS = [
  { number: "01", title: "Create your account", text: "Register and sign in through Vestora's existing authentication workflow." },
  { number: "02", title: "Explore available plans", text: "Review published terms, amount ranges, and fixed durations before selecting a plan." },
  { number: "03", title: "Fund and track", text: "Submit a deposit or investment request, then follow the status in your account." },
];

export default function HowItWorks() {
  const ref = useRef(null);
  const { fadeUp, staggerChild } = useReveal(ref);

  return (
    <section className="how-section" id="how-it-works" ref={ref}>
      <div className="how-section__inner">
        <motion.div className="how-section__heading" animate={fadeUp(0)}>
          <p className="section-eyebrow">How it works</p>
          <h2>One account.<br />A clear sequence.</h2>
        </motion.div>
        <div className="how-section__steps">
          {STEPS.map((step, i) => (
            <motion.article key={step.number} animate={staggerChild(i)}>
              <span className="how-step__number">{step.number}</span>
              <div className="how-step__rule" aria-hidden="true" />
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </motion.article>
          ))}
        </div>
      </div>
    </section>
  );
}
