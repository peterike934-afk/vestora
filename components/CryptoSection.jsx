"use client";

import { motion } from "framer-motion";
import { useRef } from "react";
import { useReveal } from "@/hooks/useReveal";

const ASSETS = [
  { symbol: "BTC", name: "Bitcoin", mark: "₿" },
  { symbol: "ETH", name: "Ethereum", mark: "Ξ" },
  { symbol: "USDT", name: "Tether", mark: "₮" },
];

export default function CryptoSection() {
  const ref = useRef(null);
  const { fadeUp, staggerChild } = useReveal(ref);

  return (
    <section className="crypto-section" id="crypto" ref={ref}>
      <div className="crypto-section__inner">
        <motion.div className="crypto-section__heading" animate={fadeUp(0)}>
          <p className="section-eyebrow">Digital assets</p>
          <h2>Crypto, in a clear<br />account workflow.</h2>
        </motion.div>
        <div className="crypto-section__content">
          <div className="crypto-list">
            {ASSETS.map((asset, i) => (
              <motion.div className="crypto-list__item" key={asset.symbol} animate={staggerChild(i)}>
                <span className="crypto-list__mark" aria-hidden="true">{asset.mark}</span>
                <div>
                  <strong>{asset.name}</strong>
                  <span>{asset.symbol}</span>
                </div>
                <span className="crypto-list__network">
                  {asset.symbol === "USDT" ? "ERC-20" : "Deposit enabled"}
                </span>
              </motion.div>
            ))}
          </div>
          <motion.div className="crypto-workflow" animate={fadeUp(1)}>
            <span className="crypto-workflow__label">Deposit workflow</span>
            <ol>
              <li><b>01</b><span>Choose an asset</span></li>
              <li><b>02</b><span>Send to the configured address</span></li>
              <li><b>03</b><span>Submit transaction details</span></li>
              <li><b>04</b><span>Track verification status</span></li>
            </ol>
            <a href="/signup" className="btn btn--primary">Open an account</a>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
