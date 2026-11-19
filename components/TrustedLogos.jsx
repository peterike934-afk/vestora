"use client";

import { useRef, useState } from "react";
import { motion, useInView } from "framer-motion";
import { useTranslations } from "next-intl";

const LOGOS = [
  { name: "Bitcoin", src: "/bitcoin.svg" },
  { name: "Ethereum", src: "/ethereum.svg" },
  { name: "Tether", src: "/tether.svg" },
  { name: "Binance", src: "/binance.svg" },
  { name: "Litecoin", src: "/litecoin.svg" },
  { name: "Visa", src: "/visa.svg" },
  { name: "Mastercard", src: "/mastercard.svg" },
  { name: "American Express", src: "/americanexpress.svg" },
  { name: "Stripe", src: "/stripe.svg" },
];

function LogoItem({ logo }) {
  const [failed, setFailed] = useState(false);

  return (
    <div className="trust__logo">
      {!failed ? (
        <img
          src={logo.src}
          alt={logo.name}
          className="trust__logo-img"
          onError={() => setFailed(true)}
          draggable={false}
        />
      ) : (
        <span className="trust__logo-fallback">{logo.name}</span>
      )}
    </div>
  );
}

function LogoTrack() {
  const doubled = [...LOGOS, ...LOGOS];
  return (
    <div className="trust__marquee-wrap">
      <div className="trust__marquee">
        {doubled.map((logo, i) => (
          <LogoItem key={i} logo={logo} />
        ))}
      </div>
    </div>
  );
}

export default function TrustedLogos() {
  const t = useTranslations("TrustedLogos");
  const sectionRef = useRef(null);
  const inView = useInView(sectionRef, { once: true, margin: "-80px" });

  return (
    <>
      <motion.p
        className="trust__label"
        initial={{ opacity: 0, y: 10 }}
        animate={inView ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 0.5 }}
        ref={sectionRef}
      >
        {t("fundYourAccount")}
      </motion.p>

      <section className="trust">
        <div className="trust__inner">
          <LogoTrack />

          <motion.div
            className="trust__divider"
            initial={{ scaleX: 0 }}
            animate={inView ? { scaleX: 1 } : {}}
            transition={{ duration: 0.8, delay: 0.2 }}
          />
        </div>
      </section>
    </>
  );
}