"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { useReveal } from "@/hooks/useReveal";
import { useRef } from "react";

export default function FinalCta() {
  const ref = useRef(null);
  const { fadeUp } = useReveal(ref);
  const t = useTranslations("FinalCta");

  return (
    <section className="final-cta" ref={ref}>
      <motion.div className="final-cta__inner" animate={fadeUp(0)}>
        <div>
          <p className="section-eyebrow">Get started</p>
          <h2>Create an account and explore your Vestora dashboard.</h2>
        </div>
        <div className="final-cta__actions">
          <a href="/signup" className="btn btn--primary">Create account</a>
          <a href="/#faq" className="btn btn--ghost">Read common questions</a>
        </div>
      </motion.div>
    </section>
  );
}
